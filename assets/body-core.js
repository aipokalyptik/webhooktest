"use strict";

// Detection on the server describes the bytes. This module only chooses their
// presentation; it never rewrites the stored payload or its download.
const BodyData = (() => {
  const mimeLanguages = {
    "application/javascript": "javascript", "application/ecmascript": "javascript",
    "text/javascript": "javascript", "text/ecmascript": "javascript",
    "application/x-javascript": "javascript", "application/typescript": "typescript",
    "text/typescript": "typescript", "application/json": "json",
    "application/x-ndjson": "json", "application/ndjson": "json",
    "application/json-seq": "json", "application/json5": "json5",
    "application/graphql": "graphql", "application/sql": "sql",
    "application/xml": "markup", "text/xml": "markup", "text/html": "markup",
    "application/xhtml+xml": "markup", "image/svg+xml": "markup",
    "application/yaml": "yaml", "application/x-yaml": "yaml", "text/yaml": "yaml",
    "text/x-yaml": "yaml", "application/toml": "toml", "text/toml": "toml",
    "application/x-httpd-php": "php", "application/x-php": "php",
    "application/x-sh": "bash", "application/x-shellscript": "bash",
    "text/x-shellscript": "bash", "text/x-python": "python", "application/x-python": "python",
    "text/x-c": "c", "text/x-csrc": "c", "text/x-chdr": "c",
    "text/x-c++src": "cpp", "text/x-c++hdr": "cpp", "text/x-csharp": "csharp",
    "text/x-java-source": "java", "text/x-go": "go", "text/x-rust": "rust",
    "text/markdown": "markdown", "text/x-markdown": "markdown", "text/csv": "csv",
    "text/tab-separated-values": "csv", "text/css": "css", "text/x-scss": "scss",
    "text/x-sass": "sass", "text/x-less": "less", "text/x-diff": "diff",
    "text/x-patch": "diff", "application/sparql-query": "sparql",
    "application/trig": "turtle", "text/turtle": "turtle", "application/x-latex": "latex",
    "application/x-tex": "latex", "message/http": "http", "application/http": "http",
  };
  const extensions = {
    htm: "markup", xhtml: "markup", xsl: "markup", xslt: "markup", xsd: "markup",
    wsdl: "markup", plist: "markup", opml: "markup", vue: "markup", svelte: "markup",
    mjml: "markup", pom: "markup", csproj: "markup", fsproj: "markup", vbproj: "markup",
    jsonl: "json", ndjson: "json", jsonc: "json", geojson: "json", har: "json",
    ipynb: "json", map: "json", avsc: "json", mjs: "javascript", cjs: "javascript",
    mts: "typescript", cts: "typescript", dts: "typescript", h: "c", cc: "cpp", cxx: "cpp",
    hpp: "cpp", hh: "cpp", hxx: "cpp", cxxm: "cpp", "c++": "cpp", phtml: "php",
    php3: "php", php4: "php", php5: "php", php7: "php", php8: "php", phps: "php",
    pyw: "python", pyi: "python", pyx: "python", rbw: "ruby", rake: "ruby",
    rs: "rust", zsh: "bash", ksh: "bash", bashrc: "bash", bash_profile: "bash",
    zshrc: "bash", bat: "batch", cmd: "batch", ps1: "powershell", psm1: "powershell",
    psd1: "powershell", fs: "fsharp", fsx: "fsharp", fsi: "fsharp", ex: "elixir",
    exs: "elixir", erl: "erlang", hrl: "erlang", clj: "clojure", cljs: "clojure",
    cljc: "clojure", edn: "clojure", hs: "haskell", lhs: "haskell", ml: "ocaml",
    mli: "ocaml", sml: "sml", scm: "scheme", ss: "scheme", lsp: "lisp", el: "lisp",
    cl: "lisp", pl: "perl", pm: "perl", t: "perl", raku: "perl", jl: "julia",
    tf: "hcl", tfvars: "hcl", proto: "protobuf", gql: "graphql", patch: "diff",
    rst: "rest", rest: "rest", mdx: "markdown", mk: "makefile", mak: "makefile",
    env: "bash", rc: "ini", cnf: "ini", cfg: "ini", conf: "ini", desktop: "ini",
    service: "systemd", socket: "systemd", timer: "systemd", mount: "systemd",
    target: "systemd", path: "systemd", pot: "gettext", zone: "dns-zone-file",
    ld: "linker-script", wat: "wasm", wlang: "wolfram", m: "objectivec", mm: "objectivec",
    cu: "cpp", cuh: "cpp", vert: "glsl", frag: "glsl", geom: "glsl", comp: "glsl",
    f: "fortran", f90: "fortran", f95: "fortran", f03: "fortran", f08: "fortran",
    pas: "pascal", dpr: "pascal", pp: "puppet", ahk: "autohotkey", au3: "autoit",
    gd: "gdscript", hx: "haxe", hxml: "haxe", vhd: "vhdl", sv: "verilog",
    svh: "verilog", vb: "visual-basic", vbs: "visual-basic", vba: "visual-basic",
    coffee: "coffeescript", litcoffee: "coffeescript", feature: "gherkin",
    pde: "processing", nuspec: "markup", nsi: "nsis", nsh: "nsis", asm: "nasm",
    a51: "nasm", asm6502: "asm6502", as: "actionscript", ads: "ada", adb: "ada",
    adoc: "asciidoc", asciidoc: "asciidoc", styl: "stylus", j2: "django", jin: "django",
    jinja: "django", jinja2: "django", tpl: "smarty", vm: "velocity", vtl: "velocity",
    puml: "plant-uml", plantuml: "plant-uml", mmd: "mermaid", mermaid: "mermaid",
    ttl: "turtle", xq: "xquery", xql: "xquery", xqm: "xquery", xqy: "xquery",
    rmd: "markdown", rpy: "renpy", cr: "crystal", sc: "scala", objc: "objectivec",
  };
  const basenames = {
    "dockerfile": "docker", "containerfile": "docker", "makefile": "makefile",
    "gnumakefile": "makefile", "cmakelists.txt": "cmake", "jenkinsfile": "groovy",
    "vagrantfile": "ruby", "gemfile": "ruby", "rakefile": "ruby", "guardfile": "ruby",
    "brewfile": "ruby", "procfile": "bash", ".env": "bash", ".htaccess": "apacheconf",
    "httpd.conf": "apacheconf", "apache2.conf": "apacheconf", "nginx.conf": "nginx",
    ".editorconfig": "editorconfig", ".gitignore": "ignore", ".dockerignore": "ignore",
    ".npmignore": "ignore", ".hgignore": "ignore", ".gitconfig": "ini",
    ".gitmodules": "ini", ".npmrc": "ini", ".yarnrc": "yaml", ".babelrc": "json",
    ".eslintrc": "json", ".prettierrc": "json", ".stylelintrc": "json",
    "composer.lock": "json", "package-lock.json": "json", "yarn.lock": "yaml",
    "go.mod": "go-module", "go.sum": "go-module", "cargo.lock": "toml",
    "pipfile": "toml", "pipfile.lock": "json", ".bashrc": "bash",
    ".bash_profile": "bash", ".profile": "bash", ".zshrc": "bash", ".zprofile": "bash",
  };

  function codec(bytes, descriptor = {}) {
    // The BOM is direct evidence, so an inaccurate charset header cannot override it.
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0)
      return "utf-32le";
    if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff)
      return "utf-32be";
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
    const label = String(descriptor.encoding || "utf-8").toLowerCase().replace(/_/g, "-");
    const aliases = { utf8: "utf-8", utf16: "utf-16le", "utf-16": "utf-16le", utf16le: "utf-16le", utf16be: "utf-16be", ascii: "utf-8", "us-ascii": "utf-8" };
    const name = aliases[label] || label;
    if (/^utf-32(?:le|be)$/.test(name)) return name;
    try { return new TextDecoder(name).encoding; } catch { return "utf-8"; }
  }

  function textFrom(bytes, encoding, partial, fatal) {
    if (!encoding.startsWith("utf-32")) {
      // ignoreBOM keeps the U+FEFF character for full-body text copy. The preview
      // strips it separately; neither operation modifies the original bytes.
      return new TextDecoder(encoding, { fatal, ignoreBOM: true }).decode(bytes, { stream: partial });
    }
    const little = encoding.endsWith("le"), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let result = "";
    for (let offset = 0; offset + 4 <= bytes.length; offset += 4) {
      const cp = view.getUint32(offset, little);
      if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
        if (fatal) throw new TypeError("Invalid UTF-32 scalar value");
        result += "\ufffd";
      } else result += String.fromCodePoint(cp);
    }
    if (!partial && bytes.length % 4) {
      if (fatal) throw new TypeError("Incomplete UTF-32 code point");
      result += "\ufffd";
    }
    return result;
  }

  function preview(bytes, descriptor = {}, limit = 100000, preserveBOM = false) {
    limit = Math.max(0, Math.floor(Number(limit) || 0));
    // Four bytes per UTF-16 unit covers the browser encodings and our UTF-32
    // decoder. Streaming drops an incomplete tail instead of inventing a bad
    // encoding warning when the next byte simply lies outside the preview.
    const prefix = bytes.subarray(0, Math.min(bytes.length, limit * 4 + 8));
    const partial = prefix.length < bytes.length, encoding = codec(bytes, descriptor);
    let text, lossy = false;
    try { text = textFrom(prefix, encoding, partial, true); }
    catch { text = textFrom(prefix, encoding, partial, false); lossy = true; }
    if (!preserveBOM) text = text.replace(/^\ufeff/, "");
    const truncated = partial || text.length > limit;
    if (text.length > limit) {
      text = text.slice(0, limit);
      if (/[\ud800-\udbff]$/.test(text)) text = text.slice(0, -1);
    }
    return { text, truncated, lossy, encoding };
  }

  function decode(bytes, descriptor = {}) {
    return textFrom(bytes, codec(bytes, descriptor), false, false);
  }

  function language(descriptor = {}, previewText = "", languages = []) {
    const registry = new Map();
    for (const entry of languages) {
      registry.set(entry.id.toLowerCase(), entry);
      for (const alias of entry.aliases || []) registry.set(alias.toLowerCase(), entry);
    }
    const choose = (id, source) => {
      const entry = registry.get(String(id || "").toLowerCase());
      return entry ? { id: entry.id, name: entry.name, source } : null;
    };
    const plain = (source = "No specific text format detected") => ({ id: "plain", name: "Plain text", source });
    if (descriptor.kind === "binary" || descriptor.kind === "multipart") return plain("Binary or multipart body");
    const format = String(descriptor.format || "").toLowerCase();
    let selected = choose(({ xml: "markup", html: "markup", svg: "markup", ndjson: "json", jsonl: "json" })[format] || format, "Detected body format");
    if (selected) return selected;
    const mimes = [...new Set([descriptor.mime, descriptor.declaredMime].filter(Boolean).map(mime => mime.split(";", 1)[0].trim().toLowerCase()))];
    for (const mime of mimes) {
      selected = choose(mimeLanguages[mime] || (mime.endsWith("+json") ? "json" : mime.endsWith("+xml") ? "markup" : null), "Content type");
      if (selected) return selected;
      // Only a specific language subtype is useful here. Generic octet-stream
      // and text/plain deliberately leave room for a posted filename.
      selected = choose(mime.replace(/^[^/]+\/(?:x-)?/, ""), "Content type");
      if (selected) return selected;
    }
    const name = String(descriptor.filename || "").split(/[\\/]/).pop().toLowerCase();
    let basenameLanguage = basenames[name];
    if (/^(?:dockerfile|containerfile)(?:\.|$)/.test(name)) basenameLanguage = "docker";
    if (/^\.env(?:\.|$)/.test(name)) basenameLanguage = "bash";
    selected = choose(basenameLanguage, "Posted filename");
    if (selected) return selected;
    const extension = String(descriptor.extension || (name.includes(".") ? name.split(".").pop() : "")).replace(/^\./, "").toLowerCase();
    // Some Prism aliases name binary containers (xls/xlsx, wasm), not text
    // source. Never infer their text grammar from an extension alone.
    if (!["xls", "xlsx", "wasm", "doc", "docx", "pdf"].includes(extension)) {
      selected = choose(extensions[extension] || extension, "Posted filename extension");
      if (selected) return selected;
    }
    const text = String(previewText).replace(/^\ufeff/, "").trimStart();
    let hint = null;
    const shebang = text.match(/^#!\s*(?:\/\S+\/)?(?:env\s+(?:-S\s+)?)?([\w.+-]+)/);
    if (shebang) {
      const executable = shebang[1].toLowerCase();
      if (/^python(?:\d[\d.]*)?$/.test(executable)) hint = "python";
      else if (/^(?:ba|z|k|da)?sh$/.test(executable)) hint = "bash";
      else if (/^(?:node|nodejs|bun)$/.test(executable)) hint = "javascript";
      else if (executable === "deno") hint = "typescript";
      else if (/^(?:ruby|perl|php|lua|groovy|awk|raku|pwsh)$/.test(executable)) hint = ({ raku: "perl", pwsh: "powershell" })[executable] || executable;
    }
    if (!hint && /^<\?php(?:\s|$)|^<\?=/.test(text)) hint = "php";
    if (!hint && /^(?:<\?xml\b|<!doctype\s+html\b|<html\b|<svg\b)/i.test(text)) hint = "markup";
    if (!hint && /^(?:\{|\[)/.test(text)) {
      try { JSON.parse(text); hint = "json"; } catch { /* Incomplete or another syntax: keep the fallback honest. */ }
    }
    if (!hint && /^---\s*\r?\n(?:#[^\n]*\r?\n|\s*\r?\n)*[\w.-]+\s*:/.test(text)) hint = "yaml";
    if (!hint && /^(?:(?:query|mutation|subscription)\s+(?:\w+[\s\S]{0,200})?\{|(?:schema|type)\s+\w*\s*\{)/.test(text)) hint = "graphql";
    if (!hint && /^(?:HTTP\/\d(?:\.\d)?\s+\d{3}\b|(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+\s+HTTP\/\d)/.test(text)) hint = "http";
    return choose(hint, shebang && hint ? "Script interpreter" : "Body contents") || plain();
  }

  return { preview, decode, language };
})();

if (typeof module !== "undefined") module.exports = BodyData;
