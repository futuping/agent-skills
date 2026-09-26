import { LoginError, fail, totp, validateCredential, validatePlan } from './core.mjs';

// Runs in the page; returns state names only, never input values or page text.
export function observeState({ states, username, previous }) {
  const visible = el => el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
  for (const state of states) {
    const m = state.match;
    if (location.origin !== m.origin || (m.pathPrefix && !location.pathname.startsWith(m.pathPrefix))) continue;
    const text = m.text === '$username' ? username : m.text;
    const matches = [...document.querySelectorAll(m.selector)].filter(el => visible(el) &&
      (!text || `${el.textContent || ''} ${el.getAttribute('aria-label') || ''}`.includes(text)));
    if (matches.length === 1) return state.name === previous ? false : state.name;
  }
  return false;
}

export function applyAction({ origin, fields, click }) {
  if (location.origin !== origin) return { ok: false, status: 'origin_changed' };
  const visible = el => el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
  const inputs = [];
  for (const field of fields) {
    const nodes = [...document.querySelectorAll(field.selector)].filter(visible);
    if (nodes.length !== 1 || !(nodes[0] instanceof HTMLInputElement) || nodes[0].disabled ||
        nodes[0].readOnly) return { ok: false, status: 'field_unavailable' };
    inputs.push([nodes[0], field.value]);
  }
  let submit;
  if (click) {
    const nodes = [...document.querySelectorAll(click.selector)].filter(el => visible(el) &&
      (!click.text || `${el.textContent || ''} ${el.getAttribute('aria-label') || ''}`.includes(click.text)));
    if (nodes.length !== 1 || nodes[0].disabled) return { ok: false, status: 'control_unavailable' };
    submit = nodes[0];
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  for (const [input, value] of inputs) {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (input.value !== value) return { ok: false, status: 'fill_failed' };
  }
  // DOM interaction avoids native focus, keyboard/clipboard and foreground activation.
  if (submit) submit.click();
  return { ok: true };
}

export async function runPlan(page, plan, credential) {
  validatePlan(plan);
  validateCredential(plan, credential);
  return runWithValues(page, plan, async source => {
    if (source !== 'totp') return credential[source];
    let generated = totp(credential.totp);
    if (generated.remainingMs < 5000) {
      await new Promise(resolve => setTimeout(resolve, generated.remainingMs + 50));
      generated = totp(credential.totp);
    }
    return generated.code;
  });
}

// A value supplier runs locally and only when the verified destination is ready.
// onSubmit lets adapters prohibit route changes after a credential submission.
export async function runWithValues(page, plan, getValue, onSubmit = () => {}) {
  validatePlan(plan);
  const started = Date.now();
  const args = { states: plan.states, username: plan.username };
  const visits = new Map();
  let previous = null;
  for (let actions = 0; actions <= 12 && Date.now() - started < 90000; actions++) {
    let name;
    try {
      // Separate conditions from actions; never retry a submitted password/code.
      await page.waitForFunction(observeState, { ...args, previous }, { timeout: 15000 });
      name = await page.evaluate(observeState, args);
    } catch { fail('unrecognized_page'); }
    const state = plan.states.find(s => s.name === name);
    if (!state) fail('unrecognized_page');
    if (state.result) return { ok: state.result === 'success', status: state.result, actions };
    if (actions === 12) fail('action_limit');
    const limit = state.fill?.length ? 1 : Math.min(state.maxVisits || 1, 2);
    visits.set(name, (visits.get(name) || 0) + 1);
    if (visits.get(name) > limit) fail('repeated_step');
    if (new URL(await page.url()).origin !== state.match.origin) fail('origin_changed');
    const fields = [];
    let result;
    try {
      for (const field of state.fill || []) {
        const value = await getValue(field.source);
        if (!value) fail(`missing_${field.source}`);
        fields.push({ selector: field.selector, value });
      }
      // Mark before dispatch: a transport error may arrive after a real click.
      if (state.fill?.some(f => f.source !== 'username')) onSubmit();
      try { result = await page.evaluate(applyAction, { origin: state.match.origin, fields, click: state.click }); }
      catch { throw new LoginError('interaction_failed'); }
    }
    finally { for (const field of fields) field.value = ''; }
    if (!result?.ok) fail(result?.status || 'interaction_failed');
    previous = name;
  }
  fail('action_limit');
}
