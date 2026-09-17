// Import + invocation helper for transpiled components (the `zhakram run` leg).
//
// The module-shape gotcha this exists for (found in W4, see
// examples/interop-static): jco transpile exports interface exports under the
// fully-qualified name *and* a bare alias holding an object — a command
// component gives you `m['wasi:cli/run@0.2.0'].run` and `m.run = { run }`,
// but *not* a callable `m.run`. resolveExport() finds the function through
// any of those shapes.
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { transpileComponent } from './pipeline.ts';

export interface LoadedModule {
	/** The transpiled module namespace. */
	module: unknown;
	/** Directory the module was loaded from. */
	dir: string;
	/** Entry .js file inside `dir`. */
	entry: string;
}

/**
 * Load a transpiled component. `target` is either an output directory (its
 * single top-level `.js` entry is imported) or a `.wasm` component (transpiled
 * to a temp dir first, like `jco run`).
 */
export async function loadTranspiled(target: string, opts: { extra?: string[] } = {}): Promise<LoadedModule> {
	const abs = path.resolve(target);
	let dir: string;
	if (abs.endsWith('.wasm')) {
		// Scratch dir *next to the component* (not os tmpdir): the transpiled
		// output imports bare `@bytecodealliance/preview2-shim/*` specifiers,
		// which must keep resolving through the repo's node_modules.
		const scratch = path.join(path.dirname(abs), `.${path.basename(abs, '.wasm')}-run`);
		dir = (await transpileComponent(abs, { outDir: scratch, extra: opts.extra })).outDir;
	} else {
		dir = abs;
	}
	const entries = await readdir(dir);
	const js = entries.filter((f) => f.endsWith('.js') && !f.endsWith('.d.ts'));
	if (js.length === 0) throw new Error(`no transpiled .js entry found in ${dir}`);
	if (js.length > 1) throw new Error(`ambiguous entry in ${dir}: ${js.join(', ')}`);
	const entry = path.join(dir, js[0]);
	return { module: await import(entry), dir, entry };
}

/** All export names a transpiled module exposes (for diagnostics). */
export function exportNames(m: unknown): string[] {
	return Object.keys(m as Record<string, unknown>);
}

/**
 * Resolve an exported function by name through the shapes jco emits:
 * a plain world-level export (`m.pick`), a bare interface alias
 * (`m.run.run`), or a fully-qualified interface export
 * (`m['wasi:cli/run@0.2.0'].run`).
 */
export function resolveExport(m: unknown, name: string): ((...args: unknown[]) => unknown) | undefined {
	const mod = m as Record<string, unknown>;
	const direct = mod?.[name];
	if (typeof direct === 'function') return direct as (...args: unknown[]) => unknown;
	const bare = (direct as Record<string, unknown>)?.[name];
	if (typeof bare === 'function') return bare as (...args: unknown[]) => unknown;
	for (const key of Object.keys(mod ?? {})) {
		const nested = (mod[key] as Record<string, unknown>)?.[name];
		if (typeof nested === 'function') return nested as (...args: unknown[]) => unknown;
	}
	return undefined;
}

/** The `wasi:cli/run` entry point of a command component, any shape. */
export function findRunExport(m: unknown): ((...args: unknown[]) => unknown) | undefined {
	return resolveExport(m, 'run');
}

export interface RunOptions {
	/** Export to invoke (resolved via resolveExport). Default: `wasi:cli/run`. */
	call?: string;
	/** Invoke `call` this many times (default 1). */
	repeat?: number;
	/** Extra args for the implicit transpile when target is a `.wasm`. */
	extra?: string[];
}

export interface RunResult {
	/** Return values, one per invocation. */
	results: unknown[];
	/** Process exit code (a command's `run()` result when numeric). */
	exitCode: number;
}

/** Import a transpiled dir (or component) and invoke it. */
export async function invoke(target: string, opts: RunOptions = {}): Promise<RunResult> {
	const { module } = await loadTranspiled(target, { extra: opts.extra });
	if (opts.call) {
		const fn = resolveExport(module, opts.call);
		if (!fn) {
			throw new Error(`export '${opts.call}' not found; available: ${exportNames(module).join(', ')}`);
		}
		const results: unknown[] = [];
		for (let i = 0; i < (opts.repeat ?? 1); i++) results.push(await fn());
		return { results, exitCode: 0 };
	}
	const run = findRunExport(module);
	if (!run) {
		throw new Error(`no wasi:cli/run export and no --call given; available: ${exportNames(module).join(', ')}`);
	}
	const result = await run();
	return { results: [result], exitCode: typeof result === 'number' ? result : 0 };
}
