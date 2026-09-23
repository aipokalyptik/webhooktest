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
    respond(['error' => 'Storage is unavailable. Check the writable JSON data directory and server logs; see README.md.'], 503);
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
    $local = is_file(__DIR__ . '/config.local.php') ? require __DIR__ . '/config.local.php' : [];
    $config = array_replace([
        // Keep captures out of the public webroot, without depending on web-server rules.
        'data_dir' => getenv('WEBHOOK_DATA_DIR') ?: dirname($root) . '/.webhooktest-' . substr(hash('sha256', $root), 0, 12),
        'base_url' => getenv('WEBHOOK_BASE_URL') ?: '',
        'max_body_bytes' => 10 * 1024 * 1024,
    ], $local);
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
    $directory = config()['data_dir'];
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

function capture_files(string $directory): Generator
{
    foreach (new DirectoryIterator($directory) as $file) {
        if ($file->isFile() && preg_match('/\\A[a-f0-9]{32}\\.json\\z/', $file->getFilename())) {
            yield $file->getPathname();
        }
    }
}

function save_capture(array $record): void
{
    storage(function (string $directory) use ($record): void {
        $json = json_encode($record, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR) . "\n";
        $temporary = tempnam($directory, '.capture-');
        if ($temporary === false) {
            throw new RuntimeException('Cannot create capture file.');
        }
        try {
            if (file_put_contents($temporary, $json) !== strlen($json) || !rename($temporary, $directory . '/' . $record['id'] . '.json')) {
                throw new RuntimeException('Cannot save capture.');
            }
        } finally {
            if (is_file($temporary)) {
                unlink($temporary);
            }
        }
    }, true);
}

function find_capture(string $id): ?array
{
    return storage(fn (string $directory): ?array => is_file($directory . '/' . $id . '.json') ? read_capture($directory . '/' . $id . '.json') : null);
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
