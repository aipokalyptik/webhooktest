"use strict";
const shellQuote = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
// Format valid JSON without parsing and serializing its numbers: 64-bit IDs remain exact.
function prettyJSON(text, maxOutput = Infinity) {
  try {
    JSON.parse(text);
  } catch {
    return text;
  }
  let result = "",
    depth = 0,
    quoted = false,
    escaped = false;
  // A small deeply nested document can expand quadratically. Fall back to the
  // original JSON before allocating excessive indentation; its bytes and exact
  // numeric spelling are more valuable than cosmetic formatting.
  const add = (value) => {
    if (result.length + value.length > maxOutput)
      throw new RangeError("JSON formatting budget exceeded");
    result += value;
  };
  const newline = () => {
    if (result.length + 1 + depth * 2 > maxOutput)
      throw new RangeError("JSON formatting budget exceeded");
    add("\n" + "  ".repeat(depth));
  };
  try {
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        add(c);
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quoted = false;
        continue;
      }
      if (c === '"') {
        quoted = true;
        add(c);
      } else if (/\s/.test(c)) continue;
      else if (c === "{" || c === "[") {
        add(c);
        depth++;
        let next = i + 1;
        while (/\s/.test(text[next] || "") && next < text.length) next++;
        if (text[next] !== "}" && text[next] !== "]") newline();
      } else if (c === "}" || c === "]") {
        depth--;
        if (!/[{\[]$/.test(result)) newline();
        add(c);
      } else if (c === ",") {
        add(",");
        newline();
      } else if (c === ":") add(": ");
      else add(c);
    }
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return text;
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

// Use local components directly; offset arithmetic breaks around DST changes.
function localCutoffParts(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  };
}

function parseLocalCutoff(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(:\d{2})?$/.test(time))
    return null;
  const fullTime = time.length === 5 ? `${time}:00` : time;
  const parsed = new Date(`${date}T${fullTime}`);
  if (!Number.isFinite(parsed.getTime())) return null;
  const parts = localCutoffParts(parsed);
  // Reject calendar overflow and nonexistent local times (the spring DST gap).
  return parts.date === date && parts.time === fullTime ? parsed : null;
}

if (typeof module !== "undefined")
  module.exports = {
    prettyJSON,
    replayCurl,
    shellQuote,
    localCutoffParts,
    parseLocalCutoff,
  };
