#!/bin/sh
# emoji-rs under jco: transpile the Rust emoji-picker component and call
# pick() from Node. Answered here: jco 1.33.0's preview2-shim satisfies the
# component's wasi:random/random@0.2.6 import as-is (no --map needed).
set -e

cd "$(dirname "$0")"
JCO=${JCO:-../../node_modules/.bin/jco}

./build.sh

rm -rf out
"$JCO" transpile --bindgen-enable-wasm-exnref build/emoji_rs.wasm -o out
node -e "import('./out/emoji_rs.js').then(m => console.log('picks:', m.pick(), m.pick(), m.pick()))"
