# crates/

Rust guests implementing the worlds defined in
[`../examples/emoji-wit/`](../examples/emoji-wit/README.md). Plain cargo +
wit-bindgen: each crate generates its bindings at macro time and builds
directly to `wasm32-wasip2`.

| Crate | Implements | What |
| --- | --- | --- |
| [`rng-rs/`](rng-rs/) | `rektide:interop/rng-source` | deterministic xorshift64* `next()` — fixed seed so composed runs are reproducible |
| [`emoji-rs/`](emoji-rs/) | `rektide:zhakram/emoji-picker` | `pick()` returns one of 8 smileys, seeded from `wasi:random/random` |
| [`consume-rs/`](consume-rs/) | `rektide:interop/rng-reader` + `rng-reader-command` | lib draws 5 rng numbers as a comma string; cmd variant prints them to wasi stdout |

## Build

```sh
cargo build --target wasm32-wasip2 --release
```

Artifacts land at `target/wasm32-wasip2/release/<crate>.wasm`. The lib crates
are components ready for composition (`wac plug`); `consume-rs/cmd` is a
command component (export `wasi:cli/run`).

**Build order (consume-rs only):** building `consume-rs-cmd` builds the lib
as a dependency with `default-features = false` and clobbers `consume_rs.wasm`
with an **empty-world** variant (no rng import, no `read` export). Build the
command first, the lib last with `--features component` —
[`../examples/interop-static/build.sh`](../examples/interop-static/build.sh)
does exactly this, and is the canonical entry point.

**Note (2026-09-15):** these crates are staged work, committed as verified by
plain `cargo build` + `wasm-tools component wit` inspection (and an end-to-end
`wac plug` + `wasmtime run` of rng-source → rng-reader-command); since then
they are also verified end-to-end under jco — `jco run` of the statically
composed pair and host-mediated instantiation of the lib
([`../examples/interop-matrix`](../examples/interop-matrix/README.md)).
`cargo component build` (0.21.1) does **not** work against them: its bundled
wit-parser ignores vendored `wit/deps` directories.
