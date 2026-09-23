"use strict";

// Inspection is a view of the original request. Multipart sources refer to byte
// ranges in that same capture; choosing a file never reconstructs its contents.
class BodyViewer {
  constructor(host, record, previousState, copy) {
    this.host = host;
    this.record = record;
    this.copy = copy;
    this.bytes = BinaryData.decode(record.body_base64);
    this.state =
      previousState?.id === record.id
        ? previousState
        : { id: record.id, source: "body", sources: {} };
    const fallback = {
      id: "body",
      label: "Original request body",
      offset: 0,
      length: this.bytes.length,
      kind: record.body_encoding === "utf-8" ? "text" : "binary",
      encoding: record.body_encoding === "utf-8" ? "utf-8" : null,
      mime: record.content_type.split(";")[0],
      evidence: [],
      warnings: [
        "Type detection was unavailable. The captured bytes are still available.",
      ],
    };
    this.sources = [
      record.inspection?.body || fallback,
      ...(record.inspection?.parts || []),
    ];
    this.sequence = 0;
    this.root = document.createElement("div");
    this.root.className = "body-viewer";
    this.root.addEventListener("click", (event) => {
      const mode = event.target.closest("[data-body-mode]");
      if (mode) {
        this.view.mode = mode.dataset.bodyMode;
        this.render();
        this.root.querySelector(`[data-body-mode="${this.view.mode}"]`).focus();
      }
      if (event.target.closest("[data-body-copy]")) this.copyBody();
      if (event.target.closest("[data-body-download]")) this.downloadPart();
    });
    this.root.addEventListener("change", (event) => {
      if (event.target.matches(".body-source-select")) {
        this.state.source = event.target.value;
        this.render();
        this.root.querySelector(".body-source-select").focus();
      }
      if (event.target.matches(".body-language")) {
        this.view.language = event.target.value;
        this.highlight();
      }
      if (event.target.matches(".body-wrap")) {
        this.view.wrap = event.target.checked;
        this.root
          .querySelector(".body-code")
          .classList.toggle("wrap-lines", this.view.wrap);
      }
    });
    host.append(this.root);
    this.render();
  }
  escape(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }
  stopHighlight() {
    this.sequence++;
    clearTimeout(this.deadline);
    if (this.pending) {
      this.worker?.terminate();
      this.worker = null;
    }
    this.pending = false;
  }
  releaseView() {
    this.stopHighlight();
    if (this.binary) {
      this.view.binary = this.binary.state;
      this.binary.destroy();
      this.binary = null;
    }
  }
  render() {
    this.releaseView();
    this.source =
      this.sources.find((source) => source.id === this.state.source) ||
      this.sources[0];
    this.state.source = this.source.id;
    this.view = this.state.sources[this.source.id] ||= {
      mode: "auto",
      language: "auto",
      wrap: false,
    };
    const source = this.source;
    this.data = this.bytes.subarray(
      source.offset,
      source.offset + source.length,
    );
    const automatic =
      source.kind === "binary" ||
      (source.kind === "multipart" && !source.encoding)
        ? "hex"
        : "pretty";
    this.mode = this.view.mode === "auto" ? automatic : this.view.mode;
    const textMode = ["pretty", "raw"].includes(this.mode);
    this.preview = textMode
      ? BodyData.preview(this.data, source, 100000, this.mode === "raw")
      : null;
    this.language = BodyData.language(
      source,
      this.preview?.text || "",
      SyntaxLanguages,
    );
    const escape = (value) => this.escape(value);
    const warnings = [
      ...new Set([
        ...(source.warnings || []),
        ...(source.id === "body" ? this.record.inspection?.warnings || [] : []),
      ]),
    ];
    const evidence = [...(source.evidence || [])];
    if (this.language.id !== "plain")
      evidence.push({
        source: "Syntax choice",
        value: `${this.language.name} · ${this.language.source}`,
      });
    if (
      source.filename &&
      !evidence.some((item) => /filename/i.test(item.source))
    )
      evidence.push({ source: "Posted filename", value: source.filename });
    if (source.id !== "body")
      evidence.push({
        source: "Original byte range",
        value: `${source.offset.toLocaleString()}–${(source.offset + Math.max(0, source.length - 1)).toLocaleString()} (${source.length.toLocaleString()} bytes)`,
      });
    const modes = [
      ["auto", "Auto"],
      ["pretty", "Formatted"],
      ["raw", "Raw"],
      ["hex", "Hex"],
      ["base64", "Base64"],
    ];
    const sourcePicker =
      this.sources.length > 1
        ? `<label class="body-source-label">Inspect <select class="body-source-select" aria-label="Body or uploaded file">${this.sources.map((item) => `<option value="${escape(item.id)}" ${item.id === source.id ? "selected" : ""}>${escape(item.id === "body" ? "Original request body" : item.name ? `${item.name}${item.filename ? " · " + item.filename : ""}` : item.filename || item.label || item.id)} · ${item.length.toLocaleString()} bytes</option>`).join("")}</select></label>`
        : "";
    this.root.innerHTML = `${sourcePicker}<details class="body-detection"><summary><span class="body-kind ${automatic === "hex" ? "is-binary" : ""}">${escape(source.kind || "unknown")}</span><strong>${escape(this.language.id !== "plain" && automatic !== "hex" ? this.language.name + " · " + (source.mime || "text") : source.mime || "Unknown type")}</strong><span class="body-detection-why">${warnings.length ? "⚠ " : ""}Detection details</span></summary><dl>${evidence.map((item) => `<div><dt>${escape(item.source)}</dt><dd>${escape(item.value)}</dd></div>`).join("")}</dl><p>Auto opens ${automatic === "hex" ? "Hex for binary bytes" : "a highlighted text view"}. Headers and filenames are hints; detection can be overridden below.</p>${warnings.map((warning) => `<p class="body-warning">${escape(warning)}</p>`).join("")}</details><div class="payload-toolbar">${modes.map(([id, label]) => `<button class="mode-button ${this.view.mode === id ? "active" : ""}" data-body-mode="${id}" aria-pressed="${this.view.mode === id}">${label}</button>`).join("")}${this.mode !== "hex" ? `<button class="mode-button" data-body-copy>Copy ${this.mode === "base64" ? "Base64" : "body"} ⧉</button>` : ""}${source.id === "body" ? `<a class="mode-button" href="api.php?action=download&id=${escape(this.record.id)}" download aria-label="Download raw body" title="Download the complete original request bytes">Download ↓</a>` : '<button class="mode-button" data-body-download title="Download the original bytes of this part">Download ↓</button>'}</div>${textMode ? `<div class="body-syntax-controls"><label>Syntax <select class="body-language" aria-label="Syntax language"><option value="auto">Auto · ${escape(this.language.name)}</option><option value="plain">Plain text</option>${SyntaxLanguages.map((language) => `<option value="${escape(language.id)}">${escape(language.name)}</option>`).join("")}</select></label><label class="body-wrap-label"><input class="body-wrap" type="checkbox" ${this.view.wrap ? "checked" : ""}> Wrap lines</label></div>` : ""}<div class="body-surface"></div><p class="body-render-status" role="status"></p><p class="body-copy-status" role="status" hidden></p>${textMode && this.preview.lossy ? '<p class="body-warning">This text interpretation contains replacement characters (�). Hex and Download preserve the original bytes.</p>' : ""}${textMode && source.kind === "binary" ? '<p class="body-warning">This payload was detected as binary. You are viewing a text interpretation.</p>' : ""}${source.encoding && !["utf-8", "us-ascii", "ascii"].includes(source.encoding.toLowerCase()) && textMode ? `<p class="body-encoding-note">Decoded from ${escape(source.encoding)} for display. Downloads and Hex retain the original encoding and bytes.</p>` : ""}<div class="detail-meta"><span>${source.length.toLocaleString()} bytes${source.id !== "body" ? " in this part" : ""}</span><span>${escape(this.record.id.slice(0, 12))}…</span><span>Captured in ${escape(this.record.inbox)}</span></div><details class="body-guide"><summary>File detection & syntax highlighting</summary><p>Byte signatures, PHP Fileinfo (when installed), text structure, Content-Type, and posted filename extensions help identify the payload. The detection details show the clues, including conflicting claims. Detection is a best-effort inspection, not file validation. Auto chooses Hex for binary formats—even when their bytes look like text, such as PDFs. You can choose any view manually.</p><p>Formatted indents valid JSON without changing number precision. Other text keeps its layout. Raw preserves whitespace; both text modes can use syntax colors. Choose Plain text to remove highlighting, or select from ${SyntaxLanguages.length} bundled Prism languages. You can type a language name while the selector is focused. No remote service receives your payload.</p><p>Highlighting runs in a worker with a time limit. Previews show up to 100,000 characters; Copy and Download retain the full body. Multipart parts use their own headers and filenames. Download saves the selected part; choose Original request body to download the complete multipart envelope.</p></details>`;
    const surface = this.root.querySelector(".body-surface");
    if (this.mode === "hex") {
      this.binary = new BinaryViewer(
        surface,
        {
          id: this.record.id + (source.id === "body" ? "" : "-" + source.id),
          body_bytes: this.data,
        },
        this.view.binary,
        this.copy,
      );
      return;
    }
    const pre = document.createElement("pre");
    pre.className = `code-block body-code${this.view.wrap ? " wrap-lines" : ""}`;
    pre.tabIndex = 0;
    const code = document.createElement("code");
    pre.append(code);
    surface.append(pre);
    if (this.mode === "base64") {
      // 75,000 complete source bytes produce exactly 100,000 Base64 characters.
      code.textContent = this.data.length
        ? BinaryData.format(
            this.data,
            0,
            Math.min(this.data.length, 75000) - 1,
            "base64",
          )
        : "(empty body)";
      this.status(
        this.data.length > 75000
          ? "Base64 preview limited to 100,000 characters. Copy or Download for all bytes."
          : "Base64 of the original bytes.",
      );
    } else {
      this.root.querySelector(".body-language").value = this.view.language;
      this.highlight();
    }
  }
  status(text) {
    this.root.querySelector(".body-render-status").textContent = text;
  }
  highlight() {
    this.stopHighlight();
    const id = this.sequence;
    const code = this.root.querySelector(".body-code code");
    code.textContent = this.preview.text || "(empty body)";
    const language =
      this.view.language === "auto" ? this.language.id : this.view.language;
    const info = SyntaxLanguages.find((item) => item.id === language);
    const hint = this.preview.truncated
      ? " · Preview limited to 100,000 characters; Copy or Download for the full body."
      : "";
    if (!this.preview.text) {
      this.status("Empty body.");
      return;
    }
    if ((language === "plain" || !info) && this.mode !== "pretty") {
      this.status("Plain text" + hint);
      return;
    }
    this.status(`Highlighting${info ? " · " + info.name : ""}…`);
    try {
      if (!this.worker) {
        this.worker = new Worker("index.php?asset=syntax-worker.js");
        this.workerReady = false;
      }
      const worker = this.worker;
      const timedOut = () => {
        if (this.destroyed || this.worker !== worker || id !== this.sequence) return;
        this.stopHighlight();
        this.status(
          "Highlighting took too long; showing plain text. Try another language or download the body." +
            hint,
        );
      };
      this.pending = true;
      this.worker.onmessage = (event) => {
        if (this.destroyed || this.worker !== worker) return;
        if (event.data.ready) {
          this.workerReady = true;
          clearTimeout(this.deadline);
          if (this.pending) this.deadline = setTimeout(timedOut, 2500);
          return;
        }
        if (event.data.id !== this.sequence) return;
        this.pending = false;
        clearTimeout(this.deadline);
        if (event.data.error) {
          this.status("Highlighting unavailable; showing plain text." + hint);
          return;
        }
        // Only Prism-generated escaped markup from our same-origin worker enters
        // this element. Raw payloads always go through textContent.
        if (event.data.language === "plain") code.textContent = event.data.text;
        else code.innerHTML = event.data.html;
        this.status(
          `${event.data.language === "plain" ? "Plain text" : info?.name || "Plain text"}${this.view.language === "auto" && this.language.source ? " · " + this.language.source : ""}${event.data.formatted ? " · JSON formatted" : ""}${this.preview.truncated || event.data.truncated ? " · Preview limited to 100,000 characters; Copy or Download for the full body." : ""}`,
        );
      };
      this.worker.onerror = () => {
        if (this.destroyed || this.worker !== worker) return;
        this.stopHighlight();
        this.worker?.terminate();
        this.worker = null;
        this.status("Highlighting unavailable; showing plain text." + hint);
      };
      // Asset loading gets a separate allowance on slow hosts; the execution
      // budget begins only once the worker confirms its grammars are loaded.
      this.deadline = setTimeout(timedOut, this.workerReady ? 2500 : 10000);
      this.worker.postMessage({
        id,
        text: this.preview.text,
        language: info?.id || "plain",
        formatted: this.mode === "pretty",
      });
    } catch {
      this.stopHighlight();
      this.status("Highlighting unavailable; showing plain text." + hint);
    }
  }
  async copyBody() {
    const sourceId = this.source.id,
      mode = this.mode;
    const value =
      this.mode === "base64"
        ? BinaryData.format(this.data, 0, this.data.length - 1, "base64")
        : BodyData.decode(this.data, this.source);
    const copied = await this.copy(value);
    if (this.destroyed || this.source.id !== sourceId || this.mode !== mode)
      return;
    const status = this.root.querySelector(".body-copy-status");
    status.hidden = false;
    status.textContent = copied
      ? `Copied ${this.mode === "base64" ? "the full Base64 body" : "the full decoded text"}.`
      : "Clipboard unavailable. Use Download to save the original bytes.";
  }
  downloadPart() {
    const source = this.source;
    const filename = (
      source.filename || `webhook-${this.record.id}-${source.id}.bin`
    ).replace(/[\\/:*?"<>|\x00-\x1F]/g, "_");
    const url = URL.createObjectURL(
      new Blob([this.data], { type: "application/octet-stream" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  destroy() {
    this.destroyed = true;
    this.releaseView();
    this.worker?.terminate();
    this.root.remove();
  }
}
