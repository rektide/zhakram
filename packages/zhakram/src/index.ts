// zhakram library surface — everything the bin wires together, importable for
// hosts that drive the pipeline programmatically (the interop-matrix style).
export { findBin, pkgRoot, toolPaths, type ToolPaths } from './config.ts';
export { sh } from './exec.ts';
export {
	buildComponent,
	transpileComponent,
	wasmStem,
	type BuildOptions,
	type TranspileOptions,
	type TranspileResult,
} from './pipeline.ts';
export {
	exportNames,
	findRunExport,
	invoke,
	loadTranspiled,
	resolveExport,
	type LoadedModule,
	type RunOptions,
	type RunResult,
} from './run.ts';
export { checkPage, MIME, serve, type CheckOptions, type ServeHandle } from './serve.ts';
