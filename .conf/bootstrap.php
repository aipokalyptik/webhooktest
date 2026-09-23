<?php
declare(strict_types=1);

// Every application response, including failures and assets, is deliberately ephemeral.
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: Thu, 01 Jan 1970 00:00:00 GMT');
header('X-Robots-Tag: noindex, nofollow, noarchive, nosnippet');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
ini_set('display_errors', '0');

function respond(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR);
    exit;
}

set_exception_handler(function (Throwable $error): void {
    error_log('Webhook Test: ' . $error->getMessage());
    respond(['error' => 'Storage is unavailable. Set data_dir in .conf/config.php to a persistent directory writable by PHP. Check .conf/config.local.php for overrides and the server logs for details.'], 503);
});

function param(string $name, string $default = ''): string
{
    $value = $_GET[$name] ?? $default;
    if (!is_string($value)) {
        respond(['error' => "Invalid parameter: $name"], 400);
    }
    return $value;
}

function inbox(): string
{
    $name = param('inbox', 'default');
    if (!preg_match('/\A[a-z0-9][a-z0-9_-]{0,63}\z/', $name)) {
        respond(['error' => 'Inbox names use 1–64 lowercase letters, numbers, hyphens, or underscores.'], 400);
    }
    return $name;
}

function request_id(): string
{
    $id = param('id');
    if (!preg_match('/\A[a-f0-9]{32}\z/', $id)) {
        respond(['error' => 'Invalid request ID.'], 400);
    }
    return $id;
}

function config(): array
{
    static $config;
    if ($config !== null) {
        return $config;
    }
    $root = dirname(__DIR__);
    $settings = [];
    // Load the main configuration first, then optional machine-specific overrides.
    foreach (['config.php', 'config.local.php'] as $filename) {
        if (is_file(__DIR__ . '/' . $filename)) {
            $values = require __DIR__ . '/' . $filename;
            if (!is_array($values)) {
                throw new RuntimeException('.conf/' . $filename . ' must return a settings array.');
            }
            $settings = array_replace($settings, $values);
        }
    }
    $config = array_replace([
        // Keep captures out of the public webroot, without depending on web-server rules.
        'data_dir' => getenv('WEBHOOK_DATA_DIR') ?: dirname($root) . '/.webhooktest-' . substr(hash('sha256', $root), 0, 12),
        'base_url' => getenv('WEBHOOK_BASE_URL') ?: '',
        'max_body_bytes' => 10 * 1024 * 1024,
    ], $settings);
    return $config;
}

function base_url(): string
{
    $configured = config()['base_url'];
    if ($configured !== '') {
        return rtrim($configured, '/');
    }
    $scheme = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off' ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $directory = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/index.php'));
    return $scheme . '://' . $host . ($directory === '/' ? '' : $directory);
}

/** One JSON document per capture; a shared lock makes scans and cleanups consistent. */
function storage(callable $operation, bool $write = false): mixed
{
    $directory = rtrim(config()['data_dir'], '/\\') ?: DIRECTORY_SEPARATOR;
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('Cannot create data directory: ' . $directory);
    }
    $lock = fopen($directory . '/.lock', 'c');
    if (!$lock) {
        throw new RuntimeException('Cannot open storage lock.');
    }
    // Bound lock waits so a stalled process cannot hang every request indefinitely.
    $deadline = microtime(true) + 5;
    while (!flock($lock, ($write ? LOCK_EX : LOCK_SH) | LOCK_NB)) {
        if (microtime(true) >= $deadline) {
            fclose($lock);
            throw new RuntimeException('Storage is busy. Retry shortly.');
        }
        usleep(10000);
    }
    try {
        return $operation($directory);
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function read_capture(string $path): array
{
    $json = file_get_contents($path);
    if ($json === false) {
        throw new RuntimeException('Cannot read capture: ' . basename($path));
    }
    $record = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($record)) {
        throw new RuntimeException('Invalid capture: ' . basename($path));
    }
    foreach (['id', 'inbox', 'received_at', 'method', 'uri', 'url', 'content_type', 'remote_addr', 'query', 'body_base64', 'body_encoding'] as $field) {
        if (!is_string($record[$field] ?? null)) {
            throw new RuntimeException('Invalid capture field ' . $field . ': ' . basename($path));
        }
    }
    if ($record['id'] . '.json' !== basename($path) || !is_array($record['headers'] ?? null) || !is_int($record['size'] ?? null) || $record['size'] < 0 || !in_array($record['body_encoding'], ['utf-8', 'base64'], true) || ($record['body_encoding'] === 'utf-8' && !is_string($record['body'] ?? null))) {
        throw new RuntimeException('Invalid capture: ' . basename($path));
    }
    return $record;
}

/** Directory traversal is deliberately bounded to inbox / hex / hex. */
function matching_directories(string $directory, string $pattern): Generator
{
    foreach (new DirectoryIterator($directory) as $entry) {
        if (!$entry->isLink() && $entry->isDir() && preg_match($pattern, $entry->getFilename())) {
            yield $entry->getFilename() => $entry->getPathname();
        }
    }
}

function capture_inboxes(string $directory): Generator
{
    yield from matching_directories($directory, '/\A[a-z0-9][a-z0-9_-]{0,63}\z/');
}

function shard_capture_files(string $directory): Generator
{
    foreach (new DirectoryIterator($directory) as $entry) {
        if (!$entry->isLink() && $entry->isFile() && preg_match('/\A[a-f0-9]{32}\.json\z/', $entry->getFilename())) {
            yield $entry->getPathname();
        }
    }
}

function capture_files(string $directory): Generator
{
    foreach (capture_inboxes($directory) as $inboxDirectory) {
        foreach (matching_directories($inboxDirectory, '/\A[a-f0-9]\z/') as $first => $firstDirectory) {
            foreach (matching_directories($firstDirectory, '/\A[a-f0-9]\z/') as $second => $shardDirectory) {
                foreach (shard_capture_files($shardDirectory) as $path) {
                    if (str_starts_with(basename($path), (string) $first . $second)) {
                        yield $path;
                    }
                }
            }
        }
    }
}

function capture_path(string $directory, string $inbox, string $id): string
{
    if (!preg_match('/\A[a-z0-9][a-z0-9_-]{0,63}\z/', $inbox) || !preg_match('/\A[a-f0-9]{32}\z/', $id)) {
        throw new RuntimeException('Invalid inbox or ID in stored capture.');
    }
    return $directory . '/' . $inbox . '/' . $id[0] . '/' . $id[1] . '/' . $id . '.json';
}

/** The folder supplies inbox names without decoding other inboxes' payloads. */
function capture_folder_inbox(string $path): string
{
    return basename(dirname($path, 3));
}

function read_stored_capture(string $directory, string $path): array
{
    $record = read_capture($path);
    $expected = capture_path($directory, $record['inbox'], $record['id']);
    if ($path !== $expected) {
        throw new RuntimeException('Capture metadata does not match its storage directory: ' . basename($path));
    }
    return $record;
}

/** ID-only permalinks probe one known shard per inbox, without scanning payloads. */
function find_capture_path(string $directory, string $id): ?string
{
    $match = null;
    foreach (capture_inboxes($directory) as $name => $inboxDirectory) {
        $path = capture_path($directory, (string) $name, $id);
        if (is_file($path) && !is_link($path) && !is_link(dirname($path)) && !is_link(dirname($path, 2))) {
            if ($match !== null) {
                throw new RuntimeException('Duplicate capture ID: ' . $id);
            }
            $match = $path;
        }
    }
    return $match;
}

function ensure_capture_directory(string $path): void
{
    for ($level = 1; $level <= 3; $level++) {
        if (is_link(dirname($path, $level))) {
            throw new RuntimeException('Capture directories must not be symbolic links.');
        }
    }
    $directory = dirname($path);
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('Cannot create capture shard directory.');
    }
}

/** Called with the exclusive storage lock held; publish only complete JSON files. */
function write_capture(string $directory, array $record): void
{
    $path = capture_path($directory, $record['inbox'], $record['id']);
    ensure_capture_directory($path);
    $record['headers'] = (object) $record['headers'];
    $json = json_encode($record, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR) . "\n";
    $temporary = tempnam(dirname($path), '.capture-');
    if ($temporary === false) {
        throw new RuntimeException('Cannot create capture file.');
    }
    try {
        if (file_put_contents($temporary, $json) !== strlen($json) || !rename($temporary, $path)) {
            throw new RuntimeException('Cannot save capture.');
        }
    } finally {
        if (is_file($temporary)) {
            unlink($temporary);
        }
    }
}

function save_capture(array $record): void
{
    storage(function (string $directory) use ($record): void {
        if (find_capture_path($directory, $record['id']) !== null) {
            throw new RuntimeException('Capture ID already exists.');
        }
        write_capture($directory, $record);
    }, true);
}

/** Remove only empty shard/inbox directories, never unrelated files or the data root. */
function prune_capture_directories(string $directory, string $path): void
{
    $parent = dirname($path);
    for ($level = 0; $level < 3 && $parent !== $directory; $level++) {
        if (!is_dir($parent) || is_link($parent)) {
            break;
        }
        foreach (new DirectoryIterator($parent) as $entry) {
            if (!$entry->isDot()) {
                return;
            }
        }
        if (!rmdir($parent)) {
            throw new RuntimeException('Capture deleted, but an empty shard directory could not be removed.');
        }
        $parent = dirname($parent);
    }
}

function find_capture(string $id): ?array
{
    return storage(function (string $directory) use ($id): ?array {
        $path = find_capture_path($directory, $id);
        return $path === null ? null : read_stored_capture($directory, $path);
    });
}

function links(string $id): array
{
    return [
        'permalink' => base_url() . '/index.php?request=' . $id,
        'api_url' => base_url() . '/api.php?action=request&id=' . $id,
        'download_url' => base_url() . '/api.php?action=download&id=' . $id,
    ];
}

function require_method(array $methods): void
{
    if (!in_array($_SERVER['REQUEST_METHOD'], $methods, true)) {
        header('Allow: ' . implode(', ', $methods));
        respond(['error' => 'Method not allowed.'], 405);
    }
}
