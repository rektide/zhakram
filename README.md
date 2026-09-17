# zhakram

> experiments and tools around zena wasm programming language and jco

Hosting [zena-language](https://github.com/rektide/zena-language) guests as
WebAssembly components on [jco](https://github.com/bytecodealliance/jco) —
Node and browser, WASI P2-direct: guests import `wasi:*@0.2.x` interfaces
directly, with no preview1 adapter anywhere.

**Status (verified):** interop matrix 10/10 green
([`examples/interop-matrix`](/examples/interop-matrix/README.md)) — {rust,
zena} generators × {rust, zena, js} consumers × {jshost, static}
composition. Zena guests emit **observable spans** through hand-lowered
`wasi:otel/tracing@0.2.0-rc.2`, Node and browser
([`examples/otel-zena`](/examples/otel-zena/README.md)). The p3/JSPI fork
frontier is a **bounded GO** per
[`doc/research/p3-frontier.solmax.md`](/doc/research/p3-frontier.solmax.md).

## Layout

| Path | What |
| --- | --- |
| [`lib/zena/`](/lib/zena/README.md) | zena guest libraries: `cabi` (canonical ABI alloc + string lift/lower), `wasip2` (p2-direct stdout/random/clocks wrappers), `otel` (spans) |
| [`examples/`](/examples/README.md) | fan-out per-example dirs (WIT contracts, JS hosts, Node + browser runs) |
| [`crates/`](/crates/README.md) | Rust guest twins for the example worlds |
| [`packages/`](/packages/README.md) | workspace package index |
| [`packages/zhakram/`](/packages/zhakram/README.md) | the pipeline CLI: `zhakram build / transpile / run / serve` over zena → wasm-tools → jco |
| [`packages/zhakram-otel/`](/packages/zhakram-otel/README.md) | `wasi:otel/tracing` JS host: span stack + pluggable sink |
| [`packages/zhakram-observe/`](/packages/zhakram-observe/README.md) | pure-JS WASI/resource dispatch observation + guarded jco runtime-table snapshots |
| [`doc/research/`](/doc/README.md) | research notes + plan of record |

## Quickstart (zhakram CLI)

The front door is [`packages/zhakram`](/packages/zhakram/README.md) — the
zena → wasm-tools → jco pipeline with sane defaults (`./node_modules/.bin/zhakram`,
env-overridable `ZENA_CLI` pointing at the fork checkout):

```sh
cd examples/emoji-zena
../../node_modules/.bin/zhakram build pick.zena \
  --world zena-jco:emoji/emoji-picker@0.1.0 --wit wit -o emoji.component.wasm
../../node_modules/.bin/zhakram transpile emoji.component.wasm -o out
../../node_modules/.bin/zhakram run out --call pick --repeat 3   # 😃 😄 😁
```

Or just run an example's script — `./run.sh` (emoji-zena, otel-zena,
observe-zena),
`node run.mjs` (interop-matrix) — each verifies Node and browser.

Raw pipeline + the verified p2-direct contract (import module names,
resource handles, the stdout do-not-drop lesson):
[`examples/interop-jshost/README.md`](/examples/interop-jshost/README.md).

## Docs & tickets

- Plan of record: [`doc/research/work-outline.glm53max.md`](/doc/research/work-outline.glm53max.md)
  (posture, workstreams, sequencing, fork strategy)
- Open work: `bd list --status open` (beads tickets in `.beads/`)
