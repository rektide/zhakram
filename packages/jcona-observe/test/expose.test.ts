import assert from 'node:assert/strict';
import test from 'node:test';

import { transformResourceExposure } from '../src/expose.ts';

const GENERATED_FIXTURE = `"use components";
export function instantiate() {
  const RESOURCE_SCOPE_TASKS = new Map();
  let RESOURCE_SCOPE_ID = 0;
  const ASYNC_TASKS_BY_COMPONENT_IDX = new Map();
  const ASYNC_STATE = new Map();
  const INSTANCE_FLAGS = new Map();
  const HANDLE_TABLES = [];
  const handleTable0 = [1 << 30, 0, 0, 7 | (1 << 30)];
  handleTable0._createdReps = new Set([7]);
  handleTable0._componentIdx = 0;
  HANDLE_TABLES[0] = handleTable0;
  const captureTable0 = new Map();
  captureTable0.set(7, { kind: 'stream' });
  RESOURCE_SCOPE_ID++;
  RESOURCE_SCOPE_TASKS.set(RESOURCE_SCOPE_ID, { task: 'live' });
  INSTANCE_FLAGS.set(0, new WebAssembly.Global({ value: 'i32', mutable: true }, 1));
  return {};
}
export const _util = {
}
`;

test('injects a per-instantiation, immutable _util snapshot view', async () => {
	const result = transformResourceExposure(GENERATED_FIXTURE);
	assert.equal(result.status, 'transformed');
	assert.match(result.source, /resourceTables: __jconaObserveResourceTables/);
	const url = `data:text/javascript;base64,${Buffer.from(result.source).toString('base64')}`;
	const generated = await import(url);
	generated.instantiate();
	generated.instantiate();
	const snapshot = generated._util.resourceTables.snapshot();
	assert.equal(snapshot.shape, 'jcona-observe.resource-tables.v1');
	assert.equal(snapshot.instances.length, 2);
	assert.equal(snapshot.instances[0].resourceScopeId, 1);
	assert.equal(snapshot.instances[0].resourceScopeTasks.size, 1);
	assert.equal(snapshot.instances[0].instanceFlags.entries[0].value.value, 1);
	assert.deepEqual(snapshot.instances[0].handleTables[0].entries, [
		{ handle: 1, state: 'live', scope: 0, rep: 7, own: true },
	]);
	assert.equal(snapshot.instances[0].captureTables.captureTable0.size, 1);
	assert.ok(Object.isFrozen(snapshot));
	assert.ok(Object.isFrozen(snapshot.instances));
});

test('is idempotent', () => {
	const once = transformResourceExposure(GENERATED_FIXTURE);
	const twice = transformResourceExposure(once.source);
	assert.equal(twice.status, 'already-exposed');
	assert.equal(twice.source, once.source);
});

test('warns and leaves an unknown shape byte-for-byte unchanged', () => {
	const source = 'export const _util = {};\n';
	const result = transformResourceExposure(source);
	assert.equal(result.status, 'skipped');
	assert.equal(result.source, source);
	assert.match(result.warnings[0], /jco 1\.33\.0 shape/);
});
