import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { consumeCredential, safeFailure, validateCredential, validatePlan } from './core.mjs';
import { serveOnce } from './channel.mjs';

let channel, credential;
try {
  process.umask(0o077);
  credential = consumeCredential(process.env);
  const plan = validatePlan(JSON.parse(await readFile(process.argv[2], 'utf8')));
  validateCredential(plan, credential);
  channel = await serveOnce({ plan, credential });
  const runner = new URL('./ego-runner.mjs', import.meta.url).href;
  const source = `const {runFromSocket}=await import(${JSON.stringify(runner)});\nawait runFromSocket(${JSON.stringify({ socketPath: channel.socketPath, nonce: channel.nonce })},{taskSpace});`;
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(BWLOGIN_|BW_|AAC_)/.test(key)) delete env[key];
  const child = spawn('ego-browser', ['nodejs'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const timer = setTimeout(() => child.kill('SIGTERM'), 100000);
  let output = '';
  const collect = chunk => {
    output += chunk.toString();
    if (output.length > 131072) child.kill('SIGTERM');
  };
  child.stdout.on('data', collect);
  // ego routes console output to stderr. Parse only our marker from either
  // stream; never forward raw browser diagnostics or submitted arguments.
  child.stderr.on('data', collect);
  child.stdin.on('error', () => {});
  child.stdin.end(source);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  }).finally(() => clearTimeout(timer));
  const line = output.split('\n').find(line => line.startsWith('BWLOGIN_RESULT '));
  const result = line ? JSON.parse(line.slice(15)) : { ok: false, status: 'browser_unavailable' };
  // Only this allowlisted shape crosses into the model's tool output.
  if (typeof result.ok !== 'boolean' || !/^[a-z_]{1,50}$/.test(result.status)) throw new Error('invalid_result');
  console.log(JSON.stringify({ ok: result.ok, status: result.status,
    ...(Number.isInteger(result.actions) ? { actions: result.actions } : {}),
    ...(typeof result.loginStatus === 'string' && /^[a-z_]{1,50}$/.test(result.loginStatus) ? { loginStatus: result.loginStatus } : {}) }));
  process.exitCode = code === 0 && result.ok ? 0 : 1;
} catch (error) {
  console.log(JSON.stringify(safeFailure(error)));
  process.exitCode = 1;
} finally {
  if (channel) await channel.close();
  if (credential) for (const key of Object.keys(credential)) credential[key] = '';
}
