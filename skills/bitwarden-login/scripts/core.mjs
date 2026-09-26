import { createHmac } from 'node:crypto';

export class LoginError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export const fail = (code) => { throw new LoginError(code); };

export function originOf(uri) {
  if (typeof uri !== 'string' || !uri || /\s/.test(uri)) fail('invalid_origin');
  let url;
  try { url = new URL(uri.includes('://') ? uri : `https://${uri}`); }
  catch { fail('invalid_origin'); }
  if (url.protocol !== 'https:' || url.username || url.password) fail('invalid_origin');
  return url.origin;
}

export function validatePlan(plan) {
  if (plan?.version !== 1 || !Number.isSafeInteger(plan.spaceId) || plan.spaceId < 1 ||
      !/^p\d+$/.test(plan.pageLabel) || typeof plan.username !== 'string' || !plan.username ||
      !plan.query || Boolean(plan.query.id) === Boolean(plan.query.domain)) fail('invalid_plan');
  if (plan.query.id && !/^[a-f0-9-]{36}$/i.test(plan.query.id)) fail('invalid_plan');
  if (originOf(plan.origin) !== plan.origin) fail('invalid_plan');
  if (plan.query.domain && plan.query.domain !== new URL(plan.origin).hostname) fail('invalid_plan');
  if (!Array.isArray(plan.states) || !plan.states.length || plan.states.length > 24) fail('invalid_plan');
  if (!plan.states.some(s => s.result === 'success')) fail('invalid_plan');
  const names = new Set();
  for (const state of plan.states) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(state.name) || names.has(state.name) || !state.match) fail('invalid_plan');
    names.add(state.name);
    if (originOf(state.match.origin) !== state.match.origin || !state.match.selector) fail('invalid_plan');
    if (state.result && !['success', 'human_required', 'rejected'].includes(state.result)) fail('invalid_plan');
    if (state.result && (state.fill || state.click)) fail('invalid_plan');
    if (state.result === 'success' && state.match.text !== '$username') fail('invalid_plan');
    if (state.fill && state.match.origin !== plan.origin) fail('invalid_plan');
    for (const field of state.fill || []) {
      if (!['username', 'password', 'totp'].includes(field.source) || !field.selector) fail('invalid_plan');
    }
    if (!state.result && !state.click && !state.fill?.length) fail('invalid_plan');
    if (state.click && !state.click.selector) fail('invalid_plan');
  }
  return plan;
}

export function validateCredential(plan, credential) {
  if (credential.username !== plan.username) fail('account_mismatch');
  if (originOf(credential.uri) !== plan.origin) fail('credential_origin_mismatch');
  if (plan.query.id && credential.credential_id !== plan.query.id) fail('item_mismatch');
  if (!credential.password) fail('missing_password');
}

function decodeBase32(value) {
  const source = value.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!source || !/^[A-Z2-7]+$/.test(source)) fail('invalid_totp');
  let bits = 0, word = 0;
  const bytes = [];
  for (const char of source) {
    word = (word << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char);
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((word >>> bits) & 255); }
  }
  if (!bytes.length || (word & ((1 << bits) - 1)) !== 0) fail('invalid_totp');
  return Buffer.from(bytes);
}

// Agent Access 0.11.0's Bitwarden provider returns login.totp (the seed/URI).
// Derive a fresh code in process only when the website is ready to receive it.
export function totp(secret, now = Date.now()) {
  let seed = secret, algorithm = 'SHA1', digits = 6, period = 30;
  if (typeof seed !== 'string' || !seed) fail('missing_totp');
  if (seed.startsWith('otpauth://')) {
    let uri;
    try { uri = new URL(seed); } catch { fail('invalid_totp'); }
    if (uri.hostname !== 'totp') fail('unsupported_totp');
    seed = uri.searchParams.get('secret');
    algorithm = (uri.searchParams.get('algorithm') || 'SHA1').toUpperCase();
    digits = Number(uri.searchParams.get('digits') || 6);
    period = Number(uri.searchParams.get('period') || 30);
  }
  if (!['SHA1', 'SHA256', 'SHA512'].includes(algorithm) || ![6, 7, 8].includes(digits) ||
      !Number.isInteger(period) || period < 1 || period > 300 || typeof seed !== 'string') fail('unsupported_totp');
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / period)));
  const key = decodeBase32(seed);
  try {
    const digest = createHmac(algorithm.toLowerCase(), key).update(counter).digest();
    const offset = digest[digest.length - 1] & 15;
    const value = (digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits);
    return { code: String(value).padStart(digits, '0'), remainingMs: period * 1000 - (now % (period * 1000)) };
  } finally { key.fill(0); }
}

export const credentialKeys = ['username', 'password', 'totp', 'uri', 'credential_id'];
export function consumeCredential(env) {
  const credential = {};
  for (const key of credentialKeys) {
    const variable = `BWLOGIN_${key.toUpperCase()}`;
    credential[key] = env[variable];
    delete env[variable];
  }
  return credential;
}

// Never print raw exceptions: browser errors may contain submitted arguments.
export function safeFailure(error) {
  return { ok: false, status: error instanceof LoginError ? error.code : 'execution_failed' };
}
