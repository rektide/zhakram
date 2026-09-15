# lib/zena/cabi

Canonical ABI helpers for zena components using linear memory. Split into
two single-purpose modules behind a facade:

| Module | What |
| --- | --- |
| [`alloc.zena`](/lib/zena/cabi/alloc.zena) | `cabiRealloc` / `cabiFree` over the stdlib `FreeListAllocator`. The canonical ABI never asks for alignment > 8, which the allocator's 8-byte-aligned pointers satisfy. |
| [`string.zena`](/lib/zena/cabi/string.zena) | `lowerString` / `liftString` (direct), `lowerStringIndirect` / `freeStringIndirect` (WIT `string` **results** — canonical ABI `MAX_FLAT_RESULTS` is 1, so a `(ptr, len)` pair must come back as one i32 pointing at an 8-byte area). |
| [`cabi.zena`](/lib/zena/cabi/cabi.zena) | facade: `export * from` both modules — the stable import surface. |

## Use

```zena
import {
  cabiRealloc, freeStringIndirect, lowerStringIndirect,
} from '../../lib/zena/cabi/cabi.zena';

// the host lowers indirect results through this export — entry modules
// must declare the wrapper themselves (zena cannot re-export an imported
// declaration under a different core export name):
export let cabi_realloc = (oldPtr: i32, oldSize: i32, align: i32,
  newSize: i32): i32 => cabiRealloc(oldPtr, oldSize, align, newSize);

export let pick = (): i32 => lowerStringIndirect(value); // string result
export let cabi_post_pick = (area: i32): void => freeStringIndirect(area);
```

Proven by [`examples/emoji-zena`](/examples/emoji-zena/README.md) (string
result + post-return free) and the
[interop-matrix](/examples/interop-matrix/README.md) zena consumer;
`lib/zena/otel` builds its span-data record images on the same allocator.
