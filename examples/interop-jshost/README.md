# examples/interop-jshost

JS-host composition demos, and the **p2-direct** proof: a core guest
importing WASI P2 interfaces *directly* — no preview1 adapter anywhere.

- `wasi-wit` — the full wasi 0.2.12 WIT tree (extracted via
  `wasm-tools component wit` from jco's vendored reactor adapter) plus our
  `zena-jco:p2/p2-hello@0.1.0` world
- `p2-hello.wat` — handcrafted guest speaking the lowered p2 ABI
- `p2-hello-zena.zena` — the same guest written in zena (host target + DCE,
  `zena:memory` for the buffer, inline `@external` p2 declarations)
- `run.sh` — build + componentize + `jco transpile` + run in Node
- `index.html` — browser page (later: matrix demos)

## The p2-direct contract (verified)

Import module names are the plain interface names; resources are i32 handles:

```wat
(import "wasi:cli/stdout@0.2.12" "get-stdout" (func (result i32)))
(import "wasi:io/streams@0.2.12"
  "[method]output-stream.blocking-write-and-flush"
  (func (param i32 i32 i32 i32)))          ;; this, ptr, len, result-retptr
(import "wasi:io/streams@0.2.12"
  "[resource-drop]output-stream" (func (param i32)))
```

Guest must export `memory`. Embed with the fully-qualified world:
`--world zena-jco:p2/p2-hello@0.1.0`.
