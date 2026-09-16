# zena handles

Guest-side ownership bookkeeping for component-model resource handles. This is
the mirror of host-side table observation: the host ABI still passes `i32`, but
zena code sees nominal resource types and explicit lifecycle states.

```zena
import { OwnedHandle, OutputStream, acquireStdout } from './handles.zena';

let stream: OwnedHandle<OutputStream> = acquireStdout();
let view = stream.borrow();
useOutputStream(view.get());
stream.drop();
```

## API

- `OwnedHandle<T>` records `owned`, `moved`, or `dropped` state.
- `acquire<T>(handle, dropper)` wraps a fresh own handle.
- `borrow()` returns `BorrowedHandle<T>`. `get()` checks that the owner is
  still live. A borrow has no host dropper; its `drop()` only throws
  `cannot drop a borrowed handle` so attempted misuse is diagnosable.
- `move()` returns a new owner and makes the old wrapper reject access.
- `drop()` calls its resource-specific `[resource-drop]` external once. A
  repeated drop and access after move/drop throw clear zena `Error`s.
- `OutputStream` is a `distinct type` over `i32`, and `acquireStdout()` is its
  adapter. Other resources should define their own distinct type and tiny
  acquisition/drop adapter; passing one resource type where another is
  expected is a compile-time error with no runtime representation cost.

The state machine is generic because zena monomorphizes generics successfully
for this shape. Resource-specific classes would duplicate the safety logic and
risk drift; only the ABI adapter is per resource.

This deliberately prototypes the discipline described by the fork's
`ownership.md` before zena has language-level affine ownership. It cannot make
all aliasing impossible: callers must keep raw handles behind adapters and use
the wrappers consistently.

## Stdout shim caveat

Every `get-stdout` returns a fresh own handle but the preview2 shims bind them
to one shared host stdout object. Node tolerates dropping one handle. The
browser shim closes that shared object on any dispose, breaking all later
writes. Process-lifetime browser code should continue to use
[`wasip2/stdout.zena`](/lib/zena/wasip2/stdout.zena), which intentionally does
not expose drop. The destructive ownership demo is therefore Node-only.
