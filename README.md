# Webhook Test

A small, self-hosted workbench for the “what did it actually send?” moments.

Send any payload to a named inbox, inspect the body and request headers, search your captures, and share permanent links. **Plain PHP. Plain JSON files. No database server, package installation, or build step. The repository root is the webroot.**

## Start in seconds

Requires **PHP 8.4+** with its standard JSON functions, a writable local directory, and a modern browser. No PHP database extensions are required.

```sh
git clone https://github.com/aipokalyptik/webhooktest.git
cd webhooktest
php -d enable_post_data_reading=Off -S 127.0.0.1:8080 .conf/router.php
```

Open **http://127.0.0.1:8080/** and click **Send a test request**, or:

```sh
curl 'http://127.0.0.1:8080/ingest.php?inbox=default' \
  -H 'Content-Type: application/json' \
  --data-binary '{"event":"hello.world","message":"It works!"}'
```

The response is `201 Created` with the capture ID, permanent viewer link, API URL, and raw download URL. HEAD responses have no body; use the `X-Webhook-Id` and `Location` response headers instead. Browser CORS preflights are also saved and return `204` with those headers.

PHP's built-in server is for local development. A public webhook provider needs an Internet-reachable PHP host or your own tunnel to this server.

## What you get

- Named inboxes with copyable endpoints; inboxes need no provisioning.
- GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS, TRACE, WebDAV methods, and any other method your HTTP server passes to PHP. The receiver has no method allowlist.
- Exact body bytes for JSON, XML, text, URL-encoded forms, multipart uploads, and binary data.
- A responsive inspector with file-type detection, 290 syntax languages, formatted/raw text, an interactive hex viewer, multipart file inspection, headers, repeated query parameters, and request metadata. JSON formatting preserves large numeric IDs and the original number spelling.
- Raw body downloads, complete JSON exports, copyable replay cURL commands, and downloadable replay shell scripts.
- Live polling (with pause), literal / wildcard / regex search, field filters, JSONPath, 50-item pages, request permalinks, and dynamic search permalinks.
- Database tools: delete an individual capture, preview and delete older captures, flush one inbox or all inboxes, and download a consistent JSON backup.
- No automatic expiry. Deleting files immediately releases their space; no vacuum or compaction is needed.
- No external fonts, CDNs, analytics, or network dependencies. JSONPath and PrismJS are bundled locally with their licenses.

The app starts in light mode. Use **Dark theme** in the top bar to switch; the button becomes **Light theme** to switch back. Your browser remembers the choice for this site and keeps other open tabs in sync. No account or server setting is needed.

## URLs

Receiver and viewer are separate, so viewing a request never creates another capture. Nothing requires URL rewriting, including installations in a subdirectory.

| Purpose | URL |
| --- | --- |
| Receive anything | `ingest.php?inbox=my-test` |
| View an inbox | `index.php?inbox=my-test` |
| View one request | `index.php?request=ID` |
| Share a search | `index.php?inbox=my-test&q=payment.failed` |
| Share a results page | `index.php?inbox=my-test&q=payment&page=2` |

Inbox names contain 1–64 lowercase ASCII letters, digits, hyphens, or underscores, starting with a letter or digit. Omit `inbox` for `default`. The receiver reserves only that query parameter; everything else is captured as supplied. Its raw query string preserves duplicate parameters and original escaping.

## Body inspection and syntax highlighting

The Body tab starts in **Auto**. It opens detected binary formats in Hex, including files such as PDFs whose bytes can look like ordinary ASCII. Text opens with syntax colors when a language can be identified; an uncertain language stays plain text. Choose **Formatted**, **Raw**, **Hex**, or **Base64** to override the view. In text modes, the **Syntax** selector offers Auto, Plain text, and **290 bundled languages**; type a language name while the selector is focused. **Wrap lines** makes long lines easier to read.

Open **Detection details** to see the evidence: known byte signatures, PHP Fileinfo/libmagic when available, byte/text validation, recognizable text structure, Content-Type, charset, and posted filenames. Specific content clues take precedence over filename guesses. Filenames from Content-Disposition, including multipart uploads and encoded `filename*` values, help select syntax for source files; a request URL is not treated as the uploaded filename. SVG remains inspectable XML text. A byte-order mark can identify UTF-16 or UTF-32 text even when the declared charset disagrees. Detection is best effort, not file validation, and the details expose warnings and conflicting claims.

**Formatted** indents valid JSON while preserving large numeric IDs and the original spelling of numbers. Other text retains its layout. **Raw** means unformatted, decoded text; both text modes can use syntax colors. Auto and Formatted omit a leading byte-order mark from the preview; Raw preserves it. Copy takes the full decoded text, including its BOM, rather than the formatted preview. Base64 copying preserves arbitrary original bytes. **Download** in the Body toolbar always saves the original bytes and encoding. Manually interpreting binary as text may produce replacement characters; use Hex or Download for exact data.

Text previews are limited to **100,000 characters**. Highlighting runs in a worker with a **2.5-second deadline** once its local assets have loaded, with up to 10 seconds allowed for initial loading. A **2,097,152-character limit on generated token markup** also applies. Exceeding either budget falls back to plain text. JSON indentation has the same 100,000-character budget and retains the unformatted source if expansion would exceed it. These preview limits do not shorten Copy, Download, or the navigable Hex body.

Compressed requests remain their original encoded bytes and open in Hex. Detection includes **Content-Encoding** and recognizes matching gzip and Zstandard signatures; Content-Type describes the body after decoding, so a gzipped JSON request is not treated as a MIME mismatch. Inspection does not decompress bodies.

PrismJS **1.30.0** is served locally, with all **297 official components** included. Seven helper/modifier components support other grammars rather than appearing as separate language choices. See [vendor provenance and update instructions](.conf/vendor/prism.md). There is no CDN, runtime package install, or deployment build step. PHP **Fileinfo** and **iconv** are optional: deterministic signatures and byte validation still work without Fileinfo; unsupported charset conversion keeps a conservative binary view with the original bytes available.

### Multipart files and fields

For a multipart request, the **Inspect** selector lets you switch between the original envelope and its individual fields/files. Each part gets its own type detection, syntax choice, Hex view, and download using its posted filename when present. Parts are exact slices of the captured body, not reconstructed uploads. Detection details show each part's original capture offset; Hex offsets start at zero within the selected part. Choose **Original request body** to download the complete envelope, including its boundaries and part headers.

The preview examines at most **100 parts**, with up to **16 KiB and 100 lines of headers per part**. Malformed or incomplete parts produce warnings; the whole body remains available. Nested multipart data stays available as one original byte slice and is not recursively expanded. Content-Transfer-Encoding is preserved as captured rather than decoded. The capture itself, JSON export, and backups remain unchanged: computed `inspection` information is added only to the individual request-detail API response.

## Binary body viewer

Choose **Hex** in the Body tab to inspect the original bytes of any capture or selected multipart part, including text and JSON. Auto opens detected binary bodies in Hex; **Base64** remains available. The viewer is read-only: selection, search, and interpretation never change the captured body.

Offsets, hexadecimal bytes, and printable ASCII stay aligned. Selecting a byte highlights both representations, and a color legend distinguishes printable text, whitespace, zeroes, control bytes, and non-ASCII bytes. Other bytes appear as dots in the ASCII column. **Auto** chooses a row width that fits the panel; choose 4, 8, 16, or 32 bytes per row explicitly, or use **Expand** for more room.

| Task | How |
| --- | --- |
| Find bytes | Select **Hex bytes** and enter complete pairs, such as `00 FF 2A` or `00ff2a`. |
| Find text | Select **UTF-8 text** for an exact, case-sensitive byte search. This searches only the open body; it does not filter the inbox. |
| Repeat a search | Previous/Next or F3 / Shift+F3. Searches wrap at the ends and report when they wrap. A background worker keeps scanning off the UI thread. |
| Go to an offset | Enter decimal (`32`) or hexadecimal with a `0x` prefix (`0x20`). Offsets start at zero. |
| Select bytes | Click a hex byte or its ASCII character. Drag, Shift-click, or hold Shift while navigating to extend the range. On touch screens, tap to select and swipe to scroll. |
| Navigate by keyboard | Arrows move by byte/row; Home/End move within a row; Ctrl/⌘+Home/End move to the first/last byte; Page Up/Down move a screen. Tab leaves the grid. |
| Copy a range | Choose **Hex bytes**, **Hex dump**, **Base64**, or **UTF-8 text**, then **Copy selection**. Ctrl/⌘+A selects the body and Ctrl/⌘+C copies using the chosen format while the grid has focus. |
| Save a range | **Save selection** downloads the selected original bytes as a `.bin` file. The filename includes the capture ID and inclusive start/end offsets. |

Clipboard copying is limited to selections of **1 MiB of source bytes**; use **Save selection** for larger ranges. UTF-8 text copying replaces invalid sequences with `�`. Use Hex, Base64, or the raw `.bin` download when every byte must be preserved. Hex dump copying includes original offsets and every selected row, including repeated rows.

The **Interpret bytes at cursor** panel shows bits, signed/unsigned integers, and floating-point values beginning at the selected byte. Switch between little and big endian; `—` means there are not enough remaining bytes for that type. The 64-bit integer values retain their exact precision. Ctrl/⌘+F and Ctrl/⌘+G focus the find and offset controls while the grid has focus; the expandable help inside the viewer explains the controls.

Only visible rows are rendered, so the full body remains navigable without creating a page element for every byte. The hex viewer itself has no library dependency. Implementation choices and maintenance notes are in [`.conf/BINARY-VIEWER.md`](.conf/BINARY-VIEWER.md).

## Search

The search bar finds literal substrings in IDs, methods, URLs, content types, header names/values, client IPs, size/received metadata, and UTF-8 body text. It ignores ASCII letter case. Punctuation such as `*`, `%`, `_`, and brackets is literal. Values are searched separately, so a match cannot cross from one header into another. Binary bodies are not text-searched.

**Advanced search** adds up to eight conditions, combined with **All (AND)** or **Any (OR)**. The search bar is an additional AND condition. A live preview shows the count and three matching requests; JSONPath conditions also show the values selected from the currently open capture. Apply updates the list and URL, Cancel leaves the active search untouched. Removable chips show the applied filters, and matching requests include a short explanation. Open **Search guide & examples** inside the modal for syntax, semantics, and one-click examples.

| Match mode | Behavior |
| --- | --- |
| Contains | Literal substring; empty text matches any existing value |
| Equals | Entire value, interpreted literally |
| Wildcard | Entire value; `*` any sequence, `?` one Unicode character, `\*` / `\?` / `\\` for literal symbols |
| Regex | PHP/PCRE, without delimiters; optional multiline and dot-matches-newline switches |
| Exists / Missing | Presence of a field/node, independent of its value |

Match case is off by default. Contains/Equals use ASCII case-insensitive comparison; wildcard/regex use Unicode case folding. Regex searches within a value; use `\A` and `\z` to anchor the entire value. Wildcards include newlines. Invalid expressions and regex work-limit failures produce an explicit error rather than zero or partial matches.

Scopes include body text, headers, a named header, URL-decoded query parameters, a named parameter, JSON body, method, URL, path/raw query, content type, ID, IP, body size, and received time. Header names ignore case; parameter names are case-sensitive. Repeated query parameters are preserved and any occurrence can match. Size comparisons use bytes. Received Before/After comparisons are strict and take an ISO timestamp with timezone, e.g. `2026-09-23T12:00:00Z`.

### JSONPath

Use a selector and a match mode together:

| Selector | Match | Value |
| --- | --- | --- |
| `$.event` | Equals | `payment.failed` |
| `$.data.customer.id` | Equals | `cus_123` |
| `$.items[*].sku` | Wildcard | `PRO-*` |
| `$['event.type']` | Equals | `push` |
| `$..id` | Exists | — |
| `$.items[?(@.sku == "PRO-123" && @.quantity > 1)]` | Exists | — |

A condition matches when any selected value matches. For multiple checks on the **same array item**, use one predicate as in the last example; separate conditions may match different items. JSON is decoded regardless of Content-Type. Invalid/non-JSON and binary bodies do not match JSON conditions, including Missing. JSON null, false, zero, empty strings, and empty containers all **exist** when selected. Missing means the selector returned no nodes.

Strings are matched without quotes; other selected values use compact JSON. Equals is a text comparison: numeric `123` and string `"123"` both match `123`. JSONPath predicates provide typed comparisons. Integers beyond PHP's integer range become digit strings to preserve exact IDs for text matching. Decimal values use PHP floating-point precision, so numeric predicates are not arbitrary precision; use raw body search when exact numeric spelling matters.

The bundled [SoftCreatR JSONPath 2.0.0](https://github.com/SoftCreatR/JSONPath/tree/941fe4742e42380d394064fda61e2d9cc5615db1) supports child/recursive selectors, array wildcards/indexes/slices, and filter comparisons and logical operators. It is **not jq** and does not implement all of RFC 9535. Scripts, pipes, function extensions (`length`, `count`, `match`, `search`, `value`), and inline regex operators are unsupported; select values and use our Regex match mode instead. Sources and MIT license are vendored under `.conf/vendor/`; provenance and update instructions are in `.conf/vendor/README.md`.

### Search API and links

`GET api.php?inbox=default&q=hello` performs simple search. For advanced search, supply `filters` as a URL-encoded JSON object:

```json
{
  "match": "all",
  "rules": [
    {"scope": "header", "key": "X-GitHub-Event", "op": "equals", "value": "push", "case": false},
    {"scope": "json", "key": "$.repository.full_name", "op": "equals", "value": "owner/project"}
  ]
}
```

Rule fields: `scope`, `op`, optional `key`, `value`, `case` (boolean), and `flags` (`""`, `"m"`, `"s"`, `"ms"`). Scope names: `any`, `body`, `headers`, `header`, `query`, `parameter`, `json`, `method`, `url`, `path`, `content_type`, `id`, `ip`, `size`, `received`. Operators: `contains`, `equals`, `wildcard`, `regex`, `exists`, `missing`; size supports `equals`, `gt`, `gte`, `lt`, `lte`; received supports `before`, `after`.

`GET api.php?action=search-preview` accepts the same arguments and optional `sample=ID`. It returns the total match count, up to three requests, and a `selections` array for JSONPath results against the sample (up to three shortened values per condition). List results include up to two shortened `matches` explanations per request. Search validation/evaluation errors return **422**; storage failures remain **503**.

The browser URL and **Copy search link** include all active filters. Opening the link reconstructs the search and shows current results: deleted captures disappear and new matches appear. No saved-search database or index is needed.

Search conditions are limited to 500 bytes per text field, eight rules, and 6,000 bytes of filter JSON (also limited to 7,000 URL-encoded bytes including search text, to keep links portable). A five-second scan budget is checked between files and conditions (not a hard interruption inside an individual JSONPath evaluation); PHP regex backtracking/recursion limits also bound pattern work. Failed searches return no partial results. Listing/search still scans the selected inbox's JSON files; sharding does not make body search indexed. Keep ephemeral inboxes tidy for responsive polling.

## Hosting

Upload/clone **the whole repository** into a PHP-enabled webroot, including `.user.ini` and `.htaccess`. There is no `public/` subdirectory and no build output to deploy.

Application configuration, server examples, and private PHP support scripts live in **`.conf/`**. The supplied hosting rules block that directory along with other dot paths; there is no list of internal filenames to maintain.

- `.conf/config.example.php` → `.conf/config.php`: optional application settings.
- `.conf/config.local.php`: optional machine-specific overrides.
- `.conf/nginx.conf` and `.conf/apache.conf`: hosting examples.
- `.conf/bootstrap.php`, `.conf/router.php`, `.conf/restore.php`: private PHP support and command-line tools.

The root `.htaccess` and `.user.ini` are discovery files for Apache and PHP. They stay in the webroot so upload-and-run hosting works automatically. For nginx + PHP-FPM, the supplied `.conf/nginx.conf` passes the multipart setting directly through FastCGI, so that deployment does not need `.user.ini` for capture.

The default storage location is a sibling directory named `.webhooktest-<path-hash>`, derived from the installation's absolute directory. PHP creates it with owner-only permissions. The parent must be writable by PHP. If your host restricts writing outside the webroot, explicitly configure another persistent writable directory allowed by the host. Keep capture storage outside the webroot.

Configuration is optional. Copy [`.conf/config.example.php`](.conf/config.example.php) to **`.conf/config.php`** (ignored by Git):

```php
<?php
return [
    'data_dir' => '/var/lib/webhooktest',
    'base_url' => 'https://hooks.example.com',
    'max_body_bytes' => 10 * 1024 * 1024,
];
```

`WEBHOOK_DATA_DIR` and `WEBHOOK_BASE_URL` environment variables are also supported. Settings load in this order, with later values overriding earlier ones: built-in defaults/environment, `.conf/config.php`, then optional `.conf/config.local.php`. Both configuration files are ignored by Git and must return a PHP array. Set the full public `base_url`, including a subdirectory if any, when behind a reverse proxy. Proxy forwarding headers are not implicitly trusted. Use a stable `data_dir` when releases change the checkout path; otherwise a new path gets a new default storage directory.

If storage returns `503`, set `data_dir` in `.conf/config.php` to a persistent directory that the PHP worker can create or write to, and check whether `.conf/config.local.php` overrides it. Check the PHP/server error log for the underlying filesystem or capture-file error. Settings are loaded before storage is opened, including for the CLI restore utility; fixing the configuration takes effect on subsequent requests subject to your host's PHP opcode-cache policy.

The application limit defaults to **10 MiB per request**. Oversize bodies return `413` without saving a partial capture. Your reverse proxy/web server may impose its own lower body limit or reject particular HTTP methods (especially TRACE and CONNECT). No PHP application can recover requests rejected before they reach it.

### Multipart capture

PHP must have `enable_post_data_reading=Off` **before the request starts** to expose exact multipart bytes through `php://input`.

For **nginx + PHP-FPM**, the included [`.conf/nginx.conf`](.conf/nginx.conf) sets this inside its PHP `location` block:

```nginx
fastcgi_param PHP_ADMIN_VALUE "enable_post_data_reading=Off";
```

FPM applies this setting before reading the request body, preserving the complete multipart payload, including uploaded files. Validate with `nginx -t`, then reload nginx using your host's service manager. A PHP-FPM restart is not required for this FastCGI change, and `.user.ini` is not needed for multipart capture in this setup. If your PHP location already supplies `PHP_ADMIN_VALUE`, add the setting to that same value separated by `\n`, rather than defining the parameter twice. See [PHP's nginx/FPM configuration documentation](https://www.php.net/manual/en/install.fpm.configuration.php).

For other **PHP-FPM/CGI** hosts, the included `.user.ini` provides the setting; restart/reload PHP or allow its `.user.ini` cache to expire after deployment. The root `.htaccess` handles **Apache mod_php**, and the local start command supplies the equivalent **PHP CLI** flag. This setting cannot be changed in `.conf/config.php`: that file is read after PHP's request-body handling has begun.

If the setting is ignored, multipart POSTs return a descriptive `503` instead of falsely reporting an empty capture as successful. See the [PHP input-stream documentation](https://www.php.net/manual/en/wrappers.php.php).

### Apache

A virtual-host example lives in [`.conf/apache.conf`](.conf/apache.conf). Use PHP-FPM or mod_php and allow the included `.htaccess` directives (`AllowOverride All` for this directory is the simplest setup). No rewrite module is needed. `.htaccess` also discourages indexing/caching of static responses and blocks dotfiles and internal configuration. If your provider disallows these directives, put the equivalent rules in the virtual host.

### nginx + PHP-FPM

Copy [`.conf/nginx.conf`](.conf/nginx.conf) into your nginx sites configuration and adjust the hostname, webroot, and PHP-FPM socket. It blocks every dot-directory/file path, including `.conf`, with one rule before the PHP handler. No per-file deny list is needed, and the rule also applies when the app is installed in a subdirectory.

Use your host's ordinary HTTPS configuration. Disable any host/CDN “cache everything” rule for this site.

## JSON storage, backups, and maintenance

Captures are stored by inbox, then by the first two hexadecimal characters of their random request ID:

```text
<data_dir>/
  default/
    a/
      b/
        abdbcbe0123456789abcdef0123456789.json
  stripe-sandbox/
    3/
      f/
        3f0123456789abcdef0123456789abcdef.json
```

The layout is `<data_dir>/<inbox>/<id[0]>/<id[1]>/<id>.json`, with up to 256 leaf directories per inbox, created as needed. Each indented JSON document includes metadata, headers, the raw query, original URL, body size, a UTF-8 `body` when representable, and an always-present `body_base64` containing the original bytes. Base64 is authoritative for downloads, including non-UTF-8 and NUL bytes. Text bodies appear in both forms for readability and reliable round trips.

Writes use a same-directory temporary file and atomic rename. A filesystem lock coordinates capture writes, reads, backups, and cleanup, with a five-second wait limit. Use a **local filesystem** with reliable `flock`/rename semantics, not a shared network mount. Normal failed writes do not expose partial JSON documents; this is not a promise of power-loss durability without filesystem-level backups. Do not edit files while the service is running.

Listing and search decode JSON files only in the selected inbox; sidebar counts enumerate filenames in the other inboxes without reading their payloads. ID-only request links probe the matching shard in each inbox, without scanning JSON bodies. Backup and workspace-wide storage tools walk all inboxes and shards. Restore writes the same sharded layout, and deletions remove empty shard/inbox directories while retaining the data root and lock.

Sharding spreads directory entries; it does not reduce total disk use or eliminate the selected inbox's search scan. Large histories or large bodies still increase search/polling time. There is no separate index to maintain. An operation that reads a malformed capture fails with `503` and logs the problem. Only files matching the inbox/hex/hex/ID layout are recognized; unrelated paths and symlinks are ignored.

Open **Database tools** to:

1. **Download backup:** one versioned JSON file containing every inbox. A snapshot is assembled under a shared lock and the lock is released before downloading it.
2. **Delete older than:** pick the scope and a cutoff, see the matching count and payload size, then confirm. The cutoff starts at the current local time. Inline date/time fields and Now / 1 minute / 1 hour / 1 day / 1 week / 1 month ago shortcuts (1 month means 30 days) keep the matching count visible and update it while you edit. The UI shows your timezone, uses a 24-hour clock, and sends UTC. Captures exactly at the cutoff are retained.
3. **Flush:** select “All requests (flush),” then the current inbox or all inboxes. Click “Yes, delete permanently” to confirm, or “Cancel” to keep the requests.

Individual deletion is available in the request inspector. Deleted request permalinks return “Request unavailable”; the API returns `404`. Cleanup previews are dynamic: matching requests arriving before deletion are included. A filesystem failure during multi-file deletion can leave a partially completed cleanup; fix permissions/disk problems and retry.

To restore a downloaded backup:

```sh
php .conf/restore.php /path/to/webhooktest-backup.json
```

The utility uses the same data-directory configuration, validates the backup, preserves IDs, skips identical existing captures, and refuses conflicting IDs before writing. Run it as the same OS user as PHP (or fix file ownership afterward). A failed interrupted write can be retried. For very large backups, raise PHP's CLI memory limit; restoration validates the complete backup in memory.

You can also move/copy the entire data directory with the service stopped. Set `data_dir` to the new location. Request IDs survive; the host portion of shared URLs naturally depends on retaining the same domain. To update the application, back up captures, then `git pull`; configuration and stored captures are outside tracked source files.

## JSON API

API errors have an HTTP error status and a JSON `error` field. No sign-in or tokens are required.

| Method | Endpoint | Result |
| --- | --- | --- |
| GET | `api.php?inbox=default&q=hello&page=1` | Summary list, counts, pagination, inboxes |
| GET | `api.php?action=request&id=ID` | Full capture, links, and computed type/multipart inspection |
| GET | `api.php?action=download&id=ID` | Original body bytes as attachment |
| GET | `api.php?action=export&id=ID` | Complete capture as JSON attachment |
| DELETE | `api.php?action=delete&id=ID` | Delete one capture |
| GET | `api.php?action=maintenance&scope=inbox&inbox=default&before=2026-01-01T00:00:00Z` | Cleanup preview and storage totals |
| DELETE | Same maintenance URL | Apply cleanup; requires `X-Confirm-Scope: default` |
| GET | `api.php?action=maintenance&scope=all` | Preview whole-workspace flush |
| DELETE | `api.php?action=maintenance&scope=all` | Flush everything; requires `X-Confirm-Scope: all` |
| DELETE | `api.php?action=clear&inbox=default` | Flush inbox; requires `X-Confirm-Inbox: default` |
| GET | `api.php?action=backup` | Consistent JSON backup attachment |

Omit `before` to select every capture in the scope. Search strings are limited to 500 bytes. API lists contain 50 items per page and never embed bodies. Viewing, listing, exporting, and downloading never write captures. Only `ingest.php` receives webhooks.

## Replay fidelity

Each request's **cURL** tab provides its captured method, URL, headers, and exact body bytes, plus Copy and Download `.sh` controls. Small text bodies use shell-quoted `printf`; binary/large bodies use a Base64 heredoc piped through PHP, avoiding both shell NUL limitations and command-argument size limits. These commands require cURL, PHP CLI, and a POSIX shell. Replaying sends to the original URL and creates a new capture.

This reproduces the application-level request as PHP observed it. HTTP framing, version, header capitalization/order, duplicate headers, and proxy-added/removed headers may differ: PHP/web servers can normalize them before application code runs. The stored client IP and timestamps are metadata, not values a replay can reproduce. Expired signatures/credentials also remain expired.

## Indexing and caching

Every application response—including errors, API responses, downloads, and UI assets—sends `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet`, `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`, `Pragma: no-cache`, and a past `Expires` header. The HTML also has a robots meta tag and `robots.txt` disallows crawling. Assets are served through PHP to apply these headers without relying on optional web-server modules. The Apache/nginx examples cover other static responses too.

This is an intentionally open testing workspace: anyone who can reach it can receive, inspect, export, or delete captures. No-index instructions are not access control. Captured markup is displayed as text, never executed.

## Tests

Development checks use Python 3 and Node.js; neither is required to host the service.

```sh
python3 tests/test_service.py
php tests/test_inspection.php
node tests/test_frontend.cjs
node tests/test_binary.cjs
node tests/test_syntax.cjs
```

The integration suite starts an isolated PHP server with temporary JSON storage, uses bounded HTTP/process timeouts, and cleans up after itself. It checks HTTP methods, binary/multipart fidelity, headers, body limits, search/pagination, persistence, downloads, backup/restore, age-based deletion, flushing, concurrency, and no-cache/no-index responses. Frontend helper tests cover shell quoting, number precision, binary replay, and large-body replay. Binary viewer tests cover exact bytes, copy formats, offset validation, numeric interpretation, worker search and wrapping, 10 MiB range downloads, and clipboard fallbacks inside dialogs. Inspection and syntax tests cover type evidence, encodings, multipart byte ranges and limits, grammar selection, token escaping, and bounded previews/formatting. GitHub Actions runs against PHP 8.4–8.5.

MIT licensed.
