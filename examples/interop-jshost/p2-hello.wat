;; p2-direct hello: a core guest importing WASI P2 interfaces DIRECTLY
;; (no preview1 adapter anywhere). Validates the exact lowered-ABI contract
;; (import module names, [method]/[resource-drop] names, handle-as-i32,
;; indirect result param) that the zena-side implementation will use.
(module
  (import "wasi:cli/stdout@0.2.12" "get-stdout"
    (func $get-stdout (result i32)))
  (import "wasi:io/streams@0.2.12" "[method]output-stream.blocking-write-and-flush"
    (func $bwaf (param i32 i32 i32 i32)))
  (import "wasi:io/streams@0.2.12" "[resource-drop]output-stream"
    (func $drop-out (param i32)))

  (memory (export "memory") 1)
  (data (i32.const 16) "hello p2\0a")

  (func (export "run")
    (local $s i32)
    (local.set $s (call $get-stdout))
    ;; blocking-write-and-flush(this, ptr, len, result-retptr)
    (call $bwaf (local.get $s) (i32.const 16) (i32.const 9) (i32.const 64))
    (call $drop-out (local.get $s))
  )
)
