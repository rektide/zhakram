import { defineConfig } from 'tsdown';

// Browser-facing ESM build: examples serve /packages/jcona-otel/dist/tracing.js
// through an import-map entry (node hosts import the .ts source directly).
export default defineConfig({
	entry: ['src/tracing.ts'],
	format: 'esm',
	dts: false,
	target: 'es2022',
});
