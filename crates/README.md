# crates/

Rust guests implementing the worlds defined in
[`../examples/emoji-wit/`](../examples/emoji-wit/README.md). Plain cargo +
wit-bindgen: each crate generates its bindings at macro time and builds
directly to `wasm32-wasip2`.

| Crate | Implements | What |
| --- | --- | --- |
| [`rng-rs/`](rng-rs/) | `rektide:interop/rng-source` | deterministic xorshift64* `next()` — fixed seed so composed runs are reproducible |
| [`emoji-rs/`](emoji-rs/) | `rektide:zena-jco/emoji-picker` | `pick()` returns one of 8 smileys, seeded from `wasi:random/random` |
| [`consume-rs/`](consume-rs/) | `rektide:interop/rng-reader` + `rng-reader-command` | lib draws 5 rng numbers as a comma string; cmd variant prints them to wasi stdout |

## Build

```sh
cargo build --target wasm32-wasip2 --release
```

Artifacts land at `target/wasm32-wasip2/release/<crate>.wasm`. The lib crates
are components ready for composition (`wac plug`); `consume-rs/cmd` is a
command component (export `wasi:cli/run`).

**Note (2026-09-15):** these crates are staged work, committed as verified by
plain `cargo build` + `wasm-tools component wit` inspection (and an end-to-end
`wac plug` + `wasmtime run` of rng-source → rng-reader-command). `cargo
component build` (0.21.1) does **not** work against them: its bundled
wit-parser ignores vendored `wit/deps` directories.
