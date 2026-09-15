"use components";
import { stdout } from '@bytecodealliance/preview2-shim/cli';
import { error, streams } from '@bytecodealliance/preview2-shim/io';
const { getStdout } = stdout;

if (getStdout=== undefined) {
  const err = new Error("unexpectedly undefined local import 'getStdout', was 'getStdout' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { Error: Error$1 } = error;

if (Error$1=== undefined) {
  const err = new Error("unexpectedly undefined local import 'Error$1', was 'Error' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}

const { OutputStream } = streams;

if (OutputStream=== undefined) {
  const err = new Error("unexpectedly undefined local import 'OutputStream', was 'OutputStream' available at instantiation?");
  console.error("ERROR:", err.toString());
  throw err;
}


let dv = new DataView(new ArrayBuffer());
const dataView = mem => dv.buffer === mem.buffer ? dv : dv = new DataView(mem.buffer);

function _isValidNumericPrimitive(ty, v) {
  if (v === undefined || v === null) { return false; }
  switch (ty) {
    case 'bool':
    return v === 0 || v === 1;
    break;
    case 'u8':
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255;
    break;
    case 's8':
    return typeof v === 'number' && Number.isInteger(v) && v >= -128 && v <= 127;
    break;
    case 'u16':
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 65535;
    break;
    case 's16':
    return typeof v === 'number' && Number.isInteger(v) && v >= -32768 && v <= 32767;
    case 'u32':
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 4_294_967_295;
    case 's32':
    return typeof v === 'number' && Number.isInteger(v) && v >= -2_147_483_648 && v <= 2_147_483_647;
    case 'u64':
    return typeof v === 'bigint' && v >= 0 && v <= 18_446_744_073_709_551_615n;
    case 's64':
    return typeof v === 'bigint' && v >= -9223372036854775808n && v <= 9223372036854775807n;
    break;
    case 'f32':
    case 'f64': return typeof v === 'number';
    default:
    return false;
  }
  return true;
}

function _requireValidNumericPrimitive(ty, v) {
  if (v === undefined  || v === null || !_isValidNumericPrimitive(ty, v)) {
    throw new TypeError(`invalid ${ty} value [${v}]`);
  }
  return true;
}
const T_FLAG = 1 << 30;

function rscTableCreateOwn(table, rep) {
  const free = table[0] & ~T_FLAG;
  table._createdReps.add(rep);
  if (free === 0) {
    table.push(0);
    table.push(rep | T_FLAG);
    return (table.length >> 1) - 1;
  }
  table[0] = table[free << 1];
  table[free << 1] = 0;
  table[(free << 1) + 1] = rep | T_FLAG;
  return free;
}

const RESOURCE_SCOPE_TASKS = new Map();
const WebAssemblyRuntimeError = WebAssembly.RuntimeError;

function rscTableRemove(table, handle) {
  const scope = table[handle << 1];
  const val = table[(handle << 1) + 1];
  const own = (val & T_FLAG) !== 0;
  const rep = val & ~T_FLAG;
  if (val === 0 || (scope & T_FLAG) !== 0) {
    // Resource entries occupy scope/rep pairs after the table sentinel.
    throw new WebAssemblyRuntimeError(`unknown handle index ${(handle << 1) + 1}`);
  }
  if (own && scope !== 0) {
    throw new WebAssemblyRuntimeError('cannot remove owned resource while borrowed');
  }
  const borrowTask = own ? undefined : RESOURCE_SCOPE_TASKS.get(scope);
  table[handle << 1] = table[0] | T_FLAG;
  table[0] = handle | T_FLAG;
  borrowTask?.removeBorrowedHandle();
  return { rep, scope, own };
}

let RESOURCE_SCOPE_ID = 0;

let curResourceBorrows = [];
const ASYNC_TASKS_BY_COMPONENT_IDX = new Map();
const ASYNC_CURRENT_COMPONENT_IDXS = [];

function getCurrentTask(componentIdx, taskID) {
  let usedGlobal = false;
  if (componentIdx === undefined || componentIdx === null) {
    throw new Error('missing component idx'); // TODO(fix)
    // componentIdx = ASYNC_CURRENT_COMPONENT_IDXS.at(-1);
    // usedGlobal = true;
  }
  
  const taskMetas = ASYNC_TASKS_BY_COMPONENT_IDX.get(componentIdx);
  if (taskMetas === undefined || taskMetas.length === 0) { return undefined; }
  
  if (taskID) {
    return taskMetas.find(meta => meta.task.id() === taskID);
  }
  
  const taskMeta = taskMetas[taskMetas.length - 1];
  if (!taskMeta || !taskMeta.task) { return undefined; }
  
  return taskMeta;
}
const ASYNC_CURRENT_TASK_IDS = [];

const _debugLog = (...args) => {
  if (!globalThis?.process?.env?.JCO_DEBUG) { return; }
  console.debug(...args);
};

function clearCurrentTask(componentIdx, taskID) {
  _debugLog('[clearCurrentTask()] args', { componentIdx, taskID });
  
  if (componentIdx === undefined || componentIdx === null) {
    throw new Error('missing/invalid component instance index while ending current task');
  }
  
  const tasks = ASYNC_TASKS_BY_COMPONENT_IDX.get(componentIdx);
  if (!tasks || !Array.isArray(tasks)) {
    throw new Error('missing/invalid tasks for component instance while ending task');
  }
  if (tasks.length == 0) {
    throw new Error(`no current tasks for component instance [${componentIdx}] while ending task`);
  }
  
  if (taskID !== undefined) {
    const last = tasks[tasks.length - 1];
    if (last.id !== taskID) {
      // throw new Error('current task does not match expected task ID');
      return;
    }
  }
  
  ASYNC_CURRENT_TASK_IDS.pop();
  ASYNC_CURRENT_COMPONENT_IDXS.pop();
  
  const taskMeta = tasks.pop();
  return taskMeta.task;
}
const ASYNC_STATE = new Map();

function promiseWithResolvers() {
  if (Promise.withResolvers) {
    return Promise.withResolvers();
  } else {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
}

class Waitable {
  #componentIdx;
  
  #pendingEventFn = null;
  
  #promise;
  #resolve;
  #reject;
  
  #waitableSet = null;
  
  #hasSyncWaiter = false;
  
  #idx = null; // to component-global waitables
  
  target;
  
  constructor(args) {
    const { componentIdx, target } = args;
    this.#componentIdx = componentIdx;
    this.target = args.target;
    this.#resetPromise();
  }
  
  componentIdx() { return this.#componentIdx; }
  isInSet() { return this.#waitableSet !== null; }
  
  idx() { return this.#idx; }
  setIdx(idx) {
    if (idx === 0) { throw new Error("waitable idx cannot be zero"); }
    this.#idx = idx;
  }
  
  setTarget(tgt) { this.target = tgt; }
  
  #resetPromise() {
    const { promise, resolve, reject } = promiseWithResolvers()
    this.#promise = promise;
    this.#resolve = resolve;
    this.#reject = reject;
  }
  
  resolve() { this.#resolve(); }
  reject(err) { this.#reject(err); }
  promise() { return this.#promise; }
  
  hasPendingEvent() {
    // _debugLog('[Waitable#hasPendingEvent()]', {
      //     componentIdx: this.#componentIdx,
      //     waitable: this,
      //     waitableSet: this.#waitableSet,
      //     hasPendingEvent: this.#pendingEventFn !== null,
      // });
      return this.#pendingEventFn !== null;
    }
    
    setPendingEvent(fn) {
      _debugLog('[Waitable#setPendingEvent()] args', {
        waitable: this,
        inSet: this.#waitableSet,
      });
      this.#pendingEventFn = fn;
    }
    
    getPendingEvent() {
      _debugLog('[Waitable#getPendingEvent()] args', {
        waitable: this,
        inSet: this.#waitableSet,
        hasPendingEvent: this.#pendingEventFn !== null,
      });
      if (this.#pendingEventFn === null) { return null; }
      const eventFn = this.#pendingEventFn;
      this.#pendingEventFn = null;
      const e = eventFn();
      this.#resetPromise();
      return e;
    }
    
    join(waitableSet) {
      _debugLog('[Waitable#join()] args', {
        waitable: this,
        waitableSet: waitableSet,
        isRemoval: waitableSet === null,
      });
      
      if (this.#waitableSet === undefined) {
        throw new TypeError('waitable set must be not be undefined');
      }
      
      if (this.#waitableSet) {
        this.#waitableSet.removeWaitable(this);
      }
      
      this.#waitableSet = waitableSet;
      
      if (waitableSet) {
        this.#waitableSet.addWaitable(this);
      }
    }
    
    drop() {
      _debugLog('[Waitable#drop()] args', {
        componentIdx: this.#componentIdx,
        waitable: this,
      });
      if (this.hasPendingEvent()) {
        throw new Error('waitables with pending events cannot be dropped');
      }
      this.join(null);
    }
    
    async waitForPendingEvent(args) {
      const { cstate } = args;
      if (!cstate) { throw new TypeError('missing component state'); }
      
      if (this.#waitableSet !== null || this.#hasSyncWaiter) {
        throw new Error("waitable is already in a set/has a sync waiter");
      }
      this.#hasSyncWaiter = true;
      await cstate.waitUntil({
        cancellable: false,
        readyFn: () => this.hasPendingEvent(),
      });
      this.#hasSyncWaiter = false;
    }
    
  }
  const INSTANCE_FLAGS = new Map();
  const STORE_TRAP = { error: null };
  const STORE_ASYNC_STATE = { deadlockCheck: null, pendingHostOperations: 0 };
  
  function _checkForDeadlock() {
    if (STORE_ASYNC_STATE.deadlockCheck !== null || STORE_TRAP.error !== null) { return; }
    STORE_ASYNC_STATE.deadlockCheck = setTimeout(() => {
      STORE_ASYNC_STATE.deadlockCheck = null;
      if (STORE_TRAP.error !== null || STORE_ASYNC_STATE.pendingHostOperations > 0) { return; }
      
      const suspendedTasks = new Set();
      for (const state of ASYNC_STATE.values()) {
        if (state.hasPendingSchedulerWork()) {
          state.runTickLoop();
          return;
        }
        for (const meta of state.suspendedTaskMetas()) {
          suspendedTasks.add(meta.task);
        }
      }
      
      const unresolvedRoots = new Set();
      for (const task of suspendedTasks) {
        const root = task.getRootTask();
        if (!root.isResolvedState()) { unresolvedRoots.add(root); }
      }
      if (unresolvedRoots.size === 0) { return; }
      
      const err = new WebAssemblyRuntimeError('wasm trap: deadlock detected: event loop cannot make further progress');
      // Which tasks were waiting, and on whose behalf. The message stays
      // exactly what the Canonical ABI calls for, so this rides alongside
      // it: a deadlock reported from a real program is otherwise a bare
      // sentence, and the state that produced it is gone by the time
      // anyone reads the failure.
      err.deadlockDetail = {
        pendingHostOperations: STORE_ASYNC_STATE.pendingHostOperations,
        suspendedTasks: [...suspendedTasks].map((task) => ({
          taskID: task.id(),
          componentIdx: task.componentIdx(),
          state: task.taskState(),
          rootTaskID: task.getRootTask().id(),
        })),
        unresolvedRootTaskIDs: [...unresolvedRoots].map((root) => root.id()),
      };
      STORE_TRAP.error = err;
      for (const root of unresolvedRoots) {
        root.setErrored(err);
        root.reject(err);
      }
      for (const task of suspendedTasks) {
        if (!task.isResolvedState() && unresolvedRoots.has(task.getRootTask())) {
          task.setErrored(err);
          task.reject(err);
        }
      }
      for (const state of ASYNC_STATE.values()) { state.runTickLoop(); }
    }, 0);
  }
  
  const CORE_TRAP_MESSAGES = new Map([
  ['unreachable', "wasm trap: wasm `unreachable` instruction executed"],
  ['memory access out of bounds', "wasm trap: out of bounds memory access"],
  ['divide by zero', "wasm trap: integer divide by zero"],
  ['remainder by zero', "wasm trap: integer divide by zero"],
  ['divide result unrepresentable', "wasm trap: integer overflow"],
  ['float unrepresentable in integer range', "wasm trap: invalid conversion to integer"],
  ['table index is out of bounds', "wasm trap: undefined element: out of bounds table access"],
  ['function signature mismatch', "wasm trap: indirect call type mismatch"],
  ['call stack exhausted', "wasm trap: call stack exhausted"],
  ]);
  function _normalizeCoreTrap(err) {
    if (!(err instanceof WebAssemblyRuntimeError)) { return err; }
    const message = CORE_TRAP_MESSAGES.get(err.message);
    if (message !== undefined) { err.message = message; }
    return err;
  }
  
  class RepTable {
    // Sentinel marking a freed slot; the freelist link for a freed slot
    // lives in the odd cell. This keeps get()/contains()/remove() on freed
    // reps well-defined (previously they returned/corrupted freelist links).
    static FREE = Symbol('RepTable.free');
    
    #data = [0, null];
    #size = 0;
    #target;
    
    constructor(args) {
      this.target = args?.target;
    }
    
    data() { return this.#data; }
    
    insert(val) {
      _debugLog('[RepTable#insert()] args', { val, target: this.target });
      const freeIdx = this.#data[0];
      if (freeIdx === 0) {
        this.#data.push(val);
        this.#data.push(null);
        const rep = (this.#data.length >> 1) - 1;
        _debugLog('[RepTable#insert()] inserted', { val, target: this.target, rep });
        this.#size += 1;
        return rep;
      }
      const placementIdx = freeIdx << 1;
      if (this.#data[placementIdx] !== RepTable.FREE) {
        throw new Error('corrupt rep table freelist: head does not point at a freed slot');
      }
      this.#data[0] = this.#data[placementIdx + 1];
      this.#data[placementIdx] = val;
      this.#data[placementIdx + 1] = null;
      _debugLog('[RepTable#insert()] inserted', { val, target: this.target, rep: freeIdx });
      this.#size += 1;
      return freeIdx;
    }
    
    get(rep) {
      _debugLog('[RepTable#get()] args', { rep, target: this.target });
      if (rep === 0) { throw new Error('invalid resource rep during get, (cannot be 0)'); }
      
      const baseIdx = rep << 1;
      const val = this.#data[baseIdx];
      if (val === RepTable.FREE) { return undefined; }
      return val;
    }
    
    contains(rep) {
      _debugLog('[RepTable#contains()] args', { rep, target: this.target });
      if (rep === 0) { throw new Error('invalid resource rep during contains, (cannot be 0)'); }
      
      const baseIdx = rep << 1;
      const val = this.#data[baseIdx];
      return val !== RepTable.FREE && !!val;
    }
    
    remove(rep) {
      _debugLog('[RepTable#remove()] args', { rep, target: this.target });
      if (rep === 0) { throw new Error('invalid resource rep during remove, (cannot be 0)'); }
      if (this.#data.length === 2) { throw new Error('invalid'); }
      
      const baseIdx = rep << 1;
      if (baseIdx >= this.#data.length) {
        throw new Error(`invalid rep [${rep}] during remove, out of range`);
      }
      const val = this.#data[baseIdx];
      if (val === RepTable.FREE) {
        throw new Error(`double removal of rep [${rep}] (already freed)`);
      }
      
      this.#data[baseIdx] = RepTable.FREE;
      this.#data[baseIdx + 1] = this.#data[0];
      this.#data[0] = rep;
      this.#size -= 1;
      
      return val;
    }
    
    size() { return this.#size; }
    
    clear() {
      _debugLog('[RepTable#clear()] args', { rep, target: this.target });
      this.#data = [0, null];
    }
  }
  
  class ComponentAsyncState {
    static EVENT_HANDLER_EVENTS = [ 'backpressure-change' ];
    
    static TickResult = {
      // no suspended tasks remain
      DONE: 'done',
      // a suspended task was resumed (more may be ready)
      RESUMED: 'resumed',
      // suspended tasks remain but none were ready
      IDLE: 'idle',
    };
    
    #componentIdx;
    #callingAsyncImport = false;
    #syncImportWait = promiseWithResolvers();
    #lockHolderTaskID = null;
    #lockWaiters = [];
    #lockHandoffScheduled = false;
    #pendingTaskStarts = 0;
    #parkedTasks = new Map();
    #suspendedTasksByTaskID = new Map();
    #suspendedTaskIDs = [];
    #errored = null;
    #trapped = false;
    #backpressure = 0;
    #backpressureWaiters = 0n;
    
    #handlerMap = new Map();
    #nextHandlerID = 0n;
    
    #tickLoop = null;
    #tickLoopInterval = null;
    
    #onExclusiveReleaseHandlers = [];
    
    #mayLeave = true;
    
    handles;
    subtasks;
    
    constructor(args) {
      this.#componentIdx = args.componentIdx;
      this.handles = new RepTable({ target: `component [${this.#componentIdx}] handles (waitable objects)` });
      this.subtasks = new RepTable({ target: `component [${this.#componentIdx}] subtasks` });
    };
    
    componentIdx() { return this.#componentIdx; }
    
    get mayLeave() {
      const flags = INSTANCE_FLAGS.get(this.#componentIdx);
      return flags === undefined ? this.#mayLeave : flags.value === 1;
    }
    set mayLeave(value) {
      if (typeof value !== 'boolean') { throw new TypeError('mayLeave must be a boolean'); }
      this.#mayLeave = value;
      const flags = INSTANCE_FLAGS.get(this.#componentIdx);
      if (flags !== undefined) { flags.value = value ? 1 : 0; }
    }
    
    errored() { return this.#errored !== null; }
    setErrored(err) {
      _debugLog('[ComponentAsyncState#setErrored()] component errored', { err, componentIdx: this.#componentIdx });
      if (this.#errored) { return; }
      if (!err) {
        err = new Error('error elswehere (see other component instance error)')
        err.componentIdx = this.#componentIdx;
      }
      this.#errored = err;
    }
    
    markTrapped(err) {
      if (!(err instanceof WebAssemblyRuntimeError)) {
        return false;
      }
      err = _normalizeCoreTrap(err);
      this.#trapped = true;
      _debugLog('[ComponentAsyncState#markTrapped()] component trapped', { err, componentIdx: this.#componentIdx });
      if (STORE_TRAP.error === null) { STORE_TRAP.error = err; }
      return true;
    }
    
    throwIfTrapped() {
      if (this.#trapped) {
        throw new WebAssemblyRuntimeError("wasm trap: cannot enter component instance");
      }
    }
    
    callingSyncImport(val) {
      if (val === undefined) { return this.#callingAsyncImport; }
      if (typeof val !== 'boolean') { throw new TypeError('invalid setting for async import'); }
      const prev = this.#callingAsyncImport;
      this.#callingAsyncImport = val;
      if (prev === true && this.#callingAsyncImport === false) {
        this.#notifySyncImportEnd();
      }
    }
    
    #notifySyncImportEnd() {
      const existing = this.#syncImportWait;
      this.#syncImportWait = promiseWithResolvers();
      existing.resolve();
    }
    
    async waitForSyncImportCallEnd() {
      await this.#syncImportWait.promise;
    }
    
    setBackpressure(v) {
      this.#backpressure = v;
      return this.#backpressure
    }
    getBackpressure() { return this.#backpressure; }
    
    incrementBackpressure() {
      const current = this.#backpressure;
      if (current < 0 || current > 2**16) {
        throw new Error(`invalid current backpressure value [${current}]`);
      }
      const newValue = this.getBackpressure() + 1;
      if (newValue >= 2**16) {
        throw new Error(`invalid new backpressure value [${newValue}], overflow`);
      }
      return this.setBackpressure(newValue);
    }
    
    decrementBackpressure() {
      const current = this.#backpressure;
      if (current < 0 || current > 2**16) {
        throw new Error(`invalid current backpressure value [${current}]`);
      }
      const newValue = Math.max(0, current - 1);
      if (newValue < 0) {
        throw new Error(`invalid new backpressure value [${newValue}], underflow`);
      }
      return this.setBackpressure(newValue);
    }
    hasBackpressure() { return this.#backpressure > 0; }
    
    waitForBackpressure() {
      let backpressureCleared = false;
      const cstate = this;
      cstate.addBackpressureWaiter();
      const handlerID = this.registerHandler({
        event: 'backpressure-change',
        fn: (bp) => {
          if (bp === 0) {
            cstate.removeHandler(handlerID);
            backpressureCleared = true;
          }
        }
      });
      return new Promise((resolve) => {
        const interval = setInterval(() => {
          if (backpressureCleared) { return; }
          clearInterval(interval);
          cstate.removeBackpressureWaiter();
          resolve(null);
        }, 0);
      });
    }
    
    registerHandler(args) {
      const { event, fn } = args;
      if (!event) { throw new Error("missing handler event"); }
      if (!fn) { throw new Error("missing handler fn"); }
      
      if (!ComponentAsyncState.EVENT_HANDLER_EVENTS.includes(event)) {
        throw new Error(`unrecognized event handler [${event}]`);
      }
      
      const handlerID = this.#nextHandlerID++;
      let handlers = this.#handlerMap.get(event);
      if (!handlers) {
        handlers = [];
        this.#handlerMap.set(event, handlers)
      }
      
      handlers.push({ id: handlerID, fn, event });
      return handlerID;
    }
    
    removeHandler(args) {
      const { event, handlerID } = args;
      const registeredHandlers = this.#handlerMap.get(event);
      if (!registeredHandlers) { return; }
      const found = registeredHandlers.find(h => h.id === handlerID);
      if (!found) { return; }
      this.#handlerMap.set(event, this.#handlerMap.get(event).filter(h => h.id !== handlerID));
    }
    
    getBackpressureWaiters() { return this.#backpressureWaiters; }
    addBackpressureWaiter() { this.#backpressureWaiters++; }
    removeBackpressureWaiter() {
      this.#backpressureWaiters--;
      if (this.#backpressureWaiters < 0) {
        throw new Error("unexepctedly negative number of backpressure waiters");
      }
    }
    
    // The per-slice mutual-exclusion lock for guest execution in this
    // component instance. Guest slices (callback invocations and
    // sync-lifted bodies) must be atomic per component even across the
    // JSPI suspensions jco introduces for host imports: wit-bindgen's
    // executors publish per-task state in single linear-memory cells
    // (the wasip3-task pointer, context-local storage discipline) that
    // an interleaved slice of the same component corrupts
    //
    // The lock is *owned*: acquisition records the holder task and
    // release is a no-op for anyone else, so a task exiting can no
    // longer drop a hold it does not own (blind acquire/release-any
    // was the previous discipline). Contended acquisition queues
    // FIFO; release hands the lock to the next waiter directly.
    isExclusivelyLocked() { return this.#lockHolderTaskID !== null; }
    exclusivelyLockedBy(taskID) { return this.#lockHolderTaskID === taskID; }
    
    exclusiveLock(taskID) {
      _debugLog('[ComponentAsyncState#exclusiveLock()]', {
        holder: this.#lockHolderTaskID,
        requester: taskID,
        componentIdx: this.#componentIdx,
      });
      if (taskID === undefined || taskID === null) {
        throw new Error('exclusive lock requires the acquiring task id');
      }
      if (this.#lockHolderTaskID !== null) {
        throw new Error(`component [${this.#componentIdx}] exclusive lock held by task [${this.#lockHolderTaskID}], requested by [${taskID}]`);
      }
      this.#lockHolderTaskID = taskID;
    }
    
    // Awaitable acquisition: takes the lock immediately when free,
    // otherwise queues FIFO behind the current holder and earlier
    // waiters. The resolved promise implies ownership.
    acquireExclusiveLock(taskID) {
      if (taskID === undefined || taskID === null) {
        throw new Error('exclusive lock requires the acquiring task id');
      }
      if (this.#lockHolderTaskID === null) {
        this.#lockHolderTaskID = taskID;
        _debugLog('[ComponentAsyncState#acquireExclusiveLock()] acquired', {
          holder: taskID,
          componentIdx: this.#componentIdx,
        });
        return;
      }
      if (this.#lockHolderTaskID === taskID) {
        throw new Error(`task [${taskID}] already holds the lock for component [${this.#componentIdx}]`);
      }
      _debugLog('[ComponentAsyncState#acquireExclusiveLock()] waiting', {
        holder: this.#lockHolderTaskID,
        requester: taskID,
        componentIdx: this.#componentIdx,
        queued: this.#lockWaiters.length,
      });
      return new Promise((resolve) => {
        this.#lockWaiters.push({ taskID, resolve });
      });
    }
    
    exclusiveRelease(taskID) {
      _debugLog('[ComponentAsyncState#exclusiveRelease()] args', {
        holder: this.#lockHolderTaskID,
        releaser: taskID,
        componentIdx: this.#componentIdx,
      });
      if (this.#lockHolderTaskID !== taskID) {
        // Ownerless releases were the historical behavior; a foreign
        // release now leaves the hold intact
        _debugLog('[ComponentAsyncState#exclusiveRelease()] ignoring foreign release', {
          holder: this.#lockHolderTaskID,
          releaser: taskID,
          componentIdx: this.#componentIdx,
        });
        return false;
      }
      
      // Make the release observable before handing the lock to the next
      // asynchronous guest slice.
      //
      // Release handlers may expose a lifted value whose consumer immediately
      // performs a synchronous call on the same component; that call must run
      // while the instance is genuinely unlocked, not via enterSync's
      // lock-free fallback code.
      this.#lockHolderTaskID = null;
      
      this.#onExclusiveReleaseHandlers = this.#onExclusiveReleaseHandlers.filter(v => !!v);
      for (const [idx, f] of this.#onExclusiveReleaseHandlers.entries()) {
        try {
          this.#onExclusiveReleaseHandlers[idx] = null;
          f();
        } catch (err) {
          _debugLog("error while executing handler for next exclusive release", err);
          throw err;
        }
      }
      this.#scheduleLockHandoff();
      return true;
    }
    
    #scheduleLockHandoff() {
      if (this.#lockHandoffScheduled || this.#lockWaiters.length === 0) { return; }
      this.#lockHandoffScheduled = true;
      queueMicrotask(() => {
        this.#lockHandoffScheduled = false;
        // A synchronous call triggered by a release handler gets the
        // first opportunity to use the unlocked component.
        //
        // Its release will leave this queued handoff in place.
        if (this.#lockHolderTaskID !== null) {
          this.#scheduleLockHandoff();
          return;
        }
        const next = this.#lockWaiters.shift();
        if (!next) { return; }
        this.#lockHolderTaskID = next.taskID;
        next.resolve();
      });
    }
    
    onNextExclusiveRelease(fn) {
      _debugLog('[ComponentAsyncState#()onNextExclusiveRelease] registering');
      this.#onExclusiveReleaseHandlers.push(fn);
    }
    
    async waitForExclusiveRelease() {
      while (this.isExclusivelyLocked()) {
        await new Promise(resolve => this.onNextExclusiveRelease(resolve));
      }
    }
    
    #getSuspendedTaskMeta(taskID) {
      return this.#suspendedTasksByTaskID.get(taskID);
    }
    
    #removeSuspendedTaskMeta(taskID) {
      _debugLog('[ComponentAsyncState#removeSuspendedTaskMeta()] removing suspended task', {
        taskID,
        componentIdx: this.#componentIdx,
      });
      const idx = this.#suspendedTaskIDs.findIndex(t => t === taskID);
      const meta = this.#suspendedTasksByTaskID.get(taskID);
      this.#suspendedTaskIDs[idx] = null;
      this.#suspendedTasksByTaskID.delete(taskID);
      return meta;
    }
    
    #addSuspendedTaskMeta(meta) {
      if (!meta) { throw new Error('missing task meta'); }
      const taskID = meta.taskID;
      this.#suspendedTasksByTaskID.set(taskID, meta);
      this.#suspendedTaskIDs.push(taskID);
      if (this.#suspendedTasksByTaskID.size < this.#suspendedTaskIDs.length - 10) {
        this.#suspendedTaskIDs = this.#suspendedTaskIDs.filter(t => t !== null);
      }
    }
    
    // TODO(threads): readyFn is normally on the thread
    suspendTask(args) {
      const { task, readyFn, cancellable, onResume } = args;
      const taskID = task.id();
      const componentIdx = task.componentIdx();
      _debugLog('[ComponentAsyncState#suspendTask()]', {
        taskID,
        componentIdx: this.#componentIdx,
        taskEntryFnName: task.entryFnName(),
        subtask: task.getParentSubtask(),
      });
      
      if (componentIdx !== this.#componentIdx) {
        throw new Error('assert: task component idx should match async state');
      }
      
      if (this.#getSuspendedTaskMeta(taskID)) {
        throw new Error(`task [${taskID}] already suspended`);
      }
      
      let promise;
      let resume;
      if (onResume) {
        resume = () => onResume(!task.isCancelled());
      } else {
        const resolvers = promiseWithResolvers();
        promise = resolvers.promise;
        resume = () => resolvers.resolve(!task.isCancelled());
      }
      this.#addSuspendedTaskMeta({
        task,
        taskID,
        cancellable,
        readyFn,
        resume: () => {
          _debugLog('[ComponentAsyncState] resuming suspended task', {
            taskID,
            componentIdx: this.#componentIdx,
          });
          // TODO(threads): it's thread cancellation we should be checking for below, not task
          resume();
        },
      });
      
      // A caller synchronously driving one task quantum (for
      // example, subtask.cancel) waits for the resumed task to
      // either resolve or suspend again.
      task.notifyProgress();
      
      this.runTickLoop();
      _checkForDeadlock();
      
      return promise;
    }
    
    resumeTaskByID(taskID) {
      const meta = this.#removeSuspendedTaskMeta(taskID);
      if (!meta) { return false; }
      if (meta.taskID !== taskID) { throw new Error('task ID does not match'); }
      meta.resume();
      return true;
    }
    
    suspendedTaskReady(taskID) {
      const meta = this.#getSuspendedTaskMeta(taskID);
      if (!meta) { return false; }
      if (!meta.readyFn) {
        throw new Error(`suspended task [${taskID}] is missing a readiness function`);
      }
      return meta.task.isRejected() || meta.readyFn();
    }
    
    suspendedTaskCancellable(taskID) {
      return !!this.#getSuspendedTaskMeta(taskID)?.cancellable;
    }
    
    isTaskSuspended(taskID) {
      return this.#suspendedTasksByTaskID.has(taskID);
    }
    
    suspendedTaskMetas() {
      return this.#suspendedTasksByTaskID.values();
    }
    
    addPendingTaskStart() { this.#pendingTaskStarts++; }
    removePendingTaskStart() { this.#pendingTaskStarts--; }
    
    hasPendingSchedulerWork() {
      if (this.#pendingTaskStarts > 0) { return true; }
      if (this.#lockHandoffScheduled) { return true; }
      for (const meta of this.#suspendedTasksByTaskID.values()) {
        if (meta.task.isRejected() || meta.readyFn()) { return true; }
      }
      return false;
    }
    
    async runTickLoop() {
      if (this.#tickLoop !== null) { return; }
      this.#tickLoop = 1;
      setTimeout(async () => {
        let result = this.tick();
        while (result !== ComponentAsyncState.TickResult.DONE) {
          if (result === ComponentAsyncState.TickResult.IDLE) {
            _checkForDeadlock();
          }
          // After resuming a task, re-tick as soon as the resumed
          // slice's microtask continuations have drained (timeout 0)
          // so queued sibling resumptions aren't charged the idle
          // polling interval; otherwise poll at the idle cadence.
          const delay = result === ComponentAsyncState.TickResult.RESUMED ? 0 : 10;
          await new Promise((resolve) => setTimeout(resolve, delay));
          result = this.tick();
        }
        this.#tickLoop = null;
      }, 10);
    }
    
    tick() {
      // _debugLog('[ComponentAsyncState#tick()]', { suspendedTaskIDs: this.#suspendedTaskIDs });
      
      const resumableTasks = this.#suspendedTaskIDs.filter(t => t !== null);
      for (const taskID of resumableTasks) {
        const meta = this.#suspendedTasksByTaskID.get(taskID);
        if (!meta || !meta.readyFn) {
          throw new Error(`missing/invalid task despite ID [${taskID}] being present`);
        }
        
        // If the task failed via any means, allow the task to resume because
        // it's been cancelled -- the callback should immediately exit as well
        if (meta.task.isRejected()) {
          _debugLog('[ComponentAsyncState#tick()] detected task rejection, leaving early', { meta });
          this.resumeTaskByID(taskID);
          return ComponentAsyncState.TickResult.RESUMED;
        }
        
        const isReady = meta.readyFn();
        if (!isReady) { continue; }
        
        _debugLog('[ComponentAsyncState#tick()] resuming task via tick', {
          taskID,
          componentIdx: this.#componentIdx,
        });
        this.resumeTaskByID(taskID);
        
        // NOTE: during single-flight resumption, we should resume at most one task per
        // tick so that the resumed slice (a microtask continuation)
        // runs -- and its current-task register window opens and
        // closes -- before any sibling task of this component is
        // resumed.
        //
        // Resuming multiple suspended tasks in one synchronous
        // cascade interleaves their register save/restore windows
        // ([restoreA, restoreB, resumeA, resumeB]), re-entering wasm
        // with the register naming the wrong task, and the
        // 'known residual' of the JSPI current-task register
        // fix); with concurrent task lifetimes per component this
        // corrupts guest context-local storage.
        return ComponentAsyncState.TickResult.RESUMED;
      }
      
      const idle = this.#suspendedTaskIDs.filter(t => t !== null).length > 0;
      return idle
      ? ComponentAsyncState.TickResult.IDLE
      : ComponentAsyncState.TickResult.DONE;
    }
    
    createWaitable(args) {
      return new Waitable({ target: args?.target, });
    }
  }
  
  function getOrCreateAsyncState(componentIdx, init) {
    if (!ASYNC_STATE.has(componentIdx)) {
      const newState = new ComponentAsyncState({ componentIdx });
      ASYNC_STATE.set(componentIdx, newState);
    }
    return ASYNC_STATE.get(componentIdx);
  }
  const GLOBAL_COMPONENT_MEMORY_MAP = new Map();
  
  function lookupMemoriesForComponent(args) {
    const { componentIdx } = args ?? {};
    if (args.componentIdx === undefined) { throw new TypeError("missing component idx"); }
    
    const metas = GLOBAL_COMPONENT_MEMORY_MAP.get(componentIdx);
    if (!metas) { return []; }
    
    if (args.memoryIdx === undefined) {
      return Object.values(metas);
    }
    
    const meta = metas[args.memoryIdx];
    return meta?.memory;
  }
  
  class AsyncSubtask {
    static _ID = 0n;
    
    static State = {
      STARTING: 0,
      STARTED: 1,
      RETURNED: 2,
      CANCELLED_BEFORE_STARTED: 3,
      CANCELLED_BEFORE_RETURNED: 4,
    };
    
    #id;
    #state = AsyncSubtask.State.STARTING;
    #componentIdx;
    
    #parentTask;
    #childTask = null;
    
    #dropped = false;
    #cancelRequested = false;
    
    #memoryIdx = null;
    #lenders = null;
    
    #waitable = null;
    
    #callbackFn = null;
    #callbackFnName = null;
    
    #postReturnFn = null;
    #onProgressFn = null;
    #pendingEventFn = null;
    
    #callMetadata = {};
    
    #resolved = false;
    
    #onResolveHandlers = [];
    #onStartHandlers = [];
    
    #result = null;
    #resultSet = false;
    
    fnName;
    target;
    isAsync;
    isManualAsync;
    // One execution slice awaited by the conditional cancel trampoline.
    cancelProgress = null;
    
    constructor(args) {
      if (typeof args.componentIdx !== 'number') {
        throw new Error('invalid componentIdx for subtask creation');
      }
      this.#componentIdx = args.componentIdx;
      
      this.#id = ++AsyncSubtask._ID;
      this.fnName = args.fnName;
      
      if (!args.parentTask) { throw new Error('missing parent task during subtask creation'); }
      this.#parentTask = args.parentTask;
      
      if (args.childTask) { this.#childTask = args.childTask; }
      
      if (args.memoryIdx) { this.#memoryIdx = args.memoryIdx; }
      
      if (!args.waitable) { throw new Error("missing/invalid waitable"); }
      this.#waitable = args.waitable;
      
      if (args.callMetadata) { this.#callMetadata = args.callMetadata; }
      
      this.#lenders = [];
      this.target = args.target;
      this.isAsync = args.isAsync;
      this.isManualAsync = args.isManualAsync;
    }
    
    id() { return this.#id; }
    parentTaskID() { return this.#parentTask?.id(); }
    childTaskID() { return this.#childTask?.id(); }
    state() { return this.#state; }
    
    waitable() { return this.#waitable; }
    waitableRep() { return this.#waitable.idx(); }
    
    join() { return this.#waitable.join(...arguments); }
    getPendingEvent() { return this.#waitable.getPendingEvent(...arguments); }
    hasPendingEvent() { return this.#waitable.hasPendingEvent(...arguments); }
    setPendingEvent() { return this.#waitable.setPendingEvent(...arguments); }
    
    setTarget(tgt) { this.target = tgt; }
    
    getResult() {
      if (!this.#resultSet) { throw new Error("subtask result has not been set") }
      return this.#result;
    }
    setResult(v) {
      if (this.#resultSet) { throw new Error("subtask result has already been set"); }
      this.#result = v;
      this.#resultSet = true;
    }
    
    componentIdx() { return this.#componentIdx; }
    
    setChildTask(t) {
      if (!t) { throw new Error('cannot set missing/invalid child task on subtask'); }
      if (this.#childTask) { throw new Error('child task is already set on subtask'); }
      if (this.#parentTask === t) { throw new Error("parent cannot be child"); }
      this.#childTask = t;
    }
    getChildTask(t) { return this.#childTask; }
    
    getParentTask() { return this.#parentTask; }
    
    setCallbackFn(f, name) {
      if (!f) { return; }
      if (this.#callbackFn) { throw new Error('callback fn can only be set once'); }
      this.#callbackFn = f;
      this.#callbackFnName = name;
    }
    
    getCallbackFnName() {
      if (!this.#callbackFn) { return undefined; }
      return this.#callbackFn.name;
    }
    
    setPostReturnFn(f) {
      if (!f) { return; }
      if (this.#postReturnFn) { throw new Error('postReturn fn can only be set once'); }
      this.#postReturnFn = f;
    }
    
    setOnProgressFn(f) {
      if (this.#onProgressFn) { throw new Error('on progress fn can only be set once'); }
      this.#onProgressFn = f;
    }
    
    isNotStarted() {
      return this.#state == AsyncSubtask.State.STARTING;
    }
    
    cancellationRequested() { return this.#cancelRequested; }
    
    // Request cooperative cancellation of this subtask, on behalf of the
    // supertask (i.e. `canon subtask.cancel`).
    //
    // If the callee is another guest task, the request is delivered to it and
    // the callee confirms via `task.cancel` (or still resolves via `task.return`).
    //
    // If the callee is a host function there is (currently) no host-side
    // cancellation hook, so the pending call is treated as immediately
    // cancelled -- consistent with hosts being expected to resolve
    // cancellation promptly -- and any later host resolution is discarded
    // (see `AsyncTask#onResolve`).
    requestCancellation() {
      _debugLog('[AsyncSubtask#requestCancellation()] args', {
        componentIdx: this.#componentIdx,
        subtaskID: this.#id,
        state: this.#state,
        childTaskID: this.childTaskID(),
        fnName: this.fnName,
      });
      if (this.#cancelRequested) {
        throw new Error('cancellation has already been requested for this subtask');
      }
      this.#cancelRequested = true;
      
      if (this.#resolved) { return; }
      
      if (this.#childTask) {
        this.#childTask.requestCancellation();
        return;
      }
      
      this.onResolve(null);
    }
    
    registerOnStartHandler(f) {
      this.#onStartHandlers.push(f);
    }
    
    onStart(args) {
      _debugLog('[AsyncSubtask#onStart()] args', {
        componentIdx: this.#componentIdx,
        subtaskID: this.#id,
        parentTaskID: this.parentTaskID(),
        fnName: this.fnName,
        args,
      });
      
      if (this.#onProgressFn) { this.#onProgressFn(); }
      
      // Starting a nested operation is a task execution boundary.
      // In particular, a cancellation handler may synchronously
      // enter an import which then suspends in the host.  Wake a
      // supertask that is driving one cancellation slice so an
      // async `subtask.cancel` can report BLOCKED without waiting
      // for that nested operation to finish.
      this.#parentTask.notifyProgress();
      
      this.#state = AsyncSubtask.State.STARTED;
      
      let result;
      
      // If we have been provided a helper start function as a result of
      // component fusion performed by wasmtime tooling, then we can call that helper and lifts/lowers will
      // be performed for us.
      //
      // See also documentation on `HostIntrinsic::PrepareCall`
      //
      if (this.#callMetadata.startFn) {
        result = this.#callMetadata.startFn.apply(null, args?.startFnParams ?? []);
      }
      
      return result;
    }
    
    
    registerOnResolveHandler(f) {
      this.#onResolveHandlers.push(f);
    }
    
    reject(subtaskErr) {
      if (this.#resolved) { return; }
      
      if (this.#onProgressFn) { this.#onProgressFn(); }
      
      if (this.#state === AsyncSubtask.State.STARTING) {
        this.#state = AsyncSubtask.State.CANCELLED_BEFORE_STARTED;
      } else if (this.#state === AsyncSubtask.State.STARTED) {
        this.#state = AsyncSubtask.State.CANCELLED_BEFORE_RETURNED;
      } else {
        throw new Error('cannot reject a completed subtask');
      }
      
      this.#resolved = true;
      this.#parentTask.removeSubtask(this);
      this.#parentTask.reject(subtaskErr);
    }
    
    onResolve(subtaskValue) {
      _debugLog('[AsyncSubtask#onResolve()] args', {
        componentIdx: this.#componentIdx,
        subtaskID: this.#id,
        isAsync: this.isAsync,
        childTaskID: this.childTaskID(),
        parentTaskID: this.parentTaskID(),
        parentTaskFnName: this.#parentTask?.entryFnName(),
        fnName: this.fnName,
      });
      
      if (this.#resolved) {
        throw new Error('subtask has already been resolved');
      }
      
      if (this.#onProgressFn) { this.#onProgressFn(); }
      
      if (subtaskValue === null && this.#cancelRequested) {
        if (this.#state === AsyncSubtask.State.STARTING) {
          this.#state = AsyncSubtask.State.CANCELLED_BEFORE_STARTED;
        } else {
          if (this.#state !== AsyncSubtask.State.STARTED) {
            throw new Error('resolved subtask must have been started before cancellation');
          }
          this.#state = AsyncSubtask.State.CANCELLED_BEFORE_RETURNED;
        }
      } else {
        if (this.#state !== AsyncSubtask.State.STARTED) {
          throw new Error('resolved subtask must have been started before completion');
        }
        this.#state = AsyncSubtask.State.RETURNED;
      }
      
      this.setResult(subtaskValue);
      
      for (const f of this.#onResolveHandlers) {
        try {
          f(subtaskValue);
        } catch (err) {
          console.error("error during subtask resolve handler", err);
          throw err;
        }
      }
      
      const callMetadata = this.getCallMetadata();
      
      // TODO(fix): we should be able to easily have the caller's meomry
      // to lower into here, but it's not present in PrepareCall
      const memory = callMetadata.memory ?? this.#parentTask?.getReturnMemory() ?? lookupMemoriesForComponent({ componentIdx: this.#parentTask?.componentIdx() })[0];
      // NOTE: cancelled resolutions carry no value, so nothing is lowered
      const returned = this.#state === AsyncSubtask.State.RETURNED;
      if (returned && callMetadata && !callMetadata.returnFn && (this.isAsync || callMetadata.funcTypeIsAsync) && callMetadata.resultPtr && memory) {
        const { resultPtr, realloc } = callMetadata;
        const lowers = callMetadata.lowers; // may have been updated in task.return of the child
        if (lowers && lowers.length > 0) {
          lowers[0]({
            componentIdx: this.#componentIdx,
            memory,
            realloc,
            vals: [subtaskValue],
            storagePtr: resultPtr,
            stringEncoding: callMetadata.stringEncoding,
          });
        }
      }
      
      this.#resolved = true;
      this.#parentTask.removeSubtask(this);
      
      if (!this.isAsync) {
        this.deliverResolve();
        const rep = this.waitableRep();
        if (rep) {
          try {
            const removed = this.#getComponentState().handles.remove(rep);
            if (removed !== this) {
              throw new Error("unexpectedly received non-self Subtask from handle removal");
            }
            this.drop();
          } catch (err) {
            _debugLog('[AsyncSubtask#onResolve()] failed to remove subtask after sync subtask completion', err);
          }
        }
      }
    }
    
    getStateNumber() { return this.#state; }
    isReturned() { return this.#state === AsyncSubtask.State.RETURNED; }
    
    getCallMetadata() { return this.#callMetadata; }
    
    isResolved() {
      if (this.#state === AsyncSubtask.State.STARTING
      || this.#state === AsyncSubtask.State.STARTED) {
        return false;
      }
      if (this.#state === AsyncSubtask.State.RETURNED
      || this.#state === AsyncSubtask.State.CANCELLED_BEFORE_STARTED
      || this.#state === AsyncSubtask.State.CANCELLED_BEFORE_RETURNED) {
        return true;
      }
      throw new Error('unrecognized internal Subtask state [' + this.#state + ']');
    }
    
    addLender(handle) {
      _debugLog('[AsyncSubtask#addLender()] args', { handle });
      if (!Number.isNumber(handle)) { throw new Error('missing/invalid lender handle [' + handle + ']'); }
      
      if (this.#lenders.length === 0 || this.isResolved()) {
        throw new Error('subtask has no lendors or has already been resolved');
      }
      
      handle.lends++;
      this.#lenders.push(handle);
    }
    
    deliverResolve() {
      _debugLog('[AsyncSubtask#deliverResolve()] args', {
        lenders: this.#lenders,
        parentTaskID: this.parentTaskID(),
        subtaskID: this.#id,
        childTaskID: this.childTaskID(),
        resolved: this.isResolved(),
        resolveDelivered: this.resolveDelivered(),
      });
      
      const cannotDeliverResolve = this.resolveDelivered() || !this.isResolved();
      if (cannotDeliverResolve) {
        throw new Error('subtask cannot deliver resolution twice, and the subtask must be resolved');
      }
      
      for (const lender of this.#lenders) {
        lender.lends--;
      }
      
      this.#lenders = null;
    }
    
    resolveDelivered() {
      _debugLog('[AsyncSubtask#resolveDelivered()] args', { });
      if (this.#lenders === null && !this.isResolved()) {
        throw new Error('invalid subtask state, lenders missing and subtask has not been resolved');
      }
      return this.#lenders === null;
    }
    
    drop() {
      _debugLog('[AsyncSubtask#drop()] args', {
        componentIdx: this.#componentIdx,
        parentTaskID: this.#parentTask?.id(),
        parentTaskFnName: this.#parentTask?.entryFnName(),
        childTaskID: this.#childTask?.id(),
        childTaskFnName: this.#childTask?.entryFnName(),
        subtaskFnName: this.fnName,
      });
      if (!this.#waitable) { throw new Error('missing/invalid inner waitable'); }
      if (!this.resolveDelivered()) {
        throw new Error('cannot drop a subtask which has not yet resolved');
      }
      if (this.#waitable) { this.#waitable.drop() }
      this.#dropped = true;
    }
    
    #getComponentState() {
      const state = getOrCreateAsyncState(this.#componentIdx);
      if (!state) {
        throw new Error('invalid/missing async state for component [' + componentIdx + ']');
      }
      return state;
    }
    
    getWaitableHandleIdx() {
      _debugLog('[AsyncSubtask#getWaitableHandleIdx()] args', { });
      if (!this.#waitable) { throw new Error('missing/invalid waitable'); }
      return this.waitableRep();
    }
  }
  
  class FutureValue {
    #start;
    #settled;
    #hideThen = 0;
    #thenFn;
    
    constructor(start) {
      if (typeof start !== 'function') {
        throw new TypeError('future start operation must be a function');
      }
      this.#start = start;
      this.#thenFn = this.#then.bind(this);
    }
    
    get then() {
      return this.#hideThen === 0 ? this.#thenFn : undefined;
    }
    
    #read() {
      if (!this.#settled) {
        // The start operation resolves to a non-thenable box so a
        // future-valued payload cannot be assimilated by this Promise.
        this.#settled = Promise.resolve().then(this.#start);
      }
      return this.#settled;
    }
    
    resolveAsValue(resolve) {
      this.#hideThen++;
      try {
        resolve(this);
      } finally {
        this.#hideThen--;
      }
    }
    
    #deliver(resolve, value) {
      if (value instanceof FutureValue) {
        // Promise resolution reads `then` synchronously. Hide it only
        // for that lookup so resolving this layer yields the inner
        // FutureValue instead of recursively awaiting it.
        value.resolveAsValue(resolve);
        return;
      }
      resolve(value);
    }
    
    #then(resolve, reject) {
      return this.#read().then(
      box => this.#deliver(resolve, box.value),
      reject,
      );
    }
  }
  const ASYNC_DETERMINISM = 'random';
  const _coinFlip = () => { return Math.random() > 0.5; };
  
  const ASYNC_EVENT_CODE = {
    NONE: 0,
    SUBTASK: 1,
    STREAM_READ: 2,
    STREAM_WRITE: 3,
    FUTURE_READ: 4,
    FUTURE_WRITE: 5,
    TASK_CANCELLED: 6,
  };
  const CURRENT_TASK_META = {};
  
  function _withGlobalCurrentTaskMeta(args) {
    _debugLog('[_withGlobalCurrentTaskMeta()] args', args);
    if (!args) { throw new TypeError('args missing'); }
    if (args.taskID === undefined) { throw new TypeError('missing task ID'); }
    if (args.componentIdx === undefined) { throw new TypeError('missing component idx'); }
    if (!args.fn) { throw new TypeError('missing fn'); }
    const { taskID, componentIdx, fn } = args;
    const previous = CURRENT_TASK_META[componentIdx] ?? null;
    const previousCurrent = CURRENT_TASK_META.current ?? null;
    
    try {
      CURRENT_TASK_META.current =
      CURRENT_TASK_META[componentIdx] = { taskID, componentIdx };
      return fn();
    } catch (err) {
      _debugLog("error while executing sync callee/callback", {
        ...args,
        err,
      });
      throw err;
    } finally {
      // Synchronous wrappers can nest without any intervening JS
      // scheduling. Restore the caller rather than clearing it so
      // helper core exports (for example fused return adapters) can
      // temporarily run under a different task of the same component.
      CURRENT_TASK_META[componentIdx] = previous;
      CURRENT_TASK_META.current = previousCurrent;
    }
  }
  
  async function _withGlobalCurrentTaskMetaAsync(args) {
    _debugLog('[_withGlobalCurrentTaskMetaAsync()] args', args);
    if (!args) { throw new TypeError('args missing'); }
    if (args.taskID === undefined) { throw new TypeError('missing task ID'); }
    if (args.componentIdx === undefined) { throw new TypeError('missing component idx'); }
    if (!args.fn) { throw new TypeError('missing fn'); }
    
    const { taskID, componentIdx, fn } = args;
    
    try {
      CURRENT_TASK_META.current =
      CURRENT_TASK_META[componentIdx] = { taskID, componentIdx };
      return await fn();
    } catch (err) {
      _debugLog("error while executing async callee/callback", {
        ...args,
        err,
      });
      throw err;
    } finally {
      CURRENT_TASK_META[componentIdx] = null;
      if (CURRENT_TASK_META.current?.taskID === taskID) {
        CURRENT_TASK_META.current = null;
      }
    }
  }
  
  class AsyncTask {
    static _ID = 0n;
    
    static State = {
      INITIAL: 'initial',
      CANCELLED: 'cancelled',
      CANCEL_PENDING: 'cancel-pending',
      CANCEL_DELIVERED: 'cancel-delivered',
      RESOLVED: 'resolved',
    }
    
    static BlockResult = {
      CANCELLED: 'block.cancelled',
      NOT_CANCELLED: 'block.not-cancelled',
    }
    
    #id;
    #componentIdx;
    #state;
    #isAsync;
    #isManualAsync;
    #callingWasmExport = true;
    #lockFreeEntry = false;
    #preserveFutureResult;
    #entryFnName = null;
    
    #onResolveHandlers = [];
    #progressWaiters = [];
    #completionPromise = null;
    #completionValue;
    #completionReady = false;
    #settleCompletionPromise;
    #rejected = false;
    
    #exitPromise = null;
    #onExitHandlers = [];
    
    #memoryIdx = null;
    #memory = null;
    
    #callbackFn = null;
    #callbackFnName = null;
    
    #postReturnFn = null;
    
    #getCalleeParamsFn = null;
    #calleeIsAsync = null;
    
    #stringEncoding = null;
    
    #parentSubtask = null;
    
    #errHandling;
    
    #backpressurePromise;
    #backpressureWaiters = 0n;
    
    #returnLowerFns = null;
    
    #resourceScopeId;
    #resourceBorrowCount = 0;
    #resourceLenders = [];
    #resourceScopeExited = false;
    
    #subtasks = [];
    
    #entered = false;
    #exited = false;
    #errored = null;
    
    cancelled = false;
    cancelRequested = false;
    alwaysTaskReturn = false;
    
    returnCalls =  0;
    storage = [0, 0];
    tmpRetI64HighBits = 0|0;
    
    constructor(opts) {
      this.#id = ++AsyncTask._ID;
      this.#resourceScopeId = ++RESOURCE_SCOPE_ID;
      RESOURCE_SCOPE_TASKS.set(this.#resourceScopeId, this);
      
      if (opts?.componentIdx === undefined) {
        throw new TypeError('missing component id during task creation');
      }
      this.#componentIdx = opts.componentIdx;
      
      this.#state = AsyncTask.State.INITIAL;
      this.#isAsync = opts?.isAsync ?? false;
      this.#isManualAsync = opts?.isManualAsync ?? false;
      this.#preserveFutureResult = opts?.preserveFutureResult ?? false;
      this.#entryFnName = opts.entryFnName;
      // Tasks that execute guest slices (export calls, fused
      // callees) default to true; import-handler tasks pass false
      // explicitly (they run host code nested inside the caller's
      // already-locked slice).
      this.#callingWasmExport = opts?.callingWasmExport !== false;
      
      const {
        promise: completionPromise,
        resolve: resolveCompletionPromise,
        reject: rejectCompletionPromise,
      } = promiseWithResolvers();
      this.#completionPromise = completionPromise;
      // A nested rejection can reach the root task while its Wasm
      // entrypoint is still suspended, before the export wrapper awaits
      // this promise. Mark it handled immediately while preserving the
      // original rejected promise for the eventual caller.
      completionPromise.catch(() => {});
      
      let completionSettled = false;
      const settleCompletionPromise = () => {
        if (completionSettled || !this.#completionReady) { return; }
        completionSettled = true;
        if (this.#errored !== null) {
          rejectCompletionPromise(this.#errored);
        } else if (this.#rejected) {
          rejectCompletionPromise(this.#completionValue);
        } else if (
        this.#preserveFutureResult
        && this.#completionValue instanceof FutureValue
        ) {
          this.#completionValue.resolveAsValue(resolveCompletionPromise);
        } else {
          resolveCompletionPromise(this.#completionValue);
        }
      };
      
      this.#settleCompletionPromise = settleCompletionPromise;
      this.#onResolveHandlers.push((results) => {
        if (this.#parentSubtask !== null) { return; }
        if (!this.#isAsync && !this.#isManualAsync) { return; }
        this.#completionValue = results;
        this.#completionReady = true;
        // Publish after the current guest slice returns, so a trap
        // in that slice can still reject the call. Do not wait for
        // task exit: detached work may require further host calls
        // or consumption of a returned resource's stream.
      });
      
      const {
        promise: exitPromise,
        resolve: resolveExitPromise,
        reject: rejectExitPromise,
      } = promiseWithResolvers();
      this.#exitPromise = exitPromise;
      
      this.#onExitHandlers.push(() => {
        if (this.#parentSubtask === null && (this.#isAsync || this.#isManualAsync)) {
          settleCompletionPromise();
        }
        resolveExitPromise();
      });
      
      if (opts.callbackFn) { this.#callbackFn = opts.callbackFn; }
      if (opts.callbackFnName) { this.#callbackFnName = opts.callbackFnName; }
      
      if (opts.getCalleeParamsFn) { this.#getCalleeParamsFn = opts.getCalleeParamsFn; }
      if (opts.stringEncoding) { this.#stringEncoding = opts.stringEncoding; }
      
      if (opts.parentSubtask) { this.#parentSubtask = opts.parentSubtask; }
      
      
      if (opts.errHandling) { this.#errHandling = opts.errHandling; }
    }
    
    taskState() { return this.#state; }
    id() { return this.#id; }
    componentIdx() { return this.#componentIdx; }
    entryFnName() { return this.#entryFnName; }
    
    resourceScopeId() { return this.#resourceScopeId; }
    
    addBorrowedHandle() {
      if (this.#resourceScopeExited) {
        throw new Error('cannot add a borrow to an exited resource scope');
      }
      this.#resourceBorrowCount++;
    }
    
    removeBorrowedHandle() {
      if (this.#resourceBorrowCount === 0) {
        throw new Error('resource borrow count underflow');
      }
      this.#resourceBorrowCount--;
    }
    
    addResourceLender(table, handle) {
      if (this.#resourceScopeExited) {
        throw new Error('cannot add a lender to an exited resource scope');
      }
      this.#resourceLenders.push({ table, handle });
    }
    
    validateResourceBorrowScope() {
      if (this.#resourceScopeExited) { return; }
      if (this.#resourceBorrowCount !== 0) {
        throw new WebAssemblyRuntimeError('borrow handles still remain at the end of the call');
      }
      for (const { table, handle } of this.#resourceLenders) {
        const idx = handle << 1;
        const lendCount = table[idx];
        if (!Number.isInteger(lendCount) || lendCount <= 0 || lendCount >= 2**30) {
          throw new Error('invalid resource lender state at scope exit');
        }
        table[idx] = lendCount - 1;
      }
      this.#resourceLenders = [];
      this.#resourceScopeExited = true;
      RESOURCE_SCOPE_TASKS.delete(this.#resourceScopeId);
    }
    
    completionPromise() { return this.#completionPromise; }
    settleCompletion() { this.#settleCompletionPromise(); }
    exitPromise() { return this.#exitPromise; }
    
    waitForProgress() {
      const { promise, resolve } = promiseWithResolvers();
      this.#progressWaiters.push(resolve);
      return promise;
    }
    
    notifyProgress() {
      const waiters = this.#progressWaiters;
      this.#progressWaiters = [];
      for (const resolve of waiters) { resolve(); }
    }
    
    isAsync() { return this.#isAsync; }
    isManualAsync() { return this.#isManualAsync; }
    isSync() { return !this.isAsync(); }
    
    getErrHandling() { return this.#errHandling; }
    
    hasCallback() { return this.#callbackFn !== null; }
    
    getReturnMemoryIdx() { return this.#memoryIdx; }
    setReturnMemoryIdx(idx) {
      if (idx === null) { return; }
      this.#memoryIdx = idx;
    }
    
    getReturnMemory() { return this.#memory; }
    setReturnMemory(m) {
      if (m === null) { return; }
      this.#memory = m;
    }
    
    setReturnLowerFns(fns) { this.#returnLowerFns = fns; }
    getReturnLowerFns() { return this.#returnLowerFns; }
    
    setCalleeIsAsync(value) {
      if (typeof value !== 'boolean') { throw new TypeError('callee async state must be a boolean'); }
      this.#calleeIsAsync = value;
    }
    
    setParentSubtask(subtask) {
      if (!subtask || !(subtask instanceof AsyncSubtask)) { return }
      if (this.#parentSubtask) { throw new Error('parent subtask can only be set once'); }
      this.#parentSubtask = subtask;
    }
    
    getParentSubtask() { return this.#parentSubtask; }
    
    // TODO(threads): this is very inefficient, we can pass along a root task,
    // and ideally do not need this once thread support is in place
    getRootTask() {
      let currentSubtask = this.getParentSubtask();
      let task = this;
      while (currentSubtask) {
        task = currentSubtask.getParentTask();
        currentSubtask = task.getParentSubtask();
      }
      return task;
    }
    
    setPostReturnFn(f) {
      if (!f) { return; }
      if (this.#postReturnFn) { throw new Error('postReturn fn can only be set once'); }
      this.#postReturnFn = f;
    }
    
    setCallbackFn(f, name) {
      if (!f) { return; }
      if (this.#callbackFn) { throw new Error('callback fn can only be set once'); }
      this.#callbackFn = f;
      this.#callbackFnName = name;
    }
    
    getCallbackFnName() {
      if (!this.#callbackFnName) { return undefined; }
      return this.#callbackFnName;
    }
    
    runCallbackFn(...args) {
      if (!this.#callbackFn) { throw new Error('no callback function has been set for task'); }
      if (this.#callbackFn._jcoMaySuspend === false) {
        return _withGlobalCurrentTaskMeta({
          taskID: this.#id,
          componentIdx: this.#componentIdx,
          fn: () => this.#callbackFn.apply(null, args),
        });
      }
      return _withGlobalCurrentTaskMetaAsync({
        taskID: this.#id,
        componentIdx: this.#componentIdx,
        fn: () => { return this.#callbackFn.apply(null, args); }
      });
    }
    
    getCalleeParams() {
      if (!this.#getCalleeParamsFn) { throw new Error('missing/invalid getCalleeParamsFn'); }
      return this.#getCalleeParamsFn();
    }
    
    // Legacy manually-async exports are sync-typed in the component
    // but use JSPI precisely so their guest stack may suspend.
    mayBlock() { return this.isAsync() || this.isManualAsync() || this.isResolvedState() }
    
    mayEnter(task) {
      const cstate = getOrCreateAsyncState(this.#componentIdx);
      if (cstate.hasBackpressure()) {
        _debugLog('[AsyncTask#mayEnter()] disallowed due to backpressure', { taskID: this.#id });
        return false;
      }
      if (!cstate.callingSyncImport()) {
        _debugLog('[AsyncTask#mayEnter()] disallowed due to sync import call', { taskID: this.#id });
        return false;
      }
      const callingSyncExportWithSyncPending = cstate.callingSyncExport && !task.isAsync;
      if (!callingSyncExportWithSyncPending) {
        _debugLog('[AsyncTask#mayEnter()] disallowed due to sync export w/ sync pending', { taskID: this.#id });
        return false;
      }
      return true;
    }
    
    enterSync() {
      if (this.needsExclusiveLock()) {
        const cstate = getOrCreateAsyncState(this.#componentIdx);
        if (!cstate.isExclusivelyLocked()) {
          cstate.exclusiveLock(this.#id);
        } else {
          // A host-called sync export arriving while another
          // task's slice holds the lock: synchronous entry
          // cannot wait, and historically this entry silently
          // stole the hold. Run without the lock instead --
          // the holder's bookkeeping stays intact and its
          // release still pairs
          this.#lockFreeEntry = true;
          _debugLog('[AsyncTask#enterSync()] entering without exclusive lock', {
            taskID: this.#id,
            componentIdx: this.#componentIdx,
          });
        }
      }
      return true;
    }
    
    tryEnter() {
      if (this.#entered) {
        throw new Error(`task with ID [${this.#id}] should not be entered twice`);
      }
      
      if (this.deliverPendingCancel({ cancellable: true })) {
        this.cancel();
        return false;
      }
      
      const cstate = getOrCreateAsyncState(this.#componentIdx);
      if (this.isSync()) {
        this.#entered = true;
        return true;
      }
      if (cstate.hasBackpressure()) { return null; }
      if (this.needsExclusiveLock()) {
        if (cstate.isExclusivelyLocked()) { return null; }
        cstate.exclusiveLock(this.#id);
      }
      
      if (this.deliverPendingCancel({ cancellable: true })) {
        cstate.exclusiveRelease(this.#id);
        this.cancel();
        return false;
      }
      
      this.#entered = true;
      return true;
    }
    
    async enter(opts) {
      _debugLog('[AsyncTask#enter()] args', {
        taskID: this.#id,
        componentIdx: this.#componentIdx,
        subtaskID: this.getParentSubtask()?.id(),
        args: opts,
        entryFnName: this.#entryFnName,
      });
      
      if (this.#entered) {
        throw new Error(`task with ID [${this.#id}] should not be entered twice`);
      }
      
      // If cancellation was requested before the task was entered, resolve
      // as cancelled without ever running guest code
      if (this.deliverPendingCancel({ cancellable: true })) {
        this.cancel();
        return false;
      }
      
      const cstate = getOrCreateAsyncState(this.#componentIdx);
      
      if (opts?.isHost) {
        this.#entered = true;
        // A guest task may be synchronously blocked in this
        // host entry. Propagate that boundary so an async
        // cancellation driver can yield BLOCKED while the host
        // operation is outstanding.
        const parentTask = this.#parentSubtask?.getParentTask();
        if (
        parentTask?.taskState() === AsyncTask.State.CANCEL_DELIVERED
        || (parentTask && !parentTask.hasCallback())
        ) {
          parentTask.notifyProgress();
        }
        return this.#entered;
      }
      
      // NOTE: concurrent task lifetimes within one component instance are
      // permitted by the Component Model: entry is governed by the
      // backpressure and exclusive-lock checks below (the lock is held per
      // execution slice, not for the task's lifetime).
      //
      // Serializing entire task lifetimes here (the former "execution slot" queue)
      // deadlocks pipelines where a parked long-lived task's progress depends on a
      // later entry into the same component.
      
      // If a task is synchronous then we can avoid component-relevant
      // tracking and immediately enter.
      if (this.isSync()) {
        this.#entered = true;
        
        // TODO(breaking): remove once manually-specifying async fns is removed
        // It is currently possible for an actually sync export to be specified
        // as async via JSPI
        if (this.#isManualAsync) {
          if (this.needsExclusiveLock()) { await cstate.acquireExclusiveLock(this.#id); }
        }
        
        return this.#entered;
      }
      
      // Perform intial backpressure check
      if (cstate.hasBackpressure()) {
        cstate.addBackpressureWaiter();
        
        const result = await this.waitUntil({
          readyFn: () => {
            return !cstate.hasBackpressure();
          },
          cancellable: true,
        });
        
        cstate.removeBackpressureWaiter();
        
        if (!result || this.isCancelled()) {
          if (!this.isResolvedState()) { this.cancel(); }
          return false;
        }
      }
      
      // Acquire the per-slice exclusive lock (FIFO-queued when
      // contended); the first slice runs under this hold and the
      // driver loop releases/re-acquires it per slice thereafter.
      if (this.needsExclusiveLock()) {
        await cstate.acquireExclusiveLock(this.#id);
      }
      
      // Cancellation-before-start may resolve this task while its
      // queued lock acquisition is still pending. Acquiring the lock
      // does not make the already-resolved task runnable again.
      if (this.isResolvedState() || this.isCancelled()) {
        cstate.exclusiveRelease(this.#id);
        return false;
      }
      
      // Cancellation can be requested while entry is waiting for
      // backpressure or its exclusive lock. Do not execute the guest
      // after acquiring a lock for a task that should no longer start.
      if (this.deliverPendingCancel({ cancellable: true })) {
        cstate.exclusiveRelease(this.#id);
        this.cancel();
        return false;
      }
      
      this.#entered = true;
      return this.#entered;
    }
    
    isRunningState() { return this.#state !== AsyncTask.State.RESOLVED; }
    isResolvedState() { return this.#state === AsyncTask.State.RESOLVED; }
    isResolved() { return this.#state === AsyncTask.State.RESOLVED; }
    isExited() { return this.#exited; }
    
    async waitUntil(opts) {
      const { readyFn, cancellable } = opts;
      _debugLog('[AsyncTask#waitUntil()] args', { taskID: this.#id, args: { cancellable } });
      
      // TODO(fix): check for cancel
      // TODO(fix): determinism
      // TODO(threads): add this thread to waiting list
      
      const keepGoing = await this.suspendUntil({
        readyFn,
        cancellable,
      });
      
      return keepGoing;
    }
    
    async yieldUntil(opts) {
      const { readyFn, cancellable } = opts;
      _debugLog('[AsyncTask#yieldUntil()]', {
        taskID: this.#id,
        args: {
          cancellable,
        },
        componentIdx: this.#componentIdx,
      });
      
      // A callback YIELD is an explicit request to let other work run.
      // Unlike waits whose condition is already ready, it must always
      // suspend for at least one scheduler turn.
      const keepGoing = await this.immediateSuspend({ readyFn, cancellable });
      if (keepGoing) {
        return {
          code: ASYNC_EVENT_CODE.NONE,
          payload0: 0,
          payload1: 0,
        };
      }
      
      return {
        code: ASYNC_EVENT_CODE.TASK_CANCELLED,
        payload0: 0,
        payload1: 0,
      };
    }
    
    async suspendUntil(opts) {
      const { cancellable, readyFn } = opts;
      _debugLog('[AsyncTask#suspendUntil()] args', {
        taskID: this.#id,
        args: {
          cancellable,
        },
        componentIdx: this.#componentIdx,
      });
      
      const pendingCancelled = this.deliverPendingCancel({ cancellable });
      if (pendingCancelled) { return false; }
      
      const completed = await this.immediateSuspendUntil({ readyFn, cancellable });
      return completed;
    }
    
    suspendUntilCallback(opts, onResume) {
      const { cancellable, readyFn } = opts;
      if (this.deliverPendingCancel({ cancellable })) {
        onResume(false);
        return;
      }
      
      const cstate = getOrCreateAsyncState(this.#componentIdx);
      cstate.suspendTask({
        task: this,
        cancellable,
        readyFn: () => {
          if (cancellable && this.#state === AsyncTask.State.CANCEL_PENDING) {
            return true;
          }
          return readyFn();
        },
        onResume: (keepGoing) => {
          if (keepGoing && this.deliverPendingCancel({ cancellable })) {
            keepGoing = false;
          }
          onResume(keepGoing);
        },
      });
    }
    
    // TODO(threads): equivalent to thread.suspend_until()
    async immediateSuspendUntil(opts) {
      const { cancellable, readyFn } = opts;
      _debugLog('[AsyncTask#immediateSuspendUntil()] args', {
        args: {
          cancellable,
          readyFn,
        },
        taskID: this.#id,
        componentIdx: this.#componentIdx,
      });
      
      const ready = readyFn();
      if (ready && ASYNC_DETERMINISM === 'random') {
        const coinFlip = _coinFlip();
        if (coinFlip) { return true }
      }
      
      const keepGoing = await this.immediateSuspend({ cancellable, readyFn });
      return keepGoing;
    }
    
    async immediateSuspend(opts) { // NOTE: equivalent to thread.suspend()
    // TODO(threads): store readyFn on the thread
    const { cancellable, readyFn } = opts;
    _debugLog('[AsyncTask#immediateSuspend()] args', { cancellable, readyFn });
    
    const pendingCancelled = this.deliverPendingCancel({ cancellable });
    if (pendingCancelled) { return false; }
    
    const cstate = getOrCreateAsyncState(this.#componentIdx);
    const keepGoing = await cstate.suspendTask({
      task: this,
      cancellable,
      readyFn: () => {
        // A pending cancellation request wakes cancellable waits
        if (cancellable && this.#state === AsyncTask.State.CANCEL_PENDING) {
          return true;
        }
        return readyFn();
      },
    });
    if (keepGoing && this.deliverPendingCancel({ cancellable })) { return false; }
    return keepGoing;
  }
  
  deliverPendingCancel(opts) {
    const { cancellable } = opts;
    _debugLog('[AsyncTask#deliverPendingCancel()]', {
      args: { cancellable },
      taskID: this.#id,
      componentIdx: this.#componentIdx,
    });
    
    if (cancellable && this.#state === AsyncTask.State.CANCEL_PENDING) {
      this.#state = AsyncTask.State.CANCEL_DELIVERED;
      return true;
    }
    
    return false;
  }
  
  isCancelled() { return this.cancelled }
  cancellationRequested() { return this.cancelRequested; }
  
  // Request cooperative cancellation of this task, called on behalf of a
  // supertask performing `subtask.cancel` on the subtask this task backs.
  //
  // The request is delivered at this task's next cancellable wait
  // (see suspendUntil/immediateSuspend), at which point the task is
  // expected to acknowledge via `task.cancel` or still resolve via
  // `task.return`.
  requestCancellation() {
    _debugLog('[AsyncTask#requestCancellation()] args', {
      taskID: this.#id,
      componentIdx: this.#componentIdx,
      state: this.#state,
    });
    if (this.isResolvedState() || this.cancelRequested) { return; }
    this.cancelRequested = true;
    if (this.#state === AsyncTask.State.INITIAL) {
      this.#state = AsyncTask.State.CANCEL_PENDING;
    }
    // Nudge the component's tick loop so that any suspended cancellable
    // wait observes the pending cancellation promptly
    getOrCreateAsyncState(this.#componentIdx).runTickLoop();
  }
  
  cancel(args) {
    _debugLog('[AsyncTask#cancel()] args', { });
    if (this.taskState() !== AsyncTask.State.CANCEL_DELIVERED) {
      throw new Error(`(component [${this.#componentIdx}]) task [${this.#id}] invalid task state [${this.taskState()}] for cancellation`);
    }
    this.validateResourceBorrowScope();
    this.cancelled = true;
    // Cancelled tasks resolve with no value (spec: `Task.cancel` calls
    // `on_resolve(None)`); an explicit error is only present on the
    // host-driven rejection path (see `reject()`).
    this.onResolve(args?.error ?? null);
    this.#state = AsyncTask.State.RESOLVED;
    // A task cancelled before entry has no driver loop that can
    // report its exit. Entered tasks notify after releasing their
    // component slice in `exit()`.
    if (!this.#entered) { this.notifyProgress(); }
  }
  
  onResolve(taskValue) {
    const handlers = this.#onResolveHandlers;
    this.#onResolveHandlers = [];
    for (const f of handlers) {
      try {
        f(taskValue);
      } catch (err) {
        _debugLog("[AsyncTask#onResolve] error during task resolve handler", err);
        throw err;
      }
    }
    
    // Rejections are control-flow failures, not canonical ABI results.
    // Propagate them through the subtask chain without running return
    // lowering or post-return hooks for a successful result.
    if (this.#rejected) {
      this.#parentSubtask?.reject(taskValue);
      return;
    }
    
    // NOTE: if the parent subtask has already been resolved (e.g. it was
    // cancelled via `subtask.cancel` while this task was still pending),
    // this task's resolution must be discarded rather than delivered.
    const parentSubtaskPending = this.#parentSubtask && !this.#parentSubtask.isResolved();
    const taskReturned = !this.isCancelled();
    
    if (parentSubtaskPending && taskReturned) {
      const meta = this.#parentSubtask.getCallMetadata();
      // Run the rturn fn if it has not already been called -- this *should* have happened in
      // `task.return`, but some paths do not go through task.return (e.g. async lower of sync fn
      // which goes through prepare + async-start-call)
      if (meta.returnFn && !meta.returnFnCalled) {
        _debugLog('[AsyncTask#onResolve()] running returnFn', {
          componentIdx: this.#componentIdx,
          taskID: this.#id,
          subtaskID: this.#parentSubtask.id(),
        });
        const callerTask = this.#parentSubtask.getParentTask();
        _withGlobalCurrentTaskMeta({
          taskID: callerTask.id(),
          componentIdx: callerTask.componentIdx(),
          fn: () => meta.returnFn.apply(null, [taskValue, meta.resultPtr]),
        });
        meta.returnFnCalled = true;
      }
    }
    
    if (this.#postReturnFn && taskReturned) {
      _debugLog('[AsyncTask#onResolve()] running post return ', {
        componentIdx: this.#componentIdx,
        taskID: this.#id,
      });
      try {
        _withGlobalCurrentTaskMeta({
          taskID: this.#id,
          componentIdx: this.#componentIdx,
          fn: () => this.#postReturnFn(taskValue),
        });
      } catch (err) {
        _debugLog("[AsyncTask#onResolve] error during task resolve handler", err);
        throw err;
      }
    }
    
    if (parentSubtaskPending) {
      this.#parentSubtask.onResolve(taskValue);
    }
  }
  
  registerOnResolveHandler(f) {
    this.#onResolveHandlers.push(f);
  }
  
  isRejected() { return this.#rejected; }
  
  isErrored() { return this.#errored; }
  setErrored(err) {
    // Preserve the originating trap when unwinding through
    // additional guest frames produces secondary traps (often
    // an `unreachable` after a call which was expected to trap).
    if (this.#errored === null) { this.#errored = err; }
  }
  
  reject(taskErr) {
    _debugLog('[AsyncTask#reject()] args', {
      componentIdx: this.#componentIdx,
      taskID: this.#id,
      parentSubtask: this.#parentSubtask,
      parentSubtaskID: this.#parentSubtask?.id(),
      entryFnName: this.entryFnName(),
      callbackFnName: this.#callbackFnName,
      errMsg: taskErr.message,
    });
    
    this.setErrored(taskErr);
    if (this.#rejected) { return; }
    
    // A task may call `task.return` before its callback exits.
    // A trap in cleanup or spawned work must still reject the
    // host call and poison the enclosing task chain.
    if (this.isResolvedState()) {
      this.#rejected = true;
      this.#errored = taskErr;
      const parentTask = this.#parentSubtask?.getParentTask();
      if (parentTask) { parentTask.reject(taskErr); }
      return;
    }
    
    this.#rejected = true;
    this.cancelRequested = true;
    this.#state = AsyncTask.State.CANCEL_PENDING;
    const cancelled = this.deliverPendingCancel({ cancellable: true });
    
    // TODO: do cleanup here to reset the machinery so we can run again?
    
    this.cancel({ error: taskErr });
  }
  
  resolve(results) {
    _debugLog('[AsyncTask#resolve()] args', {
      componentIdx: this.#componentIdx,
      taskID: this.#id,
      entryFnName: this.entryFnName(),
      callbackFnName: this.#callbackFnName,
    });
    
    if (this.#state === AsyncTask.State.RESOLVED) {
      throw new Error(`(component [${this.#componentIdx}]) task [${this.#id}]  is already resolved (did you forget to wait for an import?)`);
    }
    
    this.validateResourceBorrowScope();
    
    this.#state = AsyncTask.State.RESOLVED;
    
    switch (results.length) {
      case 0:
      this.onResolve(undefined);
      break;
      case 1:
      this.onResolve(results[0]);
      break;
      default:
      _debugLog('[AsyncTask#resolve()] unexpected number of results', {
        componentIdx: this.#componentIdx,
        results,
        taskID: this.#id,
        subtaskID: this.#parentSubtask?.id(),
        entryFnName: this.#entryFnName,
        callbackFnName: this.#callbackFnName,
      });
      throw new Error('unexpected number of results');
    }
  }
  
  exit(args) {
    _debugLog('[AsyncTask#exit()]', {
      componentIdx: this.#componentIdx,
      taskID: this.#id,
    });
    
    if (this.#exited)  { throw new Error("task has already exited"); }
    
    if (this.#state !== AsyncTask.State.RESOLVED) {
      throw new Error(`(component [${this.#componentIdx}]) task [${this.#id}] exited without resolution`);
    }
    
    this.validateResourceBorrowScope();
    
    const state = getOrCreateAsyncState(this.#componentIdx);
    if (!state) { throw new Error('missing async state for component [' + this.#componentIdx + ']'); }
    
    // Exempt the host from exclusive lock check
    if (this.#componentIdx !== -1 && !args?.skipExclusiveLockCheck && !this.#lockFreeEntry) {
      if (this.needsExclusiveLock() && !state.exclusivelyLockedBy(this.#id)) {
        throw new Error(`task [${this.#id}] exit: component [${this.#componentIdx}] should have been exclusively locked by it`);
      }
    }
    
    // Ownership-checked: releases only this task's own hold (a
    // task exiting while another task's slice holds the lock no
    // longer clears the foreign hold).
    state.exclusiveRelease(this.#id);
    this.notifyProgress();
    
    for (const f of this.#onExitHandlers) {
      try {
        f();
      } catch (err) {
        console.error("error during task exit handler", err);
        throw err;
      }
    }
    
    this.#exited = true;
    clearCurrentTask(this.#componentIdx, this.id());
  }
  
  needsExclusiveLock() {
    // Host (-1) tasks model host-side import handling: there is no
    // guest linear memory or executor state to protect, and host
    // calls from unrelated guest components would contend spuriously.
    if (this.#componentIdx === -1) { return false; }
    // Import-handler tasks (CallInterface) run host code nested
    // inside the calling guest slice, which already holds the
    // lock; only tasks that execute guest slices need it.
    if (!this.#callingWasmExport) { return false; }
    // A sync-lifted callee cannot be reentered until the whole
    // stackful call returns. This is the Component Model's
    // automatic-backpressure rule for async-lowered calls.
    return !this.#isAsync || this.hasCallback() || this.#calleeIsAsync === false;
  }
  
  createSubtask(args) {
    _debugLog('[AsyncTask#createSubtask()] args', args);
    const { componentIdx, childTask, callMetadata, fnName, isAsync, isManualAsync } = args;
    
    const cstate = getOrCreateAsyncState(this.#componentIdx);
    if (!cstate) {
      throw new Error(`invalid/missing async state for component idx [${componentIdx}]`);
    }
    
    const waitable = new Waitable({
      componentIdx: this.#componentIdx,
      target: `subtask (internal ID [${this.#id}])`,
    });
    
    const newSubtask = new AsyncSubtask({
      componentIdx,
      childTask,
      parentTask: this,
      callMetadata,
      isAsync,
      isManualAsync,
      fnName,
      waitable,
    });
    this.#subtasks.push(newSubtask);
    newSubtask.setTarget(`subtask (internal ID [${newSubtask.id()}], waitable [${waitable.idx()}], component [${componentIdx}])`);
    waitable.setIdx(cstate.handles.insert(newSubtask));
    waitable.setTarget(`waitable for subtask (waitable id [${waitable.idx()}], subtask internal ID [${newSubtask.id()}])`);
    return newSubtask;
  }
  
  getLatestSubtask() {
    return this.#subtasks.at(-1);
  }
  
  getSubtaskByWaitableRep(rep) {
    if (rep === undefined) { throw new TypeError('missing rep'); }
    return this.#subtasks.find(s => s.waitableRep() === rep);
  }
  
  currentSubtask() {
    _debugLog('[AsyncTask#currentSubtask()]');
    if (this.#subtasks.length === 0) { return undefined; }
    return this.#subtasks.at(-1);
  }
  
  removeSubtask(subtask) {
    if (this.#subtasks.length === 0) {
      throw new Error('cannot end current subtask: no current subtask');
    }
    this.#subtasks = this.#subtasks.filter(t => t !== subtask);
    return subtask;
  }
}

function createNewCurrentTask(args) {
  _debugLog('[createNewCurrentTask()] args', args);
  const {
    componentIdx,
    isAsync,
    isManualAsync,
    preserveFutureResult,
    entryFnName,
    parentSubtaskID,
    callbackFnName,
    getCallbackFn,
    getParamsFn,
    stringEncoding,
    errHandling,
    getCalleeParamsFn,
    resultPtr,
    callingWasmExport,
  } = args;
  if (componentIdx === undefined || componentIdx === null) {
    throw new Error('missing/invalid component instance index while starting task');
  }
  let taskMetas = ASYNC_TASKS_BY_COMPONENT_IDX.get(componentIdx);
  const callbackFn = getCallbackFn ? getCallbackFn() : null;
  
  const newTask = new AsyncTask({
    componentIdx,
    isAsync,
    isManualAsync,
    preserveFutureResult,
    entryFnName,
    callbackFn,
    callbackFnName,
    stringEncoding,
    getCalleeParamsFn,
    resultPtr,
    errHandling,
    callingWasmExport,
  });
  
  const newTaskID = newTask.id();
  const newTaskMeta = { id: newTaskID, componentIdx, task: newTask };
  
  // NOTE: do not track host tasks
  ASYNC_CURRENT_TASK_IDS.push(newTaskID);
  ASYNC_CURRENT_COMPONENT_IDXS.push(componentIdx);
  
  if (!taskMetas) {
    taskMetas = [newTaskMeta];
    ASYNC_TASKS_BY_COMPONENT_IDX.set(componentIdx, [newTaskMeta]);
  } else {
    taskMetas.push(newTaskMeta);
  }
  
  return [newTask, newTaskID];
}

function _checkMayLeave(componentIdx) {
  if (INSTANCE_FLAGS.get(componentIdx)?.value !== 1) {
    throw new WebAssemblyRuntimeError('cannot leave component instance');
  }
}

function _getGlobalCurrentTaskMeta(componentIdx) {
  const v = componentIdx === undefined || componentIdx === null
  ? CURRENT_TASK_META.current
  : CURRENT_TASK_META[componentIdx];
  if (v === undefined || v === null) {
    return undefined;
  }
  return { ...v };
}


function _setGlobalCurrentTaskMeta(args) {
  if (!args) { throw new TypeError('args missing'); }
  if (args.taskID === undefined) { throw new TypeError('missing task ID'); }
  if (args.componentIdx === undefined) { throw new TypeError('missing component idx'); }
  const { taskID, componentIdx } = args;
  return CURRENT_TASK_META.current =
  CURRENT_TASK_META[componentIdx] = { taskID, componentIdx };
}


async function _clearCurrentTask(args) {
  _debugLog('[_clearCurrentTask()] args', args);
  if (!args) { throw new TypeError('args missing'); }
  if (args.taskID === undefined) { throw new TypeError('missing task ID'); }
  if (args.componentIdx === undefined) { throw new TypeError('missing component idx'); }
  const { taskID, componentIdx } = args;
  
  const meta = CURRENT_TASK_META[componentIdx];
  if (!meta) { throw new Error(`missing current task meta for component idx [${componentIdx}]`); }
  
  if (meta.taskID !== taskID) {
    throw new Error(`task ID [${meta.taskID}] != requested ID [${taskID}]`);
  }
  if (meta.componentIdx !== componentIdx) {
    throw new Error(`component idx [${meta.componentIdx}] != requested idx [${componentIdx}]`);
  }
  
  CURRENT_TASK_META[componentIdx] = null;
  if (CURRENT_TASK_META.current?.taskID === taskID) {
    CURRENT_TASK_META.current = null;
  }
}

function _lowerImportBackwardsCompat(args) {
  const params = [...arguments].slice(1);
  _debugLog('[_lowerImportBackwardsCompat()] args', { args, params });
  const {
    functionIdx,
    componentIdx,
    isAsync,
    isManualAsync,
    paramLiftFns,
    resultLowerFns,
    hasResultPointer,
    funcTypeIsAsync,
    metadata,
    memoryIdx,
    getMemoryFn,
    getReallocFn,
    importFn,
    stringEncoding,
  } = args;
  
  _checkMayLeave(componentIdx);
  
  let meta = _getGlobalCurrentTaskMeta(componentIdx);
  let createdTask;
  
  // Some components depend on initialization logic (i.e. `_initialize` or some such
  // core wasm export) that is embedded in the component, but is not executed or wizer'd
  // away before the transpiled component is attempted to be used.
  //
  // These components execut their initialization logic *when they are imported* in the
  // transpiled context -- so we may get a call to an export that is lowered without going
  // through `CallWasm` or `CallInterface`.
  //
  if (!meta) {
    if (funcTypeIsAsync || (isAsync && !isManualAsync)) {
      throw new Error('p3 async wasm exports cannot use backwards compat auto-task init');
    }
    
    const [newTask, newTaskID] = createNewCurrentTask({
      componentIdx,
      isAsync,
      isManualAsync,
      callingWasmExport: false,
    });
    createdTask = newTask;
    
    // Since we're managing the task creation ourselves we must clear ourselves
    createdTask.registerOnResolveHandler(() => {
      _clearCurrentTask({
        taskID: task.id(),
        componentIdx: task.componentIdx(),
      });
    });
    
    _setGlobalCurrentTaskMeta({
      componentIdx,
      taskID: newTaskID,
    });
    
    meta = _getGlobalCurrentTaskMeta(componentIdx);
  }
  
  const { taskID } = meta;
  
  const taskMeta = getCurrentTask(componentIdx, taskID);
  if (!taskMeta) {
    throw new Error('invalid/missing async task meta');
  }
  
  const task = taskMeta.task;
  if (!task) { throw new Error('invalid/missing async task'); }
  
  const cstate = getOrCreateAsyncState(componentIdx);
  
  if (!task.mayBlock() && funcTypeIsAsync && !isAsync) {
    throw new Error("non async exports cannot synchronously call async functions");
  }
  
  // If there is an existing task, this should be part of a subtask
  const memory = getMemoryFn();
  // Canonical ABI lower appends result storage as a trailing
  // param when async lower has any flat result, or sync lower
  // has more than one flat result.
  const resultPtr = hasResultPointer ? params[params.length - 1] : undefined;
  const subtask = task.createSubtask({
    componentIdx,
    parentTask: task,
    fnName: importFn.fnName,
    isAsync,
    isManualAsync,
    callMetadata: {
      memoryIdx,
      memory,
      realloc: getReallocFn?.(),
      getReallocFn,
      resultPtr,
      lowers: resultLowerFns,
      funcTypeIsAsync,
      stringEncoding,
    }
  });
  task.setReturnMemoryIdx(memoryIdx);
  task.setReturnMemory(getMemoryFn());
  
  subtask.onStart();
  
  // If dealing with a sync lowered sync function, we can directly return results
  //
  // TODO(breaking): remove once we get rid of manual async import specification,
  // as func types cannot be detected in that case only (and we don't need that w/ p3)
  if (!isManualAsync && !isAsync && !funcTypeIsAsync) {
    if (createdTask) { createdTask.enterSync(); }
    
    const res = importFn(...params);
    
    // TODO(breaking): remove once we get rid of manual async import specification,
    // as func types cannot be detected in that case only (and we don't need that w/ p3)
    if (!funcTypeIsAsync && !subtask.isReturned()) {
      throw new Error('post-execution subtasks must either be async or returned');
    }
    
    const syncRes = subtask.getResult();
    if (createdTask) { createdTask.resolve([syncRes]); }
    
    return syncRes;
  }
  
  // Sync-lowered async functions requires async behavior because the callee *can* block,
  // but this call must *act* synchronously and return immediately with the result
  // (i.e. not returning until the work is done)
  //
  // TODO(breaking): remove checking for manual async specification here, once we can go p3-only
  //
  if (!isManualAsync && !isAsync && funcTypeIsAsync) {
    const { promise, resolve, reject } = promiseWithResolvers();
    queueMicrotask(async () => {
      try {
        await importFn(...params);
        if (!subtask.isResolved()) {
          await task.suspendUntil({ readyFn: () => subtask.isResolved() });
        }
        resolve(subtask.getResult());
      } catch (err) {
        reject(err);
      }
    });
    return promise;
  }
  
  // NOTE: at this point we know that we are working with an async lowered import
  
  const subtaskState = subtask.getStateNumber();
  if (subtaskState < 0 || subtaskState >= 2**4) {
    throw new Error('invalid subtask state, out of valid range');
  }
  
  subtask.setOnProgressFn(() => {
    subtask.setPendingEvent(() => {
      if (subtask.isResolved()) { subtask.deliverResolve(); }
      const event = {
        code: ASYNC_EVENT_CODE.SUBTASK,
        payload0: subtask.waitableRep(),
        payload1: subtask.getStateNumber(),
      }
      return event;
    });
  });
  
  // This is a hack to maintain backwards compatibility with
  // manually-specified async imports, used in wasm exports that are
  // not actually async (but are specified as so).
  //
  // This is not normal p3 sync behavior but instead anticipating that
  // the caller that is doing manual async will be waiting for a promise that
  // resolves to the *actual* result.
  //
  // TODO(breaking): remove once manually specified async is removed
  //
  // There are a few cases:
  // 1. sync function with async types (e.g. `f: func() -> stream<u32>`)
  // 2. async function with async types (e.g. `f: async func() -> stream<u32>`)
  // 3. async function with sync types (e.g. `f: async func() -> list<u32>`)
  // 4. sync function with non-async types (e.g. `f: func() -> list<u32>`)
  //
  // This hack *only* applies to 4 -- the case where an async JS host function
  // is supplied to a Wasm export which does *not* need to do any async abi
  // lifting/lowering (async ABI did not exist when JSPI integratiton was
  // initially merged to enable asynchronously returning values from the host)
  //
  const requiresManualAsyncResult = !isAsync && !funcTypeIsAsync && isManualAsync;
  let manualAsyncResult;
  if (requiresManualAsyncResult) {
    manualAsyncResult = promiseWithResolvers();
  }
  
  queueMicrotask(async () => {
    try {
      _debugLog('[_lowerImportBackwardsCompat()] calling lowered import', { importFn, params });
      if (createdTask) { await createdTask.enter(); }
      
      const asyncRes = await importFn(...params);
      if (requiresManualAsyncResult) {
        manualAsyncResult.resolve(subtask.getResult());
      }
      
      if (createdTask) { createdTask.resolve([asyncRes]); }
      
      
    } catch (err) {
      _debugLog("[_lowerImportBackwardsCompat()] import fn error:", err);
      if (requiresManualAsyncResult) {
        manualAsyncResult.reject(err);
        return;
      }
      task.setErrored(err);
      task.reject(err);
    }
  });
  
  if (requiresManualAsyncResult) { return manualAsyncResult.promise; }
  
  _debugLog('[_lowerImportBackwardsCompat()] async-lowered import return', {
    fnName: importFn.fnName,
    componentIdx,
    subtaskID: subtask.id(),
    waitableRep: subtask.waitableRep(),
    subtaskState,
    packedResult: Number(subtask.waitableRep()) << 4 | subtaskState,
  });
  
  return Number(subtask.waitableRep()) << 4 | subtaskState;
}

const CURRENT_TASK_MAY_BLOCK= globalThis.WebAssembly ? new globalThis.WebAssembly.Global({ value: 'i32', mutable: true }, 0) : false;


function _liftFlatU8(ctx) {
  _debugLog('[_liftFlatU8()] args', { ctx });
  let val;
  
  if (ctx.useDirectParams) {
    if (ctx.params.length === 0) { throw new Error('expected at least a single i32 argument'); }
    val = ctx.params[0];
    ctx.params = ctx.params.slice(1);
    return [val, ctx];
  }
  
  if (ctx.storageLen !== undefined && ctx.storageLen < 1) {
    throw new Error(`insufficient storage ([${ctx.storageLen}] bytes) for lift (u8 requires 1 byte)`);
  }
  
  val = new DataView(ctx.memory.buffer).getUint8(ctx.storagePtr, true);
  
  ctx.storagePtr += 1;
  if (ctx.storageLen !== undefined) { ctx.storageLen -= 1; }
  
  return [val, ctx];
}


function _liftFlatU32(ctx) {
  _debugLog('[_liftFlatU32()] args', { ctx });
  let val;
  
  if (ctx.useDirectParams) {
    if (ctx.params.length === 0) { throw new Error('expected at least a single i34 argument'); }
    // core i32 values arrive as signed numbers
    val = ctx.params[0] >>> 0;
    ctx.params = ctx.params.slice(1);
    return [val, ctx];
  }
  
  if (ctx.storageLen !== undefined && ctx.storageLen < 4) {
    throw new Error(`insufficient storage ([${ctx.storageLen}] bytes) for lift (u32 requires 4 bytes)`);
  }
  val = new DataView(ctx.memory.buffer).getUint32(ctx.storagePtr, true);
  ctx.storagePtr += 4;
  if (ctx.storageLen !== undefined) { ctx.storageLen -= 4; }
  
  return [val, ctx];
}


function _liftFlatList(meta) {
  const { elemLiftFn, elemSize32, elemAlign32, knownLen, typedArray } = meta;
  
  const listValue =
  typedArray === undefined
  ? values => values
  : values => new typedArray(values);
  
  const readValuesAndReset = (ctx, originalPtr, originalLen, dataPtr, len) => {
    if (dataPtr % elemAlign32 !== 0) {
      throw new TypeError(`list pointer [${dataPtr}] is not aligned to ${elemAlign32}`);
    }
    ctx.storagePtr = dataPtr;
    const val = [];
    for (var i = 0; i < len; i++) {
      const elemPtr = dataPtr + i * elemSize32;
      ctx.storagePtr = elemPtr;
      const [res, nextCtx] = elemLiftFn(ctx);
      val.push(res);
      ctx = nextCtx;
      
      ctx.storagePtr = Math.max(ctx.storagePtr, elemPtr + elemSize32);
    }
    if (originalPtr !== null) { ctx.storagePtr = originalPtr; }
    if (originalLen !== null) { ctx.storageLen = originalLen; }
    return [listValue(val), ctx];
  };
  
  return function _liftFlatListInner(ctx) {
    _debugLog('[_liftFlatList()] args', { ctx });
    
    let liftResults;
    if (knownLen !== undefined) { // list with known length
    if (ctx.useDirectParams) {
      _debugLog('memory unexpectedly missing while lifting unknown length list', { ctx });
      liftResults = [listValue(ctx.params.slice(0, knownLen)), ctx];
      ctx.params = ctx.params.slice(knownLen);
    } else { // indirect params
    if (ctx.memory === null) {
      _debugLog('memory unexpectedly missing while lifting known length list', { knownLen, ctx });
      throw new Error(`memory missing while lifting known length (${knownLen}) list`);
    }
    
    const originalLen = ctx.storageLen;
    const originalPtr = ctx.storagePtr;
    
    ctx.storageLen = knownLen * elemSize32;
    liftResults = readValuesAndReset(ctx, null, originalLen, ctx.storagePtr, knownLen);
  }
  
} else { // unknown length list

if (ctx.useDirectParams) {
  // unknown length list ptr w/ direct params
  const dataPtr = ctx.params[0];
  const len = ctx.params[1];
  ctx.params = ctx.params.slice(2);
  
  ctx.useDirectParams = false;
  const originalPtr = ctx.storagePtr;
  const originalLen = ctx.storageLen;
  ctx.storageLen = len * elemSize32;
  
  liftResults = readValuesAndReset(ctx, originalPtr, originalLen, dataPtr, len);
  
  ctx.useDirectParams = true;
} else {
  // unknown length list ptr w/ in-memory params
  const originalLen = ctx.storageLen;
  ctx.storageLen = 8;
  
  const dataPtrLiftRes = _liftFlatU32(ctx);
  const dataPtr = dataPtrLiftRes[0];
  ctx = dataPtrLiftRes[1];
  
  const lenLiftRes = _liftFlatU32(ctx);
  const len = lenLiftRes[0];
  ctx = lenLiftRes[1];
  
  const originalPtr = ctx.storagePtr;
  ctx.storagePtr = dataPtr;
  
  ctx.storageLen = len * elemSize32;
  liftResults = readValuesAndReset(ctx, originalPtr, originalLen, dataPtr, len);
}
}

return liftResults;
}
}

function _liftFlatBorrow(componentTableIdx, size, memory, vals, storagePtr, storageLen) {
  _debugLog('[_liftFlatBorrow()] args', { size, memory, vals, storagePtr, storageLen });
  throw new Error('flat lift for borrowed resources is not supported!');
}


function _lowerFlatU8(ctx) {
  _debugLog('[_lowerFlatU8()] args', ctx);
  
  if (ctx.vals.length !== 1) {
    throw new Error(`unexpected number [${ctx.vals.length}] of vals (expected 1)`);
  }
  
  _requireValidNumericPrimitive.bind('u8', ctx.vals[0]);
  
  if (!ctx.memory) { throw new Error("missing memory for lower"); }
  new DataView(ctx.memory.buffer).setUint8(ctx.storagePtr, ctx.vals[0]);
  
  ctx.storagePtr += 1;
}

function _lowerFlatU16(ctx) {
  _debugLog('[_lowerFlatU16()] args', { ctx });
  
  if (!ctx.memory) { throw new Error("missing memory for lower"); }
  if (ctx.vals.length !== 1) {
    throw new Error(`unexpected number [${ctx.vals.length}] of vals (expected 1)`);
  }
  
  const rem = ctx.storagePtr % 2;
  if (rem !== 0) { ctx.storagePtr += (2 - rem); }
  
  _requireValidNumericPrimitive.bind('u16', ctx.vals[0]);
  new DataView(ctx.memory.buffer).setUint16(ctx.storagePtr, ctx.vals[0], true);
  
  ctx.storagePtr += 2;
}

function _lowerFlatU32(ctx) {
  _debugLog('[_lowerFlatU32()] args', { ctx });
  
  if (ctx.vals.length !== 1) {
    throw new Error(`expected single value to lower, got [${ctx.vals.length}]`);
  }
  
  const rem = ctx.storagePtr % 4;
  if (rem !== 0) { ctx.storagePtr += (4 - rem); }
  
  _requireValidNumericPrimitive.bind('u32', ctx.vals[0]);
  new DataView(ctx.memory.buffer).setUint32(ctx.storagePtr, ctx.vals[0], true);
  
  ctx.storagePtr += 4;
}

function _lowerFlatVariant(meta) {
  const { variantSize32, variantAlign32, variantPayloadOffset32, caseMetas } = meta;
  
  let caseLookup = {};
  for (const [idx, meta] of caseMetas.entries()) {
    let tag = meta[0];
    caseLookup[tag] = { discriminant: idx, meta };
  }
  
  return function _lowerFlatVariantInner(ctx) {
    _debugLog('[_lowerFlatVariant()] args', { ctx });
    
    const { tag, val } = ctx.vals[0];
    const variantCase = caseLookup[tag];
    if (!variantCase) {
      throw new Error(`missing tag [${tag}] (valid tags: ${Object.keys(caseLookup)})`);
    }
    
    const [ _tag, lowerFn, caseSize32, caseAlign32, caseFlatCount ] = variantCase.meta;
    
    const originalPtr = ctx.storagePtr;
    ctx.vals = [variantCase.discriminant];
    let discLowerRes;
    if (caseMetas.length < 256) {
      discLowerRes = _lowerFlatU8(ctx);
    } else if (caseMetas.length >= 256 && caseMetas.length < 65536) {
      discLowerRes = _lowerFlatU16(ctx);
    } else if (caseMetas.length >= 65536 && caseMetas.length < 4_294_967_296) {
      discLowerRes = _lowerFlatU32(ctx);
    } else {
      throw new Error(`unsupported number of cases [${caseMetas.length}]`);
    }
    
    const payloadOffsetPtr = originalPtr + variantPayloadOffset32;
    ctx.storagePtr = payloadOffsetPtr;
    ctx.vals = [val];
    if (lowerFn) { lowerFn(ctx); }
    
    ctx.storagePtr = Math.max(ctx.storagePtr, originalPtr + variantSize32);
    
    const rem = ctx.storagePtr % variantAlign32;
    if (rem !== 0) { ctx.storagePtr += variantAlign32 - rem; }
  }
}

function _lowerFlatResult(meta) {
  const f = _lowerFlatVariant(meta);
  return function _lowerFlatResultInner(ctx) {
    _debugLog('[_lowerFlatResult()] args', { ctx });
    
    const v = ctx.vals[0];
    const isNotResultObject = typeof v !== 'object'
    || Object.keys(v).length !== 2
    || !('tag' in v)
    || !('ok' === v.tag || 'err' === v.tag)
    || !('val' in v);
    if (isNotResultObject) {
      ctx.vals[0] = { tag: 'ok', val: v };
    }
    
    f(ctx);
  };
}

function _lowerFlatOwn(meta) {
  const { lowerFn, componentIdx, tableIdx } = meta;
  
  return function _lowerFlatOwnInner(ctx) {
    _debugLog('[_lowerFlatOwn()] args', { ctx });
    const { createFn } = ctx;
    
    if (ctx.componentIdx !== componentIdx) {
      throw new Error(`component index mismatch (expected [${componentIdx}], lift called from [${ctx.componentIdx}])`);
    }
    
    const obj = ctx.vals[0];
    if (obj === undefined || obj === null) { throw new Error('missing resource'); }
    const handle = ctx.lowerResource
    ? ctx.lowerResource(obj, tableIdx)
    : lowerFn(obj);
    
    ctx.vals[0] = handle;
    _lowerFlatU32(ctx);
  };
}

function _trackHostOperation(operation) {
  const result = operation();
  if (result === null ||
  (typeof result !== 'object' && typeof result !== 'function') ||
  typeof result.then !== 'function') {
    return result;
  }
  
  STORE_ASYNC_STATE.pendingHostOperations++;
  return Promise.resolve(result).finally(() => {
    STORE_ASYNC_STATE.pendingHostOperations--;
    if (STORE_ASYNC_STATE.pendingHostOperations < 0) {
      throw new Error('negative pending host operation count');
    }
    for (const state of ASYNC_STATE.values()) { state.runTickLoop(); }
    _checkForDeadlock();
  });
}

function _guardMayLeave(componentIdx, fn) {
  return function (...args) {
    _checkMayLeave(componentIdx);
    return fn.apply(this, args);
  };
}

const base64Compile = str => WebAssembly.compile(
typeof Buffer !== 'undefined'
? Buffer.from(str, 'base64')
: Uint8Array.from(atob(str), b => b.charCodeAt(0))
);


const symbolCabiDispose = Symbol.for('cabiDispose');

const symbolRscHandle = Symbol('handle');

const symbolRscRep = Symbol.for('cabiRep');
const symbolDispose = Symbol.dispose || Symbol.for('dispose');

const HANDLE_TABLES= [];


const hasOwnProperty = Object.prototype.hasOwnProperty;

function getErrorPayload(e) {
  if (e && hasOwnProperty.call(e, 'payload')) return e.payload;
  if (e instanceof Error) throw e;
  return e;
}

const instantiateCore = WebAssembly.instantiate;

function _suspendingImport(componentIdx, fn, syncOnly = false, switchesTask = false) {
  return function (...args) {
    _checkMayLeave(componentIdx);
    const saved = CURRENT_TASK_META[componentIdx] ?? null;
    
    const savedTask = saved
    ? getCurrentTask(saved.componentIdx, saved.taskID)?.task
    : null;
    const mayBlock = savedTask
    ? (savedTask?.mayBlock() ?? (CURRENT_TASK_MAY_BLOCK.value !== 0))
    : false;
    if (!saved && !mayBlock) {
      throw new WebAssemblyRuntimeError('cannot block a synchronous task before returning');
    }
    
    if (syncOnly || !mayBlock) {
      let result;
      try {
        result = fn.apply(null, args);
      } catch (err) {
        CURRENT_TASK_META[componentIdx] = saved;
        if (!switchesTask) { CURRENT_TASK_META.current = saved; }
        throw err;
      }
      
      CURRENT_TASK_META[componentIdx] = saved;
      if (!switchesTask) { CURRENT_TASK_META.current = saved; }
      
      if (result !== null &&
      (typeof result === 'object' || typeof result === 'function') &&
      typeof result.then === 'function') {
        // The helper may already have returned a rejected promise.
        // Mark it handled before replacing it with the canonical
        // synchronous-task trap.
        Promise.resolve(result).catch(() => {});
        throw new WebAssemblyRuntimeError('cannot block a synchronous task before returning');
      }
      return result;
    }
    
    return (async () => {
      try {
        return await fn.apply(null, args);
      } finally {
        CURRENT_TASK_META[componentIdx] = saved;
        if (!switchesTask) { CURRENT_TASK_META.current = saved; }
      }
    })();
  };
}


let exports0;

const handleTable1 = [T_FLAG, 0];
handleTable1._createdReps = new Set();
handleTable1._componentIdx = 0;


const captureTable1= new Map();
let captureCnt1= 0;

HANDLE_TABLES[1] = handleTable1;

const _trampoline0 = function() {
  _debugLog('[iface="wasi:cli/stdout@0.2.12", function="get-stdout"] [Instruction::CallInterface] (sync, @ enter)');
  const hostProvided = true;
  
  let parentTask;
  let task;
  let subtask;
  
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: 'getStdout',
      getCallbackFn: () => null,
      callbackFnName: null,
      errHandling: 'none',
      callingWasmExport: false,
    });
    task = results[0];
  };
  
  taskCreation: {
    parentTask = getCurrentTask(
    0,
    _getGlobalCurrentTaskMeta(0)?.taskID,
    )?.task;
    
    if (!parentTask) {
      createTask();
      break taskCreation;
    }
    
    createTask();
    
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  
  const started = task.enterSync();
  
  let ret;
  
  try {
    ret = _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => _trackHostOperation(() => getStdout()),
    })
    ;
  } catch (err) {
    
    _debugLog('[Instruction::CallInterface] error during sync call', {
      taskID: task.id(),
      subtaskID: task.getParentSubtask()?.id(),
      err,
    });
    getOrCreateAsyncState(0).markTrapped(err);
    task.setErrored(err);
    task.reject(err);
    task.exit();
    throw err;
    
  }
  
  
  if (!(ret instanceof OutputStream)) {
    throw new TypeError('Resource error: Not a valid \"OutputStream\" resource.');
  }
  var handle0 = ret[symbolRscHandle];
  if (!handle0) {
    const rep = ret[symbolRscRep] || ++captureCnt1;
    captureTable1.set(rep, ret);
    handle0 = rscTableCreateOwn(handleTable1, rep);
  }
  
  _debugLog('[iface="wasi:cli/stdout@0.2.12", function="get-stdout"][Instruction::Return]', {
    funcName: 'get-stdout',
    paramCount: 1,
    async: false,
    postReturn: false
  });
  task.resolve([handle0]);
  task.exit();
  return handle0;
}
_trampoline0.fnName = 'wasi:cli/stdout@0.2.12#getStdout';
let exports1;
let memory0;

const handleTable0 = [T_FLAG, 0];
handleTable0._createdReps = new Set();
handleTable0._componentIdx = 0;


const captureTable0= new Map();
let captureCnt0= 0;

HANDLE_TABLES[0] = handleTable0;

const _trampoline2 = function(arg0, arg1, arg2, arg3) {
  var handle1 = arg0;
  
  var rep2 = handleTable1[(handle1 << 1) + 1] & ~T_FLAG;
  var rsc0 = captureTable1.get(rep2);
  if (!rsc0) {
    rsc0 = Object.create(OutputStream.prototype);
    Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
    Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
  }
  
  curResourceBorrows.push(rsc0);
  var ptr3 = arg1;
  var len3 = arg2;
  if (ptr3 % 1 !== 0) throw new TypeError(`list pointer [${ptr3}] is not aligned to 1`);
  var result3 = new Uint8Array(memory0.buffer.slice(ptr3, ptr3 + len3 * 1));
  _debugLog('[iface="wasi:io/streams@0.2.12", function="[method]output-stream.blocking-write-and-flush"] [Instruction::CallInterface] (sync, @ enter)');
  const hostProvided = true;
  
  let parentTask;
  let task;
  let subtask;
  
  const createTask = () => {
    const results = createNewCurrentTask({
      componentIdx: -1,
      isAsync: false,
      entryFnName: 'blockingWriteAndFlush',
      getCallbackFn: () => null,
      callbackFnName: null,
      errHandling: 'result-catch-handler',
      callingWasmExport: false,
    });
    task = results[0];
  };
  
  taskCreation: {
    parentTask = getCurrentTask(
    0,
    _getGlobalCurrentTaskMeta(0)?.taskID,
    )?.task;
    
    if (!parentTask) {
      createTask();
      break taskCreation;
    }
    
    createTask();
    
    if (hostProvided) {
      subtask = parentTask.getLatestSubtask();
      if (!subtask) {
        throw new Error(`Missing subtask (in parent task [${parentTask.id()}]) for host import, has the import been lowered? (ensure asyncImports are set properly)`);
      }
      task.setParentSubtask(subtask);
    }
  }
  
  const started = task.enterSync();
  
  let ret;
  try {
    const hostRet4 = _withGlobalCurrentTaskMeta({
      componentIdx: task.componentIdx(),
      taskID: task.id(),
      fn: () => _trackHostOperation(() => rsc0.blockingWriteAndFlush(result3)),
    })
    ;
    ret = hostRet4 !== null && typeof hostRet4 === 'object' && (hostRet4.tag === 'ok' || hostRet4.tag === 'err')
    ? hostRet4
    : { tag: 'ok', val: hostRet4};
  } catch (e) {
    if (getOrCreateAsyncState(0).markTrapped(e)) { throw e; }
    ret = { tag: 'err', val: getErrorPayload(e) };
  }
  
  for (const entry of curResourceBorrows) {
    const rsc = entry.rsc ?? entry;
    if (entry.drop) {
      if (rsc[symbolRscHandle]) {
        entry.drop(rsc[symbolRscHandle]);
      }
    }
    rsc[symbolRscHandle] = undefined;
  }
  curResourceBorrows = [];
  var variant7 = ret;
  switch (variant7.tag) {
    case 'ok': {
      const e = variant7.val;
      dataView(memory0).setInt8(arg3 + 0, 0, true);
      
      break;
    }
    case 'err': {
      const e = variant7.val;
      dataView(memory0).setInt8(arg3 + 0, 1, true);
      var variant6 = e;
      switch (variant6.tag) {
        case 'last-operation-failed': {
          const e = variant6.val;
          dataView(memory0).setInt8(arg3 + 4, 0, true);
          
          if (!(e instanceof Error$1)) {
            throw new TypeError('Resource error: Not a valid \"Error\" resource.');
          }
          var handle5 = e[symbolRscHandle];
          if (!handle5) {
            const rep = e[symbolRscRep] || ++captureCnt0;
            captureTable0.set(rep, e);
            handle5 = rscTableCreateOwn(handleTable0, rep);
          }
          
          dataView(memory0).setInt32(arg3 + 8, handle5, true);
          break;
        }
        case 'closed': {
          dataView(memory0).setInt8(arg3 + 4, 1, true);
          break;
        }
        default: {
          throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant6.tag)}\` (received \`${variant6}\`) specified for \`StreamError\``);
        }
      }
      
      break;
    }
    default: {
      _debugLog("ERROR: invalid value (expected result as object with 'tag' member)", { value: variant7, valueType: typeof variant7});
      throw new TypeError('invalid variant specified for result');
    }
  }
  _debugLog('[iface="wasi:io/streams@0.2.12", function="[method]output-stream.blocking-write-and-flush"][Instruction::Return]', {
    funcName: '[method]output-stream.blocking-write-and-flush',
    paramCount: 0,
    async: false,
    postReturn: false
  });
  task.resolve([ret]);
  task.exit();
}
_trampoline2.fnName = 'wasi:io/streams@0.2.12#blockingWriteAndFlush';
let exports2;
let exports1Run;

function run() {
  
  const hostProvided = false;
  getOrCreateAsyncState(0).throwIfTrapped();
  
  const [task, _wasm_call_currentTaskID] = createNewCurrentTask({
    componentIdx: 0,
    isAsync: false,
    isManualAsync: false,
    preserveFutureResult: false,
    entryFnName: 'exports1Run',
    getCallbackFn: () => null,
    callbackFnName: null,
    errHandling: 'none',
    callingWasmExport: true,
  });
  task.setCalleeIsAsync(false);
  
  const started = task.enterSync();
  CURRENT_TASK_MAY_BLOCK.value = task.mayBlock() ? 1 : 0;
  
  if (null!== null) {
    task.setReturnMemoryIdx(null);
    task.setReturnMemory((() => null)());
  }
  
  
  return _withGlobalCurrentTaskMeta({
    taskID: task.id(),
    componentIdx: task.componentIdx(),
    fn: () => {
      try {
        
        _debugLog('[iface="run", function="run"][Instruction::CallWasm] enter', {
          funcName: 'run',
          paramCount: 0,
          async: false,
          postReturn: false,
        });
        
        let ret;
        
        try {
          _withGlobalCurrentTaskMeta({
            taskID: task.id(),
            componentIdx: task.componentIdx(),
            fn: () => exports1Run(),
          });
        } catch (err) {
          
          _debugLog('[Instruction::CallWasm] error during sync call', {
            taskID: task.id(),
            err,
          });
          getOrCreateAsyncState(0).markTrapped(err);
          task.setErrored(err);
          task.reject(err);
          task.exit();
          throw err;
          
        }
        
        _debugLog('[iface="run", function="run"][Instruction::Return]', {
          funcName: 'run',
          paramCount: 0,
          async: false,
          postReturn: false
        });
        task.resolve([ret]);
        task.exit();
        
      } catch (err) {
        if (!task.isResolvedState()) {
          task.setErrored(err);
          task.reject(err);
        }
        if (!task.isExited()) { task.exit({ skipExclusiveLockCheck: true }); }
        throw err;
      }
    },
  });
  
}
let trampoline0 = _trampoline0.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 0,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline0.manuallyAsync,
  paramLiftFns: [],
  resultLowerFns: [_lowerFlatOwn({
    componentIdx: 0,
    tableIdx: 1,
    lowerFn: 
    function lowerImportedOwnedHost_OutputStream(obj) {
      if (!(obj instanceof OutputStream)) {
        throw new TypeError('Resource error: Not a valid \"OutputStream\" resource.');
      }
      let handle = obj[symbolRscHandle];
      if (!handle) {
        const rep = obj[symbolRscRep] || ++captureCnt1;
        captureTable1.set(rep, obj);
        handle = rscTableCreateOwn(handleTable1, rep);
      }
      return handle;
    }
    ,
  })],
  hasResultPointer: false,
  funcTypeIsAsync: false,
  getCallbackFn: () => null,
  getPostReturnFn: () => null,
  isCancellable: false,
  memoryIdx: null,
  stringEncoding: 'utf8',
  getMemoryFn: () => null,
  getReallocFn: undefined,
  importFn: _trampoline0,
},
))) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 0,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline0.manuallyAsync,
  paramLiftFns: [],
  resultLowerFns: [_lowerFlatOwn({
    componentIdx: 0,
    tableIdx: 1,
    lowerFn: 
    function lowerImportedOwnedHost_OutputStream(obj) {
      if (!(obj instanceof OutputStream)) {
        throw new TypeError('Resource error: Not a valid \"OutputStream\" resource.');
      }
      let handle = obj[symbolRscHandle];
      if (!handle) {
        const rep = obj[symbolRscRep] || ++captureCnt1;
        captureTable1.set(rep, obj);
        handle = rscTableCreateOwn(handleTable1, rep);
      }
      return handle;
    }
    ,
  })],
  hasResultPointer: false,
  funcTypeIsAsync: false,
  getCallbackFn: () => null,
  getPostReturnFn: () => null,
  isCancellable: false,
  memoryIdx: null,
  stringEncoding: 'utf8',
  getMemoryFn: () => null,
  getReallocFn: undefined,
  importFn: _trampoline0,
},
);
function trampoline1(handle) {
  const handleEntry = rscTableRemove(handleTable1, handle);
  if (handleEntry.own) {
    
    const rsc = captureTable1.get(handleEntry.rep);
    if (rsc) {
      if (rsc[symbolDispose]) rsc[symbolDispose]();
      captureTable1.delete(handleEntry.rep);
    } else if (OutputStream[symbolCabiDispose]) {
      OutputStream[symbolCabiDispose](handleEntry.rep);
    }
  }
}
let trampoline2 = _trampoline2.manuallyAsync ? new WebAssembly.Suspending(_suspendingImport(0, _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 2,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline2.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 1),_liftFlatList({
    elemLiftFn: _liftFlatU8,
    elemAlign32: 1,
    elemSize32: 1,
    typedArray: Uint8Array,
  })],
  resultLowerFns: [
  _lowerFlatResult({
    caseMetas: [
    [ 'ok', null, 12, 4, 4 ],
    [ 'err', _lowerFlatVariant({
      caseMetas: [[ 'last-operation-failed', _lowerFlatOwn({
        componentIdx: 0,
        tableIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_Error$1(obj) {
          if (!(obj instanceof Error$1)) {
            throw new TypeError('Resource error: Not a valid \"Error$1\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt0;
            captureTable0.set(rep, obj);
            handle = rscTableCreateOwn(handleTable0, rep);
          }
          return handle;
        }
        ,
      }), 4, 4, 1 ],[ 'closed', null, 0, 0, 0 ],],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    } ), 12, 4, 4 ],
    ],
    variantSize32: 12,
    variantAlign32: 4,
    variantPayloadOffset32: 4,
    variantFlatCount: 3,
  })
  ],
  hasResultPointer: true,
  funcTypeIsAsync: false,
  getCallbackFn: () => null,
  getPostReturnFn: () => null,
  isCancellable: false,
  memoryIdx: 0,
  stringEncoding: 'utf8',
  getMemoryFn: () => memory0,
  getReallocFn: undefined,
  importFn: _trampoline2,
},
))) : _lowerImportBackwardsCompat.bind(
null,
{
  trampolineIdx: 2,
  componentIdx: 0,
  isAsync: false,
  isManualAsync: _trampoline2.manuallyAsync,
  paramLiftFns: [_liftFlatBorrow.bind(null, 1),_liftFlatList({
    elemLiftFn: _liftFlatU8,
    elemAlign32: 1,
    elemSize32: 1,
    typedArray: Uint8Array,
  })],
  resultLowerFns: [
  _lowerFlatResult({
    caseMetas: [
    [ 'ok', null, 12, 4, 4 ],
    [ 'err', _lowerFlatVariant({
      caseMetas: [[ 'last-operation-failed', _lowerFlatOwn({
        componentIdx: 0,
        tableIdx: 0,
        lowerFn: 
        function lowerImportedOwnedHost_Error$1(obj) {
          if (!(obj instanceof Error$1)) {
            throw new TypeError('Resource error: Not a valid \"Error$1\" resource.');
          }
          let handle = obj[symbolRscHandle];
          if (!handle) {
            const rep = obj[symbolRscRep] || ++captureCnt0;
            captureTable0.set(rep, obj);
            handle = rscTableCreateOwn(handleTable0, rep);
          }
          return handle;
        }
        ,
      }), 4, 4, 1 ],[ 'closed', null, 0, 0, 0 ],],
      variantSize32: 8,
      variantAlign32: 4,
      variantPayloadOffset32: 4,
      variantFlatCount: 2,
    } ), 12, 4, 4 ],
    ],
    variantSize32: 12,
    variantAlign32: 4,
    variantPayloadOffset32: 4,
    variantFlatCount: 3,
  })
  ],
  hasResultPointer: true,
  funcTypeIsAsync: false,
  getCallbackFn: () => null,
  getPostReturnFn: () => null,
  isCancellable: false,
  memoryIdx: 0,
  stringEncoding: 'utf8',
  getMemoryFn: () => memory0,
  getReallocFn: undefined,
  importFn: _trampoline2,
},
);

const $init = (() => {
  let gen = (function* _initGenerator () {
    const module0 = base64Compile('AGFzbQEAAAABEwRgAAF/YAR/f39/AGABfwBgAAACowEDFndhc2k6Y2xpL3N0ZG91dEAwLjIuMTIKZ2V0LXN0ZG91dAAAFndhc2k6aW8vc3RyZWFtc0AwLjIuMTIuW21ldGhvZF1vdXRwdXQtc3RyZWFtLmJsb2NraW5nLXdyaXRlLWFuZC1mbHVzaAABFndhc2k6aW8vc3RyZWFtc0AwLjIuMTIcW3Jlc291cmNlLWRyb3Bdb3V0cHV0LXN0cmVhbQACAwIBAwUDAQABBxACBm1lbW9yeQIAA3J1bgADChkBFwEBfxAAIQAgAEEQQQlBwAAQASAAEAILCw8BAEEQCwloZWxsbyBwMgoALARuYW1lAR0DAApnZXQtc3Rkb3V0AQRid2FmAghkcm9wLW91dAIGAQMBAAFzAC8JcHJvZHVjZXJzAQxwcm9jZXNzZWQtYnkBDXdpdC1jb21wb25lbnQHMC4yNDUuMQ');
    const module1 = base64Compile('AGFzbQEAAAABCAFgBH9/f38AAwIBAAQFAXABAQEHEAIBMAAACCRpbXBvcnRzAQAKEQEPACAAIAEgAiADQQARAAALAC8JcHJvZHVjZXJzAQxwcm9jZXNzZWQtYnkBDXdpdC1jb21wb25lbnQHMC4yNDUuMQ');
    const module2 = base64Compile('AGFzbQEAAAABCAFgBH9/f38AAhUCAAEwAAAACCRpbXBvcnRzAXABAQEJBwEAQQALAQAALwlwcm9kdWNlcnMBDHByb2Nlc3NlZC1ieQENd2l0LWNvbXBvbmVudAcwLjI0NS4x');
    const instanceFlags0 = new WebAssembly.Global({ value: "i32", mutable: true }, 1);
    INSTANCE_FLAGS.set(0, instanceFlags0);
    ({ exports: exports0 } = yield instantiateCore(yield module1));
    ({ exports: exports1 } = yield instantiateCore(yield module0, {
      'wasi:cli/stdout@0.2.12': {
        'get-stdout': Object.assign(trampoline0, { _jcoMaySuspend: false }),
      },
      'wasi:io/streams@0.2.12': {
        '[method]output-stream.blocking-write-and-flush': Object.assign(exports0['0'], { _jcoMaySuspend: false }),
        '[resource-drop]output-stream': Object.assign(_guardMayLeave(0, trampoline1), { _jcoMaySuspend: false }),
      },
    }));
    memory0 = exports1.memory;
    ({ exports: exports2 } = yield instantiateCore(yield module2, {
      '': {
        $imports: exports0.$imports,
        '0': Object.assign(trampoline2, { _jcoMaySuspend: false }),
      },
    }));
    exports1Run = exports1.run;
  })();
  let promise, resolve, reject;
  function normalizeInstantiationError (e) {
    // Native JSPI rejects a suspending import called from a
    // core start function before entering its JS wrapper.
    // At component instantiation time that always means the
    // implicit synchronous task attempted to block.
    if (typeof WebAssembly.SuspendError === 'function' && e instanceof WebAssembly.SuspendError) {
      return new WebAssembly.RuntimeError('cannot block a synchronous task before returning');
    }
    return e;
  }
  function runNext (value) {
    try {
      let done;
      do {
        ({ value, done } = gen.next(value));
      } while (!(value instanceof Promise) && !done);
      if (done) {
        if (resolve) resolve(value);
        else return value;
      }
      if (!promise) promise = new Promise((_resolve, _reject) => (resolve = _resolve, reject = _reject));
      value.then(runNext, e => reject(normalizeInstantiationError(e)));
    }
    catch (e) {
      e = normalizeInstantiationError(e);
      if (reject) reject(e);
      else throw e;
    }
  }
  const maybeSyncReturn = runNext(null);
  return promise || maybeSyncReturn;
})();

await $init;

export { run,  }
export const _util = {
  
}

