<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
if (PHP_SAPI !== 'cli') {
    respond(['error' => 'This utility runs from the command line only.'], 404);
}
set_exception_handler(function (Throwable $error): void {
    fwrite(STDERR, 'Restore failed: ' . $error->getMessage() . "\n");
    exit(1);
});
if ($argc !== 2) {
    fwrite(STDERR, "Usage: php restore.php /path/to/webhooktest-backup.json\nExisting IDs are preserved. Conflicting records stop the restore before writing.\n");
    exit(1);
}
$backup = json_decode(file_get_contents($argv[1]), true, 512, JSON_THROW_ON_ERROR);
if (($backup['format'] ?? '') !== 'webhooktest' || ($backup['version'] ?? null) !== 1 || !is_array($backup['requests'] ?? null)) {
    throw new RuntimeException('Not a Webhook Test version 1 backup.');
}
$records = [];
foreach ($backup['requests'] as $record) {
    if (!is_array($record) || !is_string($record['id'] ?? null) || !preg_match('/\A[a-f0-9]{32}\z/', $record['id']) || !is_string($record['inbox'] ?? null) || !preg_match('/\A[a-z0-9][a-z0-9_-]{0,63}\z/', $record['inbox'])) {
        throw new RuntimeException('Invalid request ID or inbox in backup.');
    }
    foreach (['received_at', 'method', 'uri', 'url', 'content_type', 'remote_addr', 'query', 'body_base64', 'body_encoding'] as $key) {
        if (!is_string($record[$key] ?? null)) {
            throw new RuntimeException('Missing or invalid request field: ' . $key);
        }
    }
    $body = base64_decode($record['body_base64'], true);
    if (!is_array($record['headers'] ?? null) || $body === false || !is_int($record['size'] ?? null) || strlen($body) !== $record['size'] || !in_array($record['body_encoding'], ['utf-8', 'base64'], true) || ($record['body_encoding'] === 'utf-8' && ($record['body'] ?? null) !== $body)) {
        throw new RuntimeException('Invalid body or headers for ' . $record['id']);
    }
    if (isset($records[$record['id']])) {
        throw new RuntimeException('Duplicate ID in backup: ' . $record['id']);
    }
    $records[$record['id']] = $record;
}
$count = storage(function (string $directory) use ($records): int {
    $new = [];
    foreach ($records as $id => $record) {
        $path = $directory . '/' . $id . '.json';
        if (is_file($path)) {
            if (read_capture($path) != $record) {
                throw new RuntimeException('Existing capture differs: ' . $id . '. Restore to an empty directory or resolve the conflict.');
            }
        } else {
            $new[$id] = $record;
        }
    }
    foreach ($new as $id => $record) {
        $record['headers'] = (object) $record['headers'];
        $json = json_encode($record, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
        $temporary = tempnam($directory, '.capture-');
        if ($temporary === false) {
            throw new RuntimeException('Cannot create restore file.');
        }
        try {
            if (file_put_contents($temporary, $json) !== strlen($json) || !rename($temporary, $directory . '/' . $id . '.json')) {
                throw new RuntimeException('Cannot restore capture. Retry after fixing storage; already restored records will be skipped.');
            }
        } finally {
            if (is_file($temporary)) {
                unlink($temporary);
            }
        }
    }
    return count($new);
}, true);
fwrite(STDOUT, "Restored $count requests; existing identical requests were kept.\n");
