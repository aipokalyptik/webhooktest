"use strict";

importScripts("index.php?asset=prism.js", "index.php?asset=core.js");

// Prism's default encoder normalizes NBSP to a space. A request inspector must
// preserve whitespace, including NBSP, CRLF and BOM, in both highlighted text
// and raw mode. Only trusted Prism token markup is ever rendered as HTML.
Prism.util.encode = function encode(value) {
  if (value instanceof Prism.Token)
    return new Prism.Token(value.type, encode(value.content), value.alias);
  if (Array.isArray(value)) return value.map(encode);
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\r/g, "&#13;");
};

const TEXT_LIMIT = 100000;
// Many tiny tokens can be much larger than their source. Keep this secondary
// DOM budget independent of the character preview limit.
const HTML_LIMIT = 2 * 1024 * 1024;

self.postMessage({ ready: true });

self.onmessage = ({ data }) => {
  const id = data.id;
  try {
    const original = String(data.text ?? "");
    let text = original.slice(0, TEXT_LIMIT), truncated = original.length > TEXT_LIMIT;
    if (truncated && /[\ud800-\udbff]$/.test(text)) text = text.slice(0, -1);
    const language = typeof data.language === "string" ? data.language : "plain";
    let formatted = false;
    if (data.formatted && !truncated) {
      const result = prettyJSON(text, TEXT_LIMIT);
      formatted = result !== text;
      text = result;
    }
    const grammar = Object.hasOwn(Prism.languages, language) ? Prism.languages[language] : null;
    let html = grammar && typeof grammar === "object" && !text.includes("\0")
      ? Prism.highlight(text, grammar, language)
      : Prism.util.encode(text);
    // Falling back to escaped source is preferable to freezing the detail view
    // by inserting tens of thousands of token spans into the page.
    const plain = html.length > HTML_LIMIT || text.includes("\0");
    if (plain) html = Prism.util.encode(text);
    self.postMessage({ id, html, text, language: grammar && !plain ? language : "plain", formatted, truncated });
  } catch (error) {
    self.postMessage({ id, error: error.message || "Syntax highlighting failed" });
  }
};
