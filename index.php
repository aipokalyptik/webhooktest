<?php
declare(strict_types=1);
require __DIR__ . '/.conf/bootstrap.php';
require_method(['GET', 'HEAD']);
if (isset($_GET['asset'])) {
    $asset = param('asset');
    $assets = ['app.css' => 'text/css; charset=utf-8', 'app.js' => 'text/javascript; charset=utf-8', 'core.js' => 'text/javascript; charset=utf-8', 'mark.svg' => 'image/svg+xml'];
    if (!isset($assets[$asset])) {
        respond(['error' => 'Asset not found.'], 404);
    }
    header('Content-Type: ' . $assets[$asset]);
    readfile(__DIR__ . '/assets/' . $asset);
    exit;
}
header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow, noarchive, nosnippet" />
    <meta name="color-scheme" content="light" />
    <title>Webhook Test — a little clarity for every request</title>
    <link rel="icon" href="index.php?asset=mark.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="index.php?asset=app.css" />
    <script src="index.php?asset=core.js" defer></script>
    <script src="index.php?asset=app.js" defer></script>
  </head>
  <body
    data-base-url="<?= htmlspecialchars(base_url() . '/', ENT_QUOTES, 'UTF-8') ?>"
  >
    <a class="skip" href="#main">Skip to inbox</a>
    <aside class="sidebar">
      <a class="brand" href="index.php"
        ><img
          src="index.php?asset=mark.svg"
          width="34"
          height="34"
          alt=""
        /><span
          >webhook<span class="brand-light">test</span
          ><small>A LITTLE CLARITY.</small></span
        ></a
      >
      <div class="workspace-label">
        YOUR WORKSPACE <span class="tiny-tag">LOCAL FIRST</span>
      </div>
      <div class="sidebar-heading">
        <span>Inboxes</span
        ><button
          id="new-inbox"
          class="icon-button"
          aria-label="New inbox"
          title="New inbox"
        >
          +
        </button>
      </div>
      <nav id="inboxes" aria-label="Inboxes"></nav>
      <button id="new-inbox-bottom" class="new-inbox">+ Create an inbox</button>
      <div class="sidebar-bottom">
        <button id="database-tools" class="side-action">
          <span aria-hidden="true">▤</span> Database tools
        </button>
        <button id="help-button" class="side-action">
          <span aria-hidden="true">?</span> Quick start & API
        </button>
        <div class="sidebar-note">
          <span class="dot"></span> Small stack. Zero ceremony.<small
            >PHP + JSON · No build step</small
          >
        </div>
      </div>
    </aside>
    <main id="main">
      <header class="topbar">
        <div>
          Workspace <span class="slash">/</span>
          <strong id="breadcrumb">default</strong>
        </div>
        <span class="public-note">↗ Open testing workspace</span>
      </header>
      <div class="main-content">
        <div class="page-heading">
          <div>
            <div class="eyebrow">RECEIVE. INSPECT. UNDERSTAND.</div>
            <h1 id="inbox-title">
              default<span class="heading-suffix"> / inbox</span>
            </h1>
            <p>Every request, right where you need it.</p>
          </div>
          <button id="live-toggle" class="live-button" aria-pressed="true">
            <span class="dot"></span><span id="live-label">Live updates</span>
          </button>
        </div>
        <section class="endpoint-card" aria-labelledby="endpoint-heading">
          <div class="endpoint-top">
            <h2 id="endpoint-heading">
              <span class="endpoint-symbol" aria-hidden="true">↳</span> Your
              webhook endpoint
            </h2>
            <span class="small-muted">Any payload. Any method.</span>
          </div>
          <div class="endpoint-row">
            <label class="sr-only" for="endpoint">Webhook endpoint URL</label
            ><input id="endpoint" readonly spellcheck="false" /><button
              id="copy-endpoint"
              class="primary"
            >
              Copy URL <span aria-hidden="true">⧉</span>
            </button>
          </div>
          <div class="endpoint-bottom">
            <span>Point your service here. We’ll take it from there.</span>
            <div>
              <button id="copy-curl" class="text-button">Copy cURL</button
              ><span class="separator">·</span
              ><button id="send-sample" class="text-button">
                Send a test request <span aria-hidden="true">↗</span>
              </button>
            </div>
          </div>
        </section>
        <div
          id="connection-error"
          class="notice error"
          role="alert"
          hidden
        ></div>
        <section class="stats" aria-label="Inbox statistics">
          <div>
            <span class="stat-label">REQUESTS CAPTURED</span
            ><strong id="stat-total">0</strong>
          </div>
          <div>
            <span class="stat-label">PAYLOAD STORED</span
            ><strong id="stat-size">0 B</strong>
          </div>
          <div>
            <span class="stat-label">LAST RECEIVED</span
            ><strong id="stat-latest">Waiting for a request</strong>
          </div>
          <div class="stat-note">
            <span class="stat-note-mark" aria-hidden="true">∞</span
            ><span
              >Kept until you delete them.<small
                >Stable links. No automatic expiry.</small
              ></span
            >
          </div>
        </section>
        <section class="inspector" aria-label="Request inspector">
          <div class="request-list-panel">
            <div class="list-title">
              <h2>Requests <span id="matched" class="count">0</span></h2>
              <button
                id="refresh"
                class="icon-button"
                title="Refresh requests"
                aria-label="Refresh requests"
              >
                ↻
              </button>
            </div>
            <div class="search-wrap">
              <span aria-hidden="true">⌕</span
              ><input
                id="search"
                type="search"
                placeholder="Search body, headers, URL…"
                aria-label="Search requests"
                maxlength="500"
              /><kbd>/</kbd>
            </div>
            <div class="search-actions">
              <button id="copy-search" class="text-button">
                Copy search link ⧉
              </button>
            </div>
            <div class="list-caption">
              NEWEST FIRST <span id="page-label"></span>
            </div>
            <div
              id="request-list"
              class="request-list"
              aria-label="Captured requests"
            ></div>
            <div id="pagination" class="pagination" hidden>
              <button id="previous" class="secondary">← Previous</button
              ><button id="next" class="secondary">Next →</button>
            </div>
          </div>
          <div id="detail" class="detail-panel" aria-live="polite">
            <div class="empty-detail">
              <div class="empty-art" aria-hidden="true">
                <span>{ }</span><i class="empty-pip"></i>
              </div>
              <div class="eyebrow">READY WHEN YOU ARE</div>
              <h2>Your next request starts here.</h2>
              <p>
                Send something to your endpoint, then open it here.<br />Headers,
                payload, and all the little details.
              </p>
              <button class="secondary" id="empty-sample">
                Send a test request <span aria-hidden="true">↗</span>
              </button>
              <div class="empty-formats">
                JSON <span>·</span> Forms <span>·</span> Text
                <span>·</span> Binary <span>·</span> Anything
              </div>
            </div>
          </div>
        </section>
        <footer class="page-footer">
          <span>Made for the “what did it actually send?” moments.</span
          ><span>No indexing · No caching</span>
        </footer>
      </div>
    </main>
    <div id="toast" class="toast" role="status" hidden></div>
    <dialog id="inbox-dialog">
      <form id="inbox-form">
        <div class="dialog-title">
          <h2>A fresh inbox</h2>
          <button
            type="button"
            class="close-dialog icon-button"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p>
          Give this experiment a home. Inboxes are shared with anyone using this
          workspace.
        </p>
        <label for="inbox-name">Inbox name</label
        ><input
          id="inbox-name"
          required
          pattern="[a-z0-9][a-z0-9_-]{0,63}"
          maxlength="64"
          placeholder="e.g. stripe-sandbox"
          autocomplete="off"
        /><small>Lowercase letters, numbers, hyphens, and underscores.</small>
        <div class="dialog-actions">
          <button type="button" id="random-name" class="secondary">
            Random name</button
          ><button class="primary">Open inbox →</button>
        </div>
      </form>
    </dialog>
    <dialog id="tools-dialog" class="wide-dialog">
      <div class="dialog-title">
        <div>
          <div class="eyebrow">A TIDY WORKSPACE</div>
          <h2>Database tools</h2>
        </div>
        <button class="close-dialog icon-button" aria-label="Close">×</button>
      </div>
      <p>
        Back up your captures, clean out old experiments, and keep storage
        simple.
      </p>
      <div id="database-stats" class="database-stats">
        Loading database details…
      </div>
      <div class="tool-row">
        <div>
          <h3>Keep a copy</h3>
          <p>Download a consistent JSON backup of every inbox.</p>
        </div>
        <a href="api.php?action=backup" class="secondary" download
          >Download backup ↓</a
        >
      </div>
      <div class="cleanup">
        <h3>Clean up requests</h3>
        <div class="cleanup-fields">
          <div>
            <label for="cleanup-scope">Where</label
            ><select id="cleanup-scope">
              <option value="inbox">Current inbox</option>
              <option value="all">All inboxes</option>
            </select>
          </div>
          <div>
            <label for="cleanup-kind">What to delete</label
            ><select id="cleanup-kind">
              <option value="older">Older than a date</option>
              <option value="all">All requests (flush)</option>
            </select>
          </div>
        </div>
        <p id="cleanup-preview" class="notice" role="status" aria-live="polite">
          Checking matching requests…
        </p>
        <div id="cutoff-field">
          <div class="cutoff-heading">Received before</div>
          <div class="cutoff-presets" role="group" aria-label="Quick cleanup cutoffs">
            <button type="button" class="secondary" data-cutoff-minutes="0">Now</button>
            <button type="button" class="secondary" data-cutoff-minutes="1">1 minute ago</button>
            <button type="button" class="secondary" data-cutoff-minutes="60">1 hour ago</button>
            <button type="button" class="secondary" data-cutoff-minutes="1440">1 day ago</button>
            <button type="button" class="secondary" data-cutoff-minutes="10080">1 week ago</button>
            <button type="button" class="secondary" data-cutoff-minutes="43200" title="30 days ago">1 month ago</button>
          </div>
          <div class="cutoff-inputs">
            <div>
              <label for="cleanup-date">Date (YYYY-MM-DD)</label>
              <input id="cleanup-date" type="text" maxlength="10" placeholder="YYYY-MM-DD" autocomplete="off" spellcheck="false" aria-describedby="cleanup-timezone" />
            </div>
            <div>
              <label for="cleanup-time">Time (HH:MM:SS)</label>
              <input id="cleanup-time" type="text" maxlength="8" placeholder="HH:MM:SS" autocomplete="off" spellcheck="false" aria-describedby="cleanup-timezone" />
            </div>
          </div>
          <small id="cleanup-timezone"></small>
        </div>
        <button id="cleanup-delete" class="danger" disabled>
          Delete matching requests
        </button>
      </div>
      <p class="dialog-footnote">
        Deletion is permanent. Back up first if you might need these requests
        later. Each capture is a JSON file. Deleting captures immediately frees
        their storage.
      </p>
    </dialog>
    <dialog id="confirm-dialog" aria-labelledby="confirm-title" aria-describedby="confirm-message">
      <form id="confirm-form">
        <div class="dialog-title">
          <h2 id="confirm-title">Delete requests?</h2>
          <button
            type="button"
            class="close-dialog icon-button"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p id="confirm-message"></p>
        <div class="dialog-actions">
          <button id="confirm-cancel" type="button" class="close-dialog secondary">Cancel</button
          ><button id="confirm-submit" class="danger">
            Yes, delete permanently
          </button>
        </div>
      </form>
    </dialog>
    <dialog id="help-dialog" class="wide-dialog">
      <div class="dialog-title">
        <h2>From “sent” to understood.</h2>
        <button class="close-dialog icon-button" aria-label="Close">×</button>
      </div>
      <p>
        1. Copy your inbox endpoint.<br />2. Send it a request from your app,
        terminal, or webhook provider.<br />3. Inspect the headers and body.
        Copy a permanent link to revisit it.
      </p>
      <h3>Try it from your terminal</h3>
      <pre id="help-curl"></pre>
      <h3>A small, useful API</h3>
      <dl class="api-help">
        <dt>List & search</dt>
        <dd><code>GET api.php?inbox=default&q=hello</code></dd>
        <dt>Retrieve a request</dt>
        <dd><code>GET api.php?action=request&id=ID</code></dd>
        <dt>Download exact body</dt>
        <dd><code>GET api.php?action=download&id=ID</code></dd>
        <dt>Delete a request</dt>
        <dd><code>DELETE api.php?action=delete&id=ID</code></dd>
      </dl>
      <p>
        JSON responses include the request ID and permanent links. Binary bodies
        include a Base64 representation. Use Database tools for backups,
        age-based cleanup, and flushing.
      </p>
      <div class="notice">
        This is a shared testing space without sign-in. Anyone who can reach it
        can read or delete captures. No-index headers discourage crawlers; they
        do not make requests private.
      </div>
      <p class="dialog-footnote">
        The capture limit is <span id="body-limit">10 MB</span> per request;
        your host may impose a lower limit. Requests stay until explicitly
        deleted. Search matches literal text across IDs, methods, URLs, headers,
        and UTF-8 bodies. Press / to search, Esc to close dialogs.
      </p>
    </dialog>
    <noscript
      ><div class="noscript">
        Enable JavaScript to use the inbox interface. The receiver and JSON API
        work without it.
      </div></noscript
    >
  </body>
</html>
