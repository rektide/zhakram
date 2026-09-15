# lib/zena

Zena guest libraries for WebAssembly component work — every piece is
proven by at least one green example before it lands here.

| Piece | What | Proven by |
| --- | --- | --- |
| [`cabi/`](/lib/zena/cabi/README.md) | canonical ABI: allocation (`cabiRealloc`/`cabiFree`) + string lift/lower (direct and indirect result forms) | emoji-zena, interop-matrix, otel-zena |
| [`wasip2/`](/lib/zena/wasip2/README.md) | wasi p2-direct wrappers (stdout, random, clocks), byte-exact `@0.2.12` externals | interop-jshost, emoji-zena, otel-zena |
| [`otel/`](/lib/zena/otel/README.md) | guest-side OpenTelemetry spans, hand-lowered `wasi:otel/tracing@0.2.0-rc.2` | otel-zena |

## Import patterns

Consumers reach the lib with **relative imports** from their example
directory (the zena compiler resolves them from the importing file):

```zena
import { cabiRealloc } from '../../lib/zena/cabi/cabi.zena';
import { writeLine } from '../../lib/zena/wasip2/stdout.zena';
import { startSpan, endSpan } from '../../lib/zena/otel/otel.zena';
```

Conventions:

- **Facade modules**: `cabi/cabi.zena` re-exports its submodules
  (`export * from './alloc.zena'`) so the directory keeps one stable import
  surface while internals split — the fork's stdlib uses the same pattern.
  Import the facade for the combined surface, or a submodule directly when
  you only need one concern.
- **Entry modules must declare `cabi_realloc` themselves** when a host
  lowers through it (indirect results): zena cannot re-export an imported
  declaration under a different core export name, so each entry writes the
  wrapper — see [`cabi/README.md`](/lib/zena/cabi/README.md).
- Always build with `--dce` (the pipeline default): unused externals and
  helpers are culled from the core module.
- Known fork hazard (2026-09): string `+` concat under `--dce` mis-compiles
  to an invalid core module — build lines with `ByteArray` +
  `String.fromByteArray` instead (see `examples/interop-matrix`'s zena
  consumer for the pattern).
