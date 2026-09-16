// The pipeline: zena source → core wasm → component embed → component new,
// and the jco transpile step. Every example in this repo runs some prefix of
// these stages; jcona exists so they stop hand-rolling it.
//
// Stage intermediates keep the naming the examples already use: for an output
// `emoji.component.wasm`, the core/embed artifacts land next to it as
// `emoji.core.wasm` / `emoji.embed.wasm`.
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { exposeResourceTables } from 'jcona-observe/expose';

import { sh } from './exec.ts';
import { toolPaths } from './config.ts';

/** Strip a trailing `.component.wasm` / `.wasm` down to the bare stem. */
export function wasmStem(file: string): string {
	return path.basename(file).replace(/\.(component\.)?wasm$/, '');
}

export interface BuildOptions {
	/** Fully-qualified WIT world, e.g. `zena-jco:emoji/emoji-picker@0.1.0`. */
	world?: string;
	/** Directory holding the WIT package for `component embed`. */
	wit?: string;
	/** Output component path (default: `<src-dir>/<src-stem>.component.wasm`). */
	out?: string;
	/**
	 * Prebuilt component (e.g. a `wasm32-wasip2` cargo artifact): skip the
	 * zena/embed/new stages entirely. The artifact is used as-is (copied to
	 * `out` when given and different), so downstream steps stay uniform.
	 */
	rustArtifact?: string;
}

/** Build a component from a zena source (or pass through a rust artifact). */
export async function buildComponent(src: string, opts: BuildOptions = {}): Promise<string> {
	const tools = toolPaths();

	if (opts.rustArtifact) {
		const artifact = path.resolve(opts.rustArtifact);
		if (!opts.out || path.resolve(opts.out) === artifact) return artifact;
		const out = path.resolve(opts.out);
		await mkdir(path.dirname(out), { recursive: true });
		await copyFile(artifact, out);
		return out;
	}

	if (!opts.world || !opts.wit) {
		throw new Error('zena build needs --world <ns:pkg/world@ver> and --wit <dir>');
	}
	const srcAbs = path.resolve(src);
	const out = path.resolve(opts.out ?? setStemExt(srcAbs, 'component.wasm'));
	await mkdir(path.dirname(out), { recursive: true });
	const stem = wasmStem(out);
	const core = path.join(path.dirname(out), `${stem}.core.wasm`);
	const embed = path.join(path.dirname(out), `${stem}.embed.wasm`);

	await sh('node', [tools.zenaCli, 'build', srcAbs, '--dce', '-o', core]);
	await sh(tools.wasmTools, ['component', 'embed', path.resolve(opts.wit), core, '-o', embed,
		'--world', opts.world]);
	await sh(tools.wasmTools, ['component', 'new', embed, '-o', out]);
	return out;
}

/** `<dir>/<stem>.<ext>` for a source path whose stem has no `.zena` suffix yet. */
function setStemExt(file: string, ext: string): string {
	const base = path.basename(file).replace(/\.[^.]+$/, '');
	return path.join(path.dirname(file), `${base}.${ext}`);
}

export interface TranspileOptions {
	/** Output directory (default: `<component-dir>/<stem>-out`). */
	outDir?: string;
	/**
	 * Output base name. The transpiled entry becomes `<name>.js`; the default
	 * strips a `.component` infix, so `emoji.component.wasm` yields
	 * `emoji.js` rather than jco's raw `emoji.component.js`.
	 */
	name?: string;
	/** Extra args passed through to `jco transpile` (e.g. `-I async`). */
	extra?: string[];
	/** Inject the guarded `_util.resourceTables.snapshot()` prototype. */
	exposeResources?: boolean;
}

export interface TranspileResult {
	outDir: string;
	entry: string;
	resourceExposure?: 'transformed' | 'already-exposed' | 'skipped';
}

/** Transpile a component to JS via `jco transpile` (exnref bindgen on). */
export async function transpileComponent(component: string, opts: TranspileOptions = {}): Promise<TranspileResult> {
	const tools = toolPaths();
	const componentAbs = path.resolve(component);
	const name = opts.name ?? wasmStem(componentAbs);
	const outDir = path.resolve(opts.outDir ?? path.join(path.dirname(componentAbs), `${wasmStem(componentAbs)}-out`));
	await sh(tools.jco, ['transpile', '--bindgen-enable-wasm-exnref', '--name', name,
		componentAbs, '-o', outDir, ...(opts.extra ?? [])]);
	const entry = path.join(outDir, `${name}.js`);
	const resourceExposure = opts.exposeResources
		? (await exposeResourceTables(entry)).status
		: undefined;
	return { outDir, entry, resourceExposure };
}
