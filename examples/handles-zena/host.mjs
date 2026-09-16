#!/usr/bin/env node
import * as cli from '@bytecodealliance/preview2-shim/cli';
import * as io from '@bytecodealliance/preview2-shim/io';

const component = await import('./build/handles-demo-out/handles-demo.js');
const instance = await component.instantiate(undefined, {
  'wasi:cli/stdout': cli.stdout,
  'wasi:io/streams': io.streams,
  'wasi:io/error': io.error,
  'wasi:io/poll': io.poll,
});

instance.run();
