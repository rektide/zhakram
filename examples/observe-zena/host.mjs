#!/usr/bin/env node
import assert from 'node:assert/strict';

import * as cli from '@bytecodealliance/preview2-shim/cli';
import * as clocks from '@bytecodealliance/preview2-shim/clocks';
import * as io from '@bytecodealliance/preview2-shim/io';
import * as random from '@bytecodealliance/preview2-shim/random';
import { createTracing, formatSpanLine } from '../../packages/zhakram-otel/src/index.ts';
import {
	formatObservationLine,
	observationSummary,
	observe,
} from '../../packages/zhakram-observe/src/index.ts';

const spans = [];
const hostEvents = [];
const sink = {
	emit(event) {
		if ('span' in event) {
			const line = formatSpanLine(event);
			spans.push(line);
			console.log(line);
		} else {
			hostEvents.push(event);
			if (event.type !== 'call-start') console.log(formatObservationLine(event));
		}
	},
};

const imports = observe({
	'wasi:otel/tracing': createTracing({ sink }),
	'wasi:clocks/wall-clock': clocks.wallClock,
	'wasi:random/random': random.random,
	'wasi:cli/stdout': cli.stdout,
	'wasi:io/streams': io.streams,
	'wasi:io/error': io.error,
}, { sink });

const component = await import('./build/observe-demo-out/observe-demo.js');
const instance = await component.instantiate(undefined, imports);
instance.run();

const summary = observationSummary(imports);
const tables = component._util.resourceTables.snapshot();
const completedFunctions = hostEvents
	.filter((event) => event.type === 'call-end')
	.map((event) => event.function);

assert.equal(spans.length, 4);
assert.ok(completedFunctions.includes('get-random-u64'));
assert.ok(completedFunctions.includes('get-stdout'));
assert.ok(completedFunctions.includes('[method]output-stream.blocking-write-and-flush'));
assert.ok(summary.totals.resourceCalls >= 1);
assert.equal(summary.totals.inFlight, 0);
assert.equal(tables.instances.length, 1);
assert.ok(tables.instances[0].handleTables.some((table) =>
	table.entries.some((entry) => entry.state === 'live')));

console.log('resource summary', JSON.stringify(summary));
console.log('table snapshot', JSON.stringify(tables));
console.log(`OBSERVE-ZENA-NODE-OK: spans=${spans.length} hostCalls=${summary.totals.calls} resourceCalls=${summary.totals.resourceCalls} tableInstances=${tables.instances.length}`);
