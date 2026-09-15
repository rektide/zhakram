# emoji-rs

The Rust twin of [`../emoji-zena`](../emoji-zena/README.md): the same
emoji-picker contract (`pick() -> string`, seeded from WASI randomness), as a
Rust `wasm32-wasip2` component, transpiled and hosted by jco in Node and the
browser.

- guest: [`../../crates/emoji-rs`](../../crates/emoji-rs) (xorshift64\* seeded
  from `wasi:random/random`, fixed 8-smiley set)
- contract: [`../emoji-wit/wit/emoji.wit`](../emoji-wit/wit/emoji.wit) —
  world `rektide:zena-jco/emoji-picker@0.1.0`

## Run

```sh
./run.sh
```

`run.sh` is thin calls into the repo pipeline tool
([`packages/jcona`](../../packages/jcona/README.md)): `jcona build
--rust-artifact` (cargo component pass-through) → `jcona transpile` →
`jcona run out --call pick --repeat 3`.

Node output (emoji varies — the seed is host randomness):

```text
picks: 🤩 😉 😊
```

Browser: `index.html` (serve the repo root, open the page — import map below).

## The wasi:random version verdict

The WIT world declares `import wasi:random/random@0.2.0`, but the built
component imports **`wasi:random/random@0.2.6`** — plus the full
`wasi:io`/`wasi:cli` reactor set at 0.2.6 — because rustc's
`wasm32-wasip2` std links WASI 0.2.6 (`wasm-tools component wit` shows the
skew; the vendored `wit/deps/wasi-random` in the crate is 0.2.0 WIT, which
only shapes bindgen, not the linked imports).

**jco 1.33.0 handles this with no remedy at all**: `jco transpile` rewrites
WASI imports to `@bytecodealliance/preview2-shim/{cli,io,random}` by
interface name — version-blind, since the shim is plain JS — and
instantiation succeeds; `pick()` works in Node and the browser. The
candidate remedies were not needed:

- `jco transpile --map wasi:random/random@0.2.6=@bytecodealliance/preview2-shim/random#*`
- rebuilding emoji-rs against a vendored wasi-random 0.2.12

Both remain the escalation path if a future jco starts version-checking WASI
imports (e.g. a WASI 0.3 host with stricter matching).

## Browser import map

The transpiled guest pulls the shim's `cli`, `io`, and `random` browser
builds (the reactor set is bigger than the zena twin's, which needed only
`random`):

```json
{
  "imports": {
    "@bytecodealliance/preview2-shim/cli": "/node_modules/@bytecodealliance/preview2-shim/dist/browser/cli.js",
    "@bytecodealliance/preview2-shim/io": "/node_modules/@bytecodealliance/preview2-shim/dist/browser/io.js",
    "@bytecodealliance/preview2-shim/random": "/node_modules/@bytecodealliance/preview2-shim/dist/browser/random.js"
  }
}
```

Browser check (from the repo root — serves with ES-module MIME, then loads
the page in headless Chrome):

```sh
../../node_modules/.bin/jcona serve . --check examples/emoji-rs/index.html
# STATUS: EMOJI-RS-BROWSER-OK: 😉 😉 😀
```
