# handles-zena

End-to-end proof of [`lib/zena/handles`](/lib/zena/handles/README.md): zena
guest code acquires typed own handles, writes through checked borrows, drops
exactly once, and catches double-drop, use-after-drop, and drop-of-borrow.

```sh
./examples/handles-zena/run.sh
```

Expected output includes:

```text
lifecycle: acquired -> borrowed -> wrote
lifecycle: dropped exactly once
handle was already dropped
caught double-drop: handle was already dropped
handle was already dropped
caught use-after-drop: handle was already dropped
cannot drop a borrowed handle
caught drop-of-borrow: borrow cannot own a drop
HANDLES-ZENA-OK: lifecycle=correct misuses=3
```

The example intentionally runs only under Node. Both stdout acquisitions are
distinct own handles but resolve to the same host singleton. Node tolerates
disposing one handle and continuing through the other. The browser preview2
shim closes the shared singleton on *any* dispose, so a browser leg would turn
the intentional destructive tests into a shim-failure demo rather than an
ownership demo.

[`handles-demo.zena`](handles-demo.zena) keeps a diagnostic stdout owner alive
while it drops and probes a second owner. The final diagnostic is printed
before the diagnostic owner itself is correctly dropped.

The build script also contains one guarded compiler-compatibility step. A zena
`Error` currently retains the host-only `env.captureStackTrace -> externref`
import even under DCE, while component imports cannot carry `externref`. The
script requires exactly one known import and replaces it with an in-module
null stack provider before the normal component embed/new and zhakram transpile
steps. This preserves zena's real exception handling and clear messages; it
can be removed when the compiler emits its import-free component/WASI error
implementation.
