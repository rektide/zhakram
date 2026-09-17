# interop-matrix

The cross-product of the interop trio — who *generates* randomness, who
*consumes* it, and *who wires them together*:

- **generator**: `rust` = [`rng-rs`](../../crates/rng-rs) (interface export),
  `zena` = [`zena/rng-zena.zena`](zena/rng-zena.zena) (the `rng-source-both`
  world: interface export via the fork's `@exportName`, plus a flat
  world-level `next`)
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
zena       rust       static   PASS    "-82,-53,-18,72,-74"
zena       zena       jshost   PASS    "-82,-53,-18,72,-74"
zena       zena       static   PASS    "-82,-53,-18,72,-74"
zena       js         jshost   PASS    "-82,-53,-18,72,-74"
zena       js         static   N/A     the JS consumer is the host
```

10 pass, 0 skip, 2 n/a, 0 fail.

Determinism: the rust generator draws `49,-56,-78,34,80` (fixed
xorshift64\* seed); the zena generator must match the BigInt model of its
source (xorshift64, seed 42 — mirrored in `run.mjs`), currently
`-82,-53,-18,72,-74`. `--browser` adds a Chrome rerun of all six jshost
cells via `index.html` (import map → preview2-shim browser builds).

## Why the generator exports the rng twice

An interface export requires the core module to carry the mangled name
`rektide:interop/rng@0.1.0#next` — characters zena identifiers cannot
spell (no `#`, `:`, or `@`) — so `wasm-tools component new` rejects the
naive embedding. The generator first shipped as a flat world
(`rng-source-flat { export next }`), whose world-level export cannot
satisfy an interface *import* under static composition: `wac plug`
reported `the socket component had no matching imports for the plugs that
were provided`, and the zena × static cells SKIPped. Importing an
interface was never the problem — the zena consumer does it, via the
plain qualified module name:

```zena
@external('rektide:interop/rng@0.1.0', 'next')
declare function __rngNext(): i32;
```

The static gap closed via the fork's `@exportName` decorator, which lets
a zena export carry the mangled core name. `rng-zena.zena` now implements
the `rng-source-both` world: `rngNext` exported under
`rektide:interop/rng@0.1.0#next` (for static composition) alongside the
flat world-level `next` the JS host reads (`inst.next`) in jshost mode.
Both static cells compose and pass, and the harness no longer tolerates
skips — any wac failure is a FAIL.

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
