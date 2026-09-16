import { readFile, writeFile } from 'node:fs/promises';

/** Generated-code shape this intentionally fragile transform is pinned to. */
export const SUPPORTED_JCO_VERSION = '1.33.0';

const MARKER = 'jcona-observe.resource-tables.v1';
const EXPECTED_DECLARATIONS = [
	['RESOURCE_SCOPE_ID', /\blet RESOURCE_SCOPE_ID = 0;/g],
	['RESOURCE_SCOPE_TASKS', /\bconst RESOURCE_SCOPE_TASKS = new Map\(\);/g],
	['ASYNC_TASKS_BY_COMPONENT_IDX', /\bconst ASYNC_TASKS_BY_COMPONENT_IDX = new Map\(\);/g],
	['ASYNC_STATE', /\bconst ASYNC_STATE = new Map\(\);/g],
	['INSTANCE_FLAGS', /\bconst INSTANCE_FLAGS = new Map\(\);/g],
	['HANDLE_TABLES', /\bconst HANDLE_TABLES\s*=\s*\[\];/g],
] as const;

export interface ResourceExposureResult {
	status: 'transformed' | 'already-exposed' | 'skipped';
	source: string;
	tables: string[];
	warnings: string[];
}

export interface ExposeResourceTablesOptions {
	warn?: (message: string) => void;
}

const MODULE_HELPERS = `
// ${MARKER}; injected by jcona-observe for @bytecodealliance/jco ${SUPPORTED_JCO_VERSION} output.
const __jconaObserveResourceViews = new Map();
let __jconaObserveNextResourceViewId = 0;

function __jconaObserveSummarize(value, seen = new WeakSet(), depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'undefined') return { type: 'undefined' };
  if (typeof value === 'bigint') return { type: 'bigint', value: value.toString() };
  if (typeof value === 'number') return Number.isFinite(value) ? value : { type: 'number', value: String(value) };
  if (typeof value === 'symbol') return { type: 'symbol', description: value.description || '' };
  if (typeof value === 'function') return { type: 'function', name: value.name || '<anonymous>' };
  if (seen.has(value)) return { type: 'circular' };
  seen.add(value);
  if (Array.isArray(value)) {
    return { type: 'array', length: value.length, items: value.slice(0, 16).map(item => __jconaObserveSummarize(item, seen, depth + 1)) };
  }
  if (ArrayBuffer.isView(value)) return { type: value.constructor.name, length: value.byteLength };
  if (value instanceof Map) return __jconaObserveSnapshotMap(value);
  let globalValue;
  if (typeof WebAssembly !== 'undefined' && value instanceof WebAssembly.Global) {
    globalValue = __jconaObserveSummarize(value.value, seen, depth + 1);
  }
  const type = value.constructor?.name || 'Object';
  if (depth >= 2) return globalValue === undefined ? { type } : { type, value: globalValue };
  const fields = {};
  for (const key of Object.keys(value).slice(0, 16)) {
    try { fields[key] = __jconaObserveSummarize(value[key], seen, depth + 1); }
    catch (error) { fields[key] = { type: 'unavailable', message: String(error) }; }
  }
  return globalValue === undefined ? { type, fields } : { type, value: globalValue, fields };
}

function __jconaObserveSnapshotMap(map) {
  return {
    size: map.size,
    entries: [...map].map(([key, value]) => ({
      key: __jconaObserveSummarize(key),
      value: __jconaObserveSummarize(value),
    })),
  };
}

function __jconaObserveSnapshotHandleTable(table, tableIndex) {
  const flag = 1 << 30;
  const entries = [];
  for (let handle = 1; handle < table.length / 2; handle++) {
    const scope = table[handle << 1];
    const encodedRep = table[(handle << 1) + 1];
    if ((scope & flag) !== 0 || encodedRep === 0) {
      entries.push({ handle, state: 'free', next: scope & ~flag });
    } else {
      entries.push({
        handle,
        state: 'live',
        scope,
        rep: encodedRep & ~flag,
        own: (encodedRep & flag) !== 0,
      });
    }
  }
  return {
    tableIndex,
    componentIdx: table._componentIdx,
    freeHead: table[0] & ~flag,
    createdReps: [...table._createdReps],
    entries,
  };
}

function __jconaObserveDeepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) __jconaObserveDeepFreeze(child);
  return Object.freeze(value);
}

function __jconaObserveRegisterResourceView(snapshot) {
  const id = ++__jconaObserveNextResourceViewId;
  __jconaObserveResourceViews.set(id, snapshot);
  return id;
}

function __jconaObserveSnapshotResourceTables() {
  return __jconaObserveDeepFreeze({
    shape: '${MARKER}',
    generatedFor: '@bytecodealliance/jco@${SUPPORTED_JCO_VERSION}',
    instances: [...__jconaObserveResourceViews].map(([id, snapshot]) => ({ id, ...snapshot() })),
  });
}

const __jconaObserveResourceTables = Object.freeze({
  snapshot: __jconaObserveSnapshotResourceTables,
});
`;

function countMatches(source: string, pattern: RegExp): number {
	return [...source.matchAll(pattern)].length;
}

/**
 * Inject `_util.resourceTables.snapshot()` into known jco 1.33.0 output.
 * Unknown or ambiguous shapes are returned byte-for-byte unchanged.
 */
export function transformResourceExposure(source: string): ResourceExposureResult {
	const tables = EXPECTED_DECLARATIONS.map(([name]) => name);
	if (source.includes(MARKER)) {
		return { status: 'already-exposed', source, tables, warnings: [] };
	}

	const problems: string[] = [];
	if (!source.startsWith('"use components";')) problems.push('missing "use components" directive');
	for (const [name, pattern] of EXPECTED_DECLARATIONS) {
		const count = countMatches(source, pattern);
		if (count !== 1) problems.push(`${name} declaration count was ${count}, expected 1`);
	}
	const utilCount = countMatches(source, /export const _util = \{/g);
	if (utilCount !== 1) problems.push(`_util export count was ${utilCount}, expected 1`);

	if (problems.length) {
		const warning = `jcona-observe: resource exposure skipped; generated code does not match the pinned @bytecodealliance/jco ${SUPPORTED_JCO_VERSION} shape (${problems.join('; ')})`;
		return { status: 'skipped', source, tables: [], warnings: [warning] };
	}

	const directiveEnd = source.indexOf('\n');
	if (directiveEnd === -1) {
		return {
			status: 'skipped',
			source,
			tables: [],
			warnings: [`jcona-observe: resource exposure skipped; malformed generated module header`],
		};
	}
	let transformed = `${source.slice(0, directiveEnd + 1)}${MODULE_HELPERS}${source.slice(directiveEnd + 1)}`;

	transformed = transformed.replace(
		/^([ \t]*)const INSTANCE_FLAGS = new Map\(\);/m,
		(_match, indent: string) => `${indent}const INSTANCE_FLAGS = new Map();\n`
			+ `${indent}const __jconaObserveCaptureTables = Object.create(null);\n`
			+ `${indent}__jconaObserveRegisterResourceView(() => ({\n`
			+ `${indent}  resourceScopeId: RESOURCE_SCOPE_ID,\n`
			+ `${indent}  resourceScopeTasks: __jconaObserveSnapshotMap(RESOURCE_SCOPE_TASKS),\n`
			+ `${indent}  asyncTasksByComponentIdx: __jconaObserveSnapshotMap(ASYNC_TASKS_BY_COMPONENT_IDX),\n`
			+ `${indent}  asyncState: __jconaObserveSnapshotMap(ASYNC_STATE),\n`
			+ `${indent}  instanceFlags: __jconaObserveSnapshotMap(INSTANCE_FLAGS),\n`
			+ `${indent}  handleTables: HANDLE_TABLES.map(__jconaObserveSnapshotHandleTable),\n`
			+ `${indent}  captureTables: Object.fromEntries(Object.entries(__jconaObserveCaptureTables)\n`
			+ `${indent}    .map(([name, table]) => [name, __jconaObserveSnapshotMap(table)])),\n`
			+ `${indent}}));`,
	);
	transformed = transformed.replace(
		/^([ \t]*)(const (captureTable\d+)\s*=\s*new Map\(\);)/gm,
		(_match, indent: string, declaration: string, name: string) =>
			`${indent}${declaration}\n${indent}__jconaObserveCaptureTables.${name} = ${name};`,
	);
	transformed = transformed.replace(
		/export const _util = \{/,
		'export const _util = {\n  resourceTables: __jconaObserveResourceTables,',
	);

	return { status: 'transformed', source: transformed, tables, warnings: [] };
}

/** Transform a generated JS entry in place, warning instead of risking corruption. */
export async function exposeResourceTables(
	file: string,
	opts: ExposeResourceTablesOptions = {},
): Promise<ResourceExposureResult> {
	const result = transformResourceExposure(await readFile(file, 'utf8'));
	for (const warning of result.warnings) (opts.warn ?? console.warn)(warning);
	if (result.status === 'transformed') await writeFile(file, result.source);
	return result;
}
