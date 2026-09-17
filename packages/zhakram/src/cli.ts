#!/usr/bin/env node
// zhakram — the pipeline tool for this repo (single bin, hand-rolled parsing;
// see README.md for the alternatives considered).
import process from 'node:process';

import { invoke } from './run.ts';
import { buildComponent, transpileComponent } from './pipeline.ts';
import { checkPage, serve } from './serve.ts';

const USAGE = `usage: zhakram <command> [args]

commands:
  build <src.zena> --world <ns:pkg/world@ver> --wit <dir> [-o out.component.wasm]
      zena build --dce → wasm-tools component embed → component new.
      --rust-artifact <wasm>   use a prebuilt component (wasm32-wasip2 cargo
                               artifact): skip zena/embed/new, copy to -o
  transpile <component.wasm> [-o dir] [--name name] [--expose-resources] [-- <jco args…>]
	  jco transpile --bindgen-enable-wasm-exnref; entry becomes <name>.js
	  (default name: component stem without .component)
	  --expose-resources       guarded jco 1.33 transform adding
	                           _util.resourceTables.snapshot()
  run <dir|component.wasm> [--call export] [--repeat n]
      import a transpiled dir (or transpile a component first) and invoke it.
      Default invocation: the wasi:cli/run export (command components);
      --call resolves bare aliases and fully-qualified interfaces alike
      (the m['wasi:cli/run@0.2.0'].run / m.run.run shape)
  serve <dir> [--port n] [--check page.html]
      static server with ES-module/wasm MIME; --check loads the page in
      headless Chrome and prints its #status once it stops saying loading…

env: ZENA_CLI (zena fork cli.js), WASM_TOOLS, JCO — see src/config.ts`;

interface Flags {
	positional: string[];
	string: Record<string, string | undefined>;
	numbers: Record<string, number | undefined>;
	boolean: Record<string, boolean | undefined>;
	extra: string[];
}

function parse(argv: string[]): Flags {
	const flags: Flags = { positional: [], string: {}, numbers: {}, boolean: {}, extra: [] };
	const stringFlags = new Set(['world', 'wit', 'o', 'out', 'rust-artifact', 'name', 'call', 'check']);
	const numberFlags = new Set(['port', 'repeat']);
	const booleanFlags = new Set(['expose-resources']);
	const shortFlags: Record<string, string> = { '-o': 'out' };
	let passthrough = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (passthrough) {
			flags.extra.push(arg);
		} else if (arg === '--') {
			passthrough = true;
		} else if (arg === '-h' || arg === '--help') {
			flags.string.help = '1';
		} else if (arg.startsWith('--')) {
			const eq = arg.indexOf('=');
			const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
			if (!stringFlags.has(name) && !numberFlags.has(name) && !booleanFlags.has(name)) {
				throw new Error(`unknown flag --${name}\n\n${USAGE}`);
			}
			if (booleanFlags.has(name)) {
				if (eq !== -1) throw new Error(`--${name} does not take a value\n\n${USAGE}`);
				flags.boolean[name] = true;
				continue;
			}
			const v = eq === -1 ? argv[++i] : arg.slice(eq + 1);
			if (v === undefined) throw new Error(`--${name} needs a value\n\n${USAGE}`);
			if (numberFlags.has(name)) flags.numbers[name] = Number(v);
			else flags.string[name] = v;
		} else if (shortFlags[arg]) {
			const name = shortFlags[arg];
			const v = argv[++i];
			if (v === undefined) throw new Error(`${arg} needs a value\n\n${USAGE}`);
			flags.string[name] = v;
		} else {
			flags.positional.push(arg);
		}
	}
	return flags;
}

const command = process.argv[2];
const argv = process.argv.slice(3);
if (!command || command === 'help' || command === '--help') {
	console.log(USAGE);
	process.exit(command ? 0 : 1);
}
const flags = parse(argv);
if (flags.string.help) {
	console.log(USAGE);
	process.exit(0);
}
const out = (f: Flags): string | undefined => f.string.out ?? f.string.o;

try {
	switch (command) {
		case 'build': {
			const [src] = flags.positional;
			if (!src && !flags.string['rust-artifact']) {
				throw new Error('build needs a <src.zena> (or --rust-artifact)\n\n' + USAGE);
			}
			const component = await buildComponent(src ?? '', {
				world: flags.string.world,
				wit: flags.string.wit,
				out: out(flags),
				rustArtifact: flags.string['rust-artifact'],
			});
			console.log(`component: ${component}`);
			break;
		}
		case 'transpile': {
			const [component] = flags.positional;
			if (!component) throw new Error('transpile needs a <component.wasm>\n\n' + USAGE);
			const { outDir, entry, resourceExposure } = await transpileComponent(component, {
				outDir: out(flags),
				name: flags.string.name,
				extra: flags.extra,
				exposeResources: flags.boolean['expose-resources'],
			});
			console.log(`entry: ${entry}`);
			console.log(`out: ${outDir}`);
			if (resourceExposure) console.log(`resource exposure: ${resourceExposure}`);
			break;
		}
		case 'run': {
			const [target] = flags.positional;
			if (!target) throw new Error('run needs a <dir|component.wasm>\n\n' + USAGE);
			const { results, exitCode } = await invoke(target, {
				call: flags.string.call,
				repeat: flags.numbers.repeat,
			});
			const render = (v: unknown) => typeof v === 'string' ? v : JSON.stringify(v);
			if (flags.string.call) console.log(results.map(render).join(' '));
			process.exit(exitCode);
		}
		case 'serve': {
			const [dir] = flags.positional;
			if (!dir) throw new Error('serve needs a <dir>\n\n' + USAGE);
			const handle = await serve(dir, flags.numbers.port ?? 8232);
			if (flags.string.check) {
				const page = flags.string.check.replace(/^\/+/, '');
				const status = await checkPage(`${handle.url}/${page}`);
				console.log('STATUS:', status);
				const failed = /FAIL|ERROR/.test(status ?? '');
				await handle.close();
				process.exit(failed ? 1 : 0);
			}
			// No --check: keep serving until interrupted.
			process.on('SIGINT', () => handle.close().then(() => process.exit(0)));
			break;
		}
		default:
			throw new Error(`unknown command '${command}'\n\n${USAGE}`);
	}
} catch (e) {
	console.error(String(e instanceof Error && e.message ? e.message : e));
	process.exit(1);
}
