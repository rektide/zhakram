// Tiny process helper: inherit stdio (tool output is progress, not data),
// fail loudly with the command line on non-zero exit.
import { spawn } from 'node:child_process';

export interface ExecOptions {
	cwd?: string;
}

export async function sh(cmd: string, args: string[], opts: ExecOptions = {}): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
		child.on('error', reject);
		child.on('exit', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`));
		});
	});
}
