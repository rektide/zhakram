# observe-zena

End-to-end host introspection in Node and Chrome. The zena guest reuses the
known-green otel shape—nested guest spans, random, and stdout—while the host:

- wraps its `-I async` imports with `zhakram-observe`;
- sends guest spans and host dispatch events through one `emit` sink;
- prints per-interface call/resource counters; and
- reads the guarded `_util.resourceTables.snapshot()` injected by
  `zhakram transpile --expose-resources`.

Run both legs:

```sh
./examples/observe-zena/run.sh
```

The script is deliberately thin: `zhakram build`, `zhakram transpile
--expose-resources -- -I async`, the Node host, two browser bundles, then
`zhakram serve --check`.

## Representative Node trace

Durations and random values vary. This excerpt shows the important
interleaving and bounded values:

```text
host wasi:random/random#get-random-u64 result={"type":"bigint","value":"…"} dur=27µs
    span draw-index dur=0µs
    span render-emoji dur=0µs index=6
  span pick-emoji dur=3000µs emoji=😀
host resource acquire wasi:io/streams#output-stream:1
host wasi:cli/stdout#get-stdout result={"type":"resource","class":"output-stream","id":1} dur=106µs
😀host wasi:io/streams#[method]output-stream.blocking-write-and-flush result={"type":"undefined"} dur=66µs resource=output-stream:1
span emoji-demo dur=6000µs example=observe-zena
resource summary {"totals":{"calls":31,"inFlight":0,"resourceCalls":2,"dropEvents":0},…}
OBSERVE-ZENA-NODE-OK: spans=4 hostCalls=31 resourceCalls=2 tableInstances=1
```

The table snapshot demonstrates the second tier after the run:

```json
{
  "resourceScopeId": 32,
  "resourceScopeTasks": { "size": 0, "entries": [] },
  "instanceFlags": { "size": 1, "entries": ["…"] },
  "handleTables": [
    { "tableIndex": 1, "componentIdx": 0, "entries": [
      { "handle": 1, "state": "live", "scope": 0, "rep": 1, "own": true },
      { "handle": 2, "state": "live", "scope": 0, "rep": 2, "own": true }
    ] }
  ],
  "captureTables": {
    "captureTable1": { "size": 2, "entries": ["two summarized OutputStream objects"] }
  }
}
```

The browser assertion ends with:

```text
STATUS: OBSERVE-ZENA-BROWSER-OK: spans=4 hostCalls=31 resourceCalls=2 liveHandles=2 tableInstances=1
```

The transform's exact `_util` contract, shape guard, limitations, and upstream
js-component-bindgen PR sketch are documented in
[`packages/zhakram-observe`](/packages/zhakram-observe/README.md).
