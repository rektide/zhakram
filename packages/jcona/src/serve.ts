// Static server + headless-browser check — the promoted, package-shaped port
// of .test-agent/serve.mjs and .test-agent/browser-check.mjs. Examples
// transpiled by jco need correct MIME for ES modules and wasm, and browser
// pages signal completion by replacing their #status element's initial
// `loading…` text (the convention every example index.html follows).
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

export const MIME: Record<string, string> = {
	'.js': 'text/javascript',
	'.mjs': 'text/javascript',
	'.html': 'text/html',
	'.css': 'text/css',
	'.json': 'application/json',
	'.wasm': 'application/wasm',
	'.wat': 'text/plain',
};

export interface ServeHandle {
	server: Server;
	url: string;
	/** Stop the server (also used as the check-serve teardown). */
	close(): Promise<void>;
}

/** Serve `root` statically with correct MIME for ES modules/wasm. */
export function serve(root: string, port = 8232): Promise<ServeHandle> {
	const rootAbs = normalize(resolve(root));
	const server = createServer(async (req, res) => {
		const url = req.url?.split('?')[0] ?? '/';
		const file = join(rootAbs, normalize(url).replace(/^(\.\.[/\\])+/, ''));
		try {
			const data = await readFile(file);
			res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
			res.end(data);
		} catch {
			res.statusCode = 404;
			res.end('not found');
		}
	});
	const url = `http://localhost:${port}`;
	return new Promise((res) => {
		server.listen(port, () => {
			console.log(`serving ${rootAbs} on ${url}`);
			res({
				server,
				url,
				close: () => new Promise<void>((done) => server.close(() => done())),
			});
		});
	});
}

export interface CheckOptions {
	timeoutMs?: number;
}

/**
 * Load `url` in headless Chrome and return the page's #status text once it
 * stops saying `loading…`. Requires the repo convention: the page replaces
 * #status (document.title mirrors it) when its async work finishes.
 */
export async function checkPage(url: string, opts: CheckOptions = {}): Promise<string> {
	let chromium;
	try {
		({ chromium } = await import('playwright'));
	} catch {
		throw new Error('playwright not found — install devDependencies (pnpm install)');
	}
	const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
	try {
		const page = await browser.newPage();
		page.on('console', (m) => console.log('[console]', m.text()));
		page.on('pageerror', (e) => console.log('[pageerror]', String(e)));
		await page.goto(url, { waitUntil: 'load' });
		await page.waitForFunction(
			() => document.getElementById('status')?.textContent !== 'loading…',
			{ timeout: opts.timeoutMs ?? 15000 },
		);
		return await page.textContent('#status');
	} finally {
		await browser.close();
	}
}
