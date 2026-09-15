//! `emoji-rs` — Rust implementation of the `rektide:zena-jco/emoji-picker`
//! world (shared WIT: `examples/emoji-wit/wit/emoji.wit`).
//!
//! `pick()` returns one emoji from a fixed smiley set. The shuffle is an
//! xorshift64* PRNG seeded once per component instantiation from
//! `wasi:random/random` (a WASI P2 import, satisfied by jco's preview2-shim
//! or any WASI host), then advanced on every call.
//!
//! Build (see ../../examples/emoji-rs/build.sh):
//!   cargo build --target wasm32-wasip2 --release

wit_bindgen::generate!({
    path: "wit",
    world: "emoji-picker",
    with: {
        "wasi:random/random@0.2.0": generate,
    },
});

/// The fixed smiley set every `pick()` draws from.
pub const SMILEYS: [&str; 8] = [
    "😀", "😃", "😄", "😁", "🙂", "😉", "😊", "🤩",
];

struct Component;

impl Guest for Component {
    fn pick() -> String {
        SMILEYS[(next_u64() as usize) % SMILEYS.len()].to_string()
    }
}

export!(Component);

/// xorshift64* state, seeded from `wasi:random/random` on first use.
static STATE: std::sync::OnceLock<std::sync::atomic::AtomicU64> = std::sync::OnceLock::new();

fn next_u64() -> u64 {
    use std::sync::atomic::Ordering;
    let state = STATE.get_or_init(|| {
        let seed = wasi::random::random::get_random_u64();
        std::sync::atomic::AtomicU64::new(if seed == 0 {
            // xorshift state must be non-zero; use a fixed fallback constant.
            0x9E37_79B9_7F4A_7C15
        } else {
            seed
        })
    });
    let mut x = state.load(Ordering::Relaxed);
    loop {
        let mut y = x;
        y ^= y << 13;
        y ^= y >> 7;
        y ^= y << 17;
        match state.compare_exchange(x, y, Ordering::Relaxed, Ordering::Relaxed) {
            // scramble the output so low-bit patterns don't leak into the table index
            Ok(_) => return y.wrapping_mul(0x2545_F491_4F6C_DD1D),
            Err(current) => x = current,
        }
    }
}
