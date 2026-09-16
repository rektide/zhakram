#!/bin/sh
set -e

cd "$(dirname "$0")"
JCONA=${JCONA:-../../node_modules/.bin/jcona}
root=../..

"$JCONA" build demo.zena \
  --world zena-jco:observe/observe-demo@0.1.0 --wit wit \
  -o build/observe-demo.component.wasm

"$JCONA" transpile build/observe-demo.component.wasm \
  -o build/observe-demo-out --expose-resources -- -I async

node host.mjs

pnpm -C "$root/packages/jcona-observe" build >/dev/null
pnpm -C "$root/packages/jcona-otel" build >/dev/null
"$JCONA" serve "$root" --check examples/observe-zena/index.html
