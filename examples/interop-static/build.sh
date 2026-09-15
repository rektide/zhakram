#!/bin/sh
# Build the Rust components for the interop-static example.
#
# Order matters! Building `consume-rs-cmd` builds `consume-rs` (the lib) as a
# dependency with `default-features = false`, which clobbers
# `consume_rs.wasm` with an empty-world variant (the `component` feature —
# and with it the rng import + read export — is off). The lib must therefore
# be built (or rebuilt) LAST, with `--features component`:
#
#   cargo build -p consume-rs-cmd          → consume_rs.wasm has world `{}`
#   cargo build -p consume-rs --features component
#                                         → consume_rs.wasm has rng-reader
#
# Verify with: wasm-tools component wit build/consume_rs.wasm
set -e

cd "$(dirname "$0")"
ROOT=../..

cargo build --manifest-path "$ROOT/crates/rng-rs/Cargo.toml" \
  --target wasm32-wasip2 --release
cargo build --manifest-path "$ROOT/crates/consume-rs/Cargo.toml" \
  -p consume-rs-cmd --target wasm32-wasip2 --release
cargo build --manifest-path "$ROOT/crates/consume-rs/Cargo.toml" \
  -p consume-rs --features component --target wasm32-wasip2 --release

mkdir -p build
cp "$ROOT/crates/consume-rs/target/wasm32-wasip2/release/consume-rs-cmd.wasm" build/
cp "$ROOT/crates/consume-rs/target/wasm32-wasip2/release/consume_rs.wasm" build/
cp "$ROOT/crates/rng-rs/target/wasm32-wasip2/release/rng_rs.wasm" build/

echo "artifacts in build/: consume-rs-cmd.wasm consume_rs.wasm rng_rs.wasm"
