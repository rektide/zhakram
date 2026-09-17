# zhakram

> experiments and tools around zena wasm programming language and jco

Hosting [zena-language](https://github.com/rektide/zena-language) guests as
WebAssembly components on [jco](https://github.com/bytecodealliance/jco) —
Node and browser, WASI P2-direct: guests import `wasi:*@0.2.x` interfaces
directly, with no preview1 adapter anywhere.

Formerly **jcona / zena-jco**: the npm packages, WIT namespaces
(`zhakram:emoji`, `zhakram:otel`, …), and the GitHub repo are now `zhakram` —
the local checkout directory, the compiler fork path
(`~/src/zena-jco-fork`), beads ticket ids, and older docs keep the old names.

**Status (verified):** interop matrix **10 pass / 0 fail** (2 by-design N/A),
Node plus a green Chrome rerun of all jshost cells
([`examples/interop-matrix`](/examples/interop-matrix/README.md)) — {rust,
zena} generators × {rust, zena, js} consumers × {jshost, static} composition,
zena↔zena static included. All six example legs are green (`emoji-zena`,
`emoji-rs`, `otel-zena`, `observe-zena`, `handles-zena`, `resource-tables`).
Zena guests emit **observable spans** through hand-lowered
`wasi:otel/tracing@0.2.0-rc.2`
([`examples/otel-zena`](/examples/otel-zena/README.md)), and hosts expose
WASI dispatch + resource-table snapshots
([`packages/zhakram-observe`](/packages/zhakram-observe/README.md)). The
p3/JSPI fork frontier is a **bounded GO** per
[`doc/research/p3-frontier.solmax.md`](/doc/research/p3-frontier.solmax.md).

## Layout

| Path | What |
| --- | --- |
| [`lib/zena/`](/lib/zena/README.md) | zena guest libraries: `cabi` (canonical ABI alloc + string lift/lower), `wasip2` (p2-direct stdout/random/clocks wrappers), `handles` (typed resource ownership + misuse detection), `otel` (spans) |
| [`examples/`](/examples/README.md) | ten per-example dirs (WIT contracts, JS hosts, Node + browser runs): `emoji-wit` (shared WIT) · `emoji-zena` · `emoji-rs` · `interop-jshost` (p2-direct proof) · `interop-static` (wac plug) · `interop-matrix` (the grid) · `otel-zena` · `observe-zena` · `handles-zena` · `resource-tables` |
| [`crates/`](/crates/README.md) | Rust guest twins for the example worlds |
| [`packages/`](/packages/README.md) | workspace package index |
| [`packages/zhakram/`](/packages/zhakram/README.md) | the pipeline CLI: `zhakram build / transpile / run / serve` over zena → wasm-tools → jco |
| [`packages/zhakram-otel/`](/packages/zhakram-otel/README.md) | `wasi:otel/tracing` JS host: span stack + pluggable sink |
| [`packages/zhakram-observe/`](/packages/zhakram-observe/README.md) | pure-JS WASI/resource dispatch observation + guarded jco runtime-table snapshots |
| [`doc/`](/doc/README.md) | research corpus + plan of record (`research/`), p3/JSPI design wave (`jspi/`), zena upstream issue notes (`zena/`) |

## Quickstart (zhakram CLI)

The front door is [`packages/zhakram`](/packages/zhakram/README.md) — the
zena → wasm-tools → jco pipeline with sane defaults (`./node_modules/.bin/zhakram`,
env-overridable `ZENA_CLI` pointing at the fork checkout; plain `.ts` run by
node ≥26 type-stripping, `pnpm` workspace):

```sh
cd examples/emoji-zena
../../node_modules/.bin/zhakram build pick.zena \
  --world zhakram:emoji/emoji-picker@0.1.0 --wit wit -o emoji.component.wasm
../../node_modules/.bin/zhakram transpile emoji.component.wasm -o out
../../node_modules/.bin/zhakram run out --call pick --repeat 3   # 😃 😄 😁
```

Or run an example's script — `./run.sh` in `emoji-zena`, `emoji-rs`,
`interop-static`, `handles-zena` (Node-only legs), `otel-zena`,
`observe-zena`, `resource-tables` (Node + headless-Chrome `--check` leg) — or
`node run.mjs` in
[`interop-matrix`](/examples/interop-matrix/README.md) (`--browser` adds the
Chrome rerun).

Raw pipeline + the verified p2-direct contract (import module names,
resource handles, the stdout do-not-drop lesson):
[`examples/interop-jshost/README.md`](/examples/interop-jshost/README.md).

## Docs & tickets

- Plan of record: [`doc/research/work-outline.glm53max.md`](/doc/research/work-outline.glm53max.md)
  (posture, workstreams, sequencing, fork strategy)
- p3/JSPI design wave: [`doc/jspi/`](/doc/jspi/); the fork decision:
  [`doc/research/p3-frontier.solmax.md`](/doc/research/p3-frontier.solmax.md)
- Open work: `bd list --status open` (beads tickets in `.beads/`; ids keep
  the legacy `zenajco-` prefix)
