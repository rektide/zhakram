# examples/

Per-example directories — each example owns its WIT, hosts, and build
artifacts. Shared guest implementations live in [`../crates/`](../crates/README.md).

| Example | What |
| --- | --- |
| [`emoji-wit/`](/examples/emoji-wit/README.md) | shared WIT contracts (emoji-picker, rng worlds) — the contract of record between zena and Rust implementations |
| [`interop-jshost/`](/examples/interop-jshost/README.md) | JS-host composition demos + the **p2-direct** proof (zena guest printing via wasi:cli/stdout in Node & browser) |

More coming: `emoji-zena` (zena emoji-picker guest), `emoji-rs` docs (Rust
emoji-picker wiring), `interop-static` (wac static composition of rng-source →
rng-reader), `interop-matrix` (host × guest composition matrix).
