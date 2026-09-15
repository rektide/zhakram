//! `rng-rs` — Rust implementation of the `rektide:interop/rng-source` world
//! (shared WIT: `examples/emoji-wit/wit/interop.wit`), exporting the
//! `rektide:interop/rng` interface.
//!
//! `next()` returns small `s32` values from an xorshift64* PRNG with a
//! **fixed seed** — deliberately deterministic: the rng-source/rng-reader
//! pipeline is meant to compose reproducibly (see
//! ../../examples/interop-static), so every run draws the same sequence
//! (verified end-to-end: `49, -56, -78, 34, 80`). The sequence still advances
//! call to call. Note the `as i32` cast before the `% 100` wraps: draws can
//! be negative.
//!
//! Build (see ../../examples/interop-static/build.sh):
//!   cargo build --target wasm32-wasip2 --release

wit_bindgen::generate!({
    path: "wit",
    world: "rng-source",
});

struct Rng;

impl exports::rektide::interop::rng::Guest for Rng {
    fn next() -> i32 {
        next_u64() as i32 % 100
    }
}

export!(Rng);

/// xorshift64* with a fixed, non-zero seed — the reproducible heart of this
/// component. Bump the seed to change the (still deterministic) sequence.
static STATE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0x2026_0914_F00D);

fn next_u64() -> u64 {
    use std::sync::atomic::Ordering;
    let mut x = STATE.load(Ordering::Relaxed);
    loop {
        let mut y = x;
        y ^= y << 13;
        y ^= y >> 7;
        y ^= y << 17;
        match STATE.compare_exchange(x, y, Ordering::Relaxed, Ordering::Relaxed) {
            Ok(_) => return y.wrapping_mul(0x2545_F491_4F6C_DD1D),
            Err(current) => x = current,
        }
    }
}
