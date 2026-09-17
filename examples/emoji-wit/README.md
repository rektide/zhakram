# examples/emoji-wit

Shared WIT contracts for the emoji examples — the **contract of record**
between the zena implementations and the Rust implementations in
[`../../crates/`](../../crates/README.md). Both sides compile against these
files; neither owns the definitions.

## Packages

- [`wit/emoji.wit`](wit/emoji.wit) — package `rektide:zhakram@0.1.0`
  - world `emoji-picker`: exports `pick: func() -> string` (one smiley from a
    fixed set). Imports `wasi:random/random@0.2.0` for the shuffle seed — a
    host-side concern (jco preview2-shim or a WASI P2 host), not part of the
    component-to-component surface.
- [`wit/interop.wit`](wit/interop.wit) — package `rektide:interop@0.1.0`
  - interface `rng`: `next: func() -> s32`
  - world `rng-source`: exports `rng` (the number maker)
  - world `rng-reader`: imports `rng`, exports `read: func() -> string`
    (draws 5 numbers, comma-separated) — compose statically via `wac` or let
    a JS host supply the import
  - world `rng-reader-command`: the command variant — imports `rng`, exports
    `wasi:cli/run@0.2.0`; prints via its libc/std surface (stdout is
    deliberately not declared here — see the world's doc comment)

## Dependencies

[`wit/deps/`](wit/deps/README.md) vendors the referenced `wasi:*` packages so
wit-bindgen, wasm-tools, and wac resolve without a network registry.

## Consumers

- Rust: `crates/rng-rs` (rng-source), `crates/emoji-rs` (emoji-picker),
  `crates/consume-rs` (rng-reader + rng-reader-command; its `wit/interop.wit`
  is a symlink into this directory)
- zena guests: planned under `examples/emoji-zena`
