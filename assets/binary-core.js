"use strict";

// Keep byte handling independent of the DOM: previews must never reinterpret the
// captured body through a UTF-8 string before inspecting or copying its bytes.
const BinaryData = (() => {
  const hexValues = Array.from({ length: 256 }, (_, value) =>
    value.toString(16).toUpperCase().padStart(2, "0"),
  );
  const hexByte = (value) => hexValues[value];
  const offset = (value) => value.toString(16).toUpperCase().padStart(8, "0");
  const ascii = (value) =>
    value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : ".";

  function category(value) {
    if (value === 0) return "zero";
    if (value === 32 || (value >= 9 && value <= 13)) return "space";
    if (value >= 0x20 && value <= 0x7e) return "text";
    return value < 0x80 ? "control" : "high";
  }

  function decode(base64) {
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  function parseOffset(text, length) {
    const input = text.trim();
    if (!/^(?:[0-9]+|0x[0-9a-f]+)$/i.test(input))
      throw new Error(
        "Enter a decimal byte offset or hexadecimal offset beginning with 0x.",
      );
    const value = Number(input);
    if (!Number.isSafeInteger(value) || value < 0 || value >= length)
      throw new Error(
        length
          ? `Offset must be between 0 and ${length - 1}.`
          : "The body is empty.",
      );
    return value;
  }

  function parseNeedle(text, mode) {
    if (mode === "text") return new TextEncoder().encode(text);
    if (mode !== "hex") throw new Error("Unknown byte search format.");
    const input = text.trim();
    // Spaces may separate complete bytes; a stray half-byte is almost always a
    // typo. Do not silently turn `F F` into FF or accept JavaScript number syntax.
    if (!/^(?:[0-9a-f]{2})*(?:\s+(?:[0-9a-f]{2})+)*$/i.test(input))
      throw new Error(
        "Enter complete hexadecimal bytes, such as 00 FF 2A or 00ff2a.",
      );
    const compact = input.replace(/\s/g, "");
    const bytes = new Uint8Array(compact.length / 2);
    for (let i = 0; i < bytes.length; i++)
      bytes[i] = Number.parseInt(compact.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  }

  function find(bytes, needle, start = 0, direction = 1) {
    if (!Number.isSafeInteger(start))
      throw new Error("Search offset must be an integer.");
    if (direction !== 1 && direction !== -1)
      throw new Error("Search direction must be 1 or -1.");
    if (!needle.length || needle.length > bytes.length) return -1;
    const reverse = direction === -1;
    const pattern = (index) =>
      needle[reverse ? needle.length - index - 1 : index];
    // KMP remains linear for multi-megabyte repeated bodies and long, nearly
    // matching needles. Reverse the traversal, not the body, for Previous.
    const prefix = new Uint32Array(needle.length);
    for (let i = 1, matched = 0; i < needle.length; i++) {
      while (matched && pattern(i) !== pattern(matched))
        matched = prefix[matched - 1];
      if (pattern(i) === pattern(matched)) matched++;
      prefix[i] = matched;
    }
    let cursor = reverse
      ? Math.min(bytes.length - 1, start + needle.length - 1)
      : Math.max(0, start);
    if (reverse && start < 0) return -1;
    for (
      let matched = 0;
      cursor >= 0 && cursor < bytes.length;
      cursor += direction
    ) {
      while (matched && bytes[cursor] !== pattern(matched))
        matched = prefix[matched - 1];
      if (bytes[cursor] === pattern(matched)) matched++;
      if (matched === needle.length)
        return reverse ? cursor : cursor - needle.length + 1;
    }
    return -1;
  }

  function format(bytes, start, end, mode) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end))
      throw new Error("Selection offsets must be integers.");
    if (start === 0 && end === -1) return "";
    if (start < 0 || end < start || end >= bytes.length)
      throw new Error("Selection is outside the body.");
    const selected = bytes.subarray(start, end + 1);
    if (mode === "hex") {
      const chunks = [];
      for (let i = 0; i < selected.length; i += 8192)
        chunks.push(
          Array.from(selected.subarray(i, i + 8192), hexByte).join(" "),
        );
      return chunks.join(" ");
    }
    // A BOM is a real captured character. Text copying may replace invalid
    // UTF-8, but must not silently drop a valid leading U+FEFF.
    if (mode === "text")
      return new TextDecoder("utf-8", { ignoreBOM: true }).decode(selected);
    if (mode === "base64") {
      const chunks = [];
      // Complete three-byte groups make independently encoded chunks safe to
      // join, without a body-sized argument list or temporary binary string.
      for (let i = 0; i < selected.length; i += 24576)
        chunks.push(
          btoa(String.fromCharCode(...selected.subarray(i, i + 24576))),
        );
      return chunks.join("");
    }
    if (mode !== "dump") throw new Error("Unknown byte copy format.");
    const lines = [];
    for (let row = start; row <= end; row += 16) {
      const cells = Array(16).fill("  ");
      let characters = "";
      for (let column = 0; column < 16 && row + column <= end; column++) {
        cells[column] = hexByte(bytes[row + column]);
        characters += ascii(bytes[row + column]);
      }
      lines.push(
        `${offset(row)}  ${cells.slice(0, 8).join(" ")}  ${cells.slice(8).join(" ")}  |${characters}|`,
      );
    }
    // Preserve actual selection offsets and every row, including repeated rows;
    // the terminal offset follows hexdump -C without its lossy `*` abbreviation.
    lines.push(offset(end + 1));
    return lines.join("\n");
  }

  function inspect(bytes, cursor, littleEndian) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const available = (width) =>
      Number.isSafeInteger(cursor) &&
      cursor >= 0 &&
      cursor + width <= bytes.length;
    const read = (method, width) => {
      if (!available(width)) return "—";
      const value = view[method](cursor, littleEndian);
      return Object.is(value, -0) ? "-0" : String(value);
    };
    return [
      ["Uint8", read("getUint8", 1)],
      ["Int8", read("getInt8", 1)],
      ["Bits", available(1) ? bytes[cursor].toString(2).padStart(8, "0") : "—"],
      ["Uint16", read("getUint16", 2)],
      ["Int16", read("getInt16", 2)],
      ["Uint32", read("getUint32", 4)],
      ["Int32", read("getInt32", 4)],
      ["Uint64", read("getBigUint64", 8)],
      ["Int64", read("getBigInt64", 8)],
      ["Float32", read("getFloat32", 4)],
      ["Float64", read("getFloat64", 8)],
    ];
  }

  return {
    decode,
    hexByte,
    offset,
    ascii,
    category,
    parseOffset,
    parseNeedle,
    find,
    format,
    inspect,
  };
})();

if (typeof module !== "undefined") module.exports = BinaryData;
