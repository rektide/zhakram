#!/bin/sh
set -e

cd "$(dirname "$0")"
JCONA=${JCONA:-../../node_modules/.bin/jcona}

"$JCONA" build resource-tour.zena \
  --world zena-jco:rtour/resource-tour@0.1.0 --wit wit \
  -o build/resource-tour.component.wasm

"$JCONA" transpile build/resource-tour.component.wasm \
  -o build/resource-tour-out --expose-resources -- -I async

node host.mjs

"$JCONA" serve ../.. --check examples/resource-tables/index.html
