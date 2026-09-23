"use strict";
const shellQuote = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
// Format valid JSON without parsing and serializing its numbers: 64-bit IDs remain exact.
function prettyJSON(text) {
  try {
    JSON.parse(text);
  } catch {
    return text;
  }
  let result = "",
    depth = 0,
    quoted = false,
    escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      result += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') {
      quoted = true;
      result += c;
    } else if (/\s/.test(c)) continue;
    else if (c === "{" || c === "[") {
      result += c;
      depth++;
      if (!/^[\s]*[}\]]/.test(text.slice(i + 1)))
        result += "\n" + "  ".repeat(depth);
    } else if (c === "}" || c === "]") {
      depth--;
      if (!/[{\[]$/.test(result)) result += "\n" + "  ".repeat(depth);
      result += c;
    } else if (c === ",") result += ",\n" + "  ".repeat(depth);
    else if (c === ":") result += ": ";
    else result += c;
  }
  return result;
}

function replayCurl(r) {
  const headerLines = Object.entries(r.headers).map(
    ([name, value]) =>
      `  -H ${shellQuote(value === "" ? `${name};` : `${name}: ${value}`)}`,
  );
  const names = new Set(
    Object.keys(r.headers).map((name) => name.toLowerCase()),
  );
  // Suppress cURL defaults absent from the original request.
  for (const name of ["Accept", "Content-Type", "User-Agent", "Expect"]) {
    if (!names.has(name.toLowerCase()))
      headerLines.push(`  -H ${shellQuote(`${name}:`)}`);
  }
  const command = [
    `curl --globoff --path-as-is --request ${shellQuote(r.method)} ${shellQuote(r.url)}`,
    ...headerLines,
  ];
  if (
    r.size > 0 ||
    names.has("content-length") ||
    names.has("transfer-encoding")
  )
    command.push("  --data-binary @-");
  else return command.join(" \\\n");
  if (r.body_encoding === "utf-8" && r.body.length < 8000) {
    return `printf '%s' ${shellQuote(r.body)} | \\\n${command.join(" \\\n")}`;
  }
  // A heredoc handles NULs and bodies larger than the OS command-argument limit.
  // PHP is a project prerequisite and avoids platform-specific base64 flags.
  return `php -r 'echo base64_decode(stream_get_contents(STDIN));' <<'WEBHOOK_BODY' | \\\n${command.join(" \\\n")}\n${r.body_base64.match(/.{1,76}/g)?.join("\n") || ""}\nWEBHOOK_BODY`;
}

if (typeof module !== "undefined")
  module.exports = { prettyJSON, replayCurl, shellQuote };
