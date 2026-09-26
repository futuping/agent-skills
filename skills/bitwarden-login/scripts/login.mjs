import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { credentialKeys, safeFailure, validatePlan } from './core.mjs';

try {
  process.umask(0o077);
  const planPath = resolve(process.argv[2]);
  const plan = validatePlan(JSON.parse(await readFile(planPath, 'utf8')));
  const args = ['run', plan.query.id ? '--id' : '--domain', plan.query.id || plan.query.domain,
    '--timeout', '120'];
  if (plan.session) {
    if (!/^[0-9a-f]{8,64}$/i.test(plan.session)) throw new Error('invalid_session');
    args.push('--session', plan.session);
  }
  for (const field of credentialKeys) args.push('--env', `BWLOGIN_${field.toUpperCase()}=${field}`);
  args.push('--', process.execPath, fileURLToPath(new URL('./bridge.mjs', import.meta.url)), planPath);
  const env = { ...process.env, RUST_LOG: 'error' };
  for (const key of Object.keys(env)) if (/^(BWLOGIN_|BW_)/.test(key)) delete env[key];
  const child = spawn('aac', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; if (output.length > 131072) child.kill(); });
  child.stderr.resume();
  const timer = setTimeout(() => child.kill('SIGTERM'), 230000);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  }).finally(() => clearTimeout(timer));
  let result;
  for (const line of output.split(/\r?\n/)) {
    try {
      const candidate = JSON.parse(line);
      if (typeof candidate.ok === 'boolean' && /^[a-z_]{1,50}$/.test(candidate.status)) result = candidate;
    } catch { /* Ignore upstream progress messages, never forward them. */ }
  }
  if (!result || typeof result.ok !== 'boolean' || !/^[a-z_]{1,50}$/.test(result.status)) {
    result = { ok: false, status: code === 4 ? 'credential_lookup_failed' : 'agent_access_unavailable', exitCode: code };
  }
  console.log(JSON.stringify({ ok: result.ok, status: result.status,
    ...(Number.isInteger(result.actions) ? { actions: result.actions } : {}),
    ...(typeof result.loginStatus === 'string' && /^[a-z_]{1,50}$/.test(result.loginStatus) ? { loginStatus: result.loginStatus } : {}),
    ...(Number.isInteger(result.exitCode) ? { exitCode: result.exitCode } : {}) }));
  process.exitCode = code === 0 && result.ok ? 0 : 1;
} catch (error) { console.log(JSON.stringify(safeFailure(error))); process.exitCode = 1; }
