<?php
declare(strict_types=1);

require __DIR__ . '/../.conf/inspect.php';
set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
    if (!(error_reporting() & $severity)) {
        return false;
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

$checks = 0;
function check(bool $condition, string $message): void
{
    global $checks;
    $checks++;
    if (!$condition) {
        throw new RuntimeException($message);
    }
}
function inspect_fixture(string $raw, array $headers = []): array
{
    return inspect_capture(['body_base64' => base64_encode($raw), 'headers' => $headers, 'content_type' => '']);
}
function body_fixture(string $raw, array $headers = []): array
{
    return inspect_fixture($raw, $headers)['body'];
}

$png = "\x89PNG\r\n\x1a\n\0\xff\x80payload";
$body = body_fixture($png, ['Content-Type' => 'text/plain; charset=utf-8', 'Content-Disposition' => 'attachment; filename="notes.txt"']);
check($body['kind'] === 'binary' && $body['mime'] === 'image/png', 'PNG signature must override text header and filename');
check($body['filename'] === 'notes.txt' && $body['extension'] === 'txt', 'Keep filename evidence despite disagreement');
check(count($body['warnings']) > 0, 'Explain declared type disagreement');
check(!isset($body['text']) && !isset($body['encoding']), 'Binary metadata must not include a decoded text copy');
check($body['offset'] === 0 && $body['length'] === strlen($png), 'Whole-body offsets must refer to original bytes');
$falseMultipart = inspect_fixture($png, ['Content-Type' => 'multipart/form-data; boundary=unused']);
check($falseMultipart['body']['kind'] === 'binary' && $falseMultipart['body']['mime'] === 'image/png', 'A lying multipart header cannot override a bare PNG');
check($falseMultipart['warnings'] !== [] && $falseMultipart['body']['warnings'] !== [], 'A false multipart claim reports missing boundary lines alongside the real type');
$falseMultipart = inspect_fixture('{"hello":1}', ['Content-Type' => 'multipart/form-data; boundary=unused']);
check($falseMultipart['body']['kind'] === 'text' && $falseMultipart['body']['mime'] === 'application/json' && $falseMultipart['warnings'] !== [], 'A false multipart claim cannot override complete JSON structure');
$pdf = body_fixture("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF", ['Content-Type' => 'text/plain']);
check($pdf['kind'] === 'binary' && $pdf['mime'] === 'application/pdf', 'ASCII PDF signature still means binary document view');
foreach ([
    ["\xff\xd8\xff\0", 'image/jpeg'], ['GIF89a' . str_repeat("\0", 16), 'image/gif'],
    ["PK\x03\x04\0", 'application/zip'], ["\x1f\x8b\x08\0", 'application/gzip'],
    ["\x28\xb5\x2f\xfd\0", 'application/zstd'],
    ['RIFF' . pack('V', 12) . 'WEBP' . 'VP8 ', 'image/webp'],
    [pack('N', 24) . 'ftypavif' . str_repeat("\0", 12), 'image/avif'],
    ["\0asm\x01\0\0\0", 'application/wasm'],
] as [$raw, $mime]) {
    $body = body_fixture($raw);
    check($body['kind'] === 'binary' && $body['mime'] === $mime, "Detect deterministic signature {$mime}");
}
foreach ([
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
    'application/vnd.oasis.opendocument.text',
    'application/epub+zip',
    'application/java-archive',
    'application/x-zip-compressed',
] as $declared) {
    $body = body_fixture("PK\x03\x04\0", ['Content-Type' => $declared]);
    check($body['kind'] === 'binary' && $body['mime'] === 'application/zip' && $body['warnings'] === [], "ZIP container is compatible with {$declared}, without claiming inner format");
}
$body = body_fixture("\x1f\x8b\x08\0", ['Content-Type' => 'application/x-gzip']);
check($body['mime'] === 'application/gzip' && $body['warnings'] === [], 'Legacy gzip MIME alias is not a mismatch');
$gzipJson = base64_decode('H4sIAAAAAAAAE6tWykjNyclXsjKsBQA5PvBhCwAAAA==', true); // gzip of {"hello":1}; no zlib requirement.
$body = body_fixture($gzipJson, ['Content-Type' => 'application/json', 'Content-Encoding' => 'gzip']);
check($body['kind'] === 'binary' && $body['mime'] === 'application/gzip' && $body['warnings'] === [], 'Gzip-encoded JSON is a consistent declaration and remains binary');
check($body['length'] === strlen($gzipJson) && !isset($body['text']) && !isset($body['encoding']), 'Compressed bytes remain intact rather than becoming a decompressed preview');
check($body['contentEncoding'] === 'gzip' && in_array('Encoded body', array_column($body['evidence'], 'source'), true), 'Content coding and untouched encoded-byte explanation appear in detection evidence');
check(body_fixture($gzipJson, ['Content-Type' => 'application/json'])['warnings'] !== [], 'Gzip signature without Content-Encoding still disagrees with a plain JSON declaration');
$body = body_fixture($png, ['Content-Type' => 'application/json', 'Content-Encoding' => 'gzip']);
check(count($body['warnings']) === 2 && $body['mime'] === 'image/png', 'A PNG falsely labeled gzip does not suppress content-type or content-coding disagreements');
$body = body_fixture($gzipJson, ['Content-Type' => 'application/json', 'Content-Encoding' => 'gzip, x-gzip']);
check($body['warnings'] === [], 'The final declared content coding describes the outer captured signature');
$body = body_fixture($gzipJson, ['Content-Type' => 'application/json', 'Content-Encoding' => 'gzip, zstd']);
check($body['warnings'] !== [], 'An inner gzip declaration cannot excuse a conflicting outer zstd declaration');
$body = body_fixture("\x28\xb5\x2f\xfd\0", ['Content-Type' => 'application/json', 'Content-Encoding' => 'zstd']);
check($body['mime'] === 'application/zstd' && $body['kind'] === 'binary' && $body['warnings'] === [], 'Zstandard coding is recognized without decompressing or assuming decoded format');
check(body_fixture("PK\x03\x04\0", ['Content-Type' => 'application/pdf'])['warnings'] !== [], 'A ZIP labeled PDF must still report disagreement');
check(body_fixture("PK\x03\x04\0", ['Content-Type' => 'application/vnd.oasis.opendocument.text-flat-xml'])['warnings'] !== [], 'Flat XML OpenDocument is not assumed to be a ZIP container');
$body = body_fixture('Readable content despite this filename', ['Content-Disposition' => 'attachment; filename="photo.png"']);
check($body['kind'] === 'text' && $body['extension'] === 'png', 'A binary-looking filename must not force text into binary mode');

$json = '{"id":18446744073709551615,"emoji":"🦄"}';
$body = body_fixture($json, ['Content-Type' => 'application/octet-stream']);
check($body['kind'] === 'text' && $body['format'] === 'json' && $body['encoding'] === 'utf-8', 'Recognize JSON despite generic declared type');
check(!isset($body['text']), 'UTF-8 descriptors should use original bytes instead of another body copy');
$body = body_fixture("hello\0world", ['Content-Type' => 'application/json', 'Content-Disposition' => 'attachment; filename="file.json"']);
check($body['kind'] === 'binary' && !isset($body['encoding']), 'Language hints must not turn control-byte bodies into text');
check(body_fixture("bad\xfftext")['kind'] === 'binary', 'Invalid UTF-8 without charset uses binary mode');
check(body_fixture(str_repeat('a', 1048600) . "\0")['kind'] === 'binary', 'Binary bytes after the one MiB sniff window must be detected');
check(body_fixture(str_repeat('a', 1048600) . "\xff")['kind'] === 'binary', 'Invalid UTF-8 after the sniff window must be detected');
check(body_fixture("plain text\twith tabs\r\nand lines")['kind'] === 'text', 'Ordinary text whitespace remains text');
$body = body_fixture('<?php echo "hello"; ?>', ['Content-Disposition' => 'attachment; filename="script.php"']);
check($body['kind'] === 'text' && $body['extension'] === 'php', 'A source-code MIME or extension must stay text');
check(body_fixture('#!/usr/bin/env python3' . "\nprint('hello')\n")['format'] === 'python', 'Recognize an explicit interpreter line');
check(body_fixture('<!doctype html><html><body>Hi</body></html>')['format'] === 'html', 'Recognize HTML');
check(body_fixture('<?xml version="1.0"?><document/>')['format'] === 'xml', 'Recognize XML');
check(body_fixture('<svg xmlns="http://www.w3.org/2000/svg"></svg>')['mime'] === 'image/svg+xml', 'SVG remains structured text');
check(body_fixture('{\\rtf1 hello}')['format'] === 'rtf', 'Recognize RTF as inspectable text');
check(body_fixture('')['kind'] === 'empty', 'Empty body is explicit');
check(inspect_capture(['body_base64' => '%%%%'])['warnings'] !== [], 'Invalid Base64 fails gracefully');

$body = body_fixture('hello', ['Content-Disposition' => "attachment; filename=old.txt; filename*=UTF-8''caf%C3%A9%20report.json"]);
check($body['filename'] === 'café report.json' && $body['extension'] === 'json', 'RFC5987 filename takes precedence over fallback');
check(inspection_parameters('attachment; filename="a;\\"b.txt"')['filename'] === 'a;"b.txt', 'Quoted semicolons and escaped quotes remain filename characters');
check(inspection_filename(['filename' => 'C:\\fakepath\\upload.sql']) === 'upload.sql', 'Display filename omits client-side path');
check(inspection_filename(['filename' => 'good.txt', 'filename*' => "unknown''bad"]) === 'good.txt', 'Unsupported filename encoding preserves plain fallback');

if (function_exists('iconv')) {
    foreach (['utf-16le' => "\xff\xfe", 'utf-16be' => "\xfe\xff", 'utf-32le' => "\xff\xfe\0\0", 'utf-32be' => "\0\0\xfe\xff"] as $encoding => $bom) {
        $original = "Hello é 🦄\n";
        $raw = $bom . iconv('UTF-8', strtoupper($encoding), $original);
        $body = body_fixture($raw, ['Content-Type' => 'text/plain; charset=us-ascii']);
        check($body['kind'] === 'text' && $body['encoding'] === $encoding && $body['text'] === $original, "Decode {$encoding} BOM despite conflicting charset");
        check($body['length'] === strlen($raw) && !$body['textTruncated'], "Keep {$encoding} original byte length");
    }
    $body = body_fixture("caf\xe9 \x80", ['Content-Type' => 'text/plain; charset=windows-1252']);
    check($body['encoding'] === 'windows-1252' && $body['text'] === 'café €', 'Respect explicit Windows-1252 charset');
    $body = body_fixture("caf\xe9", ['Content-Type' => 'text/plain; charset=ISO-8859-1']);
    check($body['text'] === 'café' && $body['encoding'] === 'iso-8859-1', 'Respect explicit ISO-8859-1 charset');
    $body = body_fixture("\0A\0B", ['Content-Type' => 'text/plain; charset=UTF-16']);
    check($body['text'] === 'AB' && $body['encoding'] === 'utf-16be', 'Generic UTF-16 without BOM must emit explicit big-endian label');
    $body = body_fixture("\0\0\0A\0\0\0B", ['Content-Type' => 'text/plain; charset=UTF-32']);
    check($body['text'] === 'AB' && $body['encoding'] === 'utf-32be', 'Generic UTF-32 without BOM must emit explicit big-endian label');
    $body = body_fixture("\xff\xfeA", ['Content-Type' => 'text/plain']);
    check($body['kind'] === 'binary' && $body['warnings'] !== [], 'Truncated UTF-16 cannot silently drop bytes');
    $many = str_repeat('🦄', 100003);
    $body = body_fixture("\xff\xfe" . iconv('UTF-8', 'UTF-16LE', $many));
    check($body['text'] === str_repeat('🦄', 100000) && $body['textTruncated'], 'Converted previews cap Unicode characters without cutting code points');
}

// Build the expected byte ranges alongside the fixture, independently of the
// parser. Boundary-looking file content must never be split on mere substrings.
$boundary = 'AaB03x';
$multipart = "A short preamble\r\n";
$expected = [];
$add = static function (array $headers, string $content) use (&$multipart, &$expected, $boundary): void {
    $multipart .= '--' . $boundary . "\r\n";
    foreach ($headers as $name => $value) {
        $multipart .= $name . ': ' . $value . "\r\n";
    }
    $multipart .= "\r\n";
    $expected[] = ['offset' => strlen($multipart), 'length' => strlen($content), 'bytes' => $content];
    $multipart .= $content . "\r\n";
};
$add(['Content-Disposition' => 'form-data; name="event"'], 'payment.updated');
$add(['Content-Disposition' => "form-data; name=upload; filename*=UTF-8''caf%C3%A9.txt", 'Content-Type' => 'text/plain'], $png);
$lookalikes = "prefix--AaB03x\r\n--AaB03x-not-a-delimiter\r\n--AaB03x--suffix\r\ntrailing\r\n\0\xff";
$add(['Content-Disposition' => 'form-data; name="upload"; filename="second.bin"', 'Content-Type' => 'application/octet-stream'], $lookalikes);
$add(['Content-Disposition' => 'form-data; name="empty"'], '');
$add([], "headerless\r\n");
$multipart .= '--' . $boundary . "--\r\nEpilogue";
$originalHash = hash('sha256', $multipart);
$inspection = inspect_fixture($multipart, ['content-type' => 'multipart/form-data; boundary="' . $boundary . '"']);
check($inspection['body']['kind'] === 'multipart' && $inspection['body']['mime'] === 'multipart/form-data', 'Whole multipart must retain envelope type');
check(!isset($inspection['body']['encoding']), 'Binary multipart envelope defaults to bytes');
check(count($inspection['parts']) === count($expected) && $inspection['warnings'] === [], 'Parse all file and field parts without warnings');
foreach ($inspection['parts'] as $index => $part) {
    check($part['offset'] === $expected[$index]['offset'] && $part['length'] === $expected[$index]['length'], "Part {$index} exact range");
    check(substr($multipart, $part['offset'], $part['length']) === $expected[$index]['bytes'], "Part {$index} exact raw download bytes");
}
check($inspection['parts'][0]['name'] === 'event' && $inspection['parts'][0]['kind'] === 'text', 'Named form field metadata');
check($inspection['parts'][1]['mime'] === 'image/png' && $inspection['parts'][1]['filename'] === 'café.txt', 'File content detection beats its text filename/header');
check($inspection['parts'][1]['name'] === 'upload' && $inspection['parts'][2]['name'] === 'upload', 'Repeated upload field names remain separate parts');
check($inspection['parts'][3]['kind'] === 'empty', 'Empty part remains downloadable zero-byte range');
check(hash('sha256', $multipart) === $originalHash, 'Inspection does not mutate original captured bytes');

$textMultipart = "--text\r\nContent-Disposition: form-data; name=message\r\n\r\nhello\r\n--text--";
$inspection = inspect_fixture($textMultipart, ['Content-Type' => 'multipart/form-data; boundary=text']);
check($inspection['body']['kind'] === 'multipart' && $inspection['body']['encoding'] === 'utf-8', 'Text-only multipart can show readable envelope');
check(count($inspection['parts']) === 1 && $inspection['parts'][0]['length'] === 5, 'Closing boundary at EOF is valid');
$incomplete = inspect_fixture(str_replace('--text--', '', $textMultipart), ['Content-Type' => 'multipart/form-data; boundary=text']);
check($incomplete['warnings'] !== [] && $incomplete['body']['length'] > 0, 'Missing final boundary keeps whole-body access');
check(inspect_fixture($textMultipart, ['Content-Type' => 'multipart/form-data'])['warnings'] !== [], 'Missing boundary parameter is reported');
check(inspect_fixture($textMultipart, ['Content-Type' => 'multipart/form-data; boundary=' . str_repeat('x', 71)])['warnings'] !== [], 'Oversized boundary is rejected');
check(inspect_fixture($textMultipart, ['Content-Type' => 'multipart/form-data; boundary=other'])['warnings'] !== [], 'Mismatching boundary is reported');

$oversized = "--x\r\nX-Large: " . str_repeat('a', 16385) . "\r\n\r\nfile\r\n--x--\r\n";
$inspection = inspect_fixture($oversized, ['Content-Type' => 'multipart/form-data; boundary=x']);
check($inspection['parts'] === [] && $inspection['warnings'] !== [], 'Oversized part headers stop extraction without losing body');
$manyParts = str_repeat("--x\r\n\r\na\r\n", 105) . "--x--\r\n";
$inspection = inspect_fixture($manyParts, ['Content-Type' => 'multipart/form-data; boundary=x']);
check(count($inspection['parts']) === 100 && $inspection['warnings'] !== [], 'Part count is bounded');
$nested = "--outer\r\nContent-Type: multipart/mixed; boundary=inner\r\n\r\n--inner\r\n\r\nhello\r\n--inner--\r\n\r\n--outer--\r\n";
$inspection = inspect_fixture($nested, ['Content-Type' => 'multipart/form-data; boundary=outer']);
check(count($inspection['parts']) === 1 && $inspection['parts'][0]['kind'] === 'multipart' && $inspection['parts'][0]['warnings'] !== [], 'Nested multipart is available without pretending to extract nested files');
$encoded = "--x\r\nContent-Type: image/png\r\nContent-Transfer-Encoding: base64\r\n\r\niVBORw0KGgo=\r\n--x--\r\n";
$inspection = inspect_fixture($encoded, ['Content-Type' => 'multipart/form-data; boundary=x']);
check($inspection['parts'][0]['contentTransferEncoding'] === 'base64' && $inspection['parts'][0]['length'] === 12 && $inspection['parts'][0]['warnings'] !== [], 'Encoded transport parts preserve original encoded bytes and explain that choice');

echo "Inspection: {$checks} checks passed for byte signatures, text encodings, exact multipart ranges, and bounded malformed-input handling.\n";
