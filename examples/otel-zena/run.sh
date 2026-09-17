#!/bin/sh
# otel-zena via packages/zhakram: zena guest emits wasi:otel/tracing spans
# (hand-lowered by lib/zena/otel), the zhakram-otel host sink observes them.
# Node run prints the span tree; then the browser page is checked headless.
set -e

cd "$(dirname "$0")"
ZHAKRAM=${ZHAKRAM:-../../node_modules/.bin/zhakram}
root=../..

# 1. component: zena --dce → wasm-tools component embed/new
"$ZHAKRAM" build demo.zena \
  --world zena-jco:otel/otel-demo@0.1.0 --wit wit \
  -o build/otel-demo.component.wasm

# 2. transpile in instantiation mode: every import (wasi:otel/tracing
#    included) is supplied by the host's imports object at instantiate()
"$ZHAKRAM" transpile build/otel-demo.component.wasm -o build/otel-demo-out -- -I async

# 3. Node: span lines print from the host sink as on-end fires, interleaved
#    with the guest's own stdout line (the picked emoji)
node host.mjs

# 4. browser: fresh host-package dist, then serve the repo root (the page
#    import-maps /node_modules/... and /packages/...) and check headless
pnpm -C "$root/packages/zhakram-otel" build >/dev/null
"$ZHAKRAM" serve "$root" --check examples/otel-zena/index.html
