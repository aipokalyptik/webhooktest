# Webhook Test

A small, self-hosted workbench for the “what did it actually send?” moments.

Send any payload to a named inbox, inspect the body and request headers, search your captures, and share permanent links. **Plain PHP. Plain JSON files. No database server, dependencies, package installation, or build step. The repository root is the webroot.**

## Start in seconds

Requires **PHP 8.2+** with its standard JSON functions, a writable local directory, and a modern browser. No PHP database extensions are required.

```sh
git clone https://github.com/aipokalyptik/webhooktest.git
cd webhooktest
php -d enable_post_data_reading=Off -S 127.0.0.1:8080 router.php
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
- A responsive inspector with formatted/raw body views, headers, repeated query parameters, and request metadata. JSON formatting preserves large numeric IDs and the original number spelling.
- Raw body downloads, complete JSON exports, copyable replay cURL commands, and downloadable replay shell scripts.
- Live polling (with pause), literal text search, 50-item pages, request permalinks, and dynamic search permalinks.
- Database tools: delete an individual capture, preview and delete older captures, flush one inbox or all inboxes, and download a consistent JSON backup.
- No automatic expiry. Deleting files immediately releases their space; no vacuum or compaction is needed.
- No external fonts, CDNs, analytics, runtime libraries, or network dependencies.

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

Search covers request ID, method, URL path/query, content type, header names/values, and UTF-8 body text. It is a literal substring search (ASCII case-insensitive), not a regex or SQL query. `%` and `_` are ordinary characters. Binary bodies are downloadable but are not text-searched. Search links always show current matching captures; deleted items disappear and new matches appear.

## Hosting

Upload/clone **the whole repository** into a PHP-enabled webroot, including `.user.ini` and `.htaccess`. There is no `public/` subdirectory and no build output to deploy.

The default storage location is a sibling directory named `.webhooktest-<path-hash>`, derived from the installation's absolute directory. PHP creates it with owner-only permissions. The parent must be writable by PHP. If your host restricts writing outside the webroot, explicitly configure another persistent writable directory allowed by the host. Keep capture storage outside the webroot.

Configuration is optional. Copy `config.example.php` to **`config.local.php`** (ignored by Git):

```php
<?php
return [
    'data_dir' => '/var/lib/webhooktest',
    'base_url' => 'https://hooks.example.com',
    'max_body_bytes' => 10 * 1024 * 1024,
];
```

`WEBHOOK_DATA_DIR` and `WEBHOOK_BASE_URL` environment variables are also supported; `config.local.php` takes precedence. Set the full public `base_url`, including a subdirectory if any, when behind a reverse proxy. Proxy forwarding headers are not implicitly trusted. Use a stable `data_dir` when releases change the checkout path; otherwise a new path gets a new default storage directory.

The application limit defaults to **10 MiB per request**. Oversize bodies return `413` without saving a partial capture. Your reverse proxy/web server may impose its own lower body limit or reject particular HTTP methods (especially TRACE and CONNECT). No PHP application can recover requests rejected before they reach it.

### Multipart capture

PHP must have `enable_post_data_reading=Off` **before the request starts** to expose exact multipart bytes through `php://input`. The included `.user.ini` sets it for PHP-FPM/CGI, and `.htaccess` sets it for Apache mod_php. Restart/reload PHP or allow its `.user.ini` cache to expire after deployment. The local start command supplies the equivalent flag. If the setting is ignored, multipart POSTs return a descriptive `503` instead of falsely reporting an empty capture as successful. See the [PHP input-stream documentation](https://www.php.net/manual/en/wrappers.php.php).

### Apache

Use PHP-FPM or mod_php and allow the included `.htaccess` directives (`AllowOverride All` for this directory is the simplest setup). No rewrite module is needed. `.htaccess` also discourages indexing/caching of static responses and blocks dotfiles and internal configuration. If your provider disallows these directives, put the equivalent rules in the virtual host.

### nginx + PHP-FPM

A minimal server block (adjust host, root, and PHP-FPM socket):

```nginx
server {
    listen 80;
    server_name hooks.example.com;
    root /var/www/webhooktest;
    index index.php;
    client_max_body_size 10m;

    add_header X-Robots-Tag "noindex, nofollow, noarchive, nosnippet" always;
    add_header Cache-Control "no-store, no-cache, must-revalidate, max-age=0" always;

    location ~ /\. { deny all; }
    location ~ ^/(bootstrap|config\.local|config\.example|router|restore)\.php$ { deny all; }
    location / { try_files $uri $uri/ =404; }
    location ~ \.php$ {
        try_files $uri =404;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
    }
}
```

Use your host's ordinary HTTPS configuration. For a subdirectory deployment, adjust the internal-file deny rule to include that prefix. Disable any host/CDN “cache everything” rule for this site.

## JSON storage, backups, and maintenance

Every capture is an indented `<32-character-id>.json` document. It includes metadata, headers, the raw query, original URL, body size, a UTF-8 `body` when representable, and an always-present `body_base64` containing the original bytes. Base64 is authoritative for downloads, including non-UTF-8 and NUL bytes. Text bodies appear in both forms for readability and reliable round trips.

Writes use a same-directory temporary file and atomic rename. A filesystem lock coordinates capture writes, reads, backups, and cleanup, with a five-second wait limit. Use a **local filesystem** with reliable `flock`/rename semantics, not a shared network mount. Normal failed writes do not expose partial JSON documents; this is not a promise of power-loss durability without filesystem-level backups. Do not edit files while the service is running.

Search scans JSON files and is intended for small testing workspaces, not a high-volume event archive. Large histories or large bodies increase search/polling time. There is no separate index to corrupt or rebuild. A malformed capture fails the operation with `503` and logs the problem rather than silently omitting history. Files with unrelated names are ignored.

Open **Database tools** to:

1. **Download backup:** one versioned JSON file containing every inbox. A snapshot is assembled under a shared lock and the lock is released before downloading it.
2. **Delete older than:** pick the scope and a date/time, see the matching count and payload size, then confirm. The UI uses your local time and sends UTC. Captures exactly at the cutoff are retained.
3. **Flush:** select “All requests (flush),” then the current inbox or all inboxes. Type the inbox name or `all` to confirm.

Individual deletion is available in the request inspector. Deleted request permalinks return “Request unavailable”; the API returns `404`. Cleanup previews are dynamic: matching requests arriving before deletion are included. A filesystem failure during multi-file deletion can leave a partially completed cleanup; fix permissions/disk problems and retry.

To restore a downloaded backup:

```sh
php restore.php /path/to/webhooktest-backup.json
```

The utility uses the same data-directory configuration, validates the backup, preserves IDs, skips identical existing captures, and refuses conflicting IDs before writing. Run it as the same OS user as PHP (or fix file ownership afterward). A failed interrupted write can be retried. For very large backups, raise PHP's CLI memory limit; restoration validates the complete backup in memory.

You can also move/copy the entire data directory with the service stopped. Set `data_dir` to the new location. Request IDs survive; the host portion of shared URLs naturally depends on retaining the same domain. To update the application, back up captures, then `git pull`; configuration and stored captures are outside tracked source files.

## JSON API

API errors have an HTTP error status and a JSON `error` field. No sign-in or tokens are required.

| Method | Endpoint | Result |
| --- | --- | --- |
| GET | `api.php?inbox=default&q=hello&page=1` | Summary list, counts, pagination, inboxes |
| GET | `api.php?action=request&id=ID` | Full capture and links |
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
node tests/test_frontend.cjs
```

The integration suite starts an isolated PHP server with temporary JSON storage, uses bounded HTTP/process timeouts, and cleans up after itself. It checks HTTP methods, binary/multipart fidelity, headers, body limits, search/pagination, persistence, downloads, backup/restore, age-based deletion, flushing, concurrency, and no-cache/no-index responses. Frontend helper tests cover shell quoting, number precision, binary replay, and large-body replay. GitHub Actions runs against PHP 8.2–8.5.

MIT licensed.
