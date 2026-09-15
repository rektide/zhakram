#!/bin/sh
# Build the emoji-rs Rust component (see crates/emoji-rs).
#
# cargo build (not `cargo component build`): the bundled wit-parser of the
# cargo-component toolchain ignores the vendored deps/ layout and fails;
# plain rustc --target wasm32-wasip2 emits the component directly.
set -e

cd "$(dirname "$0")"
ROOT=../..

cargo build --manifest-path "$ROOT/crates/emoji-rs/Cargo.toml" \
  --target wasm32-wasip2 --release

mkdir -p build
cp "$ROOT/crates/emoji-rs/target/wasm32-wasip2/release/emoji_rs.wasm" build/
echo "artifact in build/emoji_rs.wasm"
