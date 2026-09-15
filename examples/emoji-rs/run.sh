#!/bin/sh
# emoji-rs under jco, via packages/jcona (the repo pipeline tool): cargo
# artifact → build (rust pass-through) → transpile → run. Answered here:
# jco 1.33.0's preview2-shim satisfies the component's
# wasi:random/random@0.2.6 import as-is (no --map needed).
set -e

cd "$(dirname "$0")"
JCONA=${JCONA:-../../node_modules/.bin/jcona}

./build.sh

rm -rf out
"$JCONA" build --rust-artifact build/emoji_rs.wasm -o build/emoji_rs.component.wasm
"$JCONA" transpile build/emoji_rs.component.wasm -o out
printf 'picks: '
"$JCONA" run out --call pick --repeat 3
