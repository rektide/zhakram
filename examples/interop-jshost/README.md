# examples/interop-jshost

JS-host composition demos, and the **p2-direct** proof: a core guest
importing WASI P2 interfaces *directly* — no preview1 adapter anywhere.

- `wasi-wit` — the full wasi 0.2.12 WIT tree (extracted via
  `wasm-tools component wit` from jco's vendored reactor adapter) plus our
  `zena-jco:p2/p2-hello@0.1.0` world
- `p2-hello.wat` — handcrafted guest speaking the lowered p2 ABI
- `p2-hello-zena.zena` — the same guest written in zena (**green in Node and
  browser** with the fork's preRec type-identity fix)
- `index.html` — browser page (import map → preview2-shim browser builds)
- build artifacts: `p2-zena.core.wasm` → `p2-zena.component.wasm` →
  `p2-zena-out/`

## Reproduce

```sh
node ~/src/zena-jco-fork/packages/cli/lib/cli.js build p2-hello-zena.zena --dce -o p2-zena.core.wasm
wasm-tools component embed wasi-wit p2-zena.core.wasm -o p2-zena.embed.wasm --world zena-jco:p2/p2-hello@0.1.0
wasm-tools component new p2-zena.embed.wasm -o p2-zena.component.wasm
../../node_modules/.bin/jco transpile --bindgen-enable-wasm-exnref p2-zena.component.wasm -o p2-zena-out
node -e "import('./p2-zena-out/p2-zena.component.js').then(m => m.run())"
```

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

## Notes

- **Do not `[resource-drop]` the stdout handle**: the *browser*
  preview2-shim throws `{tag:"closed"}` on dispose after write (Node does
  not). `get-stdout` returns an owned handle, so the drop is legal — this is
  a shim quirk worth an upstream issue; meanwhile guests skip dropping
  process-lifetime stdio handles.
- `blocking-write-and-flush` has **no direct result**: the flattened
  `result<_, error-code>` goes through the 4th i32 (retptr into guest
  memory).

