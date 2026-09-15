#!/bin/sh
# interop-static — static composition, jco-hosted.
#
# wac plugs rng-rs into consume-rs-cmd at *build* time; jco then runs the
# composed component, which still imports WASI (stdout for printing) but no
# longer imports rektide:interop/rng — that edge is compiled away.
set -e

cd "$(dirname "$0")"
JCO=${JCO:-../../node_modules/.bin/jco}

./build.sh

rm -rf build/composed.wasm build/composed-out
wac plug build/consume-rs-cmd.wasm --plug build/rng_rs.wasm -o build/composed.wasm

echo "== jco run (transpiles to a temp dir, then executes):"
"$JCO" run build/composed.wasm

echo "== transpile + node (same composed component, explicit pipeline):"
"$JCO" transpile --bindgen-enable-wasm-exnref build/composed.wasm -o build/composed-out >/dev/null
node -e "import('./build/composed-out/composed.js').then(m => m['wasi:cli/run@0.2.0'].run())"
