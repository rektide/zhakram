# packages/zhakram

The pipeline tool for this repo. Every example used to hand-roll the same
incantation — zena build → wasm-tools component embed/new → jco transpile →
node/browser run — so it lives here once, for the later fronts (otel spans,
p3 experiments, matrix maintenance) to build on.

One bin, four subcommands, plain `.ts` run directly by node (no build step —
node 26 type-stripping):

```text
zhakram build <src.zena> --world <ns:pkg/world@ver> --wit <dir> [-o out.component.wasm]
       [--rust-artifact <wasm>]
zhakram transpile <component.wasm> [-o dir] [--name name] [--expose-resources] [-- <extra jco args…>]
zhakram run <dir|component.wasm> [--call export] [--repeat n]
zhakram serve <dir> [--port n] [--check page.html]
```

The library surface (`src/index.ts`) exports the same pieces for hosts that
drive the pipeline programmatically — the
[`examples/interop-matrix`](/examples/interop-matrix/README.md) style.

## Commands

| Command | What it does |
| --- | --- |
| `build` | zena build `--dce` → `wasm-tools component embed` → `component new`. Intermediates land next to the output with the stage-suffix convention: `emoji.core.wasm`, `emoji.embed.wasm`, `emoji.component.wasm`. `--rust-artifact <wasm>` skips the zena/embed/new stages and passes the prebuilt component through (copied to `-o` when given), so rust legs (`cargo build --target wasm32-wasip2`) share the same build → transpile → run shape. |
| `transpile` | wraps `jco transpile --bindgen-enable-wasm-exnref`. Default out dir `<stem>-out` next to the component; default output name strips a `.component` infix, so `emoji.component.wasm` yields `emoji.js` (jco raw would emit `emoji.component.js`). Extra args after `--` pass through to jco (e.g. `-I async` for the host-mediated-composition mode). `--expose-resources` runs zhakram-observe's guarded jco-1.33 transform and adds `_util.resourceTables.snapshot()`; unknown shapes warn and remain unchanged. |
| `run` | imports a transpiled dir (its single top-level `.js` entry) or a component (transpiled first into a `.<stem>-run` scratch dir). Default invocation is the `wasi:cli/run` export — for command components. `--call pick` resolves any export shape: a world-level function (`m.pick`), a bare interface alias (`m.run.run`), or the fully-qualified interface (`m['wasi:cli/run@0.2.0'].run`). Results print one per `--repeat`, space-separated, on one line. |
| `serve` | static server with correct MIME for ES modules/wasm (import-map pages need this), port 8232 by default. `--check page.html` loads the page in headless Chrome and prints its `#status` text once it stops saying `loading…` (the convention every example `index.html` follows), exiting non-zero on FAIL/ERROR statuses. |

## Configuration (env)

| Var | Default | Controls |
| --- | --- | --- |
| `ZENA_CLI` | `~/src/zena-jco-fork/packages/cli/lib/cli.js` | the zena compiler CLI (a node script) |
| `WASM_TOOLS` | `wasm-tools` (PATH) | the `wasm-tools` binary |
| `JCO` | `node_modules/.bin/jco`, found by walking up from the package (then from cwd) | the `jco` binary |

## Design decisions (and the alternatives)

- **One bin with subcommands** (vs. `zhakram-build`/`zhakram-transpile`/… bins).
  Four small verbs in one place read better in example `run.sh`s and keep the
  package.json bin table trivial.
- **Hand-rolled arg parsing** (vs. [gunshi]). This is plumbing, not a
  framework; the parser is ~40 lines and the usage text is the contract. If
  the CLI grows flags worth tab-completing, switching is mechanical.
- **`--rust-artifact` copies to `-o`** (vs. being a no-op pass-through). A
  file copy keeps the invariant *build always leaves a component at `-o`*, so
  downstream steps never branch on where the component came from.
- **`run <component.wasm>` transpiles into an in-repo scratch dir** (vs. os
  tmpdir, vs. refusing components). The transpiled output imports bare
  `@bytecodealliance/preview2-shim/*` specifiers, which must keep resolving
  through a repo `node_modules` — os tmpdir breaks that.

[gunshi]: https://github.com/kazupon/gunshi

## Verified

Recorded while converting [`examples/emoji-rs`](/examples/emoji-rs/README.md)
(the end-to-end proof):

- zena leg: `zhakram build …/pick.zena --world zhakram:emoji/emoji-picker@0.1.0
  --wit …/wit -o emoji.component.wasm` → `zhakram transpile` → `zhakram run
  emoji-out --call pick --repeat 3` prints three emoji.
- command leg (the object-shape gotcha): `zhakram run .test-agent/w4/composed-out`
  prints `49,-56,-78,34,80`, exit 0.
- `zhakram run <composed.wasm>` (implicit transpile) — same output.
- `zhakram serve . --check examples/emoji-rs/index.html` →
  `STATUS: EMOJI-RS-BROWSER-OK: 😉 😉 😀`, exit 0.
- `examples/emoji-rs/run.sh` (now thin zhakram calls) prints `picks: 🤩 😁 😉`
  in Node; the untouched hand-rolled `examples/emoji-zena/run.sh` still runs
  green under the workspace.
- error paths (`--call nope`, missing `--world`) exit 1 with the available
  exports / the missing flag named.

## Follow-ups (not yet converted)

Five example run scripts now drive this CLI (`emoji-rs`, `otel-zena`,
`observe-zena`, `handles-zena`, `resource-tables`, via `"$ZHAKRAM"`). The
remaining hand-rolled spots; converting them is mechanical but
deliberately not done yet:

- `examples/emoji-zena/run.sh` — the zena leg, direct translation.
- `examples/interop-jshost` — README quickstart + reproduce blocks.
- `examples/interop-static/run.sh` — wac step stays hand-rolled (zhakram does
  not wrap `wac` yet); the transpile + run tail converts.
- `examples/interop-matrix/run.mjs` — could import the zhakram library
  instead of re-implementing `transpile()`/env defaults.

Possible later absorption (friction the tool sees but does not yet absorb):
the `wac plug` static-composition step; `-I async` jshost instantiation mode
as a first-class `run` shape; the wasi-import wiring matrix that
interop-matrix builds by hand.
