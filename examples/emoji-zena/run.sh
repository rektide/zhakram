#!/bin/sh
set -e

cd "$(dirname "$0")"

ZENA_CLI=${ZENA_CLI:-$HOME/src/zena-jco-fork/packages/cli/lib/cli.js}
JCO=${JCO:-../../node_modules/.bin/jco}

rm -rf out
node "$ZENA_CLI" build pick.zena --dce -o emoji.core.wasm
wasm-tools component embed wit emoji.core.wasm -o emoji.embed.wasm \
  --world zhakram:emoji/emoji-picker@0.1.0
wasm-tools component new emoji.embed.wasm -o emoji.component.wasm
"$JCO" transpile --bindgen-enable-wasm-exnref emoji.component.wasm -o out
node -e "import('./out/emoji.component.js').then(m => console.log(m.pick()))"
