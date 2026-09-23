const assert = require("node:assert/strict");
const { prettyJSON, replayCurl, shellQuote } = require("../assets/core.js");
const { execFileSync } = require("node:child_process");
for (const raw of [
  '{"n":900719925474099312345,"a":[1,{},[]],"text":"quoted \\"and\\" \\\\"}',
  "[]",
  "{}",
  "null",
  "123.5000",
  "invalid JSON",
  '{"nested":{"empty":{}}}',
  '{"html":"<script>alert(1)</script>"}',
]) {
  const formatted = prettyJSON(raw);
  try {
    assert.deepEqual(JSON.parse(formatted), JSON.parse(raw));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    assert.equal(formatted, raw);
  }
}
assert.match(
  prettyJSON('{"n":900719925474099312345}'),
  /900719925474099312345/,
);
assert.equal(prettyJSON('{"n":1.000e+999}'), '{\n  "n": 1.000e+999\n}');
assert.equal(
  execFileSync(
    "/bin/sh",
    ["-c", `printf '%s' ${shellQuote("a'b $(no) `no` \n")}`],
    { encoding: "utf8" },
  ),
  "a'b $(no) `no` \n",
);
for (const body of [
  Buffer.from("hello 'world'\n$(touch BAD)"),
  Buffer.from([0, 255, 3, 10]),
  Buffer.alloc(400000, 120),
]) {
  const utf8 = body[0] !== 0;
  const r = {
    method: "PATCH",
    url: "http://127.0.0.1/example?x=1&y=2",
    headers: { "X-Empty": "", "Content-Type": "application/octet-stream" },
    body: utf8 ? body.toString() : null,
    body_encoding: utf8 ? "utf-8" : "base64",
    body_base64: body.toString("base64"),
    size: body.length,
  };
  const command = replayCurl(r);
  assert.match(command, /-H 'X-Empty;'/);
  // Substitute only the HTTP sender with cat, then check the actual shell pipeline bytes.
  const pipeline = command.replace(
    /curl --globoff[\s\S]*?--data-binary @-/,
    "cat",
  );
  assert.deepEqual(
    execFileSync("/bin/sh", [], {
      input: pipeline,
      maxBuffer: 1024 * 1024,
      timeout: 5000,
    }),
    body,
  );
}
console.log(
  "Frontend helpers: precision, escaping, binary and large replay bodies passed.",
);
