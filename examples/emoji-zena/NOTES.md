# Componentization: string-result ABI shape (RESOLVED)

> **Resolution (2026-09-15)** — the original stop condition below was based
> on a wrong ABI assumption, not a zena limitation: canonical ABI
> `MAX_FLAT_RESULTS` is 1, so a lowered `string` *result* must use the
> indirect form — one `i32` result pointing at an 8-byte (ptr, len) area in
> guest memory. `lib/zena/cabi.zena` now provides `lowerStringIndirect` /
> `freeStringIndirect` for exactly this shape, `pick()` returns `i32`, and
> the example is **green end to end** (Node and browser): `pick()` returns a
> real emoji, entropy via `wasi:random/random@0.2.12` p2-direct externals.
>
> Chasing the pipeline further surfaced a genuine **fork codegen bug**, since
> fixed: under `--dce`, `@intrinsic` overload families (`zena:math`'s `div`)
> were culled to a single wrong overload, emitting `i64.div_u` over i32
> operands and producing an *invalid core module* — surfacing misleadingly as
> `component new: failed to validate component output … expected i64, found
> i32`. Standalone `wasm-tools validate` on the core module is the honest
> first check for that error class.

---

Original finding, preserved for the record:

The Zena source compiles successfully with the required `--dce` option. Its
inline tuple return produces the intended core Wasm signature:

```wat
(func $pick (result i32 i32))
```

Embedding the `zhakram:emoji/emoji-picker@0.1.0` world also succeeds. The next
pipeline step fails under `wasm-tools 1.245.1`:

```text
error: failed to encode a component from module

Caused by:
    0: failed to decode world from module
    1: module was not valid
    2: failed to classify export `pick`
    3: failed to validate export for `pick`
    4: type mismatch for function `pick`: expected `[] -> [I32]` but found `[] -> [I32, I32]`
```

Thus this toolchain's canonical ABI for an exported `func() -> string` expects
one `i32` result (an indirect result-area pointer), not a direct two-value
`(ptr, len)` result. The task explicitly identifies inability to lift the inline
tuple export as a stop condition, so the example has not been silently changed
to a different ABI. `run.sh` preserves the full reproducer and stops at the
failing component-new command.

The reusable allocation and string helpers compile, and the guest source gets
as far as a valid core module with these exports:

```text
cabi_realloc:   (i32, i32, i32, i32) -> i32
pick:           () -> (i32, i32)
cabi_post_pick: (i32, i32) -> ()
memory
```

No Node output exists because no component or jco transpilation can be produced
from that core export shape.
