//! `consume-rs-cmd` — Rust implementation of the
//! `rektide:interop/rng-reader-command` world (shared WIT:
//! `examples/emoji-wit/wit/interop.wit`).
//!
//! The command variant of the rng-reader: a WASI P2 command (its `wasi:cli/run`
//! export comes from Rust's `main` on `wasm32-wasip2`) that draws 5 numbers via
//! the imported `rektide:interop/rng` interface and prints them, comma
//! separated, to stdout through `wasi:cli/stdout` (Rust's `println!`).
//!
//! Build (see ../../examples/interop-static/build.sh):
//!   cargo build --target wasm32-wasip2 --release

wit_bindgen::generate!({
    path: "wit",
    world: "rng-reader-command",
    with: {
        "rektide:interop/rng@0.1.0": generate,
        "wasi:cli/run@0.2.0": generate,
    },
});

fn main() {
    let drawn = consume_rs::draw_with(rektide::interop::rng::next, 5);
    println!("{drawn}");
}
