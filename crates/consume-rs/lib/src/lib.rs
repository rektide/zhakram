//! `consume-rs` — Rust implementation of the `rektide:interop/rng-reader`
//! world (shared WIT: `examples/emoji-wit/wit/interop.wit`).
//!
//! It *imports* the `rektide:interop/rng` interface and *exports* `read()`,
//! which draws 5 numbers and returns them comma-separated. Where the rng
//! comes from is decided by composition: statically via `wac`
//! (../../examples/interop-static) or dynamically by a host (the JS host
//! supplies an import object).
//!
//! Build (see ../../examples/interop-static/build.sh):
//!   cargo build --target wasm32-wasip2 --release

// The rng-reader component bindings are gated behind the `component` feature
// (default on). With the feature off (the command variant, ../cmd), this crate
// is a plain library: linking the component's `read` export into a
// wasm32-wasip2 command collides with wasi libc's POSIX `read` symbol, and
// the component encoder would still demand that export from the world type.
#[cfg(feature = "component")]
wit_bindgen::generate!({
    path: "wit",
    world: "rng-reader",
    with: {
        "rektide:interop/rng@0.1.0": generate,
    },
});

/// Draws `count` numbers from `next` and joins them with commas.
/// Shared with the command variant (`../cmd`), which prints instead of returning.
pub fn draw_with(next: impl Fn() -> i32, count: usize) -> String {
    let mut parts = Vec::with_capacity(count);
    for _ in 0..count {
        parts.push(next().to_string());
    }
    parts.join(",")
}

#[cfg(feature = "component")]
struct Component;

#[cfg(feature = "component")]
impl Guest for Component {
    fn read() -> String {
        draw_with(crate::rektide::interop::rng::next, 5)
    }
}

#[cfg(feature = "component")]
export!(Component);
