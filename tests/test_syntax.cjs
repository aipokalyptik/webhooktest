"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const BodyData = require("../assets/body-core.js");
const { prettyJSON } = require("../assets/core.js");
const languages = require("../assets/vendor/prism/languages.json");

const lang = (descriptor, text = "") => BodyData.language({kind:"text", ...descriptor}, text, languages);
for (const [descriptor, expected] of [
  [{format:"json", mime:"text/plain", filename:"wrong.py"}, "json"],
  [{mime:"application/problem+json"}, "json"],
  [{mime:"image/svg+xml"}, "markup"],
  [{mime:"application/soap+xml"}, "markup"],
  [{mime:"application/graphql"}, "graphql"],
  [{mime:"text/x-python; charset=utf-8"}, "python"],
  [{mime:"text/plain", filename:"report.yaml"}, "yaml"],
  [{mime:"application/octet-stream", filename:"source.TSX"}, "tsx"],
  [{mime:"text/plain", filename:"source.cs"}, "csharp"],
  [{mime:"text/plain", filename:"data.jsonl"}, "json"],
  [{mime:"text/plain", filename:"/tmp/nginx.conf"}, "nginx"],
  [{filename:"C:\\uploads\\Dockerfile.dev"}, "docker"],
  [{filename:".env.production"}, "bash"],
  [{filename:"Makefile"}, "makefile"],
  [{filename:"CMakeLists.txt"}, "cmake"],
  [{filename:".htaccess"}, "apacheconf"],
  [{filename:".gitignore"}, "ignore"],
  [{filename:"Cargo.lock"}, "toml"],
  [{filename:"go.mod"}, "go-module"],
  [{extension:".rs"}, "rust"],
  [{kind:"binary", format:"pdf", mime:"application/pdf", filename:"fake.py"}, "plain"],
  [{kind:"multipart", mime:"multipart/form-data"}, "plain"],
  [{filename:"sheet.xlsx"}, "plain"],
  [{filename:"module.wasm"}, "plain"],
  [{mime:"application/octet-stream"}, "plain"],
]) assert.equal(lang(descriptor).id, expected, JSON.stringify(descriptor));
for (const [text, expected] of [
  ["#!/usr/bin/env python3\nprint('hello')", "python"],
  ["#!/usr/bin/python3.13\nprint('hello')", "python"],
  ["#!/bin/bash\necho hello", "bash"],
  ["#!/usr/bin/env -S deno run\nconst x = 1", "typescript"],
  ["#!/usr/local/bin/node\nconsole.log(1)", "javascript"],
  ["<?php echo '<test>';", "php"],
  ["<?xml version='1.0'?><a/>", "markup"],
  ["<!doctype html><script>alert(1)</script>", "markup"],
  ['{"exact":900719925474099312345}', "json"],
  ["---\n# sample\nhello: world\n", "yaml"],
  ["query Capture { request { body } }", "graphql"],
  ["HTTP/1.1 200 OK\r\nContent-Type: text/plain", "http"],
  ["These are ordinary words containing JSON and Python.", "plain"],
  ['{"unfinished":', "plain"],
  ["[brackets] do not imply JSON", "plain"],
]) assert.equal(lang({}, text).id, expected, text);
assert.equal(lang({filename:"a.py"}).source, "Posted filename extension");
assert.equal(lang({filename:"a.py", mime:"application/json"}).id, "json");

const utf8 = Buffer.from("\ufeffHello\u00a0world\r\n<unsafe> & \"quoted\"\n😀");
assert.equal(BodyData.decode(utf8, {encoding:"utf-8"}), utf8.toString());
const utf8Preview = BodyData.preview(utf8, {encoding:"utf-8"});
assert.equal(utf8Preview.text, utf8.toString().slice(1));
assert.equal(utf8Preview.lossy, false);
assert.equal(utf8Preview.truncated, false);
assert.equal(BodyData.preview(utf8, {encoding:"utf-8"}, 100000, true).text, utf8.toString());
const utf16le = Buffer.from("\ufeffhello 😀\r\n", "utf16le");
const utf16be = Buffer.from(utf16le).swap16();
for (const [bytes, encoding] of [[utf16le,"utf-16le"], [utf16be,"utf-16be"]]) {
  assert.equal(BodyData.decode(bytes, {encoding:"wrong-label"}), "\ufeffhello 😀\r\n");
  assert.equal(BodyData.preview(bytes, {encoding:"utf-8"}).text, "hello 😀\r\n");
  assert.equal(BodyData.preview(bytes).encoding, encoding);
  assert.equal(BodyData.preview(bytes, {}, 100000, true).text, "\ufeffhello 😀\r\n");
}
for (const little of [true, false]) {
  const points = [0xfeff, 0x41, 0x1f600, 13, 10], buffer = Buffer.alloc(points.length * 4);
  points.forEach((value,index) => little ? buffer.writeUInt32LE(value,index*4) : buffer.writeUInt32BE(value,index*4));
  assert.equal(BodyData.decode(buffer), "\ufeffA😀\r\n");
  assert.equal(BodyData.preview(buffer).text, "A😀\r\n");
  assert.equal(BodyData.preview(buffer).encoding, little ? "utf-32le" : "utf-32be");
  assert.equal(BodyData.preview(buffer, {}, 100000, true).text, "\ufeffA😀\r\n");
}
assert.equal(BodyData.decode(Buffer.from([0x80,0x20,0x93,0x61,0x94]), {encoding:"windows-1252"}), "€ “a”");
assert.equal(BodyData.preview(Buffer.from([0xff,0x80]), {kind:"binary"}).lossy, true);
assert.equal(BodyData.preview(Buffer.from([0xff,0x80]), {kind:"binary"}).text, "��");
assert.equal(BodyData.preview(Buffer.from([0xc3]), {encoding:"utf-8"}).lossy, true);
assert.equal(BodyData.preview(Buffer.alloc(0), {encoding:"utf-8"}).text, "");
// A prefix ending inside a multibyte sequence must not create replacement
// characters or a false warning. Also never split a displayed surrogate pair.
for (let prefixLength = 0; prefixLength < 4; prefixLength++) {
  const bytes = Buffer.from("a".repeat(prefixLength) + "😀".repeat(100));
  const preview = BodyData.preview(bytes, {encoding:"utf-8"}, 13);
  assert.equal(preview.lossy, false);
  assert.equal(preview.truncated, true);
  assert.ok(preview.text.length <= 13);
  assert.doesNotMatch(preview.text, /[\ud800-\udbff]$/);
  assert.doesNotMatch(preview.text, /\ufffd/);
}
const hugeText = Buffer.alloc(10 * 1024 * 1024, 0x61);
assert.equal(BodyData.preview(hugeText).text.length, 100000);
assert.equal(BodyData.preview(hugeText).truncated, true);
assert.equal(BodyData.decode(Buffer.from("\ufeffx")), "\ufeffx");

const nested = "[".repeat(20000) + "900719925474099312345" + "]".repeat(20000);
assert.equal(prettyJSON(nested, 100000), nested);
assert.equal(prettyJSON('{"value":1.000e+999}', 100000), '{\n  "value": 1.000e+999\n}');

// Exercise the actual vendored bundle and worker protocol without a DOM or a
// dependency download. Every worker invocation has a hard execution deadline.
let reply, ready = false;
const context = vm.createContext({self:{postMessage: data => {
  if (data.ready) ready = true;
  else reply = data;
}}, console});
context.importScripts = (...urls) => {
  for (const url of urls) {
    const asset = new URL(url, "http://test/").searchParams.get("asset");
    const filename = asset === "prism.js" ? "assets/vendor/prism/prism.js" : "assets/core.js";
    vm.runInContext(fs.readFileSync(path.resolve(__dirname,"..",filename),"utf8"), context, {filename, timeout:3000});
  }
};
vm.runInContext(fs.readFileSync(path.resolve(__dirname,"../assets/syntax-worker.js"),"utf8"),context,{timeout:3000});
assert.equal(ready, true, "worker announces readiness after loading its local assets");
assert.equal(reply, undefined, "initial readiness is not a highlighting reply");
function highlight(text, language, formatted = false) {
  reply = null;
  context.request = {id:41, text, language, formatted};
  vm.runInContext("self.onmessage({data:request})",context,{timeout:3000});
  assert.ok(reply, "worker replied");
  assert.equal(reply.id, 41);
  assert.equal(reply.error, undefined, reply.error);
  return reply;
}
function renderedText(html) {
  return html.replace(/<[^>]*>/g, "").replace(/&#13;/g,"\r").replace(/&lt;/g,"<").replace(/&amp;/g,"&");
}
for (const [id, sample] of [
  ["json", '{"id":900719925474099312345,"evil":"<script>alert(1)</script> &"}'],
  ["markup", '<script>alert("x")</script>\r\n<img src=x onerror="alert(1)">'],
  ["php", '<?php echo "\u00a0";\r\n'],
  ["python", 'print("\u00a0and\ufeffBOM")\r\n'],
  ["yaml", 'enabled: true\r\nname: "\u00a0spacing"\n'],
  ["javascript", 'const hello = "\u00a0world";\r\n'],
  ["sql", "SELECT * FROM captures WHERE id = 123;"],
  ["plain", "<svg onload=alert(1)>\r\n\u00a0"],
  ["constructor", "<script>hello</script>"],
]) {
  const result = highlight(sample, id);
  assert.equal(result.text, sample);
  assert.equal(renderedText(result.html), sample, `${id} preserves code text`);
  assert.doesNotMatch(result.html, /<(?:script|img|svg)\b/);
  if (!["plain","constructor"].includes(id)) assert.match(result.html, /class="token /);
}
const formatted = highlight('{"n":900719925474099312345,"precise":1.000e+999}',"json",true);
assert.match(formatted.html, /900719925474099312345/);
assert.match(formatted.text, /1\.000e\+999/);
assert.equal(formatted.formatted, true);
assert.equal(renderedText(formatted.html), formatted.text);
assert.equal(highlight('{"value":1}', "plain", true).formatted, true);
assert.equal(highlight("<plain>\0text", "markup").language, "plain");
assert.equal(highlight("x".repeat(100001),"plain").text.length,100000);
assert.equal(highlight("x".repeat(100001),"plain").truncated,true);
assert.equal(highlight(nested,"plain",true).text,nested);
// Repeated tokens hit the secondary DOM budget and remain readable plain text.
assert.equal(highlight("0,".repeat(50000),"json").language,"plain");
for (const language of languages) {
  const sample = "sample <hello> & \"value\" = 1\r\n\u00a0";
  const result = highlight(sample,language.id);
  assert.equal(result.language,language.id);
  assert.equal(renderedText(result.html),sample,`${language.id} does not rewrite text`);
}

// Test real viewer lifecycle methods with a deterministic clock: loading a
// local grammar asset is distinct from executing it, and changing views must
// invalidate both late replies and late worker failures.
const deadlines = new Map(), workers = [];
let timerSequence = 0;
class FakeWorker {
  constructor(url) { this.url = url; this.messages = []; this.terminated = false; workers.push(this); }
  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminated = true; }
}
const viewerContext = vm.createContext({
  Worker: FakeWorker,
  SyntaxLanguages: languages,
  setTimeout(callback, delay) { const id = ++timerSequence; deadlines.set(id, {callback,delay}); return id; },
  clearTimeout(id) { deadlines.delete(id); },
});
vm.runInContext(fs.readFileSync(path.resolve(__dirname,"../assets/body-view.js"),"utf8"),viewerContext,{timeout:1000});
const Viewer = vm.runInContext("BodyViewer",viewerContext), viewer = Object.create(Viewer.prototype);
const codeNode = {textContent:"",innerHTML:""}, statusNode = {textContent:""};
Object.assign(viewer, {
  root:{querySelector: selector => selector === ".body-code code" ? codeNode : statusNode, remove() {}},
  preview:{text:'{"answer":42}',truncated:false},
  language:{id:"json",name:"JSON",source:"Detected body format"},
  view:{language:"auto"}, mode:"raw", sequence:0,
});
viewer.highlight();
assert.equal(workers.length,1);
assert.equal(deadlines.get(viewer.deadline).delay,10000,"initial grammar loading allowance");
const firstWorker = viewer.worker;
firstWorker.onmessage({data:{ready:true}});
assert.equal(deadlines.size,1,"ready replaces the loading timer");
assert.equal(deadlines.get(viewer.deadline).delay,2500,"CPU deadline begins after readiness");
const firstMessage = firstWorker.messages[0];
firstWorker.onmessage({data:{id:firstMessage.id,language:"json",html:'<span class="token punctuation">{</span>',text:"{",formatted:false}});
assert.equal(viewer.pending,false);
assert.equal(deadlines.size,0,"successful highlighting clears the deadline");
viewer.highlight();
assert.equal(viewer.worker,firstWorker,"idle initialized worker is reused");
assert.equal(deadlines.get(viewer.deadline).delay,2500);
firstWorker.onmessage({data:{id:firstMessage.id,language:"plain",text:"STALE"}});
assert.equal(viewer.pending,true,"old job reply does not complete current work");
assert.notEqual(codeNode.textContent,"STALE");
const staleReady = firstWorker.onmessage, staleError = firstWorker.onerror;
viewer.highlight();
assert.equal(firstWorker.terminated,true,"changing work cancels a running grammar");
assert.equal(workers.length,2);
const secondWorker = viewer.worker, secondDeadline = viewer.deadline;
staleReady({data:{ready:true}});
staleError();
assert.equal(viewer.worker,secondWorker,"late error from the replaced worker is ignored");
assert.equal(viewer.deadline,secondDeadline,"late readiness does not reset the new deadline");
assert.equal(viewer.workerReady,false);
secondWorker.onmessage({data:{ready:true}});
const executionTimer = deadlines.get(viewer.deadline);
deadlines.delete(viewer.deadline);
executionTimer.callback();
assert.equal(secondWorker.terminated,true);
assert.equal(viewer.worker,null);
assert.match(statusNode.textContent,/took too long/);
assert.equal(codeNode.textContent,viewer.preview.text,"timeout retains the original readable preview");
viewer.highlight();
const thirdWorker = viewer.worker, afterDestroyError = thirdWorker.onerror;
viewer.destroy();
assert.equal(thirdWorker.terminated,true);
assert.equal(deadlines.size,0);
afterDestroyError();
assert.equal(viewer.worker,null,"destroyed view ignores queued failures");

console.log(`Body rendering: language evidence, bounded Unicode previews, lossless copy, safe token HTML, JSON precision, worker lifecycle and all ${languages.length} Prism languages passed.`);
