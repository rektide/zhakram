# emoji-zena

This is the attempted first Zena component in this repository that returns a
string to a JavaScript host. It imports WASI Preview 2 randomness directly, selects one of
eight UTF-8 smiley byte arrays, lowers the selected string with the reusable
canonical-ABI helpers in [`../../lib/zena/cabi/cabi.zena`](../../lib/zena/cabi/cabi.zena),
for the host. Componentization is currently blocked by an ABI-shape mismatch;
see [`NOTES.md`](NOTES.md).

The example imports the library with Zena's relative module syntax:

```zena
import { cabiFree, cabiRealloc, lowerString } from '../../lib/zena/cabi/cabi.zena';
```

The entry module wraps `cabiRealloc` as the required `cabi_realloc` core export
and exports `cabi_post_pick` so the host can release the returned allocation.
The local [`wit/deps.wit`](wit/deps.wit) includes WASI 0.2.12 and declares the
random import alongside `pick` in the component world.

## Build and run

From this directory, run:

```sh
./run.sh
```

The script compiles with `--dce` and embeds the WIT world, then currently stops
at `wasm-tools component new`: the tool expects one indirect result `i32`, while
Zena's inline tuple export produces two direct `i32` results. Once that fork/toolchain
mismatch is resolved, the intended Node result is one of:

```text
😀 😃 😄 😁 😆 😅 😂 😊
```

Build outputs are written beside the source (`emoji.*.wasm` and `out/`) and are
not source inputs.
