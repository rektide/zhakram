#!/usr/bin/env node
// interop-matrix — {generator: zena|rust} × {consumer: zena|rust|js} ×
// {mode: jshost|static}.
//
//   generator  rng-rs (crates/rng-rs, interface export) or rng-zena
//              (zena/rng-zena.zena — rng-source-both world: the
//              rektide:interop/rng interface export via @exportName's
//              mangled core name, plus a flat world-level `next`)
//   consumer   consume-rs (lib, read() -> string), consume-zena
//              (read() -> string via indirect cabi), or js (the host itself)
//   jshost     JS host instantiates both and wires rng.next through the
//              instantiation imports object (jco -I mode)
//   static     wac plug fuses the generator into the consumer at build
//              time; jco transpile + node calls read()
//
// Deterministic expectations: rust generator draws 49,-56,-78,34,80 (fixed
// xorshift64* seed); the zena generator's draws must match the BigInt model
// of zena/rng-zena.zena (xorshift64, seed 42) below.
//
// Usage: node run.mjs [--browser]
//   --browser  additionally run index.html (jshost cells) via
//              .test-agent/serve.mjs + .test-agent/browser-check.mjs
import { execFile as execFileCb } from 'node:child_process';
import { rm, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as cli from '@bytecodealliance/preview2-shim/cli';
import * as io from '@bytecodealliance/preview2-shim/io';

const execFile = promisify(execFileCb);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const jco = path.join(root, 'node_modules/.bin/jco');
const zenaCli = process.env.ZENA_CLI
  ?? path.join(homedir(), 'src/zena-jco-fork/packages/cli/lib/cli.js');

const RUST_SEQ = [49, -56, -78, 34, 80];

/// BigInt model of zena/rng-zena.zena — xorshift64, seed 42, output
/// int32(state & 0xffffffff) % 100.
function zenaModelSeq(count = 5) {
  const M64 = (1n << 64n) - 1n;
  let s = 42n;
  const out = [];
  for (let i = 0; i < count; i++) {
    s ^= (s << 13n) & M64;
    s ^= s >> 7n;
    s ^= (s << 17n) & M64;
    out.push(Number(BigInt.asIntN(32, s & 0xffffffffn)) % 100);
  }
  return out;
}

const expected = { rust: RUST_SEQ, zena: zenaModelSeq() };

async function run(cmd, args) {
  const { stdout } = await execFile(cmd, args, { cwd: here });
  return stdout;
}

async function transpile(component, outDir, extra = []) {
  await run(jco, ['transpile', '--bindgen-enable-wasm-exnref', ...extra, component, '-o', outDir]);
}

// The WASI namespaces consume-rs needs in -I mode (the zena consumer and
// both generators import nothing WASI).
const wasiImports = {
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
};

// ---------------------------------------------------------------- build

async function buildRust() {
  await run(path.join(here, '../interop-static/build.sh'), []);
  await mkdir(path.join(here, 'build'), { recursive: true });
}

async function buildZena() {
  await mkdir(path.join(here, 'build'), { recursive: true });
  for (const [src, name, world] of [
    ['zena/rng-zena.zena', 'rng-zena', 'rektide:interop/rng-source-both@0.1.0'],
    ['zena/consume-zena.zena', 'consume-zena', 'rektide:interop/rng-reader-flat@0.1.0'],
  ]) {
    await run('node', [zenaCli, 'build', src, '--dce', '-o', `build/${name}.core.wasm`]);
    await run('wasm-tools', ['component', 'embed', 'wit', `build/${name}.core.wasm`,
      '-o', `build/${name}.embed.wasm`, '--world', world]);
    await run('wasm-tools', ['component', 'new', `build/${name}.embed.wasm`,
      '-o', `build/${name}.component.wasm`]);
  }
}

// ---------------------------------------------------------------- cells

const importCache = new Map();
async function loadModule(relPath) {
  if (!importCache.has(relPath)) {
    importCache.set(relPath, import(path.join(here, relPath)));
  }
  return importCache.get(relPath);
}

/// jshost generator handles: instantiate fresh (fresh linear memory → fresh
/// PRNG state) and expose a bare next().
async function jshostGenerator(gen) {
  if (gen === 'rust') {
    const m = await loadModule('build/rng-rs-out/rng_rs.js');
    const inst = await m.instantiate();
    return { next: inst.rng.next };
  }
  const m = await loadModule('build/rng-zena-out/rng-zena.component.js');
  const inst = await m.instantiate();
  return { next: inst.next };
}

async function jshostConsume(consumer, genHandle) {
  const imports = { 'rektide:interop/rng': { next: genHandle.next } };
  if (consumer === 'rust') {
    const m = await loadModule('build/consume-rs-out/consume_rs.js');
    const inst = await m.instantiate(undefined, { ...imports, ...wasiImports });
    return inst.read();
  }
  const m = await loadModule('build/consume-zena-out/consume-zena.component.js');
  const inst = await m.instantiate(undefined, imports);
  return inst.read();
}

async function jsConsume(genHandle) {
  const draws = [];
  for (let i = 0; i < 5; i++) draws.push(genHandle.next());
  return draws.join(',');
}

async function cellJshost(gen, consumer) {
  const genHandle = await jshostGenerator(gen);
  const out = consumer === 'js'
    ? await jsConsume(genHandle)
    : await jshostConsume(consumer, genHandle);
  return { out, want: expected[gen].join(',') };
}

async function cellStatic(gen, consumer) {
  if (consumer === 'js') {
    return { na: 'the JS consumer is the host — nothing to statically compose' };
  }
  const socket = consumer === 'rust' ? '../interop-static/build/consume_rs.wasm'
    : 'build/consume-zena.component.wasm';
  const plug = gen === 'rust' ? '../interop-static/build/rng_rs.wasm'
    : 'build/rng-zena.component.wasm';
  const name = `static-${gen}-${consumer}`;
  try {
    await run('wac', ['plug', socket, '--plug', plug, '-o', `build/${name}.wasm`]);
  } catch (e) {
    const detail = (e.stderr ?? e.message ?? String(e)).trim().split('\n')[0];
    // The zena generator exports the rng interface (mangled core name via
    // @exportName), so every plug should compose now — any wac failure is
    // a real failure.
    throw new Error(`wac plug failed unexpectedly: ${detail}`);
  }
  await transpile(`build/${name}.wasm`, `build/${name}-out`);
  const m = await loadModule(`build/${name}-out/${name}.js`);
  return { out: m.read(), want: expected[gen].join(',') };
}

// ---------------------------------------------------------------- main

const results = [];
function record(gen, consumer, mode, r) {
  if (r.na) results.push({ gen, consumer, mode, status: 'N/A', detail: r.na });
  else if (r.skip) results.push({ gen, consumer, mode, status: 'SKIP', detail: r.skip });
  else results.push({
    gen, consumer, mode,
    status: r.out === r.want ? 'PASS' : 'FAIL',
    detail: `got ${JSON.stringify(r.out)}, want ${JSON.stringify(r.want)}`,
  });
}

await rm(path.join(here, 'build'), { recursive: true, force: true });
await buildRust();
await buildZena();
await transpile('../interop-static/build/rng_rs.wasm', 'build/rng-rs-out', ['-I', 'async']);
await transpile('../interop-static/build/consume_rs.wasm', 'build/consume-rs-out', ['-I', 'async']);
await transpile('build/rng-zena.component.wasm', 'build/rng-zena-out', ['-I', 'async']);
await transpile('build/consume-zena.component.wasm', 'build/consume-zena-out', ['-I', 'async']);

for (const gen of ['rust', 'zena']) {
  for (const consumer of ['rust', 'zena', 'js']) {
    for (const mode of ['jshost', 'static']) {
      try {
        record(gen, consumer, mode,
          mode === 'jshost' ? await cellJshost(gen, consumer)
            : await cellStatic(gen, consumer));
      } catch (e) {
        results.push({
          gen, consumer, mode, status: 'FAIL',
          detail: String(e.message ?? e).split('\n')[0],
        });
      }
    }
  }
}

// Browser row for the jshost cells (index.html re-runs them under an import
// map with the shim browser builds).
if (process.argv.includes('--browser')) {
  const { spawn } = await import('node:child_process');
  const server = spawn('node', [path.join(root, '.test-agent/serve.mjs'), root, '8234'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((res) => server.stdout.on('data', res));
  try {
    const out = await run('node', [path.join(root, '.test-agent/browser-check.mjs'),
      'http://localhost:8234/examples/interop-matrix/index.html']);
    const status = /INTEROP-MATRIX-BROWSER-OK/.test(out) ? 'PASS'
      : /EMOJI|MATRIX/.test(out) ? 'FAIL' : 'FAIL';
    results.push({
      gen: '*', consumer: '*', mode: 'browser', status,
      detail: status === 'PASS' ? 'jshost cells green under Chrome (import map + shim browser builds)'
        : out.trim().split('\n').pop(),
    });
  } finally {
    server.kill();
  }
}

const w = Math.max(...['generator', ...results.map((r) => r.gen)].map((s) => s.length));
const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('generator', w)}  consumer  mode     status  detail`);
console.log(`${pad('-'.repeat(w), w)}  -------   -----    ------  ------`);
for (const r of results) {
  console.log(`${pad(r.gen, w)}  ${pad(r.consumer, 9)}  ${pad(r.mode, 8)}  ${pad(r.status, 6)}  ${r.detail}`);
}
const failed = results.filter((r) => r.status === 'FAIL');
console.log(`\n${results.filter((r) => r.status === 'PASS').length} pass, `
  + `${results.filter((r) => r.status === 'SKIP').length} skip, `
  + `${results.filter((r) => r.status === 'N/A').length} n/a, `
  + `${failed.length} fail`);
process.exit(failed.length ? 1 : 0);
