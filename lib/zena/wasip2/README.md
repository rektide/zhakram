# lib/zena/wasip2

WASI Preview 2 **p2-direct** wrappers: guests import `wasi:*@0.2.12`
interfaces directly (plain qualified interface names as core module names,
resources as i32 handles) — no preview1 adapter anywhere. External
declarations are lifted byte-for-byte from the examples that proved them.

| Module | Wraps | Helpers |
| --- | --- | --- |
| [`stdout.zena`](/lib/zena/wasip2/stdout.zena) | `wasi:cli/stdout@0.2.12` `get-stdout` + `wasi:io/streams@0.2.12` `[method]output-stream.blocking-write-and-flush` | `writeBytes(ptr, len)`, `writeString(text)`, `writeLine(text)` |
| [`random.zena`](/lib/zena/wasip2/random.zena) | `wasi:random/random@0.2.12` `get-random-u64` | `getRandomU64()`, `randomIndex(len)` (sign-clear + signed remainder) |
| [`clocks.zena`](/lib/zena/wasip2/clocks.zena) | `wasi:clocks/wall-clock@0.2.12` `now` + `wasi:clocks/monotonic-clock@0.2.12` `now` | `wallNow() -> (seconds, nanoseconds)`, `monotonicNow() -> i64` |

## Use

```zena
import { writeLine } from '../../lib/zena/wasip2/stdout.zena';
import { randomIndex } from '../../lib/zena/wasip2/random.zena';
import { monotonicNow, wallNow } from '../../lib/zena/wasip2/clocks.zena';
```

ABI notes baked into the wrappers (all verified against
`wasm-tools component embed/new` + `jco transpile`):

- **Do not `[resource-drop]` the stdout handle** — the *browser*
  preview2-shim throws `{tag:"closed"}` on dispose after a write (Node does
  not). stdout is a process-lifetime handle, so `stdout.zena` does not even
  declare the drop external; see
  [`examples/interop-jshost/README.md`](/examples/interop-jshost/README.md).
- `blocking-write-and-flush` has no direct core result: the flattened
  `result<_, stream-error>` goes through a trailing retptr param, allocated
  per call through the cabi allocator so it never overlaps guest data.
- `wall-clock.now` is a 2-value record result (over `MAX_FLAT_RESULTS`),
  lowering as a trailing return-area param; `monotonic-clock.now` is a
  single flat u64 (direct i64 result). The monotonic flat form was first
  proven by the `.test-agent/libsplit` probe alongside this extraction.
