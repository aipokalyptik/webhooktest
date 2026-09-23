"use strict";
const searchScopes = {
  any: "Anywhere",
  body: "Body text",
  headers: "All headers",
  header: "Specific header",
  query: "All query parameters",
  parameter: "Specific query parameter",
  json: "JSON body (JSONPath)",
  method: "HTTP method",
  url: "Full URL",
  path: "Path & raw query",
  content_type: "Content type",
  id: "Request ID",
  ip: "Client IP",
  size: "Body size (bytes)",
  received: "Received time",
};
const searchOperators = {
  contains: "Contains literal text",
  equals: "Equals entire value",
  wildcard: "Wildcard",
  regex: "Regular expression",
  exists: "Exists",
  missing: "Missing",
  gt: "Greater than",
  gte: "At least",
  lt: "Less than",
  lte: "At most",
  before: "Before",
  after: "After",
};
let searchDraft = { match: "all", rules: [] };
let previewTimer, previewController;
let previewGeneration = 0;
const ruleModes = (scope) =>
  scope === "size"
    ? ["equals", "gt", "gte", "lt", "lte"]
    : scope === "received"
      ? ["before", "after"]
      : ["contains", "equals", "wildcard", "regex", "exists", "missing"];
function parseFilters(raw) {
  if (!raw) return { match: "all", rules: [] };
  const value = JSON.parse(raw);
  if (
    !value ||
    !["all", "any"].includes(value.match) ||
    !Array.isArray(value.rules) ||
    value.rules.length > 8 ||
    value.rules.some(
      (r) =>
        !r ||
        !searchScopes[r.scope] ||
        !ruleModes(r.scope).includes(r.op) ||
        ["key", "value", "flags"].some(
          (k) => r[k] !== undefined && typeof r[k] !== "string",
        ),
    )
  )
    throw new Error(
      "Invalid search link. Reset the filters to start a new search.",
    );
  return value;
}
function renderSearchChips() {
  let value;
  try {
    value = parseFilters(filters);
  } catch {
    $("search-chips").innerHTML =
      '<button class="filter-chip" data-edit-search>Invalid filters · edit</button><button class="text-button" data-clear-search>Clear filters</button>';
    return;
  }
  $("advanced-search").textContent = value.rules.length
    ? `Filters (${value.rules.length})`
    : "Advanced search";
  $("search-chips").innerHTML = value.rules.length
    ? `<span class="filter-join">${value.match === "all" ? "ALL" : "ANY"}${query ? " + search text" : ""}</span>` +
      value.rules
        .map(
          (r, i) =>
            `<button class="filter-chip" data-remove-filter="${i}" title="Remove condition ${i + 1}">${esc(r.key || searchScopes[r.scope])} · ${esc(searchOperators[r.op])}${["exists", "missing"].includes(r.op) ? "" : ` · ${esc(r.value || '""')}`} ×</button>`,
        )
        .join("") +
      '<button class="text-button" data-clear-search>Clear filters</button>'
    : "";
}
function applyFilters(value) {
  filters = value.rules.length ? JSON.stringify(value) : "";
  page = 1;
  ++listGeneration;
  renderSearchChips();
  updateAddress();
  loadList();
}
function renderSearchRules() {
  $("search-join").value = searchDraft.match;
  $("add-search-rule").disabled = searchDraft.rules.length >= 8;
  $("search-rules").innerHTML = searchDraft.rules.length
    ? searchDraft.rules
        .map((r, i) => {
          const keyed = ["header", "parameter", "json"].includes(r.scope);
          const noValue = ["exists", "missing"].includes(r.op);
          const textMatch = !["size", "received"].includes(r.scope) && !noValue;
          const keyLabel =
            r.scope === "json"
              ? "JSONPath"
              : r.scope === "header"
                ? "Header name"
                : "Parameter name";
          const keyPlaceholder =
            r.scope === "json"
              ? "$.data.customer.id"
              : r.scope === "header"
                ? "X-GitHub-Event"
                : "event";
          const choices = (values, labels, selected) =>
            values
              .map(
                (v) =>
                  `<option value="${v}" ${v === selected ? "selected" : ""}>${labels[v]}</option>`,
              )
              .join("");
          return `<fieldset class="search-rule" data-rule="${i}"><legend>Condition ${i + 1}</legend><button type="button" class="remove-rule text-button" data-remove-rule="${i}" aria-label="Remove condition ${i + 1}">Remove</button><div class="search-rule-grid">
      <div><label for="scope-${i}">Search in</label><select id="scope-${i}" data-property="scope">${choices(Object.keys(searchScopes), searchScopes, r.scope)}</select></div>
      ${keyed ? `<div><label for="key-${i}">${keyLabel}</label><input id="key-${i}" data-property="key" maxlength="500" value="${esc(r.key || "")}" placeholder="${keyPlaceholder}" ${r.scope === "header" ? 'list="search-header-names"' : r.scope === "parameter" ? 'list="search-query-names"' : ""} autocomplete="off" spellcheck="false"></div>` : ""}
      <div><label for="op-${i}">Match</label><select id="op-${i}" data-property="op">${choices(ruleModes(r.scope), searchOperators, r.op)}</select></div>
      ${noValue ? "" : `<div><label for="value-${i}">${r.scope === "size" ? "Bytes" : r.scope === "received" ? "Date with timezone (ISO 8601)" : "Value / pattern"}</label><input id="value-${i}" data-property="value" maxlength="500" value="${esc(r.value || "")}" placeholder="${r.scope === "received" ? "2026-09-23T12:00:00Z" : r.op === "wildcard" ? "payment.*" : r.op === "regex" ? "payment\\.(failed|refunded)" : "Text to match"}" autocomplete="off" spellcheck="false"></div>`}
      </div><div class="search-rule-options">${textMatch ? `<label><input type="checkbox" data-property="case" ${r.case ? "checked" : ""}> Match case</label>` : ""}${r.op === "regex" ? `<label><input type="checkbox" data-flag="m" ${(r.flags || "").includes("m") ? "checked" : ""}> ^/$ match each line</label><label><input type="checkbox" data-flag="s" ${(r.flags || "").includes("s") ? "checked" : ""}> Dot matches newlines</label>` : ""}</div>
      ${r.scope === "json" ? "<small>Select values with JSONPath, then match any selected value. Exists includes null, false, 0, and empty strings. See the guide below.</small>" : r.op === "wildcard" ? "<small>Matches the entire value. * = any sequence, ? = one character. Use *text* to match within a value; \\* and \\? match literal symbols.</small>" : r.op === "regex" ? "<small>PHP regex, without / delimiters. Searches within the value; use \\A and \\z for the entire value.</small>" : ""}</fieldset>`;
        })
        .join("")
    : '<p class="search-empty">No conditions yet. Add one below or start with an example.</p>';
}
function addSearchRule(rule = {}) {
  if (searchDraft.rules.length >= 8) return;
  searchDraft.rules.push({
    scope: "body",
    op: "contains",
    key: "",
    value: "",
    case: false,
    flags: "",
    ...rule,
  });
  renderSearchRules();
  scheduleSearchPreview();
  $(`scope-${searchDraft.rules.length - 1}`).focus();
}
function scheduleSearchPreview() {
  ++previewGeneration;
  clearTimeout(previewTimer);
  previewController?.abort();
  $("apply-search").disabled = true;
  $("search-preview-count").textContent = "Checking matching requests…";
  $("search-preview-count").classList.remove("search-error");
  $("search-preview-results").innerHTML = "";
  $("search-selection-preview").innerHTML = "";
  previewTimer = setTimeout(previewSearch, 350);
}
async function previewSearch() {
  const generation = previewGeneration;
  previewController = new AbortController();
  try {
    const raw = JSON.stringify(searchDraft);
    if (
      new TextEncoder().encode(raw).length > 6000 ||
      new URLSearchParams({ q: query, filters: raw }).toString().length > 7000
    ) {
      throw new Error(
        "This search is too long for a portable link. Shorten the patterns or use fewer conditions.",
      );
    }
    const data = await api(
      {
        action: "search-preview",
        inbox,
        q: query,
        filters: JSON.stringify(searchDraft),
        ...(current ? { sample: current.id } : {}),
      },
      { signal: previewController.signal },
    );
    if (generation !== previewGeneration || !$("search-dialog").open) return;
    $("search-preview-count").textContent =
      `${data.matched} matching request${data.matched === 1 ? "" : "s"} in ${inbox}${query ? " · also matching the search bar" : ""}`;
    $("apply-search").disabled = false;
    $("search-preview-results").innerHTML = data.requests
      .map(
        (r) =>
          `<div>${method(r.method)} <span>${esc(r.uri)}</span>${r.matches?.[0] ? `<small>${esc(r.matches[0].field)}: ${esc(r.matches[0].value)}</small>` : ""}</div>`,
      )
      .join("");
    $("search-selection-preview").innerHTML = data.selections
      .map(
        (s) =>
          `<div><strong>Condition ${s.condition} · JSONPath on the open request</strong><p>${!s.applicable ? "This body is not valid JSON." : `${s.count} selected value${s.count === 1 ? "" : "s"}${s.count > 3 ? " (first 3 shown)" : ""}`}</p>${s.values.length ? `<pre>${esc(s.values.join("\n"))}</pre>` : ""}</div>`,
      )
      .join("");
  } catch (error) {
    if (generation !== previewGeneration || error.name === "AbortError") return;
    $("search-preview-count").textContent = error.message;
    $("search-preview-count").classList.add("search-error");
  }
}
function openSearch() {
  try {
    searchDraft = structuredClone(parseFilters(filters));
  } catch {
    searchDraft = { match: "all", rules: [] };
  }
  $("search-header-names").innerHTML = Object.keys(current?.headers || {})
    .map((name) => `<option value="${esc(name)}">`)
    .join("");
  $("search-query-names").innerHTML = [
    ...new Set(new URLSearchParams(current?.query || "").keys()),
  ]
    .map((name) => `<option value="${esc(name)}">`)
    .join("");
  renderSearchRules();
  $("search-dialog").showModal();
  scheduleSearchPreview();
}
function initSearch() {
  $("advanced-search").onclick = openSearch;
  $("open-search-guide").onclick = () => {
    $("search-guide").open = true;
    $("search-guide").scrollIntoView({ block: "start", behavior: "smooth" });
  };
  $("search-chips").onclick = (e) => {
    if (e.target.closest("[data-edit-search]")) return openSearch();
    if (e.target.closest("[data-clear-search]"))
      return applyFilters({ match: "all", rules: [] });
    const button = e.target.closest("[data-remove-filter]");
    if (!button) return;
    const value = parseFilters(filters);
    value.rules.splice(Number(button.dataset.removeFilter), 1);
    applyFilters(value);
  };
  $("search-join").onchange = () => {
    searchDraft.match = $("search-join").value;
    scheduleSearchPreview();
  };
  $("add-search-rule").onclick = () => addSearchRule();
  $("reset-search-rules").onclick = () => {
    searchDraft = { match: "all", rules: [] };
    renderSearchRules();
    scheduleSearchPreview();
  };
  $("search-rules").onclick = (e) => {
    const button = e.target.closest("[data-remove-rule]");
    if (!button) return;
    searchDraft.rules.splice(Number(button.dataset.removeRule), 1);
    renderSearchRules();
    scheduleSearchPreview();
    $("add-search-rule").focus();
  };
  $("search-rules").oninput = (e) => {
    const row = e.target.closest("[data-rule]");
    if (!row) return;
    const rule = searchDraft.rules[Number(row.dataset.rule)];
    const property = e.target.dataset.property;
    if (property)
      rule[property] =
        e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (e.target.dataset.flag) {
      const flags = new Set(rule.flags || "");
      if (e.target.checked) flags.add(e.target.dataset.flag);
      else flags.delete(e.target.dataset.flag);
      rule.flags = ["m", "s"].filter((f) => flags.has(f)).join("");
    }
    if (property === "scope") rule.key = "";
    if (property === "scope" || property === "op") {
      if (!ruleModes(rule.scope).includes(rule.op))
        rule.op = ruleModes(rule.scope)[0];
      const focusId = e.target.id;
      renderSearchRules();
      $(focusId).focus();
    }
    scheduleSearchPreview();
  };
  $("search-examples").onclick = (e) => {
    const example = e.target.closest("[data-search-example]")?.dataset
      .searchExample;
    const examples = {
      header: {
        scope: "header",
        key: "X-GitHub-Event",
        op: "equals",
        value: "push",
      },
      json: {
        scope: "json",
        key: "$.event",
        op: "wildcard",
        value: "payment.*",
      },
      array: {
        scope: "json",
        key: '$.items[?(@.sku == "PRO-123" && @.quantity > 1)]',
        op: "exists",
      },
      regex: {
        scope: "body",
        op: "regex",
        value: "payment\\.(failed|refunded)",
      },
    };
    if (examples[example]) addSearchRule(examples[example]);
  };
  $("search-form").onsubmit = (e) => {
    e.preventDefault();
    if ($("apply-search").disabled) return;
    applyFilters(searchDraft);
    $("search-dialog").close();
  };
  $("search-dialog").addEventListener("close", () => {
    ++previewGeneration;
    clearTimeout(previewTimer);
    previewController?.abort();
  });
  renderSearchChips();
}
