# interop-static

**Static composition, jco-hosted**: `wac plug` fuses the deterministic
generator `rng-rs` into the WASI command `consume-rs-cmd` at *build* time,
and jco runs the result. The composed component no longer imports
`rektide:interop/rng` — that edge is compiled away — but it still imports
WASI P2 (stdout), which jco's preview2-shim satisfies at instantiation.

This is the counterpart to
[`examples/interop-jshost`](../interop-jshost/README.md) (host-mediated
composition): here the wiring decision is made once, by `wac`, instead of
per-instantiation by the host.

## Contracts

Shared WIT lives in [`../emoji-wit/wit/interop.wit`](../emoji-wit/wit/interop.wit):

- `rng-rs` — world `rng-source`: exports `rektide:interop/rng` (`next() ->
  s32`), deterministic xorshift64\* (fixed seed), no imports.
- `consume-rs-cmd` — world `rng-reader-command`: imports
  `rektide:interop/rng`, exports `wasi:cli/run@0.2.0`; `main` draws 5
  numbers and prints them comma-separated.

## Run

```sh
./run.sh
```

Verified output (deterministic):

```text
== jco run (transpiles to a temp dir, then executes):
49,-56,-78,34,80
== transpile + node (same composed component, explicit pipeline):
49,-56,-78,34,80
```

Pipeline:

```sh
./build.sh                                        # cargo build (order matters, see below)
wac plug build/consume-rs-cmd.wasm --plug build/rng_rs.wasm -o build/composed.wasm
../../node_modules/.bin/jco run build/composed.wasm
```

## Build-order footgun (consume-rs lib vs cmd)

`consume-rs` builds two variants of one crate: the *component* (lib, default
features) and the *command* (`cmd/`, lib as a dependency with
`default-features = false`). Both emit a cdylib named `consume_rs.wasm` at
the same target path. Building only the command (or building it **after**
the lib) leaves `consume_rs.wasm` with an **empty world** — no rng import,
no `read` export — because the `component` feature is off in that build.

`build.sh` therefore builds the command first and the lib **last**, with
`--features component`. If a downstream step suddenly sees an empty world
(`wasm-tools component wit build/consume_rs.wasm` → `world root {}`), rebuild
via `./build.sh`.

## Findings

- `wac plug` (wac-cli 0.11.0) composes the pair without complaint and the
  composed component runs under `jco run` (jco 1.33.0) with the expected
  deterministic sequence — static composition and the jco hosting pipeline
  compose cleanly with each other.
- The transpiled command exports `run` under **both** the bare name and the
  fully-qualified interface: `m.run.run()` / `m['wasi:cli/run@0.2.0'].run()`
  (the bare `run` is an object `{ run }`, not a function — see
  `run.sh`).
- Related matrix view of generator/consumer/host combinations, including
  zena guests: [`../interop-matrix`](../interop-matrix/README.md).
