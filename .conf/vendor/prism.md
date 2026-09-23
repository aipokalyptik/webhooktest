# PrismJS syntax highlighting

PrismJS **1.30.0**, MIT licensed, is bundled under `assets/vendor/prism/`.

- Upstream: <https://github.com/PrismJS/prism/tree/v1.30.0>
- Release tag commit: `76dde18a575831c91491895193f56081ac08b0c5`
- npm package: <https://registry.npmjs.org/prismjs/-/prismjs-1.30.0.tgz>
- npm `gitHead`: `93cca40b364215210f23a9e35f085a682a2b8175`
- Archive SHA-256: `ac16a9106a28c53b6a6313993c816a3a02525fdfefd7614fc1703df915a9fc11`
- Archive npm integrity: `sha512-DEvV2ZF2r2/63V+tK8hQvrR2ZGn10srHbXviTlcv7Kpzw8jWiNTqbVgjO3IY8RxrrOUF8VPMQQFysYYYv0YZxw==`
- Generated artifact hashes: `assets/vendor/prism/SHA256SUMS`.

## Included files and runtime contract

`prism.js` concatenates the upstream minified core and all **297 official language components**, ordered by upstream's `dependencies.js` resolver. Required, optional, and modifying components are all considered. The source of each component is unchanged. A short local prefix sets `manual: true` and `disableWorkerMessageHandler: true`, so our application controls DOM rendering, worker messages, and timeouts. Importing the bundle exposes global `Prism`.

`languages.js` exposes global `SyntaxLanguages`, an alphabetically sorted array of `{id, name, aliases}`. `languages.json` contains the same data for tools. There are **290 selectable languages**: seven helper/modifier components (`css-extras`, `js-extras`, `js-templates`, `php-extras`, `xml-doc`, `markup-templating`, `t4-templating`) are included in the bundle but do not represent independent language choices. Names and aliases come from upstream's `components.json`; aliases are language identifiers, not a complete file-extension database.

`LICENSE` is the unmodified upstream MIT license. No upstream plugins, autoloader, CDN requests, or theme CSS are required. The app supplies its own token colors. Hosts deploy these committed static files and do not need Node, npm, package installation, or a build step.

## Why Prism

[Prism](https://prismjs.com/) provides broad language coverage, embedded-language support, static browser artifacts, and a small JavaScript core. The package already contains minified grammars; the vendor script only combines them. It does not guess languages: request metadata and bounded content detection choose a grammar, with an explicit user override.

[Highlight.js](https://highlightjs.readthedocs.io/en/latest/readme.html) is another sound option with prebuilt assets and automatic language detection. Its built-in set is narrower, and guessing across every grammar is not a substitute for evidence from the captured content. [Shiki](https://shiki.style/guide/bundles) offers TextMate grammars and editor-style fidelity, but its full preset is substantially larger and brings module/engine packaging. Its [JavaScript regex engine](https://shiki.style/guide/regex-engines) can avoid WebAssembly, so WASM is not an inherent requirement; it still adds unnecessary integration machinery for bounded request previews.

## Integration invariants

- Run grammar evaluation in a dedicated worker. Cap the input preview and terminate workers that exceed the main thread's deadline. A worker alone prevents UI blocking but does not impose a CPU limit on regex-based grammars. Ignore stale responses when a request or language changes.
- Keep source text and captured bytes authoritative. Prism's default `util.encode` normalizes U+00A0 to a space; our worker must preserve it when rendering. Test NBSP, BOM, CRLF, HTML-looking payloads, and large numeric IDs. Copy and download use source data, never reconstructed token markup.
- Insert only controlled highlighting markup. Captured HTML is code to inspect, not a page to execute. Keep the preview's rendered text equivalent to its input and escape characters/attributes appropriately.
- Highlighter failure or timeout should leave a usable plain-text preview and an explanation. Raw body, Hex, and downloads remain independent of syntax highlighting.

## Reproduce or update

These are maintainer commands, not deployment requirements. Download the exact package above to a temporary directory, verify its SHA-256 or npm integrity before extraction, and extract it. From the repository root run:

```sh
node .conf/vendor/vendor-prism.cjs /path/to/extracted/package
```

The script checks the pinned package version, resolves all language dependencies, highlights a sample with every selectable grammar under time limits, copies the license, and writes the bundle, metadata, and checksums. Running it again with the same package should produce no diff.

For an update, review upstream changes and its license, choose an exact released version, and update the script's version pin and this note's archive provenance. Regenerate all files together, retain the license, inspect the diff, and run the application's syntax/browser tests. Do not alphabetically concatenate grammar files or load optional dependencies after dependents: embedded grammars and extensions rely on the upstream order.
