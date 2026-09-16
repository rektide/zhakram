# examples/

Per-example directories — each example owns its WIT, hosts, and build
artifacts. Shared guest implementations live in [`../crates/`](../crates/README.md).

| Example | What |
| --- | --- |
| [`emoji-wit/`](/examples/emoji-wit/README.md) | shared WIT contracts (emoji-picker, rng worlds) — the contract of record between zena and Rust implementations |
| [`emoji-zena/`](/examples/emoji-zena/README.md) | zena emoji-picker guest: `pick() -> string` via the indirect canonical ABI, Node & browser |
| [`emoji-rs/`](/examples/emoji-rs/README.md) | Rust emoji-picker twin under jco; the `wasi:random/random@0.2.6` shim verdict |
| [`interop-jshost/`](/examples/interop-jshost/README.md) | JS-host composition demos + the **p2-direct** proof (zena guest printing via wasi:cli/stdout in Node & browser); [addendum](/examples/interop-jshost/README-ADDENDUM.md): host-mediated rng composition (`compose.mjs`) |
| [`interop-static/`](/examples/interop-static/README.md) | static composition: `wac plug` rng-source → rng-reader-command, run under jco |
| [`interop-matrix/`](/examples/interop-matrix/README.md) | the full {generator} × {consumer} × {jshost\|static} grid, zena included, Node + browser |
| [`otel-zena/`](/examples/otel-zena/README.md) | zena guest emitting observable spans via hand-lowered `wasi:otel/tracing` + the jcona-otel JS host sink — Node & browser |
| [`observe-zena/`](/examples/observe-zena/README.md) | interleaved guest spans + host WASI/resource dispatch, per-interface summaries, and guarded jco table snapshots — Node & browser |
