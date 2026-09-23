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
    fwrite(STDERR, "Usage: php .conf/restore.php /path/to/webhooktest-backup.json\nExisting IDs are preserved. Conflicting records stop the restore before writing.\n");
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
        $path = find_capture_path($directory, $id);
        if ($path !== null) {
            if (read_stored_capture($directory, $path) != $record) {
                throw new RuntimeException('Existing capture differs: ' . $id . '. Restore to an empty directory or resolve the conflict.');
            }
        } else {
            $new[$id] = $record;
        }
    }
    foreach ($new as $record) {
        write_capture($directory, $record);
    }
    return count($new);
}, true);
fwrite(STDOUT, "Restored $count requests; existing identical requests were kept.\n");
