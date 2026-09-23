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

// The cleanup cutoff must stay in local time, including fractional UTC offsets.
for (const timezone of ["UTC", "America/Los_Angeles", "Asia/Kathmandu"]) {
  execFileSync(
    process.execPath,
    [
      "-e",
      `
    const assert = require('node:assert/strict');
    const {localCutoffParts, parseLocalCutoff} = require('./assets/core.js');
    for (const instant of ['2026-09-23T17:23:45Z', '2026-01-01T00:15:20Z', '2026-03-08T10:30:00Z']) {
      const expected = new Date(instant);
      const parts = localCutoffParts(expected);
      assert.equal(parseLocalCutoff(parts.date, parts.time).toISOString(), expected.toISOString());
    }
    assert.equal(parseLocalCutoff('2026-02-30', '12:00:00'), null);
    assert.equal(parseLocalCutoff('2026-09-23', '24:00:00'), null);
    assert.equal(parseLocalCutoff('', ''), null);
    assert.equal(parseLocalCutoff('2026-09-23', 'bad'), null);
    assert.equal(parseLocalCutoff('2026-09-23', '12:34').getSeconds(), 0);
    if (process.env.TZ === 'America/Los_Angeles') {
      assert.equal(parseLocalCutoff('2026-03-08', '02:30:00'), null);
      assert.deepEqual(localCutoffParts(new Date('2026-09-23T17:23:45Z')), {date:'2026-09-23',time:'10:23:45'});
    }
  `,
    ],
    {
      cwd: require("node:path").resolve(__dirname, ".."),
      env: { ...process.env, TZ: timezone },
      timeout: 5000,
    },
  );
}
console.log(
  "Cleanup date/time: timezone round trips, invalid dates, and DST gap checks passed.",
);
