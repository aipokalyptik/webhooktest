"use strict";
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const params = new URLSearchParams(location.search);
let inbox = params.get("inbox") || "default";
let selected = params.get("request");
let current = null;
let page = Math.max(1, Number.parseInt(params.get("page"), 10) || 1);
let pages = 1;
let query = (params.get("q") || "").slice(0, 500);
let live = true;
let activeTab = "body";
let bodyMode = "pretty";
let listGeneration = 0;
let detailGeneration = 0;
let cleanupGeneration = 0;
let inboxes = [];
let toastTimer;
let confirmAction;
let lastListSignature = "";
const validInbox = (name) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(name);
if (!validInbox(inbox)) inbox = "default";
const base = new URL(document.body.dataset.baseUrl || ".", location.href);
const endpoint = () =>
  new URL(`ingest.php?inbox=${encodeURIComponent(inbox)}`, base).href;

const curl = () =>
  `curl -X POST ${shellQuote(endpoint())} \\\n  -H 'Content-Type: application/json' \\\n  -d '{"event":"hello.world","message":"It works!"}'`;
const bytes = (n) => {
  n = Number(n);
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
};
const relative = (value) => {
  const seconds = Math.max(0, (Date.now() - new Date(value)) / 1000);
  return seconds < 60
    ? "just now"
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ago`
      : seconds < 86400
        ? `${Math.floor(seconds / 3600)}h ago`
        : `${Math.floor(seconds / 86400)}d ago`;
};
const time = (value) =>
  new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const method = (value) =>
  `<span class="method ${["get", "delete", "put", "patch"].includes(value.toLowerCase()) ? value.toLowerCase() : ""}">${esc(value)}</span>`;
function toast(message, error = false) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").classList.toggle("error", error);
  $("toast").hidden = false;
  toastTimer = setTimeout(() => ($("toast").hidden = true), 4500);
}
async function api(args = {}, options = {}) {
  const response = await fetch(`api.php?${new URLSearchParams(args)}`, {
    cache: "no-store",
    credentials: "omit",
    ...options,
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "The server returned an unreadable response. Check the PHP server configuration.",
    );
  }
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}
async function copy(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    const ok = document.execCommand("copy");
    input.remove();
    if (!ok) {
      toast(
        "Copy is unavailable here. Select and copy the text manually.",
        true,
      );
      return;
    }
  }
  toast("Copied to clipboard");
}
function updateAddress(replace = false) {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("inbox", inbox);
  if (query) url.searchParams.set("q", query);
  if (page > 1) url.searchParams.set("page", String(page));
  if (selected) url.searchParams.set("request", selected);
  history[replace ? "replaceState" : "pushState"]({}, "", url);
}
function paintInbox() {
  $("breadcrumb").textContent = inbox;
  $("inbox-title").innerHTML =
    `${esc(inbox)}<span class="heading-suffix"> / inbox</span>`;
  document.title = `${inbox} — Webhook Test`;
  $("endpoint").value = endpoint();
  $("help-curl").textContent = curl();
  $("cleanup-scope").options[0].textContent = `Current inbox (${inbox})`;
  renderInboxes();
}
function renderInboxes() {
  const names = [{ name: inbox, count: 0 }, ...inboxes];
  const seen = new Set();
  $("inboxes").innerHTML = names
    .filter((x) => !seen.has(x.name) && seen.add(x.name))
    .map((x) => {
      const count = inboxes.find((i) => i.name === x.name)?.count || 0;
      return `<a href="?inbox=${encodeURIComponent(x.name)}" class="inbox-link ${x.name === inbox ? "active" : ""}" ${x.name === inbox ? 'aria-current="page"' : ""}><span aria-hidden="true">▱</span><span class="inbox-name">${esc(x.name)}</span><span class="inbox-count">${count}</span></a>`;
    })
    .join("");
}
const emptyMarkup = $("detail").innerHTML;
function emptyDetail(message = "") {
  current = null;
  $("detail").innerHTML = message
    ? `<div class="empty-detail"><div class="empty-art" aria-hidden="true"><span>?</span></div><h2>Request unavailable</h2><p>${esc(message)}</p></div>`
    : emptyMarkup;
}
async function loadList({ manual = false } = {}) {
  const generation = ++listGeneration;
  try {
    const data = await api({ inbox, q: query, page });
    if (generation !== listGeneration) return;
    $("connection-error").hidden = true;
    $("live-label").textContent = live ? "Live updates" : "Updates paused";
    inboxes = data.inboxes;
    renderInboxes();
    page = data.page;
    pages = data.pages;
    updateAddress(true);
    $("stat-total").textContent = Number(data.stats.total).toLocaleString();
    $("stat-size").textContent = bytes(data.stats.bytes);
    $("stat-latest").textContent = data.stats.latest
      ? relative(data.stats.latest)
      : "Waiting for a request";
    $("stat-latest").title = data.stats.latest ? time(data.stats.latest) : "";
    $("matched").textContent = data.matched;
    $("body-limit").textContent = bytes(data.max_body_bytes);
    $("pagination").hidden = pages <= 1;
    $("previous").disabled = page <= 1;
    $("next").disabled = page >= pages;
    $("page-label").textContent = pages > 1 ? `${page} / ${pages}` : "";
    const signature = JSON.stringify([data.requests, selected, query]);
    if (signature !== lastListSignature) {
      lastListSignature = signature;
      $("request-list").innerHTML = data.requests.length
        ? data.requests
            .map(
              (r) =>
                `<a href="?inbox=${encodeURIComponent(inbox)}&request=${r.id}" class="request-item ${r.id === selected ? "selected" : ""}" data-id="${r.id}" ${r.id === selected ? 'aria-current="true"' : ""}><div class="request-topline">${method(r.method)}<time class="request-time" datetime="${r.received_at}" title="${esc(time(r.received_at))}">${relative(r.received_at)}</time></div><div class="request-path">${esc(r.uri)}</div><div class="request-bottom"><span>${esc(r.content_type || "No content type")}</span><span>${bytes(r.size)}</span></div></a>`,
            )
            .join("")
        : `<div class="list-empty"><strong>${query ? "No matching requests" : "Listening for your first request"}</strong>${query ? "Try a different search or clear the search field." : "Your endpoint is ready. Send it something."}</div>`;
    } else {
      document.querySelectorAll(".request-time").forEach((el) => {
        el.textContent = relative(el.dateTime);
      });
    }
    if (!selected && data.requests.length)
      await selectRequest(data.requests[0].id, true);
    if (manual) toast("Inbox refreshed");
  } catch (error) {
    if (generation !== listGeneration) return;
    $("connection-error").textContent = error.message;
    $("connection-error").hidden = false;
    $("live-label").textContent = "Reconnecting…";
  }
}
async function selectRequest(id, replace = false) {
  selected = id;
  updateAddress(replace);
  const generation = ++detailGeneration;
  document.querySelectorAll(".request-item").forEach((el) => {
    const active = el.dataset.id === id;
    el.classList.toggle("selected", active);
    if (active) el.setAttribute("aria-current", "true");
    else el.removeAttribute("aria-current");
  });
  $("detail").innerHTML =
    '<div class="empty-detail"><p>Opening request…</p></div>';
  try {
    const request = await api({ action: "request", id });
    if (generation !== detailGeneration) return;
    current = request;
    if (inbox !== request.inbox) {
      inbox = request.inbox;
      page = 1;
      query = "";
      $("search").value = "";
      paintInbox();
      updateAddress(true);
      await loadList();
    }
    renderDetail();
  } catch (error) {
    if (generation === detailGeneration) emptyDetail(error.message);
  }
}
function table(entries) {
  return `<table class="kv-table"><tbody>${entries.map(([key, value]) => `<tr><th scope="row">${esc(key)}</th><td>${esc(value)}</td></tr>`).join("")}</tbody></table>`;
}
function renderDetail() {
  if (!current) return;
  const r = current;
  const headerCount = Object.keys(r.headers).length;
  const queryEntries = [...new URLSearchParams(r.query).entries()];
  $("detail").innerHTML =
    `<div class="detail-head"><div class="detail-title">${method(r.method)}<h2>Request details</h2><time title="${esc(r.received_at)}">${esc(time(r.received_at))}</time></div><div class="detail-uri">${esc(r.uri)}</div><div class="detail-actions"><button class="secondary" data-detail-action="link">Copy permalink ⧉</button><a class="secondary" href="api.php?action=download&id=${r.id}" download>Raw body ↓</a><a class="secondary" href="api.php?action=export&id=${r.id}" download>Export JSON ↓</a><button class="delete-one" data-detail-action="delete">Delete</button></div></div><div class="detail-tabs" role="tablist" aria-label="Request details">${[
      ["body", "Body", ""],
      ["headers", "Headers", headerCount],
      ["query", "Query", queryEntries.length],
      ["replay", "cURL", ""],
      ["info", "Info", ""],
    ]
      .map(
        ([id, label, count]) =>
          `<button id="tab-${id}" class="tab" role="tab" aria-selected="${activeTab === id}" aria-controls="tab-content" tabindex="${activeTab === id ? 0 : -1}" data-tab="${id}">${label}${count !== "" ? `<span>${count}</span>` : ""}</button>`,
      )
      .join(
        "",
      )}</div><div class="detail-body" id="tab-content" role="tabpanel" aria-labelledby="tab-${activeTab}" tabindex="0"></div>`;
  const content = $("tab-content");
  if (activeTab === "headers")
    content.innerHTML = table(Object.entries(r.headers));
  else if (activeTab === "query")
    content.innerHTML = queryEntries.length
      ? table(queryEntries)
      : '<p class="binary-note">This request has no query parameters.</p>';
  else if (activeTab === "replay")
    content.innerHTML = `<div class="payload-toolbar"><button class="secondary" data-detail-action="curl">Copy cURL ⧉</button><button class="secondary" data-detail-action="curl-download">Download .sh ↓</button></div><pre class="code-block">${esc(replayCurl(r).slice(0, 100000))}</pre>${replayCurl(r).length > 100000 ? '<p class="binary-note">Preview shortened. Copy or download for the complete command.</p>' : ""}<p class="notice">Replays the method, captured headers, URL, and exact body bytes. Running it creates another capture. HTTP framing, header casing, and duplicate headers may have been normalized by your server. Requires PHP CLI, cURL, and a POSIX shell.</p>`;
  else if (activeTab === "info")
    content.innerHTML = table([
      ["Request ID", r.id],
      ["Inbox", r.inbox],
      ["Received (UTC)", r.received_at],
      ["Method", r.method],
      ["Content type", r.content_type || "Not supplied"],
      ["Body size", `${r.size} bytes`],
      ["Client IP", r.remote_addr],
      ["Body encoding", r.body_encoding],
    ]);
  else {
    const binary = r.body_encoding === "base64";
    const raw = binary ? r.body_base64 : r.body;
    const display = bodyMode === "pretty" && !binary ? prettyJSON(raw) : raw;
    // Large bodies remain available in full via download/export; keep the inspector responsive.
    const truncated = display.length > 100000;
    content.innerHTML = `<div class="payload-toolbar">${binary ? '<span style="margin-left:0">BASE64</span>' : `<button class="mode-button ${bodyMode === "pretty" ? "active" : ""}" data-mode="pretty">Formatted</button><button class="mode-button ${bodyMode === "raw" ? "active" : ""}" data-mode="raw">Raw</button>`}<button class="mode-button" data-detail-action="body">Copy ${binary ? "Base64" : "body"} ⧉</button><span>${esc(r.content_type.split(";")[0] || "NO CONTENT TYPE")}</span></div>${binary ? '<p class="binary-note">Binary payload · Base64 preview. Download the raw body for the original bytes.</p>' : ""}<pre class="code-block">${esc(display.slice(0, 100000) || "(empty body)")}</pre>${truncated ? '<p class="binary-note">Preview limited to 100,000 characters. Copy, download, or export for the complete body.</p>' : ""}<div class="detail-meta"><span>${bytes(r.size)}</span><span>${esc(r.id.slice(0, 12))}…</span><span>Captured in ${esc(r.inbox)}</span></div>`;
  }
}
async function sendSample() {
  const button = $("send-sample");
  button.disabled = true;
  try {
    const response = await fetch(endpoint(), {
      method: "POST",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Test": "sample",
      },
      body: JSON.stringify(
        {
          event: "hello.world",
          message: "Your webhook inbox is working.",
          data: { order_id: "ord_1042", amount: 4200, currency: "USD" },
          sent_at: new Date().toISOString(),
        },
        null,
        2,
      ),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Could not send test request.");
    query = "";
    page = 1;
    $("search").value = "";
    await selectRequest(result.id);
    await loadList();
    toast("Test request captured");
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}
function openInbox() {
  $("inbox-name").value = "";
  $("inbox-dialog").showModal();
  $("inbox-name").focus();
}
function confirmDelete(title, message, action) {
  $("confirm-title").textContent = title;
  $("confirm-message").textContent = message;
  confirmAction = action;
  $("confirm-dialog").showModal();
  $("confirm-cancel").focus();
}
function cleanupArgs() {
  const args = {
    action: "maintenance",
    scope: $("cleanup-scope").value,
    inbox,
  };
  if ($("cleanup-kind").value === "older") {
    const date = new Date($("cleanup-before").value);
    if (!Number.isFinite(date.getTime())) return null;
    args.before = date.toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  return args;
}
async function previewCleanup() {
  const generation = ++cleanupGeneration;
  $("cutoff-field").hidden = $("cleanup-kind").value !== "older";
  $("cleanup-delete").disabled = true;
  const args = cleanupArgs();
  if (!args) {
    $("cleanup-preview").textContent =
      "Choose a cutoff to preview the cleanup.";
    return;
  }
  $("cleanup-preview").textContent = "Checking matching requests…";
  try {
    const data = await api(args);
    if (generation !== cleanupGeneration) return;
    $("database-stats").innerHTML =
      `<div><strong>${Number(data.totals.count).toLocaleString()}</strong>total requests</div><div><strong>${bytes(data.storage_bytes)}</strong>JSON storage</div><div><strong>${bytes(data.totals.bytes)}</strong>payload bytes</div>`;
    $("cleanup-preview").textContent =
      `${data.matching.count} request${data.matching.count === 1 ? "" : "s"} (${bytes(data.matching.bytes)}) match this cleanup. New matching requests arriving before deletion are included.`;
    $("cleanup-delete").disabled = Number(data.matching.count) === 0;
  } catch (error) {
    if (generation === cleanupGeneration)
      $("cleanup-preview").textContent = error.message;
  }
}
$("copy-endpoint").onclick = () => copy(endpoint());
$("copy-curl").onclick = () => copy(curl());
$("send-sample").onclick = sendSample;
$("new-inbox").onclick = openInbox;
$("new-inbox-bottom").onclick = openInbox;
$("random-name").onclick = () => {
  $("inbox-name").value = `test-${Math.random().toString(36).slice(2, 10)}`;
};
$("inbox-form").onsubmit = (e) => {
  e.preventDefault();
  const name = $("inbox-name").value;
  if (validInbox(name)) location.href = `?inbox=${encodeURIComponent(name)}`;
};
$("help-button").onclick = () => $("help-dialog").showModal();
$("live-toggle").onclick = () => {
  live = !live;
  $("live-toggle").setAttribute("aria-pressed", String(live));
  $("live-toggle").classList.toggle("paused", !live);
  $("live-label").textContent = live ? "Live updates" : "Updates paused";
  if (live) loadList();
};
$("refresh").onclick = () => loadList({ manual: true });
let searchTimer;
$("search").oninput = () => {
  query = $("search").value;
  page = 1;
  updateAddress(true);
  ++listGeneration;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadList(), 250);
};
$("previous").onclick = () => {
  page--;
  updateAddress();
  loadList();
};
$("next").onclick = () => {
  page++;
  updateAddress();
  loadList();
};
$("request-list").onclick = (e) => {
  const row = e.target.closest("[data-id]");
  if (row && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    selectRequest(row.dataset.id);
  }
};
$("detail").onclick = (e) => {
  if (e.target.closest("#empty-sample")) {
    sendSample();
    return;
  }
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    activeTab = tab.dataset.tab;
    renderDetail();
    $(`tab-${activeTab}`).focus();
    return;
  }
  const mode = e.target.closest("[data-mode]");
  if (mode) {
    bodyMode = mode.dataset.mode;
    renderDetail();
    $("detail").querySelector(`[data-mode="${bodyMode}"]`).focus();
    return;
  }
  const action = e.target.closest("[data-detail-action]")?.dataset.detailAction;
  if (!action || !current) return;
  if (action === "link") copy(current.permalink);
  if (action === "curl") copy(replayCurl(current));
  if (action === "curl-download") {
    const url = URL.createObjectURL(
      new Blob(["#!/bin/sh\n" + replayCurl(current) + "\n"], {
        type: "text/plain",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `webhook-${current.id}.sh`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (action === "body")
    copy(
      current.body_encoding === "base64" ? current.body_base64 : current.body,
    );
  if (action === "delete") {
    const id = current.id;
    confirmDelete(
      "Delete this request?",
      "Its permanent link will stop working. This cannot be undone.",
      async () => {
        await api({ action: "delete", id }, { method: "DELETE" });
        ++detailGeneration;
        selected = null;
        updateAddress(true);
        emptyDetail();
        await loadList();
        toast("Request deleted");
      },
    );
  }
};
$("detail").addEventListener("keydown", (e) => {
  const tab = e.target.closest("[data-tab]");
  if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
    return;
  e.preventDefault();
  const tabs = ["body", "headers", "query", "replay", "info"];
  const index = tabs.indexOf(activeTab);
  activeTab =
    tabs[
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? 4
          : (index + (e.key === "ArrowRight" ? 1 : 4)) % 5
    ];
  renderDetail();
  $(`tab-${activeTab}`).focus();
});
document
  .querySelectorAll(".close-dialog")
  .forEach(
    (button) => (button.onclick = () => button.closest("dialog").close()),
  );
document.querySelectorAll("dialog").forEach((dialog) =>
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      )
        dialog.close();
    }
  }),
);
$("database-tools").onclick = () => {
  const date = new Date(Date.now() - 30 * 86400000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  $("cleanup-before").value = date.toISOString().slice(0, 16);
  $("tools-dialog").showModal();
  previewCleanup();
};
["cleanup-scope", "cleanup-kind", "cleanup-before"].forEach((id) =>
  $(id).addEventListener("change", previewCleanup),
);
$("cleanup-delete").onclick = () => {
  const args = cleanupArgs();
  if (!args) return;
  const expected = args.scope === "all" ? "all" : inbox;
  confirmDelete(
    "Delete matching requests?",
    `${args.scope === "all" ? "Every inbox" : `Inbox “${inbox}”`} will be affected. ${args.before ? `Only requests received before ${new Date(args.before).toLocaleString()} will be deleted.` : "All requests in this scope will be deleted."} Download a backup first if you need one.`,
    async () => {
      const result = await api(args, {
        method: "DELETE",
        headers: { "X-Confirm-Scope": expected },
      });
      if (
        current &&
        (args.scope === "all" || current.inbox === args.inbox) &&
        (!args.before ||
          current.received_at < args.before.replace("Z", ".000000Z"))
      ) {
        ++detailGeneration;
        selected = null;
        updateAddress(true);
        emptyDetail();
      }
      await loadList();
      await previewCleanup();
      toast(`${result.deleted} requests deleted`);
    },
  );
};
$("confirm-form").onsubmit = async (e) => {
  e.preventDefault();
  if ($("confirm-submit").disabled || !confirmAction) return;
  $("confirm-submit").disabled = true;
  try {
    await confirmAction();
    $("confirm-dialog").close();
  } catch (error) {
    toast(error.message, true);
  } finally {
    $("confirm-submit").disabled = false;
  }
};
document.addEventListener("keydown", (e) => {
  if (
    e.key === "/" &&
    !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) &&
    !document.querySelector("dialog[open]")
  ) {
    e.preventDefault();
    $("search").focus();
  }
});
window.addEventListener("popstate", async () => {
  const p = new URLSearchParams(location.search);
  inbox = validInbox(p.get("inbox") || "") ? p.get("inbox") : "default";
  selected = p.get("request");
  page = Math.max(1, Number.parseInt(p.get("page"), 10) || 1);
  query = (p.get("q") || "").slice(0, 500);
  $("search").value = query;
  ++detailGeneration;
  ++listGeneration;
  paintInbox();
  emptyDetail();
  if (selected) await selectRequest(selected, true);
  await loadList();
});
async function poll() {
  if (live && !document.hidden) await loadList();
  setTimeout(poll, 4000);
}
(async () => {
  $("search").value = query;
  paintInbox();
  if (selected) await selectRequest(selected, true);
  await loadList();
  setTimeout(poll, 4000);
})();

$("copy-search").onclick = () => {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("inbox", inbox);
  if (query) url.searchParams.set("q", query);
  if (page > 1) url.searchParams.set("page", String(page));
  copy(url.href);
};
