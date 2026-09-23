<?php
declare(strict_types=1);

// Inspection is a view of a capture, never a rewrite of it. Offsets and lengths
// always refer to the original decoded body, including multipart file bytes.
function inspect_capture(array $record): array
{
    $raw = base64_decode($record['body_base64'] ?? '', true);
    if ($raw === false) {
        return ['body' => ['id' => 'body', 'label' => 'Whole body', 'offset' => 0, 'length' => 0, 'kind' => 'binary', 'mime' => 'application/octet-stream', 'declaredMime' => '', 'evidence' => [], 'warnings' => ['The captured Base64 body is invalid.']], 'parts' => [], 'warnings' => ['The captured Base64 body is invalid.']];
    }
    $headers = inspection_headers($record['headers'] ?? []);
    if (!isset($headers['content-type']) && is_string($record['content_type'] ?? null)) {
        $headers['content-type'] = $record['content_type'];
    }
    $body = inspection_describe($raw, $headers, 0, 'body', 'Whole body');
    $parts = [];
    $warnings = [];
    if (str_starts_with($body['declaredMime'], 'multipart/')) {
        $parameters = inspection_parameters($headers['content-type'] ?? '');
        $boundary = $parameters['boundary'] ?? '';
        $validBoundary = preg_match("~\A[0-9A-Za-z'()+_,./:=? -]{1,70}\z~D", $boundary) === 1 && !str_ends_with($boundary, ' ');
        // A real envelope wins even if its preamble happens to begin with a file
        // signature. A bare PNG falsely labeled multipart remains a PNG.
        $identifiedBody = isset($body['detectionHint']) || isset($body['format']);
        if (!$identifiedBody || ($validBoundary && inspection_boundary($raw, $boundary, 0) !== null)) {
            $body['kind'] = 'multipart';
            $body['mime'] = $body['declaredMime'];
        }
        if (!$validBoundary) {
            $warnings[] = 'Multipart boundary is missing or invalid. The whole captured body remains available.';
        } else {
            [$parts, $warnings] = inspection_multipart($raw, $boundary);
        }
    }
    $body['warnings'] = array_values(array_unique([...$body['warnings'], ...$warnings]));
    return ['body' => $body, 'parts' => $parts, 'warnings' => $warnings];
}

function inspection_headers(array $headers): array
{
    $normalized = [];
    foreach ($headers as $name => $value) {
        if (is_string($name) && is_string($value)) {
            $normalized[strtolower($name)] = $value;
        }
    }
    return $normalized;
}

function inspection_parameters(string $header): array
{
    $parameters = [];
    // Header size is bounded both here and in the multipart parser. Quoted
    // semicolons are data, and quoted-pair escaping is not percent decoding.
    preg_match_all('~;\s*([a-z0-9!#$%&\x27*+.^_`|\~-]+)\s*=\s*(?:"((?:[^"\\\\]|\\\\.)*)"|([^;\r\n]*))~i', substr($header, 0, 16384), $matches, PREG_SET_ORDER | PREG_UNMATCHED_AS_NULL);
    foreach ($matches as $match) {
        $parameters[strtolower($match[1])] = $match[2] !== null ? preg_replace('~\\\\(.)~s', '$1', $match[2]) : trim($match[3]);
    }
    return $parameters;
}

function inspection_mime(string $header): string
{
    $mime = strtolower(trim(explode(';', $header, 2)[0]));
    return preg_match('~\A[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+\z~D', $mime) ? $mime : '';
}

function inspection_encoding(string $charset): ?string
{
    $charset = strtolower(trim($charset));
    $aliases = ['utf8' => 'utf-8', 'ascii' => 'us-ascii', 'latin1' => 'iso-8859-1', 'latin-1' => 'iso-8859-1', 'cp1252' => 'windows-1252', 'sjis' => 'shift_jis', 'shift-jis' => 'shift_jis', 'utf16le' => 'utf-16le', 'utf16be' => 'utf-16be'];
    $charset = $aliases[$charset] ?? $charset;
    // These encodings have predictable browser TextDecoder counterparts; avoid
    // iconv modifiers such as //IGNORE, which would silently discard bytes.
    return preg_match('~\A(?:utf-8|us-ascii|utf-16(?:le|be)?|utf-32(?:le|be)?|windows-125[0-8]|iso-8859-(?:[1-9]|1[013456])|shift_jis|euc-jp|euc-kr|gbk|gb18030|big5|koi8-r|koi8-u)\z~D', $charset) ? $charset : null;
}

function inspection_filename(array $parameters): ?string
{
    $filename = $parameters['filename'] ?? null;
    if (isset($parameters['filename*']) && preg_match("~\A([^']*)'[^']*'(.*)\z~sD", $parameters['filename*'], $match)) {
        $encoding = inspection_encoding($match[1]);
        $decoded = rawurldecode($match[2]);
        if ($encoding !== null && !in_array($encoding, ['utf-8', 'us-ascii'], true) && function_exists('iconv')) {
            $decoded = @iconv($encoding, 'UTF-8', $decoded);
        }
        if ($encoding !== null && is_string($decoded) && preg_match('//u', $decoded)) {
            $filename = $decoded;
        }
    }
    if (!is_string($filename) || !preg_match('//u', $filename)) {
        return null;
    }
    // No files are written. Removing path components gives an honest, useful
    // display name even when a client submits a Windows or Unix upload path.
    $filename = basename(str_replace('\\', '/', str_replace(["\0", "\r", "\n"], '', $filename)));
    return $filename !== '' ? $filename : null;
}

function inspection_signature(string $sample): ?array
{
    $signatures = [
        ["\x89PNG\r\n\x1a\n", 'image/png', 'PNG signature'],
        ["\xff\xd8\xff", 'image/jpeg', 'JPEG signature'],
        ['GIF87a', 'image/gif', 'GIF87a signature'], ['GIF89a', 'image/gif', 'GIF89a signature'],
        ["II*\0", 'image/tiff', 'TIFF signature'], ["MM\0*", 'image/tiff', 'TIFF signature'],
        ['%PDF-', 'application/pdf', 'PDF signature'],
        ["PK\x03\x04", 'application/zip', 'ZIP signature'], ["PK\x05\x06", 'application/zip', 'ZIP signature'], ["PK\x07\x08", 'application/zip', 'ZIP signature'],
        ["\x1f\x8b\x08", 'application/gzip', 'gzip signature'],
        ["\x28\xb5\x2f\xfd", 'application/zstd', 'Zstandard signature'],
        ["\xfd7zXZ\0", 'application/x-xz', 'XZ signature'],
        ["7z\xbc\xaf\x27\x1c", 'application/x-7z-compressed', '7-Zip signature'],
        ["Rar!\x1a\x07", 'application/vnd.rar', 'RAR signature'],
        ["\0asm\x01\0\0\0", 'application/wasm', 'WebAssembly signature'],
        ["\x7fELF", 'application/x-executable', 'ELF signature'],
        ["SQLite format 3\0", 'application/vnd.sqlite3', 'SQLite signature'],
        ["\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", 'application/x-ole-storage', 'OLE compound document signature'],
        ['wOFF', 'font/woff', 'WOFF signature'], ['wOF2', 'font/woff2', 'WOFF2 signature'],
        ['OTTO', 'font/otf', 'OpenType signature'],
        ["OggS\0", 'application/ogg', 'Ogg signature'], ['fLaC', 'audio/flac', 'FLAC signature'],
    ];
    foreach ($signatures as [$prefix, $mime, $description]) {
        if (str_starts_with($sample, $prefix)) {
            return [$mime, $description];
        }
    }
    if (strlen($sample) >= 12 && substr($sample, 0, 4) === 'RIFF') {
        return match (substr($sample, 8, 4)) {
            'WEBP' => ['image/webp', 'RIFF WebP signature'],
            'WAVE' => ['audio/wav', 'RIFF WAVE signature'],
            'AVI ' => ['video/x-msvideo', 'RIFF AVI signature'],
            default => null,
        };
    }
    if (strlen($sample) >= 12 && substr($sample, 4, 4) === 'ftyp') {
        $brand = substr($sample, 8, 4);
        return match ($brand) {
            'avif', 'avis' => ['image/avif', 'AVIF file type signature'],
            'heic', 'heix', 'hevc', 'hevx', 'mif1' => ['image/heic', 'HEIF file type signature'],
            'M4A ', 'M4B ' => ['audio/mp4', 'MPEG-4 audio signature'],
            default => ['video/mp4', 'ISO media file type signature'],
        };
    }
    if (preg_match('~\ABZh[1-9]~', $sample)) {
        return ['application/x-bzip2', 'bzip2 signature'];
    }
    if (strlen($sample) >= 10 && substr($sample, 0, 3) === 'ID3' && ord($sample[3]) >= 2 && ord($sample[3]) <= 4) {
        return ['audio/mpeg', 'ID3 audio tag'];
    }
    return null;
}

function inspection_text_mime(string $mime): bool
{
    return str_starts_with($mime, 'text/') || preg_match('~(?:\+json|\+xml)\z~D', $mime) === 1 || in_array($mime, ['application/json', 'application/xml', 'application/javascript', 'application/ecmascript', 'application/x-javascript', 'application/x-www-form-urlencoded', 'application/graphql', 'application/sql', 'application/yaml', 'application/x-yaml', 'application/toml', 'application/rtf', 'application/x-httpd-php', 'image/svg+xml'], true);
}

function inspection_binary_mime(string $mime): bool
{
    return (preg_match('~\A(?:image|audio|video|font)/~', $mime) === 1 && $mime !== 'image/svg+xml') || in_array($mime, ['application/pdf', 'application/zip', 'application/gzip', 'application/x-gzip', 'application/zstd', 'application/x-zstd', 'application/x-bzip2', 'application/x-xz', 'application/x-7z-compressed', 'application/x-rar', 'application/vnd.rar', 'application/x-executable', 'application/x-dosexec', 'application/x-sharedlib', 'application/x-object', 'application/vnd.sqlite3', 'application/x-sqlite3', 'application/x-ole-storage', 'application/wasm'], true);
}

function inspection_mime_compatible(string $detected, string $declared): bool
{
    if ($declared === '' || $declared === 'application/octet-stream' || $detected === $declared) {
        return true;
    }
    $aliases = [
        'application/x-gzip' => 'application/gzip',
        'application/x-zstd' => 'application/zstd',
        'application/x-zip' => 'application/zip',
        'application/x-zip-compressed' => 'application/zip',
        'application/x-rar' => 'application/vnd.rar',
        'application/x-rar-compressed' => 'application/vnd.rar',
        'image/x-png' => 'image/png',
        'image/jpg' => 'image/jpeg',
        'image/pjpeg' => 'image/jpeg',
        'image/x-tiff' => 'image/tiff',
        'application/x-pdf' => 'application/pdf',
    ];
    if (($aliases[$declared] ?? $declared) === $detected) {
        return true;
    }
    if ($detected !== 'application/zip') {
        return false;
    }
    // ZIP identifies the container, not its contents. A DOCX/EPUB/JAR declaration
    // is compatible evidence, but it does not prove which ZIP-based format this
    // capture contains. Keep the effective MIME at application/zip without a
    // misleading disagreement warning or guessing from a filename extension.
    return str_starts_with($declared, 'application/vnd.openxmlformats-officedocument.')
        || preg_match('~\Aapplication/vnd\.ms-(?:word\.(?:document|template)|excel\.(?:sheet|template|addin)|powerpoint\.(?:presentation|slideshow|template|addin))\.(?:macroenabled\.12|binary\.macroenabled\.12)\z~D', $declared) === 1
        || preg_match('~\Aapplication/vnd\.oasis\.opendocument\.(?:text(?:-master|-web|-template)?|spreadsheet(?:-template)?|presentation(?:-template)?|graphics(?:-template)?|chart(?:-template)?|image(?:-template)?|formula(?:-template)?|database)\z~D', $declared) === 1
        || in_array($declared, ['application/epub+zip', 'application/java-archive', 'application/x-java-archive', 'application/vnd.android.package-archive', 'application/vnd.google-earth.kmz', 'application/x-xpinstall'], true);
}

function inspection_describe(string $raw, array $headers, int $offset, string $id, string $label): array
{
    $length = strlen($raw);
    $declared = inspection_mime($headers['content-type'] ?? '');
    $parameters = inspection_parameters($headers['content-type'] ?? '');
    $disposition = inspection_parameters($headers['content-disposition'] ?? '');
    $result = ['id' => $id, 'label' => $label, 'offset' => $offset, 'length' => $length, 'kind' => $length ? 'binary' : 'empty', 'mime' => 'application/octet-stream', 'declaredMime' => $declared, 'evidence' => [], 'warnings' => []];
    if ($declared !== '') {
        $result['evidence'][] = ['source' => 'Content-Type', 'value' => $headers['content-type']];
    }
    $contentEncoding = trim($headers['content-encoding'] ?? '');
    $outerEncoding = null;
    if ($contentEncoding !== '') {
        $result['contentEncoding'] = $contentEncoding;
        $result['evidence'][] = ['source' => 'Content-Encoding', 'value' => $contentEncoding];
        $encodings = array_values(array_filter(array_map('trim', explode(',', strtolower($contentEncoding))), static fn (string $encoding): bool => $encoding !== '' && $encoding !== 'identity'));
        $outerEncoding = $encodings === [] ? null : $encodings[array_key_last($encodings)];
        if ($outerEncoding !== null) {
            $result['evidence'][] = ['source' => 'Encoded body', 'value' => 'Showing the original encoded bytes without decompression. Content-Type describes the body after Content-Encoding is decoded.'];
        }
    }
    $filename = inspection_filename($disposition);
    if ($filename !== null) {
        $result['filename'] = $filename;
        $result['extension'] = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
        $result['evidence'][] = ['source' => 'Filename', 'value' => $filename];
    }
    if (isset($disposition['name'])) {
        $result['name'] = $disposition['name'];
    }
    if (!$length) {
        $result['mime'] = $declared ?: 'application/octet-stream';
        return $result;
    }
    // Full UTF-8/control-byte validation is linear and necessary: an otherwise
    // textual 10 MiB upload can contain its first NUL after the sniffing window.
    // File identification and semantic format sniffing are capped at 1 MiB.
    $sample = substr($raw, 0, 1048576);
    $signature = inspection_signature($sample);
    if ($signature !== null) {
        [$result['mime'], $hint] = $signature;
        $result['evidence'][] = ['source' => 'Signature', 'value' => $hint];
        $result['detectionHint'] = $hint;
        // Content codings are applied in header order; the final one describes
        // the captured outer bytes. A gzip-compressed JSON request is therefore
        // consistent even though the raw-byte MIME is application/gzip.
        $compressionMime = match ($outerEncoding) {
            'gzip', 'x-gzip' => 'application/gzip',
            'zstd' => 'application/zstd',
            default => null,
        };
        $matchingContentEncoding = $compressionMime !== null && $compressionMime === $result['mime'];
        if (!$matchingContentEncoding && !inspection_mime_compatible($result['mime'], $declared)) {
            $result['warnings'][] = "Captured bytes identify as {$result['mime']}; the declared Content-Type differs.";
        }
        if ($compressionMime !== null && !$matchingContentEncoding) {
            $result['warnings'][] = "Content-Encoding declares {$outerEncoding}, but the captured signature identifies {$result['mime']} instead.";
        }
        return $result;
    }
    $text = null;
    $encoding = null;
    $bom = null;
    foreach (["\x00\x00\xfe\xff" => 'utf-32be', "\xff\xfe\x00\x00" => 'utf-32le', "\xff\xfe" => 'utf-16le', "\xfe\xff" => 'utf-16be', "\xef\xbb\xbf" => 'utf-8'] as $prefix => $candidate) {
        if (str_starts_with($raw, $prefix)) {
            $bom = $candidate;
            break;
        }
    }
    $declaredEncoding = isset($parameters['charset']) ? inspection_encoding($parameters['charset']) : null;
    $candidate = $bom ?? $declaredEncoding;
    // With no BOM, the generic UTF-16/UTF-32 MIME encodings default to big
    // endian. Emit an explicit label so PHP and the browser decode identically.
    $candidate = match ($candidate) {
        'utf-16' => 'utf-16be',
        'utf-32' => 'utf-32be',
        default => $candidate,
    };
    if ($bom !== null) {
        $result['evidence'][] = ['source' => 'Byte-order mark', 'value' => $bom];
    }
    if (isset($parameters['charset'])) {
        $result['evidence'][] = ['source' => 'Declared charset', 'value' => $parameters['charset']];
    }
    if ($candidate !== null && !in_array($candidate, ['utf-8', 'us-ascii'], true)) {
        if (function_exists('iconv')) {
            $converted = @iconv($candidate, 'UTF-8', $raw);
            if ($converted !== false && preg_match('//u', $converted)) {
                $text = $converted;
                $encoding = $candidate;
            }
        }
        if ($text === null) {
            $result['warnings'][] = "The {$candidate} character encoding could not be decoded safely; inspect the original bytes.";
        }
    } elseif (preg_match('//u', $raw)) {
        $text = $raw;
        $encoding = 'utf-8';
    }
    if ($text !== null && preg_match('/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/', $text)) {
        $text = null;
        $encoding = null;
        $result['evidence'][] = ['source' => 'Byte validation', 'value' => 'Contains binary control bytes'];
    }
    if ($text === null) {
        if (inspection_text_mime($declared)) {
            $result['warnings'][] = 'The declared text type does not match safely decodable text; binary view preserves the captured bytes.';
        }
        $result['evidence'][] = ['source' => 'Byte validation', 'value' => 'Binary or unsupported text encoding'];
    } else {
        $result['kind'] = 'text';
        $result['encoding'] = $encoding;
        $result['mime'] = inspection_text_mime($declared) ? $declared : 'text/plain';
        $result['evidence'][] = ['source' => 'Byte validation', 'value' => "Valid {$encoding} text without binary control bytes"];
        $textSample = substr($text, 0, 1048576);
        $sniff = ltrim(str_starts_with($textSample, "\xef\xbb\xbf") ? substr($textSample, 3) : $textSample, " \t\r\n");
        if (strlen($text) <= 1048576 && (str_starts_with($sniff, '{') || str_starts_with($sniff, '[') || $declared === 'application/json' || str_ends_with($declared, '+json')) && json_validate($sniff)) {
            $result['format'] = 'json';
            $result['mime'] = 'application/json';
        } elseif (preg_match('~\A(?:<!doctype\s+html\b|<html(?:\s|>))~i', $sniff)) {
            $result['format'] = 'html';
            $result['mime'] = 'text/html';
        } elseif (preg_match('~\A(?:<\?xml\b|<[A-Za-z_][\w:.-]*(?:\s|/?>))~', $sniff)) {
            $result['format'] = 'xml';
            $result['mime'] = preg_match('~<(?:[\w.-]+:)?svg(?:\s|>)~', substr($sniff, 0, 4096)) ? 'image/svg+xml' : 'application/xml';
        } elseif (str_starts_with($sniff, '{\\rtf')) {
            $result['format'] = 'rtf';
            $result['mime'] = 'application/rtf';
        } elseif (str_starts_with($sniff, '#!')) {
            $line = strtolower(strtok(substr($sniff, 0, 256), "\r\n"));
            foreach (['python' => 'python', 'node' => 'javascript', 'ruby' => 'ruby', 'perl' => 'perl', 'bash' => 'bash', '/sh' => 'bash'] as $marker => $format) {
                if (str_contains($line, $marker)) {
                    $result['format'] = $format;
                    break;
                }
            }
        }
        if (isset($result['format'])) {
            $result['evidence'][] = ['source' => 'Text structure', 'value' => $result['format']];
        }
        if ($encoding !== 'utf-8') {
            // The UI can decode/copy the full original slice using encoding.
            // A bounded convenience preview must never become the download data.
            $text = str_starts_with($text, "\xef\xbb\xbf") ? substr($text, 3) : $text;
            $previewEnd = 0;
            for ($characters = 0, $textLength = strlen($text); $characters < 100000 && $previewEnd < $textLength; $characters++) {
                $lead = ord($text[$previewEnd]);
                $previewEnd += $lead < 0x80 ? 1 : ($lead < 0xe0 ? 2 : ($lead < 0xf0 ? 3 : 4));
            }
            $result['text'] = substr($text, 0, $previewEnd);
            $result['textTruncated'] = strlen($result['text']) < strlen($text);
        }
    }
    if (class_exists('finfo')) {
        try {
            static $finfo;
            $finfo ??= new finfo(FILEINFO_MIME_TYPE);
            $magic = $finfo->buffer($sample);
            if (is_string($magic) && $magic !== 'application/octet-stream' && $magic !== 'text/plain' && $magic !== 'application/x-empty') {
                $result['evidence'][] = ['source' => 'libmagic', 'value' => $magic];
                // Text validation remains authoritative for text safety. libmagic
                // may call arbitrary binary payloads "text/plain" or call source
                // code application/*; neither should override the byte checks.
                if ($text === null || (!isset($result['format']) && inspection_text_mime($magic))) {
                    $result['mime'] = $magic;
                }
                if ($text !== null && inspection_binary_mime($magic)) {
                    $result['kind'] = 'binary';
                    $result['mime'] = $magic;
                    unset($result['encoding'], $result['text'], $result['textTruncated']);
                }
            }
        } catch (Throwable) {
            // fileinfo is optional; deterministic signatures and byte validation
            // above remain usable on hosts without a working magic database.
        }
    }
    return $result;
}

function inspection_boundary(string $raw, string $boundary, int $from): ?array
{
    $marker = '--' . $boundary;
    $length = strlen($raw);
    while (($at = strpos($raw, $marker, $from)) !== false) {
        $from = $at + strlen($marker);
        if ($at !== 0 && substr($raw, $at - 2, 2) !== "\r\n") {
            continue;
        }
        $end = $from;
        $closing = substr($raw, $end, 2) === '--';
        if ($closing) {
            $end += 2;
        }
        while ($end < $length && ($raw[$end] === ' ' || $raw[$end] === "\t")) {
            $end++;
        }
        if (substr($raw, $end, 2) === "\r\n") {
            return ['start' => $at, 'after' => $end + 2, 'closing' => $closing];
        }
        if ($closing && $end === $length) {
            return ['start' => $at, 'after' => $end, 'closing' => true];
        }
        // A prefix such as --boundaryXYZ inside a file is ordinary file data.
    }
    return null;
}

function inspection_multipart(string $raw, string $boundary): array
{
    $parts = [];
    $warnings = [];
    $seen = 0;
    $delimiter = inspection_boundary($raw, $boundary, 0);
    if ($delimiter === null) {
        return [[], ['No valid multipart boundary lines were found. The whole captured body remains available.']];
    }
    while (!$delimiter['closing']) {
        if ($seen++ >= 100) {
            $warnings[] = 'Multipart preview is limited to 100 parts. Remaining bytes are available in the whole body.';
            break;
        }
        $next = inspection_boundary($raw, $boundary, $delimiter['after']);
        if ($next === null) {
            $warnings[] = 'Multipart body is incomplete: a final boundary is missing. Unparsed bytes remain available in the whole body.';
            break;
        }
        $start = $delimiter['after'];
        $end = max($start, $next['start'] - 2);
        if (substr($raw, $start, 2) === "\r\n") {
            $headerEnd = $start;
            $contentStart = $start + 2;
        } else {
            // Limit the search itself, not just a header block found much later
            // in an adversarial payload. Overlong headers never become file data.
            $headerProbe = substr($raw, $start, min(16388, max(0, $end - $start)));
            $relativeEnd = strpos($headerProbe, "\r\n\r\n");
            $headerEnd = $relativeEnd === false ? false : $start + $relativeEnd;
            $contentStart = $headerEnd === false ? $start : $headerEnd + 4;
        }
        if ($headerEnd === false || $headerEnd - $start > 16384 || $contentStart > $end) {
            $warnings[] = 'A multipart part has missing or oversized headers and was not extracted. The whole body is unchanged.';
            $delimiter = $next;
            continue;
        }
        $headerText = substr($raw, $start, $headerEnd - $start);
        $lines = $headerText === '' ? [] : explode("\r\n", $headerText);
        if (count($lines) > 100) {
            $warnings[] = 'A multipart part exceeds 100 header lines and was not extracted.';
            $delimiter = $next;
            continue;
        }
        $headers = [];
        $last = null;
        foreach ($lines as $line) {
            if (($line[0] === ' ' || $line[0] === "\t") && $last !== null) {
                $headers[$last] .= ' ' . trim($line);
            } elseif (preg_match('~\A([!#$%&\x27*+.^_`|\~0-9A-Za-z-]+):[ \t]*(.*)\z~D', $line, $match)) {
                $last = strtolower($match[1]);
                $headers[$last] = $match[2];
            } else {
                $last = null;
                $warnings[] = 'A malformed multipart header was ignored.';
            }
        }
        $index = count($parts) + 1;
        $part = inspection_describe(substr($raw, $contentStart, $end - $contentStart), $headers, $contentStart, 'part-' . $index, 'Part ' . $index);
        $part['label'] = $part['filename'] ?? $part['name'] ?? $part['label'];
        if (str_starts_with($part['declaredMime'], 'multipart/')) {
            $part['kind'] = 'multipart';
            $part['mime'] = $part['declaredMime'];
            $part['warnings'][] = 'Nested multipart is available as its original bytes; nested parts are not expanded.';
        }
        if (isset($headers['content-transfer-encoding']) && !in_array(strtolower(trim($headers['content-transfer-encoding'])), ['binary', '8bit', '7bit'], true)) {
            $part['contentTransferEncoding'] = $headers['content-transfer-encoding'];
            $part['warnings'][] = 'Content-Transfer-Encoding is preserved as captured; this view does not decode the part transport encoding.';
        }
        $parts[] = $part;
        $delimiter = $next;
    }
    return [$parts, array_values(array_unique($warnings))];
}
