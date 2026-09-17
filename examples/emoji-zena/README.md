# emoji-zena

The first Zena component in this repository that returns a string to a
JavaScript host. It imports WASI Preview 2 randomness directly, selects one of
eight UTF-8 smiley byte arrays, and lowers the selected string with the
reusable canonical-ABI helpers in
[`../../lib/zena/cabi/cabi.zena`](../../lib/zena/cabi/cabi.zena) for the
host — green end to end (Node & browser). [`NOTES.md`](NOTES.md) records
how it got there: the string-result ABI detour (canonical ABI
`MAX_FLAT_RESULTS` is 1, so a lowered string result must use the indirect
form) and a fork DCE codegen bug found and fixed along the way.

The example imports the library with Zena's relative module syntax:

```zena
import {
  cabiRealloc,
  freeStringIndirect,
  lowerStringIndirect,
} from '../../lib/zena/cabi/cabi.zena';
```

The entry module wraps `cabiRealloc` as the required `cabi_realloc` core
export, returns the string in the indirect canonical-ABI form (`pick()`
hands back one `i32` pointing at the (ptr, len) area), and exports
`cabi_post_pick` so the host can release the returned allocation. The
local [`wit/deps.wit`](wit/deps.wit) includes WASI 0.2.12 and declares the
random import alongside `pick` in the component world
(`zhakram:emoji/emoji-picker@0.1.0`).

## Build and run

From this directory, run:

```sh
./run.sh
```

The script compiles with `--dce`, embeds the WIT world, lifts it with
`wasm-tools component new`, transpiles with `jco`, and calls `pick()` from
a one-line Node host — green end to end, printing one of the eight emojis:

```text
😀 😃 😄 😁 😆 😅 😂 😊
```

A browser leg lives in [`index.html`](index.html). Build outputs are
written beside the source (`emoji.*.wasm` and `out/`) and are not source
inputs.
