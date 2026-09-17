#!/bin/sh
set -e

cd "$(dirname "$0")"
ZHAKRAM=${ZHAKRAM:-../../node_modules/.bin/zhakram}
ZENA_CLI=${ZENA_CLI:-$HOME/src/zena-jco-fork/packages/cli/lib/cli.js}
WASM_TOOLS=${WASM_TOOLS:-wasm-tools}

mkdir -p build
node "$ZENA_CLI" build handles-demo.zena --dce -o build/handles-demo.core.wasm

# --dce compiles the component flavor of zena:error (fork F1d), so an
# exception-using core module has no env externref imports to strip.
"$WASM_TOOLS" component embed wit build/handles-demo.core.wasm \
  -o build/handles-demo.embed.wasm --world zhakram:handles/handles-demo@0.1.0
"$WASM_TOOLS" component new build/handles-demo.embed.wasm \
  -o build/handles-demo.component.wasm

"$ZHAKRAM" transpile build/handles-demo.component.wasm \
  -o build/handles-demo-out -- -I async
node host.mjs
