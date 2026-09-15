# Addendum: host-mediated composition (compose.mjs)

[`compose.mjs`](compose.mjs) is the rng counterpart of this directory's p2
demos: two components composed **by the JS host at instantiation time**
rather than by a compiler. The host instantiates `rng-rs` (exports
`rektide:interop/rng.next`) and `consume-rs` (imports rng, exports
`read() -> string`), passes the generator's `next` through the consumer's
instantiation imports object, and prints `read()`:

```sh
node compose.mjs
# 49,-56,-78,34,80
```

Same deterministic sequence as the statically composed twin in
[`../interop-static`](../interop-static/README.md) — the rng edge is
identical, only *who* wires it differs (host per-instantiation vs `wac` at
build time). The full generator/consumer/mode grid, zena included, is
[`../interop-matrix`](../interop-matrix/README.md).

## Notes on jco's `-I` (instantiation) mode

- Transpiling with `--instantiation async` (`-I async`) emits
  `export function instantiate(getCoreModule, imports)` instead of wiring
  imports at module top level; the guest's exports come back from that call
  (`{ rng: { next } }` for the generator, `{ read }` for the consumer).
- In this mode the shim auto-wiring is **off**: *every* import — WASI
  included — is read from the `imports` object, so the host supplies the
  `@bytecodealliance/preview2-shim` namespaces itself (see the `wasi:*`
  entries in `compose.mjs`). In default (TLA) mode those are static imports
  in the generated JS and only *custom* imports like
  `'rektide:interop/rng'` need mapping (`--map`, or an import-map entry in
  the browser).
- `build/` holds the transpile outputs and self-manages a `*` `.gitignore`
  inside itself; this directory's existing ignore entries cover only the
  `p2-*` outputs.
