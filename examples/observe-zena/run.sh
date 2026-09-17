#!/bin/sh
set -e

cd "$(dirname "$0")"
ZHAKRAM=${ZHAKRAM:-../../node_modules/.bin/zhakram}
root=../..

"$ZHAKRAM" build demo.zena \
  --world zena-jco:observe/observe-demo@0.1.0 --wit wit \
  -o build/observe-demo.component.wasm

"$ZHAKRAM" transpile build/observe-demo.component.wasm \
  -o build/observe-demo-out --expose-resources -- -I async

node host.mjs

pnpm -C "$root/packages/zhakram-observe" build >/dev/null
pnpm -C "$root/packages/zhakram-otel" build >/dev/null
"$ZHAKRAM" serve "$root" --check examples/observe-zena/index.html
