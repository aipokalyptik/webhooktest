"use strict";

const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const binary = require("../assets/binary-core.js");

const all = Uint8Array.from({ length: 256 }, (_, index) => index);
assert.deepEqual(binary.decode(Buffer.from(all).toString("base64")), all);
assert.deepEqual(binary.decode(""), new Uint8Array());
for (const byte of all) {
  assert.equal(
    binary.hexByte(byte),
    Buffer.from([byte]).toString("hex").toUpperCase(),
  );
  assert.equal(
    binary.ascii(byte),
    byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".",
  );
  assert.equal(
    binary.category(byte),
    byte === 0
      ? "zero"
      : byte === 32 || (byte >= 9 && byte <= 13)
        ? "space"
        : byte >= 32 && byte <= 126
          ? "text"
          : byte < 128
            ? "control"
            : "high",
  );
}
assert.equal(binary.offset(0), "00000000");
assert.equal(binary.offset(256), "00000100");
assert.equal(binary.offset(0x123456789), "123456789");
for (const value of ["15", "0015", "0xf", "0XF", " 15 "])
  assert.equal(binary.parseOffset(value, 16), 15);
for (const value of [
  "",
  " ",
  "-1",
  "+1",
  "1.0",
  "1e1",
  "1_0",
  "0x",
  "0xGG",
  "FF",
  "16",
  "0x10",
  "9007199254740993",
])
  assert.throws(() => binary.parseOffset(value, 16));
assert.throws(() => binary.parseOffset("0", 0), /empty/);
assert.equal(binary.parseOffset("0", 1), 0);
for (const value of ["00 FF 2a", "00ff2A", " 00\nFF\t2A ", "00FF 2a"])
  assert.deepEqual(
    binary.parseNeedle(value, "hex"),
    new Uint8Array([0, 255, 42]),
  );
for (const value of ["F", "F F", "0xFF", "00,F0", "GG", "000", "00 0", "ff;01"])
  assert.throws(() => binary.parseNeedle(value, "hex"));
assert.deepEqual(binary.parseNeedle(" ", "hex"), new Uint8Array());
assert.deepEqual(binary.parseNeedle("", "text"), new Uint8Array());
const unicode = "A\0é🦄\r\n";
assert.deepEqual(
  binary.parseNeedle(unicode, "text"),
  new Uint8Array(Buffer.from(unicode)),
);
assert.throws(() => binary.parseNeedle("", "bad"));

assert.equal(
  binary.format(all, 0, 255, "hex"),
  Buffer.from(all).toString("hex").match(/../g).join(" ").toUpperCase(),
);
assert.equal(
  binary.format(all, 0, 255, "base64"),
  Buffer.from(all).toString("base64"),
);
assert.equal(
  binary.format(all, 4, 190, "base64"),
  Buffer.from(all.subarray(4, 191)).toString("base64"),
);
assert.equal(
  binary.format(
    Buffer.from(unicode),
    0,
    Buffer.byteLength(unicode) - 1,
    "text",
  ),
  unicode,
);
assert.equal(
  binary.format(new Uint8Array([239, 187, 191, 65]), 0, 3, "text"),
  "\uFEFFA",
);
assert.equal(
  binary.format(new Uint8Array([255, 0, 128]), 0, 2, "text"),
  "�\0�",
);
assert.equal(binary.format(new Uint8Array(), 0, -1, "hex"), "");
for (const [start, end] of [
  [-1, 2],
  [0, 256],
  [3, 2],
  [0.5, 1],
  [0, NaN],
])
  assert.throws(() => binary.format(all, start, end, "hex"));
assert.throws(() => binary.format(all, 0, 1, "bad"));
const dump = binary.format(all, 7, 26, "dump");
assert.equal(
  dump,
  [
    "00000007  07 08 09 0A 0B 0C 0D 0E  0F 10 11 12 13 14 15 16  |................|",
    "00000017  17 18 19 1A                                       |....|",
    "0000001B",
  ].join("\n"),
);
assert.match(binary.format(all, 32, 47, "dump"), /\| !"#\$%&'\(\)\*\+,-\.\/\|/);
assert.equal(
  binary.format(new Uint8Array(48), 0, 47, "dump").split("\n").length,
  4,
);
const large = Uint8Array.from({ length: 100001 }, (_, index) => index % 256);
assert.equal(
  binary.format(large, 0, large.length - 1, "base64"),
  Buffer.from(large).toString("base64"),
);
assert.equal(
  binary.format(large, 0, large.length - 1, "hex").replace(/ /g, ""),
  Buffer.from(large).toString("hex").toUpperCase(),
);

const inspect = (bytes, cursor, little) =>
  Object.fromEntries(binary.inspect(bytes, cursor, little));
const ints = new Uint8Array([255, 254, 253, 252, 251, 250, 249, 248]);
const little = inspect(ints, 0, true);
const big = inspect(ints, 0, false);
assert.equal(little.Uint8, "255");
assert.equal(little.Int8, "-1");
assert.equal(little.Bits, "11111111");
assert.equal(little.Uint16, "65279");
assert.equal(little.Int16, "-257");
assert.equal(big.Uint16, "65534");
assert.equal(big.Int16, "-2");
assert.equal(little.Uint32, "4244504319");
assert.equal(little.Int32, "-50462977");
assert.equal(big.Uint32, "4294901244");
assert.equal(big.Int32, "-66052");
assert.equal(little.Uint64, "17940646550795321087");
assert.equal(little.Int64, "-506097522914230529");
assert.equal(big.Uint64, "18446460386757245432");
assert.equal(big.Int64, "-283686952306184");
assert.equal(
  inspect(new Uint8Array(8).fill(255), 0, true).Uint64,
  "18446744073709551615",
);
assert.equal(inspect(new Uint8Array(8).fill(255), 0, false).Int64, "-1");
for (const endian of [true, false]) {
  const floatBuffer = new ArrayBuffer(8);
  const view = new DataView(floatBuffer);
  view.setFloat32(0, -1.5, endian);
  assert.equal(inspect(new Uint8Array(floatBuffer), 0, endian).Float32, "-1.5");
  view.setFloat64(0, Math.PI, endian);
  assert.equal(
    inspect(new Uint8Array(floatBuffer), 0, endian).Float64,
    String(Math.PI),
  );
  view.setFloat64(0, -0, endian);
  assert.equal(inspect(new Uint8Array(floatBuffer), 0, endian).Float64, "-0");
  view.setFloat64(0, Infinity, endian);
  assert.equal(
    inspect(new Uint8Array(floatBuffer), 0, endian).Float64,
    "Infinity",
  );
  view.setFloat64(0, NaN, endian);
  assert.equal(inspect(new Uint8Array(floatBuffer), 0, endian).Float64, "NaN");
}
const tail = inspect(ints, 7, true);
assert.equal(tail.Uint8, "248");
assert.equal(tail.Int8, "-8");
assert.equal(tail.Bits, "11111000");
for (const [key, value] of Object.entries(tail))
  if (!["Uint8", "Int8", "Bits"].includes(key)) assert.equal(value, "—");
for (const cursor of [-1, 8, 0.5, NaN])
  assert(
    binary.inspect(ints, cursor, true).every(([, value]) => value === "—"),
  );
assert(
  binary.inspect(new Uint8Array(), 0, true).every(([, value]) => value === "—"),
);
// Respect typed-array byteOffset: a sliced view must not read surrounding bytes.
assert.equal(
  inspect(new Uint8Array([9, 1, 2, 8]).subarray(1, 3), 0, true).Uint16,
  "513",
);

const repeated = Buffer.from("aaaaa");
const overlapping = Buffer.from("aaa");
assert.equal(binary.find(repeated, overlapping), 0);
assert.equal(binary.find(repeated, overlapping, 1), 1);
assert.equal(binary.find(repeated, overlapping, 2), 2);
assert.equal(binary.find(repeated, overlapping, 3), -1);
assert.equal(binary.find(repeated, overlapping, 4, -1), 2);
assert.equal(binary.find(repeated, overlapping, 1, -1), 1);
assert.equal(binary.find(repeated, overlapping, 0, -1), 0);
assert.equal(binary.find(repeated, overlapping, -1, -1), -1);
assert.equal(binary.find(repeated, new Uint8Array()), -1);
assert.equal(binary.find(new Uint8Array(), overlapping), -1);
assert.equal(
  binary.find(Buffer.from([0, 255, 0, 255]), Buffer.from([0, 255]), 1),
  2,
);
assert.equal(binary.find(Buffer.from(unicode), Buffer.from("é🦄")), 2);
assert.throws(() => binary.find(repeated, overlapping, 1.2));
assert.throws(() => binary.find(repeated, overlapping, 0, 0));
// A seeded corpus compares boundary handling and overlapping matches against
// Node's separately implemented byte search in both traversal directions.
let seed = 0xb1a2c3d4;
function random(maximum) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed % maximum;
}
for (let trial = 0; trial < 1500; trial++) {
  const bytes = Buffer.from(
    Array.from({ length: 1 + random(120) }, () => random(5)),
  );
  const needle = Buffer.from(
    Array.from({ length: 1 + random(15) }, () => random(5)),
  );
  if (trial % 2 === 0 && needle.length <= bytes.length) {
    const at = random(bytes.length - needle.length + 1);
    bytes.copy(needle, 0, at, at + needle.length);
  }
  const start = random(bytes.length + 4);
  assert.equal(binary.find(bytes, needle, start), bytes.indexOf(needle, start));
  assert.equal(
    binary.find(bytes, needle, start, -1),
    bytes.lastIndexOf(needle, start),
  );
}
// This pattern is quadratic in a naive candidate-by-candidate implementation.
// Keep a generous wall-clock ceiling so CI fails quickly on an algorithm regression.
const stress = new Uint8Array(10 * 1024 * 1024).fill(65);
const longNeedle = new Uint8Array(8192).fill(65);
longNeedle[longNeedle.length - 1] = 66;
const started = performance.now();
assert.equal(binary.find(stress, longNeedle), -1);
longNeedle[longNeedle.length - 1] = 65;
longNeedle[0] = 66;
assert.equal(binary.find(stress, longNeedle, stress.length - 1, -1), -1);
assert(
  performance.now() - started < 5000,
  "Repeated-data search exceeded five seconds",
);

// Execute the shipped worker rather than a duplicate of its wrapping logic.
// Structured cloning at both boundaries models browser postMessage semantics:
// changing the sender's byte array cannot change the worker's cached body.
function createSearchWorker() {
  const responses = [];
  const context = vm.createContext({
    atob,
    btoa,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Uint32Array,
    DataView,
    self: { postMessage: (data) => responses.push(structuredClone(data)) },
    importScripts: (url) => {
      assert.equal(url, "index.php?asset=binary-core.js");
      vm.runInContext(
        fs.readFileSync(
          path.join(__dirname, "../assets/binary-core.js"),
          "utf8",
        ),
        context,
      );
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../assets/binary-worker.js"), "utf8"),
    context,
  );
  return {
    send(data) {
      context.self.onmessage({ data: structuredClone(data) });
    },
    responses,
  };
}

const worker = createSearchWorker();
const cached = Uint8Array.from(all);
worker.send({ bytes: cached });
cached.fill(0);
assert.equal(
  worker.responses.length,
  0,
  "Caching bytes must not create a search response",
);
worker.send({
  needle: new Uint8Array([254, 255]),
  start: 0,
  direction: 1,
  sequence: 40,
});
assert.deepEqual(worker.responses.pop(), {
  sequence: 40,
  index: 254,
  wrapped: false,
});
worker.send({
  needle: new Uint8Array([0, 1, 2]),
  start: 1,
  direction: 1,
  sequence: 41,
});
assert.deepEqual(worker.responses.pop(), {
  sequence: 41,
  index: 0,
  wrapped: true,
});
worker.send({
  needle: new Uint8Array([254, 255]),
  start: 253,
  direction: -1,
  sequence: 42,
});
assert.deepEqual(worker.responses.pop(), {
  sequence: 42,
  index: 254,
  wrapped: true,
});
worker.send({
  needle: new Uint8Array([255, 0]),
  start: 0,
  direction: 1,
  sequence: 43,
});
assert.deepEqual(worker.responses.pop(), {
  sequence: 43,
  index: -1,
  wrapped: false,
});
worker.send({
  needle: new Uint8Array([255, 0]),
  start: 255,
  direction: -1,
  sequence: 44,
});
assert.deepEqual(worker.responses.pop(), {
  sequence: 44,
  index: -1,
  wrapped: false,
});
worker.send({ needle: new Uint8Array(), start: 0, direction: 1, sequence: 45 });
assert.deepEqual(worker.responses.pop(), {
  sequence: 45,
  index: -1,
  wrapped: false,
});
worker.send({
  needle: new Uint8Array([0]),
  start: -1,
  direction: -1,
  sequence: 46,
});
assert.deepEqual(worker.responses.pop(), {
  sequence: 46,
  index: 0,
  wrapped: true,
});
worker.send({
  needle: new Uint8Array([255]),
  start: 256,
  direction: 1,
  sequence: 47,
});
assert.deepEqual(worker.responses.pop(), {
  sequence: 47,
  index: 255,
  wrapped: true,
});
worker.send({
  needle: new Uint8Array([0]),
  start: 0,
  direction: 0,
  sequence: 48,
});
const invalidWorkerSearch = worker.responses.pop();
assert.equal(invalidWorkerSearch.sequence, 48);
assert.match(invalidWorkerSearch.error, /direction/);

// Every response retains its request's identity, even if an older queued search
// finishes after the UI has chosen a newer query. The viewer can discard it.
worker.send({
  needle: new Uint8Array([50]),
  start: 0,
  direction: 1,
  sequence: 900,
});
worker.send({
  needle: new Uint8Array([70]),
  start: 255,
  direction: -1,
  sequence: 901,
});
assert.deepEqual(worker.responses, [
  { sequence: 900, index: 50, wrapped: false },
  { sequence: 901, index: 70, wrapped: false },
]);
worker.responses.length = 0;
const sliced = new Uint8Array([9, 0, 255, 0, 255, 8]).subarray(1, 5);
worker.send({ bytes: sliced });
worker.send({
  needle: new Uint8Array([0, 255]),
  start: 1,
  direction: 1,
  sequence: 902,
});
assert.deepEqual(worker.responses.pop(), {
  sequence: 902,
  index: 2,
  wrapped: false,
});
worker.send({
  needle: new Uint8Array([0, 255]),
  start: 1,
  direction: -1,
  sequence: 903,
});
assert.deepEqual(worker.responses.pop(), {
  sequence: 903,
  index: 0,
  wrapped: false,
});
worker.send({ bytes: new Uint8Array() });
worker.send({
  needle: new Uint8Array([0]),
  start: 0,
  direction: 1,
  sequence: 904,
});
assert.deepEqual(worker.responses.pop(), {
  sequence: 904,
  index: -1,
  wrapped: false,
});

async function testDownloads() {
  const blobs = [];
  const links = [];
  const timers = [];
  const revoked = [];
  const context = vm.createContext({
    BinaryData: binary,
    // Use the real platform Blob so we verify the actual encoded bytes, its
    // snapshot behavior, and typed-array slice handling, not a hand-made stand-in.
    Blob,
    URL: {
      createObjectURL(blob) {
        blobs.push(blob);
        return `blob:test/${blobs.length}`;
      },
      revokeObjectURL(url) {
        revoked.push(url);
      },
    },
    document: {
      createElement(tag) {
        assert.equal(tag, "a");
        return {
          click() {
            links.push({ href: this.href, download: this.download });
          },
        };
      },
    },
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
    },
  });
  const Viewer = vm.runInContext(
    `${fs.readFileSync(path.join(__dirname, "../assets/binary-view.js"), "utf8")}\nBinaryViewer;`,
    context,
  );
  const viewer = Object.create(Viewer.prototype);
  viewer.record = { id: "0123456789abcdef" };
  viewer.copy = () => assert.fail("Downloads must not depend on the clipboard");
  viewer.el = () =>
    assert.fail("Downloads must not format data through UI controls");

  async function verify(bytes, anchor, cursor, expected, offsets) {
    const before = blobs.length;
    viewer.data = bytes;
    viewer.state = { anchor, cursor };
    // Both this method and its range() dependency are the shipped implementation.
    viewer.downloadSelection();
    assert.equal(blobs.length, before + 1);
    assert.equal(links.length, blobs.length);
    const blob = blobs[before];
    assert.equal(blob.type, "application/octet-stream");
    assert.equal(blob.size, expected.length);
    assert.deepEqual(
      Buffer.from(await blob.arrayBuffer()),
      Buffer.from(expected),
    );
    assert.deepEqual(links[before], {
      href: `blob:test/${before + 1}`,
      download: `webhook-0123456789abcdef-${offsets}.bin`,
    });
    assert.equal(timers[before].delay, 1000);
    assert.equal(
      revoked.length,
      before,
      "Keep the object URL alive for the browser's download",
    );
    timers[before].callback();
    assert.equal(revoked[before], links[before].href);
  }

  const source = new Uint8Array([88, 0, 255, 127, 128, 89]);
  await verify(source, 1, 4, [0, 255, 127, 128], "00000001-00000004");
  await verify(source, 4, 1, [0, 255, 127, 128], "00000001-00000004");
  await verify(source, 5, 5, [89], "00000005-00000005");
  await verify(source, 0, 0, [88], "00000000-00000000");
  await verify(source.subarray(1, 5), 0, 1, [0, 255], "00000000-00000001");
  const beforeEmpty = blobs.length;
  viewer.data = new Uint8Array();
  viewer.state = { anchor: 0, cursor: 0 };
  viewer.downloadSelection();
  assert.equal(blobs.length, beforeEmpty);
  assert.equal(links.length, beforeEmpty);
  assert.equal(timers.length, beforeEmpty);

  // Save selection must support the complete upload limit, even though copying
  // very large formatted strings is intentionally capped for responsiveness.
  const fullBody = new Uint8Array(10 * 1024 * 1024).fill(65);
  fullBody[0] = 0;
  fullBody[fullBody.length - 1] = 255;
  await verify(fullBody, 0, fullBody.length - 1, fullBody, "00000000-009FFFFF");
  fullBody.fill(0);
  const saved = new Uint8Array(await blobs.at(-1).arrayBuffer());
  assert.equal(saved[0], 0);
  assert.equal(saved[1], 65);
  assert.equal(
    saved.at(-1),
    255,
    "The download Blob must retain its original snapshot",
  );
}

async function testClipboardFallback() {
  const appSource = fs.readFileSync(
    path.join(__dirname, "../assets/app.js"),
    "utf8",
  );
  // Extract the shipped top-level function rather than duplicate its fallback.
  // Anchoring the closing brace at column zero avoids nested catch/if blocks.
  const copySource = appSource.match(
    /^async function copy\(value\) \{[\s\S]*?^\}/m,
  )?.[0];
  assert(
    copySource,
    "The application's copy function must be available for regression testing",
  );
  const value = "00 FF 80\né🦄";

  async function verify({ modal, clipboard, commandSucceeds = true }) {
    const events = [];
    const notices = [];
    let input;
    let copiedValue;
    let apiValue;
    let host;
    const focused = {
      focus(options) {
        events.push("focus");
        assert.equal(options.preventScroll, true);
        assert.equal(
          input.removed,
          true,
          "Remove the temporary input before restoring focus",
        );
      },
    };
    const container = (name) => ({
      append(element) {
        events.push(`append:${name}`);
        element.parent = this;
        host = name;
      },
    });
    const body = container("body");
    const dialog = container("dialog");
    const document = {
      body,
      activeElement: focused,
      querySelector(selector) {
        assert.equal(selector, "dialog[open]");
        return modal ? dialog : null;
      },
      createElement(tag) {
        assert.equal(tag, "textarea");
        assert.equal(input, undefined, "Create only one fallback input");
        input = {
          style: {},
          removed: false,
          select() {
            events.push("select");
            this.selected = true;
            document.activeElement = this;
          },
          remove() {
            events.push("remove");
            this.removed = true;
            this.parent = null;
          },
        };
        return input;
      },
      execCommand(command) {
        assert.equal(command, "copy");
        events.push("copy");
        // An open modal makes the body inert. Model the real browser failure:
        // the fallback succeeds only when its textarea is inside that modal.
        const activeContainer = modal ? dialog : body;
        const success =
          commandSucceeds && input.selected && input.parent === activeContainer;
        if (success) copiedValue = input.value;
        return success;
      },
    };
    const navigator = {};
    if (clipboard !== "unavailable") {
      navigator.clipboard = {
        async writeText(text) {
          events.push("clipboard");
          if (clipboard === "reject")
            throw new Error("Clipboard permission denied");
          apiValue = text;
        },
      };
    }
    const context = vm.createContext({
      document,
      navigator,
      toast: (...args) => notices.push(args),
    });
    const copy = vm.runInContext(`${copySource}\ncopy;`, context);
    const result = await copy(value);
    if (clipboard === "success") {
      assert.equal(result, true);
      assert.equal(apiValue, value);
      assert.equal(
        input,
        undefined,
        "A successful Clipboard API call must not touch the DOM",
      );
      assert.deepEqual(events, ["clipboard"]);
    } else {
      assert.equal(result, commandSucceeds);
      assert.equal(host, modal ? "dialog" : "body");
      assert.equal(input.value, value);
      assert.equal(input.removed, true);
      assert.equal(input.parent, null);
      assert.equal(input.style.position, "fixed");
      assert.equal(input.style.opacity, "0");
      assert.equal(copiedValue, commandSucceeds ? value : undefined);
      assert.deepEqual(events, [
        ...(clipboard === "reject" ? ["clipboard"] : []),
        `append:${modal ? "dialog" : "body"}`,
        "select",
        "copy",
        "remove",
        "focus",
      ]);
    }
    assert.deepEqual(
      notices,
      commandSucceeds || clipboard === "success"
        ? [["Copied to clipboard"]]
        : [
            [
              "Copy is unavailable here. Select and copy the text manually.",
              true,
            ],
          ],
    );
  }

  for (const modal of [false, true]) {
    await verify({ modal, clipboard: "unavailable" });
    await verify({ modal, clipboard: "reject" });
    await verify({ modal, clipboard: "success" });
  }
  await verify({
    modal: true,
    clipboard: "unavailable",
    commandSucceeds: false,
  });
}

testDownloads()
  .then(testClipboardFallback)
  .then(() => {
    console.log(
      "Binary helpers, worker, downloads, and clipboard: byte fidelity, UTF-8, offsets, inspector, random and 10 MiB search, wrapping, exact downloads, and modal/body clipboard fallback passed.",
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
