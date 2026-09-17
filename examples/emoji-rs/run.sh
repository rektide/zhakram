#!/bin/sh
# emoji-rs under jco, via packages/zhakram (the repo pipeline tool): cargo
# artifact → build (rust pass-through) → transpile → run. Answered here:
# jco 1.33.0's preview2-shim satisfies the component's
# wasi:random/random@0.2.6 import as-is (no --map needed).
set -e

cd "$(dirname "$0")"
ZHAKRAM=${ZHAKRAM:-../../node_modules/.bin/zhakram}

./build.sh

rm -rf out
"$ZHAKRAM" build --rust-artifact build/emoji_rs.wasm -o build/emoji_rs.component.wasm
"$ZHAKRAM" transpile build/emoji_rs.component.wasm -o out
printf 'picks: '
"$ZHAKRAM" run out --call pick --repeat 3
