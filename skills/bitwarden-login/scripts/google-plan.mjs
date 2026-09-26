// Selectors grounded in the observed Google password/TOTP login flow.
// Private usernames and vault IDs are supplied at runtime and never stored here.
export function googlePlan({ spaceId, pageLabel = 'p1', username, itemId, guardIdentifier }) {
  const auth = 'https://accounts.google.com';
  const account = 'https://myaccount.google.com';
  const state = (name, selector, text, click, extra = {}) => ({ name, match: { origin: auth, selector, ...(text ? { text } : {}) }, click, ...extra });
  return { version: 1, spaceId, pageLabel, username, origin: auth, query: { id: itemId },
    ...(guardIdentifier ? { guardIdentifier } : {}), states: [
      { name: 'google_rejected', match: { origin: auth, pathPrefix: '/v3/signin/rejected', selector: 'h1', text: 'Couldn’t sign you in' }, result: 'rejected' },
      { name: 'signed_in', match: { origin: account, selector: 'a[aria-label^="Google Account:"]', text: '$username' }, result: 'success' },
      state('totp', 'input[name="totpPin"]', null, { selector: 'button', text: 'Next' }, { fill: [{ source: 'totp', selector: 'input[name="totpPin"]' }] }),
      state('password', 'input[name="Passwd"]', null, { selector: 'button', text: 'Next' }, { fill: [{ source: 'password', selector: 'input[name="Passwd"]' }] }),
      state('username', 'input[name="identifier"]', null, { selector: 'button', text: 'Next' }, { fill: [{ source: 'username', selector: 'input[name="identifier"]' }] }),
      state('authenticator_option', 'a,[role="link"]', 'Google Authenticator', { selector: 'a,[role="link"]', text: 'Google Authenticator' }),
      state('password_option', 'a,[role="link"]', 'Enter your password', { selector: 'a,[role="link"]', text: 'Enter your password' }),
      { name: 'skip_optional_selfie', match: { origin: account, pathPrefix: '/verification/selfie/', selector: 'a[aria-label="Not now"]' }, click: { selector: 'a[aria-label="Not now"]' } },
      state('alternative_method', 'button', 'Try another way', { selector: 'button', text: 'Try another way' }, { maxVisits: 2 }),
    ] };
}
