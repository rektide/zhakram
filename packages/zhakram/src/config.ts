// Shared tool configuration: where the external binaries come from.
//
// Everything is overridable through the environment so the same commands run
// against a different zena fork or a custom wasm-tools without touching code:
//
//   ZENA_CLI     zena compiler CLI (a node script); default: the fork checkout
//                at ~/src/zena-jco-fork
//   WASM_TOOLS   wasm-tools binary (component embed/new); default: PATH
//   JCO          jco binary (transpile); default: node_modules/.bin/jco
//                found by walking up from this package, then from the cwd
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directory of this package (…/packages/zhakram). */
export const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Find `node_modules/.bin/<name>` walking up from `from`; undefined if absent. */
export function findBin(name: string, from: string = process.cwd()): string | undefined {
	for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
		const candidate = path.join(dir, 'node_modules', '.bin', name);
		if (existsSync(candidate)) return candidate;
		const parent = path.dirname(dir);
		if (parent === dir) return undefined;
	}
}

export interface ToolPaths {
	/** zena compiler CLI (a node script, invoked via `node <zenaCli> …`). */
	zenaCli: string;
	/** wasm-tools binary (component embed/new). */
	wasmTools: string;
	/** jco binary (transpile). */
	jco: string;
}

/** Resolve the external tools, honoring env overrides. */
export function toolPaths(env: NodeJS.ProcessEnv = process.env): ToolPaths {
	return {
		zenaCli: env.ZENA_CLI
			?? path.join(homedir(), 'src/zena-jco-fork/packages/cli/lib/cli.js'),
		wasmTools: env.WASM_TOOLS ?? 'wasm-tools',
		jco: env.JCO ?? findBin('jco', pkgRoot) ?? findBin('jco') ?? 'jco',
	};
}
