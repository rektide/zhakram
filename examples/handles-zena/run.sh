#!/bin/sh
set -e

cd "$(dirname "$0")"
JCONA=${JCONA:-../../node_modules/.bin/jcona}
ZENA_CLI=${ZENA_CLI:-$HOME/src/zena-jco-fork/packages/cli/lib/cli.js}
WASM_TOOLS=${WASM_TOOLS:-wasm-tools}

mkdir -p build
node "$ZENA_CLI" build handles-demo.zena --dce -o build/handles-demo.core.wasm

# zena Error currently retains one host-only externref stack hook under DCE.
# A component cannot import externref, so replace precisely that import with a
# same-index null stack provider. Fail if the known shape changes.
"$WASM_TOOLS" print build/handles-demo.core.wasm > build/handles-demo.core.wat
count=$(grep -c '^  (import "env" "captureStackTrace"' build/handles-demo.core.wat)
test "$count" -eq 1
sed -E \
  's/^  \(import "env" "captureStackTrace" \(func \(;([0-9]+);\) \(type ([0-9]+)\)\)\)$/  (func (;\1;) (type \2) ref.null extern)/' \
  build/handles-demo.core.wat > build/handles-demo.component-core.wat
test "$(grep -c 'captureStackTrace' build/handles-demo.component-core.wat)" -eq 0
"$WASM_TOOLS" parse build/handles-demo.component-core.wat \
  -o build/handles-demo.component-core.wasm
"$WASM_TOOLS" component embed wit build/handles-demo.component-core.wasm \
  -o build/handles-demo.embed.wasm --world zena-jco:handles/handles-demo@0.1.0
"$WASM_TOOLS" component new build/handles-demo.embed.wasm \
  -o build/handles-demo.component.wasm

"$JCONA" transpile build/handles-demo.component.wasm \
  -o build/handles-demo-out -- -I async
node host.mjs
