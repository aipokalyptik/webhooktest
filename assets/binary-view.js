"use strict";

// The grid owns only the visible rows. Bytes always come from the captured Base64,
// never from a formatted body or a re-encoded JavaScript string.
class BinaryViewer {
  constructor(host, record, previousState, onCopy) {
    this.host = host;
    this.record = record;
    this.copy = onCopy;
    this.data = record.body_bytes ?? BinaryData.decode(record.body_base64);
    this.state =
      previousState?.id === record.id
        ? previousState
        : {
            id: record.id,
            anchor: 0,
            cursor: 0,
            columns: "auto",
            little: true,
            top: 0,
          };
    this.columns = this.state.resolvedColumns;
    this.rowHeight = 28;
    this.destroyed = false;
    this.searchSequence = 0;
    this.root = document.createElement("section");
    this.root.className = "hex-viewer";
    this.root.setAttribute("aria-label", "Binary body viewer");
    this.root.innerHTML = `
      <div class="hex-heading"><div><span class="hex-eyebrow">ORIGINAL BYTES</span><strong>${this.data.length.toLocaleString()} <span>bytes</span></strong></div><button type="button" class="secondary" data-hex="expand">Expand ↗</button></div>
      <div class="hex-tools">
        <form class="hex-find"><label for="hex-find">Find in this body</label><div class="hex-input-group"><select id="hex-find-mode" aria-label="Byte search format"><option value="hex">Hex bytes</option><option value="text">UTF-8 text</option></select><input id="hex-find" placeholder="e.g. 00 FF or 89504E47" autocomplete="off" spellcheck="false" maxlength="1024"><button class="secondary">Find</button></div></form>
        <form class="hex-jump"><label for="hex-offset">Go to byte offset</label><div class="hex-input-group"><input id="hex-offset" placeholder="0x20 or 32" autocomplete="off" spellcheck="false"><button class="secondary">Go</button></div></form>
      </div>
      <div class="hex-navigation"><div><button class="hex-nav-button" type="button" data-hex="previous" aria-label="Previous byte match" disabled>↑</button><button class="hex-nav-button" type="button" data-hex="next" aria-label="Next byte match" disabled>↓</button><span class="hex-find-status" role="status">Find a byte sequence or text.</span></div><label>Bytes / row <select class="hex-columns" aria-label="Bytes per row"><option value="auto">Auto</option><option value="4">4</option><option value="8">8</option><option value="16">16</option><option value="32">32</option></select></label></div>
      <div class="hex-grid-shell"><div class="hex-grid-header" aria-hidden="true"></div><div class="hex-scroll" role="grid" aria-multiselectable="true" aria-label="Body bytes, hexadecimal and ASCII" aria-describedby="hex-keyboard-help" tabindex="0"><div class="hex-spacer"><div class="hex-rows"></div></div></div></div>
      <div class="hex-legend" aria-label="Byte colors"><span class="hex-text">● Printable</span><span class="hex-space">● Whitespace</span><span class="hex-zero">● Zero</span><span class="hex-control">● Control</span><span class="hex-high">● Non-ASCII</span></div>
      <div class="hex-selection"><p class="hex-selection-label" role="status" aria-live="polite"></p><div class="hex-copy-controls"><select class="hex-copy-format" aria-label="Copy selection format"><option value="hex">Hex bytes</option><option value="dump">Hex dump</option><option value="base64">Base64</option><option value="text">UTF-8 text</option></select><button class="secondary" type="button" data-hex="copy">Copy selection</button><button class="secondary" type="button" data-hex="download">Save selection ↓</button></div><p class="hex-copy-status" role="status" hidden></p></div>
      <details class="hex-inspector" open><summary>Interpret bytes at cursor <span class="hex-cursor-label"></span></summary><div class="hex-inspector-tools"><label>Byte order <select class="hex-endian" aria-label="Byte order"><option value="little">Little endian</option><option value="big">Big endian</option></select></label><span>Values start at the cursor; — means not enough bytes.</span></div><dl class="hex-values"></dl></details>
      <details class="hex-help"><summary>How to read and use this view</summary><p id="hex-keyboard-help">Offsets on the left are hexadecimal. The middle shows each original byte; the right shows printable ASCII (20–7E), with a dot for other bytes. Click either representation to inspect the byte. Drag, Shift-click, or hold Shift with the arrow keys to select a range. Arrows move by byte/row; Home/End move within a row; Ctrl/⌘+Home/End move to the first/last byte. Page Up/Down move a screen. Ctrl/⌘+A selects the whole body, Ctrl/⌘+C copies the selection, and Tab leaves the grid.</p><p>Find accepts pairs of hex digits, spaced or joined, or case-sensitive UTF-8 text. Previous/Next wrap through the body; F3 / Shift+F3 repeat the search. Ctrl/⌘+F and Ctrl/⌘+G open find and offset controls while the grid has focus. Hex/ASCII selections always represent the same bytes. Numeric values use the selected byte order, including exact 64-bit integers. UTF-8 text copying replaces invalid sequences with �; use Hex, Base64, or Save selection to preserve arbitrary bytes.</p><p>This is a read-only view of the captured body, available for text and binary payloads. Only visible rows are rendered; the entire captured body remains navigable. On touch screens, tap to select and swipe to scroll. Expand gives the viewer more room. Use Download in the Body toolbar to save the complete original body. In expanded view, collapse to reach that toolbar, or select all and choose Save selection.</p></details>`;
    host.append(this.root);
    this.el = (selector) => this.root.querySelector(selector);
    this.viewport = this.el(".hex-scroll");
    this.rows = this.el(".hex-rows");
    this.el(".hex-columns").value = this.state.columns;
    this.el(".hex-endian").value = this.state.little ? "little" : "big";
    this.el(".hex-find").onsubmit = (e) => {
      e.preventDefault();
      this.find(1, true);
    };
    this.el(".hex-jump").onsubmit = (e) => {
      e.preventDefault();
      try {
        const n = BinaryData.parseOffset(
          this.el("#hex-offset").value.trim(),
          this.data.length,
        );
        this.select(n, false, true);
        this.viewport.focus({ preventScroll: true });
        this.message(
          `At byte ${n.toLocaleString()} · 0x${BinaryData.offset(n)}`,
        );
      } catch (error) {
        this.message(error.message, true);
      }
    };
    this.el("#hex-find-mode").onchange = () => {
      this.el("#hex-find").placeholder =
        this.el("#hex-find-mode").value === "hex"
          ? "e.g. 00 FF or 89504E47"
          : "Exact UTF-8 text";
      this.invalidateFind();
    };
    this.el("#hex-find").oninput = () => this.invalidateFind();
    this.el(".hex-columns").onchange = () => {
      this.state.columns = this.el(".hex-columns").value;
      this.layout();
      this.reveal(this.state.cursor);
    };
    this.el(".hex-endian").onchange = () => {
      this.state.little = this.el(".hex-endian").value === "little";
      this.inspect();
    };
    this.root.addEventListener("click", (e) => {
      const action = e.target.closest("[data-hex]")?.dataset.hex;
      if (action === "expand") this.expand();
      if (action === "previous") this.find(-1);
      if (action === "next") this.find(1);
      if (action === "copy") this.copySelection();
      if (action === "download") this.downloadSelection();
    });
    this.viewport.addEventListener("scroll", () => {
      this.state.top = this.logicalTop();
      this.scheduleRender();
    });
    this.viewport.addEventListener("keydown", (e) => this.keydown(e));
    // A compressed scrollbar still spans the whole body, but wheel gestures
    // should move ordinary rows rather than multiplying their speed by file size.
    this.viewport.addEventListener(
      "wheel",
      (e) => {
        if (
          this.logicalHeight <= this.physicalHeight ||
          e.ctrlKey ||
          Math.abs(e.deltaX) > Math.abs(e.deltaY)
        )
          return;
        e.preventDefault();
        const unit =
          e.deltaMode === 1
            ? this.rowHeight
            : e.deltaMode === 2
              ? this.viewport.clientHeight
              : 1;
        this.setTop(this.logicalTop() + e.deltaY * unit);
        this.scheduleRender();
      },
      { passive: false },
    );
    this.viewport.addEventListener("pointerdown", (e) => {
      const cell = e.target.closest("[data-byte]");
      if (!cell || e.button !== 0) return;
      const offset = Number(cell.dataset.byte);
      if (e.pointerType === "touch") return; // Native touch panning; a tap is handled below.
      e.preventDefault();
      this.viewport.focus({ preventScroll: true });
      this.select(offset, e.shiftKey);
      this.drag = { pointer: e.pointerId, x: e.clientX, y: e.clientY };
      this.viewport.setPointerCapture(e.pointerId);
    });
    this.viewport.addEventListener("click", (e) => {
      const cell = e.target.closest("[data-byte]");
      if (cell && e.pointerType === "touch")
        this.select(Number(cell.dataset.byte), false);
    });
    this.viewport.addEventListener("pointermove", (e) => {
      const cell = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest("[data-byte]");
      if (this.drag) {
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
        if (cell && this.viewport.contains(cell))
          this.select(Number(cell.dataset.byte), true);
        this.startAutoScroll();
      } else
        this.hover(
          cell && this.viewport.contains(cell) ? Number(cell.dataset.byte) : -1,
        );
    });
    this.viewport.addEventListener("pointerleave", () => this.hover(-1));
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
      this.viewport.addEventListener(name, () => {
        this.drag = null;
        cancelAnimationFrame(this.dragFrame);
        this.dragFrame = null;
      });
    this.observer = new ResizeObserver(() => this.layout());
    this.observer.observe(this.viewport);
    this.layout();
    this.inspect();
  }
  range() {
    return [
      Math.min(this.state.anchor, this.state.cursor),
      Math.max(this.state.anchor, this.state.cursor),
    ];
  }
  layout() {
    if (this.destroyed) return;
    const width = this.viewport.clientWidth;
    const columns =
      this.state.columns === "auto"
        ? width >= 720
          ? 16
          : width >= 450
            ? 8
            : 4
        : Number(this.state.columns);
    const top = this.columns
      ? ((Math.floor(this.state.top / this.rowHeight) * this.columns) /
          columns) *
        this.rowHeight
      : this.state.top;
    this.columns = this.state.resolvedColumns = columns;
    this.rowCount = Math.ceil(this.data.length / columns);
    this.logicalHeight = this.rowCount * this.rowHeight;
    // Web engines cap element heights. Map the scrollbar to the full byte range,
    // subtracting viewport height at both ends so the final row stays reachable.
    this.physicalHeight = Math.min(this.logicalHeight, 4000000);
    this.el(".hex-spacer").style.height =
      `${Math.max(this.physicalHeight, this.viewport.clientHeight)}px`;
    this.root.style.setProperty("--hex-columns", columns);
    this.root.style.setProperty(
      "--hex-width",
      `${100 + columns * 34 + Math.floor((columns - 1) / 8) * 12 + 30}px`,
    );
    this.viewport.setAttribute("aria-rowcount", this.rowCount);
    this.viewport.setAttribute("aria-colcount", columns);
    this.el(".hex-grid-header").innerHTML =
      `<div class="hex-row"><span class="hex-address">OFFSET</span><span class="hex-octets">${Array.from({ length: columns }, (_, i) => `<span class="${i && i % 8 === 0 ? "hex-group" : ""}">${i.toString(16).toUpperCase().padStart(2, "0")}</span>`).join("")}</span><span class="hex-characters hex-ascii-heading">ASCII</span></div>`;
    this.setTop(top);
    this.render();
  }
  logicalTop() {
    const physicalMax = Math.max(
      1,
      this.physicalHeight - this.viewport.clientHeight,
    );
    return (
      (this.viewport.scrollTop / physicalMax) *
      Math.max(0, this.logicalHeight - this.viewport.clientHeight)
    );
  }
  setTop(value) {
    const logicalMax = Math.max(
      1,
      this.logicalHeight - this.viewport.clientHeight,
    );
    this.viewport.scrollTop =
      (Math.max(0, value) / logicalMax) *
      Math.max(0, this.physicalHeight - this.viewport.clientHeight);
    this.state.top = this.logicalTop();
  }
  scheduleRender() {
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.render();
      });
  }
  render() {
    if (this.destroyed) return;
    if (!this.data.length) {
      this.rows.innerHTML =
        '<p class="hex-empty">This request has an empty body. There are no bytes to inspect.</p>';
      this.viewport.removeAttribute("aria-activedescendant");
      return;
    }
    const top = this.logicalTop();
    const first = Math.max(0, Math.floor(top / this.rowHeight) - 2);
    const last = Math.min(
      this.rowCount,
      first + Math.ceil(this.viewport.clientHeight / this.rowHeight) + 5,
    );
    const [start, end] = this.range();
    const escape = (value) =>
      String(value).replace(
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
    let html = "";
    for (let row = first; row < last; row++) {
      let hex = "",
        ascii = "";
      for (let col = 0; col < this.columns; col++) {
        const n = row * this.columns + col;
        const group = col && col % 8 === 0 ? " hex-group" : "";
        if (n >= this.data.length) {
          hex += `<span class="${group}"></span>`;
          ascii += "<span></span>";
          continue;
        }
        const b = this.data[n];
        const selected = n >= start && n <= end;
        const classes = `hex-byte hex-${BinaryData.category(b)}${selected ? " selected" : ""}${n === this.state.cursor ? " cursor" : ""}`;
        hex += `<span id="hex-byte-${n}" role="gridcell" aria-colindex="${col + 1}" aria-selected="${selected}" aria-label="Offset ${n}, hex ${BinaryData.hexByte(b)}, decimal ${b}" class="${classes}${group}" data-byte="${n}" title="0x${BinaryData.offset(n)} · ${n} · ${BinaryData.hexByte(b)} = ${b}">${BinaryData.hexByte(b)}</span>`;
        ascii += `<span class="${classes}" data-byte="${n}" aria-hidden="true">${escape(BinaryData.ascii(b))}</span>`;
      }
      html += `<div class="hex-row" role="row" aria-rowindex="${row + 1}"><span class="hex-address" aria-hidden="true">${BinaryData.offset(row * this.columns)}</span><span class="hex-octets" role="presentation">${hex}</span><span class="hex-characters" aria-hidden="true">${ascii}</span></div>`;
    }
    this.rows.style.transform = `translateY(${this.viewport.scrollTop - top + first * this.rowHeight}px)`;
    this.rows.innerHTML = html;
    this.el(".hex-grid-header").scrollLeft = this.viewport.scrollLeft;
    if (
      this.state.cursor >= first * this.columns &&
      this.state.cursor < last * this.columns
    )
      this.viewport.setAttribute(
        "aria-activedescendant",
        `hex-byte-${this.state.cursor}`,
      );
    else this.viewport.removeAttribute("aria-activedescendant");
  }
  hover(offset) {
    this.rows
      .querySelectorAll(".hover")
      .forEach((el) => el.classList.remove("hover"));
    if (offset >= 0)
      this.rows
        .querySelectorAll(`[data-byte="${offset}"]`)
        .forEach((el) => el.classList.add("hover"));
  }
  select(offset, extend = false, reveal = false) {
    if (!this.data.length) return;
    this.copyMessage("");
    this.state.cursor = Math.max(0, Math.min(this.data.length - 1, offset));
    if (!extend) this.state.anchor = this.state.cursor;
    if (reveal) this.reveal(this.state.cursor);
    this.render();
    this.inspect();
  }
  reveal(offset) {
    const top = Math.floor(offset / this.columns) * this.rowHeight;
    const column = offset % this.columns;
    const left = 100 + column * 26 + Math.floor(column / 8) * 12;
    if (
      left < this.viewport.scrollLeft ||
      left + 26 > this.viewport.scrollLeft + this.viewport.clientWidth
    )
      this.viewport.scrollLeft = Math.max(
        0,
        left - this.viewport.clientWidth / 2,
      );
    const currentTop = this.logicalTop();
    if (
      top < currentTop ||
      top + this.rowHeight > currentTop + this.viewport.clientHeight
    )
      this.setTop(Math.max(0, top - this.viewport.clientHeight / 2));
  }
  inspect() {
    const [start, end] = this.range();
    this.el(".hex-selection-label").textContent = this.data.length
      ? `${(end - start + 1).toLocaleString()} byte${end === start ? "" : "s"} selected · 0x${BinaryData.offset(start)}${end === start ? "" : `–${BinaryData.offset(end)}`}`
      : "0 bytes selected";
    this.el(".hex-cursor-label").textContent = this.data.length
      ? `0x${BinaryData.offset(this.state.cursor)}`
      : "";
    this.el('[data-hex="copy"]').disabled = this.el(
      '[data-hex="download"]',
    ).disabled = !this.data.length;
    this.el(".hex-values").innerHTML = BinaryData.inspect(
      this.data,
      this.state.cursor,
      this.state.little,
    )
      .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
      .join("");
  }
  startAutoScroll() {
    if (this.dragFrame) return;
    const tick = () => {
      this.dragFrame = null;
      if (!this.drag || this.destroyed) return;
      const rect = this.viewport.getBoundingClientRect();
      const direction =
        this.drag.y < rect.top + 16
          ? -1
          : this.drag.y > rect.bottom - 16
            ? 1
            : 0;
      if (direction) {
        this.setTop(this.logicalTop() + direction * this.rowHeight);
        const n =
          Math.floor(
            (this.logicalTop() +
              (direction > 0
                ? this.viewport.clientHeight - this.rowHeight
                : 0)) /
              this.rowHeight,
          ) * this.columns;
        this.select(n, true);
        this.dragFrame = requestAnimationFrame(tick);
      }
    };
    this.dragFrame = requestAnimationFrame(tick);
  }
  keydown(e) {
    const command = e.metaKey || e.ctrlKey;
    if (command && ["f", "g", "a", "c"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const key = e.key.toLowerCase();
      if (key === "f") this.el("#hex-find").focus();
      if (key === "g") this.el("#hex-offset").focus();
      if (key === "a" && this.data.length) {
        this.state.anchor = 0;
        this.select(this.data.length - 1, true);
      }
      if (key === "c") this.copySelection();
      return;
    }
    if (e.key === "F3") {
      e.preventDefault();
      this.find(e.shiftKey ? -1 : 1);
      return;
    }
    let next = this.state.cursor;
    const page =
      Math.max(1, Math.floor(this.viewport.clientHeight / this.rowHeight) - 1) *
      this.columns;
    switch (e.key) {
      case "ArrowLeft":
        next--;
        break;
      case "ArrowRight":
        next++;
        break;
      case "ArrowUp":
        next -= this.columns;
        break;
      case "ArrowDown":
        next += this.columns;
        break;
      case "Home":
        next = command ? 0 : Math.floor(next / this.columns) * this.columns;
        break;
      case "End":
        next = command
          ? this.data.length - 1
          : (Math.floor(next / this.columns) + 1) * this.columns - 1;
        break;
      case "PageUp":
        next -= page;
        break;
      case "PageDown":
        next += page;
        break;
      default:
        return;
    }
    e.preventDefault();
    this.select(next, e.shiftKey, true);
  }
  message(text, error = false) {
    const el = this.el(".hex-find-status");
    el.textContent = text;
    el.classList.toggle("error", error);
  }
  invalidateFind() {
    this.searchSequence++;
    this.needle = null;
    this.lastMatch = null;
    // A new query cancels work rather than queueing scans behind an obsolete query.
    this.worker?.terminate();
    this.worker = null;
    this.el('[data-hex="previous"]').disabled = this.el(
      '[data-hex="next"]',
    ).disabled = true;
    this.message("Press Find to search this body.");
  }
  find(direction, fresh = false) {
    try {
      const needle = BinaryData.parseNeedle(
        this.el("#hex-find").value,
        this.el("#hex-find-mode").value,
      );
      if (!needle.length) throw new Error("Enter hex bytes or text to find.");
      if (!this.data.length) throw new Error("This body is empty.");
      this.needle = needle;
      const start =
        fresh || this.lastMatch == null
          ? direction > 0
            ? 0
            : this.data.length - 1
          : this.lastMatch + direction;
      const sequence = ++this.searchSequence;
      this.message("Searching all bytes…");
      if (!this.worker) {
        this.worker = new Worker("index.php?asset=binary-worker.js");
        this.worker.postMessage({ bytes: this.data });
        this.worker.onmessage = (e) => {
          if (this.destroyed || e.data.sequence !== this.searchSequence) return;
          if (e.data.error) {
            this.message(e.data.error, true);
            return;
          }
          const { index, wrapped } = e.data;
          this.lastMatch = index < 0 ? null : index;
          this.el('[data-hex="previous"]').disabled = this.el(
            '[data-hex="next"]',
          ).disabled = index < 0;
          if (index < 0) {
            this.message("No matching bytes in this body.");
            return;
          }
          this.state.anchor = index + this.needle.length - 1;
          this.select(index, true, true);
          this.message(
            `Found at 0x${BinaryData.offset(index)}${wrapped ? " · wrapped" : ""}`,
          );
        };
        this.worker.onerror = () => {
          this.message(
            "Byte search could not start. Reload and try again.",
            true,
          );
          this.worker?.terminate();
          this.worker = null;
        };
      }
      this.worker.postMessage({ needle, start, direction, sequence });
    } catch (error) {
      this.message(error.message, true);
    }
  }
  copyMessage(text, error = false) {
    if (this.destroyed) return;
    const status = this.el(".hex-copy-status");
    status.textContent = text;
    status.hidden = !text;
    status.classList.toggle("error", error);
  }
  async copySelection() {
    if (!this.data.length) return;
    const [start, end] = this.range();
    // Clipboard encodings can be several times larger than the source. Offer an
    // exact file download for very large ranges without freezing the main thread.
    if (end - start + 1 > 1048576) {
      this.copyMessage(
        "Selection exceeds 1 MiB. Use Save selection for the exact bytes.",
        true,
      );
      return;
    }
    const format = this.el(".hex-copy-format").value;
    const copied = await this.copy(
      BinaryData.format(this.data, start, end, format),
    );
    this.copyMessage(
      copied
        ? `Copied ${(end - start + 1).toLocaleString()} byte${end === start ? "" : "s"}${format === "text" ? " as UTF-8 text; invalid sequences become �" : ""}.`
        : "Clipboard unavailable. Use Save selection to download the bytes.",
      !copied,
    );
  }
  downloadSelection() {
    if (!this.data.length) return;
    const [start, end] = this.range();
    const url = URL.createObjectURL(
      new Blob([this.data.subarray(start, end + 1)], {
        type: "application/octet-stream",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `webhook-${this.record.id}-${BinaryData.offset(start)}-${BinaryData.offset(end)}.bin`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  expand() {
    if (this.dialog) {
      this.dialog.close();
      return;
    }
    const dialog = document.createElement("dialog");
    this.dialog = dialog;
    dialog.className = "hex-expanded";
    dialog.setAttribute("aria-label", "Expanded binary body viewer");
    const close = document.createElement("button");
    close.className = "icon-button hex-expanded-close";
    close.setAttribute("aria-label", "Close expanded binary viewer");
    close.textContent = "×";
    close.onclick = () => dialog.close();
    dialog.append(close, this.root);
    document.body.append(dialog);
    this.el('[data-hex="expand"]').textContent = "Collapse ↙";
    dialog.addEventListener("close", () => {
      if (!this.destroyed && this.host.isConnected) this.host.append(this.root);
      dialog.remove();
      this.dialog = null;
      this.el('[data-hex="expand"]').textContent = "Expand ↗";
      if (!this.destroyed)
        this.el('[data-hex="expand"]').focus({ preventScroll: true });
      this.layout();
    });
    dialog.showModal();
    this.layout();
    this.reveal(this.state.cursor);
    this.viewport.focus();
  }
  destroy() {
    this.destroyed = true;
    this.observer.disconnect();
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.dragFrame);
    this.worker?.terminate();
    this.dialog?.close();
    this.root.remove();
  }
}
