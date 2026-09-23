# Binary viewer decisions and maintenance

The Body tab uses a small read-only viewer implemented in `assets/binary-view.js`, with byte operations in `assets/binary-core.js` and search in `assets/binary-worker.js`. It uses ordinary DOM elements and a bounded viewport. There is no additional runtime dependency or deployment build step.

## Why a custom viewer

We reviewed upstream projects in September 2026. [HexCanvas](https://github.com/htcom-code/hexcanvas) was the strongest vendor candidate: MIT, framework-free, zero external runtime dependencies, read-only mode, search, selection, and offset navigation. It is a viable library, but its early API and editing/history/diff machinery are broader than this capture inspector needs. Its canvas grid exposes [a live region and `role="application"`](https://github.com/htcom-code/hexcanvas/blob/main/packages/element/src/hexcanvas-element.ts), with Escape then Tab to leave forward. Its [roadmap](https://github.com/htcom-code/hexcanvas/blob/main/ROADMAP.md) explicitly leaves actual screen-reader experience unverified. Adaptive columns, mobile controls, and a typed inspector would still require integration work. Our DOM grid gives individual bytes accessible names, normal Tab exit, and styling consistent with the app. This is an architectural choice, not a claim that a custom widget is automatically accessible.

Other candidates had less favorable tradeoffs:

- [ImChrisChen/hex-viewer](https://github.com/ImChrisChen/hex-viewer) is MIT and standalone, but its [worker requires WebGPU and throws without an adapter](https://github.com/ImChrisChen/hex-viewer/blob/main/src/renderer.worker.ts). WebGPU is unnecessary for our payload sizes and would restrict hosting/browser compatibility.
- [js-hex-editor](https://github.com/stan-kondrat/js-hex-editor) uses Svelte and supplies a more basic viewing surface. Its [component manifest](https://github.com/stan-kondrat/js-hex-editor/blob/main/packages/svelte/package.json) declares GPL-3.0 while the root repository identifies ISC; we did not resolve that inconsistency or incorporate its code.
- [Microsoft's VS Code Hex Editor](https://github.com/microsoft/vscode-hexeditor) has useful UX patterns—typed inspection, byte order, find, offset navigation, and copy formats—but its [React/Recoil and VS Code integration](https://github.com/microsoft/vscode-hexeditor/blob/main/package.json) make it unsuitable as a small drop-in component.

[Hexyl](https://github.com/sharkdp/hexyl) informed the visual distinction between printable, whitespace, zero, control, and non-ASCII bytes. The viewer's implementation is our own; these projects are references, not vendored dependencies.

## Invariants to preserve

- **Original bytes are authoritative.** Decode `body_base64` into `Uint8Array`; never reconstruct bytes from `body`, formatted JSON, or a UTF-8 round trip. Hex and ASCII cells refer to the same zero-based offset. Rendering escapes printable text rather than treating it as markup.
- **Inspection is read-only.** Search, selection, endian changes, and formatting do not mutate the source. Numeric interpretation starts at the cursor and checks remaining length before reading; 64-bit integers use `BigInt` getters rather than JavaScript numbers.
- **Byte fidelity is explicit.** Raw range downloads and Hex/Base64 copying preserve the selected bytes. UTF-8 text copying may replace invalid sequences, and the interface explains this. Selection endpoints are inclusive. Dumps retain original offsets, include repeated rows, and end with the exclusive terminal offset.
- **DOM size follows the viewport.** Render visible rows plus a small overscan, not the complete payload. Cap physical scroll height and map it to logical byte rows. Both ranges subtract viewport height: mapping total heights directly can make final bytes unreachable. [HexCanvas's scroll implementation](https://github.com/htcom-code/hexcanvas/blob/main/packages/core/src/viewport.ts) documents this same browser constraint. Verify bottom navigation for a full 10 MiB body at four bytes per row, including after resize and Expand.
- **Search must not stall interaction.** Run exact hex/UTF-8 matching in a worker, use linear-time matching for repeated data, invalidate stale searches, and terminate workers when the view is destroyed. Previous/Next wrap and report the wrap; malformed hex is an error rather than a silent coercion.
- **Large copy operations are bounded.** The 1 MiB clipboard limit applies to source bytes before formatting. Larger ranges use raw file download. Formatting must avoid body-sized argument lists.
- **Input methods stay usable.** Maintain linked selection, keyboard extension and navigation, normal Tab exit, touch scrolling, visible focus, and accessible byte labels. Check that sticky headings remain aligned when horizontal scrolling is necessary. Keep the empty-body state and short final row usable.

When changing byte helpers, run `node tests/test_binary.cjs` and `node tests/test_frontend.cjs`. Browser checks should cover byte identity, forward/reverse/wrapped searches, selection and copy formats, tail reads in the numeric inspector, empty bodies, full-size bodies, keyboard navigation, mobile widths, and expansion/collapse. See the README for the full project verification commands.
