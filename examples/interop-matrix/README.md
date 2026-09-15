# interop-matrix

The cross-product of the interop trio — who *generates* randomness, who
*consumes* it, and *who wires them together*:

- **generator**: `rust` = [`rng-rs`](../../crates/rng-rs) (interface export),
  `zena` = [`zena/rng-zena.zena`](zena/rng-zena.zena) (flat world-level
  `next` export)
- **consumer**: `rust` = [`consume-rs`](../../crates/consume-rs) lib
  (`read() -> string`), `zena` = [`zena/consume-zena.zena`](zena/consume-zena.zena)
  (`read() -> string` via the indirect canonical ABI from
  [`lib/zena/cabi`](../../lib/zena/cabi/cabi.zena)), `js` = the host itself
- **mode**: `jshost` = JS host instantiates both and wires `rng.next`
  through the instantiation imports object (jco `-I` mode); `static` =
  `wac plug` fuses them at build time, jco transpile + node calls `read()`

Contract: [`../emoji-wit/wit/interop.wit`](../emoji-wit/wit/interop.wit)
(`rektide:interop/rng`); zena worlds in [`wit/worlds.wit`](wit/worlds.wit).

## Run

```sh
node run.mjs            # builds everything, runs the matrix, exit 1 on FAIL
node run.mjs --browser  # additionally reruns the jshost cells under Chrome
```

Verified result (Node 26, jco 1.33.0, wasm-tools 1.245.1, wac-cli 0.11.0):

```text
generator  consumer  mode     status  detail
---------  -------   -----    ------  ------
rust       rust       jshost   PASS    "49,-56,-78,34,80"
rust       rust       static   PASS    "49,-56,-78,34,80"
rust       zena       jshost   PASS    "49,-56,-78,34,80"
rust       zena       static   PASS    "49,-56,-78,34,80"
rust       js         jshost   PASS    "49,-56,-78,34,80"
rust       js         static   N/A     the JS consumer is the host
zena       rust       jshost   PASS    "-82,-53,-18,72,-74"
zena       rust       static   SKIP    wac plug: no matching imports
zena       zena       jshost   PASS    "-82,-53,-18,72,-74"
zena       zena       static   SKIP    wac plug: no matching imports
zena       js         jshost   PASS    "-82,-53,-18,72,-74"
zena       js         static   N/A     the JS consumer is the host
```

Determinism: the rust generator draws `49,-56,-78,34,80` (fixed
xorshift64\* seed); the zena generator must match the BigInt model of its
source (xorshift64, seed 42 — mirrored in `run.mjs`), currently
`-82,-53,-18,72,-74`. `--browser` adds a Chrome rerun of all six jshost
cells via `index.html` (import map → preview2-shim browser builds).

## Why the zena generator uses a flat world

A world like `rng-source { export rng; }` (interface export) requires the
core module to export the mangled name `rektide:interop/rng@0.1.0#next`.
Zena export names are identifiers — no `#`, `:`, or `@` — so
`wasm-tools component new` rejects the embedding:

```text
error: failed to encode a component from module

Caused by:
    0: failed to decode world from module
    1: module was not valid
    2: failed to find export of interface `rektide:interop/rng@0.1.0` function `next`
```

Hence `rng-source-flat { export next: func() -> s32; }` — a world-level
function lifts from a plain `next` core export. The consequence is the
SKIP pair above: under static composition, a world-level `next` export
cannot satisfy an interface *import* (`wac plug`:
`error: the socket component had no matching imports for the plugs that
were provided`). Importing an interface is not a problem — the zena
consumer does it, via the plain qualified module name:

```zena
@external('rektide:interop/rng@0.1.0', 'next')
declare function __rngNext(): i32;
```

Closing the static gap needs one of: zena support for mangled export names
(or an export-renaming attribute), a tiny adapter component exporting the
interface while forwarding to a flat `next`, or wac-side renaming — all
future work, deliberately not forced here.

The harness treats the known skip as legitimate (and flips it to PASS if a
future toolchain composes it) — any *other* wac failure is a FAIL.

## Notes

- Each cell instantiates its own generator instance: fresh linear memory →
  fresh PRNG state → the full expected sequence per cell, not shared
  advancing state.
- The zena consumer is the first zena↔zena component composition in the
  repo: guest A's import satisfied by guest B's export, both wasm-gc
  modules, wired by a JS host, with a string round-tripping through the
  indirect canonical ABI.
- Cross-references: host-mediated demo [`../interop-jshost`](../interop-jshost/README-ADDENDUM.md),
  static demo [`../interop-static`](../interop-static/README.md), string
  ABI [`../emoji-zena`](../emoji-zena/README.md).
