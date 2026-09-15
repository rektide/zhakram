// Vendored WASI WIT dependencies for the rektide:zena-jco / rektide:interop
// worlds, so that wit-bindgen, wasm-tools and wac can resolve the
// wasi:* package references without a network registry.
//
// Sources:
//   wasi-random@0.2.0 — https://github.com/WebAssembly/wasi-random (tag v0.2.0)
//   wasi-io@0.2.6, wasi-cli@0.2.6, wasi-cli@0.2.0 — extracted with
//     `wasm-tools component wit <component.wasm>` from a component built by
//     rustc's wasm32-wasip2 target (rustc 1.96-nightly 2026-03). rustc's std
//     imports wasi:io@0.2.6 / wasi:cli@0.2.6 and exports wasi:cli/run@0.2.0;
//     these files match that exactly, which keeps `wac compose` and
//     `wasm-tools component wit` happy when checking our components against
//     these worlds.
//
// Note the intentional version mix: interface versions are package-level, so
// `wasi:cli/run@0.2.0` (what rustc std exports for commands) and
// `wasi:cli/stdout@0.2.6` (what std imports for printing) coexist as two
// versions of the wasi:cli package. All references below are version
// qualified, so resolution is unambiguous.
