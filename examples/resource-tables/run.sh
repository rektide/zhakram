#!/bin/sh
set -e

cd "$(dirname "$0")"
ZHAKRAM=${ZHAKRAM:-../../node_modules/.bin/zhakram}

"$ZHAKRAM" build resource-tour.zena \
  --world zena-jco:rtour/resource-tour@0.1.0 --wit wit \
  -o build/resource-tour.component.wasm

"$ZHAKRAM" transpile build/resource-tour.component.wasm \
  -o build/resource-tour-out --expose-resources -- -I async

node host.mjs

"$ZHAKRAM" serve ../.. --check examples/resource-tables/index.html
