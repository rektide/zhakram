# jcona

> experiments and tools around zena wasm programming language and jco

Hosting [zena-language](https://github.com/rektide/zena-language) (and sibling)
programs as WebAssembly components on
[jco](https://github.com/bytecodealliance/jco) — Node and browser, WASI
P2-direct: guests import `wasi:*@0.2.x` interfaces directly, with no preview1
adapter anywhere.

**Status (verified):** the zena p2-direct guest prints via
`wasi:cli/stdout@0.2.12` under `jco transpile` in both Node and the browser —
see [`examples/interop-jshost`](/examples/interop-jshost/README.md). Rust
counterparts for the example worlds build green in [`crates/`](/crates/README.md)
(staged, see caveats there).

## Layout

| Path                               | What                                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| [`examples/`](/examples/README.md) | fan-out per-example dirs (WIT contracts, JS hosts)                                                                         |
| [`crates/`](/crates/README.md)     | Rust guest code implementing the example worlds                                                                            |
| `lib/`                             | zena guest libraries: `lib/zena/cabi` canonical ABI (string lift/lower, realloc — proven by emoji-zena), planned: `lib/zena/wasip2`, `lib/zena/otel` |
| `packages/`                        | host-side TS tooling — planned                                                                                             |
| [`doc/research/`](/doc/README.md)  | research notes + plan of record                                                                                            |

## Docs

- [`doc/research/getting-started.glm53max.md`](/doc/research/getting-started.glm53max.md) — kickoff, validated facts, experiment ladder
- [`doc/research/work-outline.glm53max.md`](/doc/research/work-outline.glm53max.md) — plan of record: posture, workstreams, sequencing

## Quickstart (p2-direct guest, from `examples/interop-jshost`)

The zena CLI lives in the zena fork checkout (`~/src/zena-jco-fork` here);
everything else is repo-local:

```sh
node ~/src/zena-jco-fork/packages/cli/lib/cli.js build p2-hello-zena.zena --dce -o p2-zena.core.wasm
wasm-tools component embed wasi-wit p2-zena.core.wasm -o p2-zena.embed.wasm --world zena-jco:p2/p2-hello@0.1.0
wasm-tools component new p2-zena.embed.wasm -o p2-zena.component.wasm
../../node_modules/.bin/jco transpile --bindgen-enable-wasm-exnref p2-zena.component.wasm -o p2-zena-out
node -e "import('./p2-zena-out/p2-zena.component.js').then(m => m.run())"
```

Pipeline: zena → core wasm (wasm-gc) → component embed (WIT metadata) →
component new → `jco transpile` → run on Node (`index.html` covers the
browser). Details and the verified p2 contract:
[`examples/interop-jshost/README.md`](/examples/interop-jshost/README.md).
For a guest that *returns* a string,
[`examples/emoji-zena/run.sh`](/examples/emoji-zena/run.sh) runs the same
pipeline on `pick.zena` (indirect canonical-ABI string result + `wasi:random`)
and prints a random emoji.
