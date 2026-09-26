// Opt-in integration check. Only the official example provider is auto-approved.
// Refuse to touch an existing Agent Access identity/session directory.
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.umask(0o077);
const stateDirectory = join(homedir(), '.access-protocol');
const root = fileURLToPath(new URL('../', import.meta.url));
let listener, remote, directory, createdState = false;
const stop = child => { if (child?.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} } };
const strip = value => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
const frontmost = () => execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', 'ObjC.import("AppKit"); $.NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier.js;'], { encoding: 'utf8' }).trim();
try {
  let exists = true;
  try { await access(stateDirectory); } catch { exists = false; }
  if (exists) throw new Error('existing_agent_access_state');
  const spaceId = Number(process.argv[2]);
  if (!Number.isSafeInteger(spaceId)) throw new Error('missing_task_space');
  directory = await mkdtemp(join(tmpdir(), 'aac-demo-'));
  const planPath = join(directory, 'plan.json');
  await writeFile(planPath, JSON.stringify({ version: 1, spaceId, pageLabel: 'p1',
    username: 'alice@example.com', origin: 'https://example.com', query: { domain: 'example.com' }, states: [
      { name: 'password', match: { origin: 'https://example.com', selector: '#password' }, fill: [{ source: 'password', selector: '#password' }], click: { selector: '#next' } },
      { name: 'success', match: { origin: 'https://example.com', selector: '#account', text: '$username' }, result: 'success' },
    ] }), { mode: 0o600 });
  // Directory was absent and belongs only to this demo. Do not reuse real trust.
  await mkdir(stateDirectory, { mode: 0o700 }); createdState = true;
  listener = spawn('python3', [join(root, 'tests/pty-relay.py'), 'aac', 'listen', '--provider', 'example'], {
    detached: true, env: { ...process.env, TERM: 'xterm-256color', COLUMNS: '180', LINES: '45' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  listener.stdin.on('error', () => {});
  listener.stderr.resume();
  let screen = '', fingerprintApproved = false, named = false, credentialApproved = false;
  let resolveToken, rejectToken;
  const tokenPromise = new Promise((resolve, reject) => { resolveToken = resolve; rejectToken = reject; });
  listener.once('error', () => rejectToken(new Error('demo_provider_failed')));
  listener.once('exit', () => rejectToken(new Error('demo_provider_failed')));
  listener.stdout.on('data', chunk => {
    screen = (screen + strip(chunk.toString())).slice(-250000);
    const match = screen.match(/RENDEZVOUS CODE:\s*([A-Z0-9-]{9,20})/i);
    if (match) resolveToken(match[1]);
    if (!fingerprintApproved && screen.includes('Do the fingerprints match?')) {
      fingerprintApproved = true; listener.stdin.write('y'); screen = '';
    } else if (!named && /Name\s*this\s*connection/.test(screen)) {
      named = true; listener.stdin.write('isolated-demo\r'); screen = '';
    } else if (!credentialApproved && /Send\s*credential\s*for\s*example\.com/.test(screen)) {
      credentialApproved = true; listener.stdin.write('y'); screen = '';
    }
  });
  let pairingTimer;
  const token = await Promise.race([tokenPromise, new Promise((_, reject) => {
    pairingTimer = setTimeout(() => reject(new Error('demo_pairing_timeout')), 20000);
  })]).finally(() => clearTimeout(pairingTimer));
  const before = frontmost();
  remote = spawn(process.execPath, [join(root, 'skills/bitwarden-login/scripts/login.mjs'), planPath], {
    detached: true, env: { ...process.env, AAC_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  remote.stdout.on('data', chunk => { output += chunk; });
  remote.stderr.resume();
  const timer = setTimeout(() => stop(remote), 45000);
  const code = await new Promise((resolve, reject) => { remote.once('error', reject); remote.once('close', resolve); }).finally(() => clearTimeout(timer));
  const result = JSON.parse(output.trim() || '{"ok":false,"status":"demo_timeout"}');
  const after = frontmost();
  console.log(JSON.stringify({ demo: true, ok: code === 0 && result.ok, status: result.status,
    sameForegroundApplication: before === after, egoForegroundAfter: after === 'com.citrolabs.ego.lite', provider: 'example',
    fingerprintApproved, named, credentialApproved,
    approvalPromptSeen: /approve/i.test(screen), requestSeen: /Credential\s*request/i.test(screen) }));
  process.exitCode = code === 0 && result.ok ? 0 : 1;
} catch (error) {
  console.log(JSON.stringify({ demo: true, ok: false, status: ['existing_agent_access_state', 'missing_task_space', 'demo_pairing_timeout'].includes(error.message) ? error.message : 'demo_failed' }));
  process.exitCode = 1;
} finally {
  stop(remote); stop(listener);
  if (createdState) {
    // Only files created by this refused-if-existing test are removed.
    await rm(stateDirectory, { recursive: true, force: true });
  }
  if (directory) await rm(directory, { recursive: true, force: true });
}
