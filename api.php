<?php
declare(strict_types=1);
require __DIR__ . '/.conf/bootstrap.php';
$action = param('action', 'list');

if (in_array($action, ['list', 'search-preview'], true)) {
    require __DIR__ . '/.conf/search.php';
    try {
        require_method(['GET', 'HEAD']);
        $name = inbox();
        $query = param('q');
        if (strlen($query) > 500) {
            respond(['error' => 'Search is limited to 500 bytes.'], 400);
        }
        $search = compile_search(param('filters'), $query);
        $page = filter_var(param('page', '1'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 1000000]]);
        if ($page === false) {
            respond(['error' => 'Invalid page.'], 400);
        }
        $data = storage(function (string $directory) use ($name, $search, $page): array {
            $items = [];
            $inboxes = [];
            $stats = ['total' => 0, 'bytes' => 0, 'latest' => null];
            foreach (capture_files($directory) as $path) {
                search_check_time($search);
                $folderInbox = capture_folder_inbox($path);
                if ($folderInbox !== $name) {
                    $inboxes[$folderInbox] = ($inboxes[$folderInbox] ?? 0) + 1;
                    continue;
                }
                $record = read_stored_capture($directory, $path);
                $inboxes[$record['inbox']] = ($inboxes[$record['inbox']] ?? 0) + 1;
                $stats['total']++;
                $stats['bytes'] += $record['size'];
                $stats['latest'] = max($stats['latest'] ?? '', $record['received_at']);
                $evidence = match_search($record, $search);
                if ($evidence === null) continue;
                $items[] = array_intersect_key($record, array_flip(['id', 'inbox', 'received_at', 'method', 'uri', 'content_type', 'size'])) + ['matches' => $evidence];
            }
            usort($items, fn ($a, $b) => [$b['received_at'], $b['id']] <=> [$a['received_at'], $a['id']]);
            $matched = count($items);
            $pages = max(1, (int) ceil($matched / 50));
            $page = min($page, $pages);
            ksort($inboxes);
            return ['requests' => array_slice($items, ($page - 1) * 50, 50), 'matched' => $matched, 'page' => $page, 'pages' => $pages, 'stats' => $stats, 'inboxes' => array_map(fn ($name, $count) => ['name' => (string) $name, 'count' => $count], array_keys($inboxes), array_values($inboxes)), 'max_body_bytes' => config()['max_body_bytes']];
        });
        if ($action === 'search-preview') {
            $data['requests'] = array_slice($data['requests'], 0, 3);
            $data['selections'] = [];
            if (param('sample') !== '') {
                $id = param('sample');
                if (!preg_match('/\A[a-f0-9]{32}\z/', $id)) throw new SearchError('Invalid preview request ID.');
                $record = find_capture($id);
                if ($record && $record['inbox'] === $name) {
                    $cache = [];
                    foreach ($search['rules'] as $i => $rule) {
                        if ($rule['scope'] !== 'json') continue;
                        $selection = search_values($record, $rule, $cache);
                        $data['selections'][] = ['condition' => $i + 1, 'applicable' => $selection['applicable'], 'count' => count($selection['values']), 'values' => array_map(fn ($v) => substr($v[1], 0, 300), array_slice($selection['values'], 0, 3))];
                    }
                }
            }
        }
        respond($data);
    } catch (SearchError $error) {
        respond(['error' => $error->getMessage()], 422);
    }
}

if (in_array($action, ['request', 'download', 'export', 'delete'], true)) {
    require_method($action === 'delete' ? ['DELETE'] : ['GET', 'HEAD']);
    $id = request_id();
    if ($action === 'delete') {
        $deleted = storage(function (string $directory) use ($id): bool {
            $path = find_capture_path($directory, $id);
            if ($path === null) {
                return false;
            }
            if (!unlink($path)) {
                throw new RuntimeException('Cannot delete capture.');
            }
            prune_capture_directories($directory, $path);
            return true;
        }, true);
        respond($deleted ? ['ok' => true] : ['error' => 'This request was deleted or does not exist.'], $deleted ? 200 : 404);
    }
    $request = find_capture($id);
    if (!$request) {
        respond(['error' => 'This request was deleted or does not exist.'], 404);
    }
    if ($action === 'download') {
        $body = base64_decode($request['body_base64'], true);
        if ($body === false) {
            throw new RuntimeException('Invalid Base64 in capture.');
        }
        header('Content-Type: application/octet-stream');
        header('Content-Disposition: attachment; filename="webhook-' . $id . '.bin"');
        header('Content-Length: ' . strlen($body));
        echo $body;
        exit;
    }
    if ($action === 'request') {
        // Inspection is computed on demand, outside the storage lock. It never
        // changes captures/exports and must not hide a body if a detector fails.
        try {
            require_once __DIR__ . '/.conf/inspect.php';
            $request['inspection'] = inspect_capture($request);
        } catch (Throwable $error) {
            error_log('Webhook Test inspection: ' . $error->getMessage());
            $request['inspection'] = ['warnings' => ['File inspection is unavailable; original bytes are preserved.']];
        }
    }
    $request['headers'] = (object) $request['headers'];
    if ($action === 'export') {
        header('Content-Disposition: attachment; filename="webhook-' . $id . '.json"');
    }
    respond($request + links($id));
}

if ($action === 'maintenance' || $action === 'clear') {
    require_method($action === 'clear' ? ['DELETE'] : ['GET', 'DELETE']);
    $scope = param('scope', 'inbox');
    if (!in_array($scope, ['inbox', 'all'], true) || ($action === 'clear' && $scope !== 'inbox')) {
        respond(['error' => 'Invalid cleanup scope.'], 400);
    }
    $name = inbox();
    $cutoff = param('before');
    if ($cutoff !== '') {
        $date = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s\Z', $cutoff, new DateTimeZone('UTC'));
        if (!$date || $date->format('Y-m-d\TH:i:s\Z') !== $cutoff) {
            respond(['error' => 'Use a UTC cutoff such as 2026-01-01T00:00:00Z.'], 400);
        }
        $cutoff = $date->format('Y-m-d\TH:i:s.u\Z');
    }
    $delete = $_SERVER['REQUEST_METHOD'] === 'DELETE';
    $confirm = $scope === 'all' ? 'all' : $name;
    $confirmationHeader = $action === 'clear' ? 'HTTP_X_CONFIRM_INBOX' : 'HTTP_X_CONFIRM_SCOPE';
    if ($delete && ($_SERVER[$confirmationHeader] ?? '') !== $confirm) {
        respond(['error' => 'Send ' . ($action === 'clear' ? 'X-Confirm-Inbox' : 'X-Confirm-Scope') . ' with ' . $confirm . '.'], 400);
    }
    $data = storage(function (string $directory) use ($scope, $name, $cutoff, $delete): array {
        $matching = ['count' => 0, 'bytes' => 0];
        $totals = ['count' => 0, 'bytes' => 0];
        $storageBytes = 0;
        $paths = [];
        foreach (capture_files($directory) as $path) {
            $record = read_stored_capture($directory, $path);
            $totals['count']++;
            $totals['bytes'] += $record['size'];
            $storageBytes += filesize($path);
            if (($scope === 'all' || $record['inbox'] === $name) && ($cutoff === '' || $record['received_at'] < $cutoff)) {
                $matching['count']++;
                $matching['bytes'] += $record['size'];
                $paths[] = $path;
            }
        }
        // Finish validation before deleting, so a malformed document cannot cause a partial scan cleanup.
        if ($delete) {
            foreach ($paths as $path) {
                if (!unlink($path)) {
                    throw new RuntimeException('Cleanup interrupted; some matching files may already be deleted.');
                }
                prune_capture_directories($directory, $path);
            }
            return ['ok' => true, 'deleted' => count($paths)];
        }
        return ['matching' => $matching, 'totals' => $totals, 'storage_bytes' => $storageBytes];
    }, $delete);
    respond($data);
}
if ($action === 'backup') {
    require_method(['GET']);
    // Assemble a consistent backup under the shared lock, then release it before sending
    // to a potentially slow client. Temporary snapshots stay outside the webroot.
    $snapshot = storage(function (string $directory): string {
        $path = tempnam($directory, '.backup-');
        if ($path === false) {
            throw new RuntimeException('Cannot create backup.');
        }
        $output = fopen($path, 'wb');
        $write = function (string $data) use ($output): void {
            if (fwrite($output, $data) !== strlen($data)) {
                throw new RuntimeException('Cannot write backup.');
            }
        };
        try {
            $write('{"format":"webhooktest","version":1,"exported_at":' . json_encode(gmdate('Y-m-d\TH:i:s\Z')) . ',"requests":[');
            $first = true;
            foreach (capture_files($directory) as $file) {
                $record = read_stored_capture($directory, $file);
                $record['headers'] = (object) $record['headers'];
                $write(($first ? '' : ',') . json_encode($record, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
                $first = false;
            }
            $write(']}');
        } catch (Throwable $error) {
            unlink($path);
            throw $error;
        } finally {
            fclose($output);
        }
        return $path;
    });
    try {
        header('Content-Type: application/json; charset=utf-8');
        header('Content-Disposition: attachment; filename="webhooktest-' . gmdate('Y-m-d-His') . '.json"');
        header('Content-Length: ' . filesize($snapshot));
        readfile($snapshot);
    } finally {
        unlink($snapshot);
    }
    exit;
}
respond(['error' => 'Unknown action.'], 404);
