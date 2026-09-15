#!/usr/bin/env node
// interop-jshost compose.mjs — host-mediated composition under jco.
//
// The JS host instantiates two transpiled components:
//
//   rng-rs        (world rng-source)      exports rektide:interop/rng.next
//   consume-rs    (world rng-reader)      imports rng, exports read()
//
// and wires the generator's `next` into the consumer's instantiation
// imports object — the composition decision is made *by the host, per
// instantiation*, not compiled in (contrast: ../interop-static). This is
// the browser-friendly model: the same wiring is an import-map entry there.
//
// Transpiled with jco's -I (instantiation) mode: the generated module
// exports instantiate(getCoreModule, imports) instead of wiring imports at
// top level. In this mode ALL imports come from the imports object — WASI
// included — so the host supplies the preview2-shim namespaces itself.
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import * as cli from '@bytecodealliance/preview2-shim/cli';
import * as io from '@bytecodealliance/preview2-shim/io';

const execFile = promisify(execFileCb);
const jco = new URL('../../node_modules/.bin/jco', import.meta.url).pathname;
const here = new URL('.', import.meta.url).pathname;

async function run(cmd, args, opts) {
  const { stdout } = await execFile(cmd, args, { cwd: here, ...opts });
  return stdout;
}

// Transpile outputs land in build/, which self-manages its own .gitignore
// (`*`): the parent dir's .gitignore is owned by the p2 examples and only
// covers p2-* outputs.
await mkdir(new URL('build/', import.meta.url), { recursive: true });
await writeFile(new URL('build/.gitignore', import.meta.url), '*\n');

// 1. Build the Rust artifacts (no-ops when up to date; order-sensitive, see
//    ../interop-static/build.sh).
await run(`${here}../interop-static/build.sh`, []);

// 2. Transpile both components in instantiation (-I) mode.
await run(jco, ['transpile', '--bindgen-enable-wasm-exnref', '-I', 'async',
  '../interop-static/build/rng_rs.wasm', '-o', 'build/rng-out']);
await run(jco, ['transpile', '--bindgen-enable-wasm-exnref', '-I', 'async',
  '../interop-static/build/consume_rs.wasm', '-o', 'build/consume-out']);

// 3. Instantiate the generator. No imports of its own.
const rngMod = await import('./build/rng-out/rng_rs.js');
const gen = await rngMod.instantiate();
const next = gen.rng.next; // namespaced export: 'rektide:interop/rng@0.1.0'

// 4. Instantiate the consumer, wiring rng.next + the WASI shim namespaces.
const consumeMod = await import('./build/consume-out/consume_rs.js');
const consumer = await consumeMod.instantiate(undefined, {
  'rektide:interop/rng': { next },
  'wasi:cli/environment': cli.environment,
  'wasi:cli/exit': cli.exit,
  'wasi:cli/stderr': cli.stderr,
  'wasi:cli/stdin': cli.stdin,
  'wasi:cli/stdout': cli.stdout,
  'wasi:cli/terminal-input': cli.terminalInput,
  'wasi:cli/terminal-output': cli.terminalOutput,
  'wasi:cli/terminal-stdin': cli.terminalStdin,
  'wasi:cli/terminal-stdout': cli.terminalStdout,
  'wasi:cli/terminal-stderr': cli.terminalStderr,
  'wasi:io/error': io.error,
  'wasi:io/poll': io.poll,
  'wasi:io/streams': io.streams,
});

// 5. read(): five draws through the wired edge, returned as one string.
console.log(consumer.read());
