import assert from 'node:assert/strict';
import test from 'node:test';

import {
	observationSummary,
	observe,
	type ObservationEvent,
} from '../src/observe.ts';

test('observes sync dispatch with bounded BigInt and byte summaries', () => {
	const events: ObservationEvent[] = [];
	let tick = 1;
	const imports = observe({
		'wasi:test/values': {
			inspect(value: bigint, bytes: Uint8Array) {
				return { value, bytes };
			},
		},
	}, { sink: { emit: (event) => events.push(event) }, clock: () => tick++ });

	const result = imports['wasi:test/values'].inspect(42n, new Uint8Array(64));
	assert.equal(result.value, 42n);
	const end = events.find((event) => event.type === 'call-end');
	assert.equal(end?.function, 'inspect');
	assert.deepEqual(end?.arguments[0], { type: 'bigint', value: '42' });
	assert.deepEqual(end?.arguments[1], {
		type: 'bytes', class: 'Uint8Array', length: 64, preview: Array(16).fill(0),
	});
	assert.deepEqual(observationSummary(imports).totals, {
		calls: 1, inFlight: 0, resourceCalls: 0, dropEvents: 0,
	});
});

test('tracks async calls while they are in flight', async () => {
	let resolve!: (value: number) => void;
	const pending = new Promise<number>((done) => { resolve = done; });
	const imports = observe({ 'wasi:test/async': { wait: () => pending } });
	const result = imports['wasi:test/async'].wait();
	assert.equal(observationSummary(imports).totals.inFlight, 1);
	resolve(7);
	assert.equal(await result, 7);
	assert.equal(observationSummary(imports).totals.inFlight, 0);
});

test('preserves resource instanceof and observes methods and drops', () => {
	class OutputStream {
		writes = 0;
		write(bytes: Uint8Array): number {
			this.writes += bytes.byteLength;
			return this.writes;
		}
		drop(): void {}
	}
	const stream = new OutputStream();
	const events: ObservationEvent[] = [];
	const imports = observe({
		'wasi:cli/stdout': { getStdout: () => stream },
		'wasi:io/streams': { OutputStream },
	}, { sink: { emit: (event) => events.push(event) } });

	const wrapped = imports['wasi:cli/stdout'].getStdout();
	assert.ok(wrapped instanceof imports['wasi:io/streams'].OutputStream);
	assert.equal(wrapped.write(new Uint8Array(3)), 3);
	wrapped.drop();

	const completed = events.filter((event) => event.type === 'call-end');
	assert.deepEqual(completed.map((event) => event.function), [
		'get-stdout',
		'[method]output-stream.write',
		'[resource-drop]output-stream',
	]);
	assert.equal(events.filter((event) => event.type === 'resource-acquire').length, 1);
	assert.equal(events.filter((event) => event.type === 'resource-drop').length, 1);
	assert.deepEqual(observationSummary(imports).interfaces, [
		{ interface: 'wasi:cli/stdout', calls: 1, inFlight: 0, resourceCalls: 0, dropEvents: 0 },
		{ interface: 'wasi:io/streams', calls: 2, inFlight: 0, resourceCalls: 2, dropEvents: 1 },
	]);
});

test('recognizes flat canonical resource function names', () => {
	const imports = observe({
		'wasi:test/resources': {
			'[method]widget.ping': () => 'pong',
			'[resource-drop]widget': () => undefined,
		},
	});
	assert.equal(imports['wasi:test/resources']['[method]widget.ping'](), 'pong');
	imports['wasi:test/resources']['[resource-drop]widget']();
	assert.deepEqual(observationSummary(imports).totals, {
		calls: 2, inFlight: 0, resourceCalls: 2, dropEvents: 1,
	});
});
