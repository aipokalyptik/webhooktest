<?php
declare(strict_types=1);
// Router for PHP's development server. Apache/FPM uses the actual .php files.
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/');
$entry = ['/' => 'index.php', '/index.php' => 'index.php', '/api.php' => 'api.php', '/ingest.php' => 'ingest.php'];
if (isset($entry[$path])) {
    $_SERVER['SCRIPT_NAME'] = '/' . $entry[$path];
    require __DIR__ . '/' . $entry[$path];
} elseif ($path === '/robots.txt') {
    require __DIR__ . '/bootstrap.php';
    header('Content-Type: text/plain; charset=utf-8');
    readfile(__DIR__ . '/robots.txt');
} else {
    require __DIR__ . '/bootstrap.php';
    respond(['error' => 'Not found.'], 404);
}
