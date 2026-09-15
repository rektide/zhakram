#!/usr/bin/env node
// otel-zena Node host: instantiate the -I transpiled demo with the
// jcona-otel tracing host + the preview2-shim namespaces it imports.
//
// The span lines print from the host sink as the guest's on-end calls fire,
// interleaved with the guest's own stdout ("picked" emoji) writes.
import * as cli from '@bytecodealliance/preview2-shim/cli';
import * as clocks from '@bytecodealliance/preview2-shim/clocks';
import * as io from '@bytecodealliance/preview2-shim/io';
import * as random from '@bytecodealliance/preview2-shim/random';
import { createTracing } from '../../packages/jcona-otel/src/index.ts';

const m = await import('./build/otel-demo-out/otel-demo.js');
const inst = await m.instantiate(undefined, {
	'wasi:otel/tracing': createTracing(),
	'wasi:clocks/wall-clock': clocks.wallClock,
	'wasi:random/random': random.random,
	'wasi:cli/stdout': cli.stdout,
	'wasi:io/streams': io.streams,
	'wasi:io/error': io.error,
});
inst.run();
