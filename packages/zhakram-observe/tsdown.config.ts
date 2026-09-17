import { defineConfig } from 'tsdown';

// Only the pure observation layer is browser-facing. The package root also
// exports the Node-only post-transpile transform from src/expose.ts.
export default defineConfig({
	entry: ['src/observe.ts'],
	format: 'esm',
	dts: false,
	target: 'es2022',
});
