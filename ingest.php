<?php
declare(strict_types=1);
require __DIR__ . '/.conf/bootstrap.php';

// A receiver intentionally accepts cross-origin test traffic, including preflight.
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: ' . ($_SERVER['HTTP_ACCESS_CONTROL_REQUEST_HEADERS'] ?? '*'));
header('Access-Control-Expose-Headers: Location, X-Webhook-Id');
$preflight = $_SERVER['REQUEST_METHOD'] === 'OPTIONS' && isset($_SERVER['HTTP_ACCESS_CONTROL_REQUEST_METHOD']);
$name = inbox();
$type = $_SERVER['CONTENT_TYPE'] ?? '';
// PHP can consume multipart bodies before this script runs. Never report success
// for an empty substitute: the FastCGI setting, .user.ini, or CLI flag preserves bytes.
if ($_SERVER['REQUEST_METHOD'] === 'POST' && stripos($type, 'multipart/form-data') === 0 && filter_var(ini_get('enable_post_data_reading'), FILTER_VALIDATE_BOOLEAN)) {
    respond(['error' => 'Multipart capture requires enable_post_data_reading=Off. Use PHP_ADMIN_VALUE in .conf/nginx.conf, the included .user.ini, or the documented PHP CLI flag; see README.md.'], 503);
}
$limit = (int) config()['max_body_bytes'];
if ($limit < 1) {
    throw new RuntimeException('max_body_bytes must be positive.');
}
$input = fopen('php://input', 'rb');
$body = stream_get_contents($input, $limit + 1);
fclose($input);
if ($body === false) {
    throw new RuntimeException('Unable to read request body.');
}
if (strlen($body) > $limit) {
    respond(['error' => "Body exceeds the $limit byte limit."], 413);
}
$headers = function_exists('getallheaders') ? getallheaders() : [];
if (!$headers) {
    foreach ($_SERVER as $key => $value) {
        if (str_starts_with($key, 'HTTP_') || in_array($key, ['CONTENT_TYPE', 'CONTENT_LENGTH'], true)) {
            $headers[str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', preg_replace('/^HTTP_/', '', $key)))))] = $value;
        }
    }
}
$id = bin2hex(random_bytes(16));
$received = (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.u\Z');
$uri = $_SERVER['REQUEST_URI'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
$isText = preg_match('//u', $body) && !preg_match('/[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]/', $body);
save_capture([
    'version' => 1,
    'id' => $id,
    'inbox' => $name,
    'received_at' => $received,
    'method' => $method,
    'uri' => $uri,
    'url' => base_url() . '/ingest.php' . (($_SERVER['QUERY_STRING'] ?? '') !== '' ? '?' . $_SERVER['QUERY_STRING'] : ''),
    'content_type' => $type,
    'remote_addr' => $_SERVER['REMOTE_ADDR'] ?? '',
    'headers' => (object) $headers,
    'query' => $_SERVER['QUERY_STRING'] ?? '',
    'size' => strlen($body),
    'body' => $isText ? $body : null,
    'body_base64' => base64_encode($body),
    'body_encoding' => $isText ? 'utf-8' : 'base64',
]);
header('Location: ' . links($id)['permalink']);
header('X-Webhook-Id: ' . $id);
if ($preflight) {
    http_response_code(204);
    exit;
}
respond(['ok' => true, 'id' => $id, 'inbox' => $name, 'received_at' => $received, 'size' => strlen($body)] + links($id), 201);
