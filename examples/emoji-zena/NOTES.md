# Componentization blocker: string-result ABI shape

The Zena source compiles successfully with the required `--dce` option. Its
inline tuple return produces the intended core Wasm signature:

```wat
(func $pick (result i32 i32))
```

Embedding the `zena-jco:emoji/emoji-picker@0.1.0` world also succeeds. The next
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
