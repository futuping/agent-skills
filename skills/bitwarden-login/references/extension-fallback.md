# Bitwarden extension fallback in ego-browser

Use this only when the correct native autofill suggestion cannot be operated.
Keep the login page open and use one temporary extension page in the same task
space. Retain it for both password and TOTP; close it at task completion.

## Discover once, then reuse

Reuse an extension ID and UI route already observed in this session. Otherwise,
open `chrome://extensions/` once, confirm the enabled **Bitwarden Password
Manager**, and obtain its ID. The standard Chrome Web Store ID is
`nngceckbapebfimnlniiiahkandclblb`; verify it is actually installed. The UI route
observed in extension 2026.9.2 is:

```text
chrome-extension://<observed-extension-id>/popup/index.html
```

This extension-owned URL and the selectors below are implementation details,
not a stable public automation API. Inspect the current controls if they differ.
Opening the extension as a tab may lose its association with the website, so do
not assume its **Autofill** button targets the login page. Use scoped copy
controls for this fallback.

Search the vault once, preferably by the intended website or exact username.
Search results may contain the same username for several unrelated websites.
Inspect only item names, usernames, website URIs, and control labels needed to
select the exact item. Do not dump all search results or item details. If the
URI is not yet known, open that one item's details and extract only its Website
field and Username, excluding Password, TOTP, and Notes.

The observed search input is `input[name="searchText"]`. Item view controls
have labels such as `View item - Example - user@example.com`. Quick-copy
controls may be present on a list row, depending on existing settings. Scope
**Copy password** and **Copy verification code** to that row. If quick-copy
controls are absent, open the exact item and use its existing copy controls;
do not change settings to expose them. Never choose the first global copy
button in a list containing multiple items.

Keep transient page labels and selectors in the current task context. Do not
save personal accounts, vault item IDs, credentials, notes, screenshots, or
login-session URLs into this skill or the repository.

## Batch a verified copy and paste

Adapt this pattern to already-observed selectors. `page` is the login page,
`vault` is the temporary Bitwarden page, and `copySelector` identifies the
selected item's copy control. `fieldSelector` is a unique top-document input;
this example does not authorize filling cross-origin frames.

```js
const expectedOrigin = "https://accounts.example.com";
const fieldSelector = 'input[name="password"]';
const copySelector = 'button[aria-label="Copy password"]'; // Unique item detail.

async function verifyDestination() {
  if (new URL(await page.url()).origin !== expectedOrigin) {
    throw new Error("Unexpected login origin");
  }
}

await verifyDestination();
// Prevent an unsuccessful copy from reusing stale clipboard contents.
await vault.evaluate(async () => { await navigator.clipboard.writeText(""); });
let filled = false;
try {
  await vault.click(copySelector);
  await verifyDestination();
  await page.click(fieldSelector);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("ControlOrMeta+V");
  filled = await page.evaluate((selector) => {
    const inputs = document.querySelectorAll(selector);
    return inputs.length === 1 && inputs[0].value.length > 0;
  }, fieldSelector);
} finally {
  await vault.evaluate(async () => { await navigator.clipboard.writeText(""); });
}
if (!filled) throw new Error("Credential was not filled; do not submit");
// Click the observed submit control, wait for the next step, observe once.
```

For TOTP use the same verified item, its **Copy verification code** button, and
the site's observed code input. Verify only the expected code shape as a
boolean. A missing code is not permission to inspect or extract the TOTP seed.
If clipboard operations are denied, stop this fallback; do not grant clipboard
permissions or read secrets into tool output to work around the failure.

Masking passwords does not make a page snapshot secret-free. A TOTP can remain
visible after filling. Use a metadata-only observation until the login form is
gone, then inspect the success page. Do not expand the vault or browse other
items once the selected item has provided the required credentials.

## Verified scope

On 2026-09-26, this fallback completed a Google password-plus-TOTP login using
ego-browser API v2 and Bitwarden extension 2026.9.2, resuming an existing login
flow. Both secrets stayed in the local copy/paste path, the clipboard was
cleared after each transfer, an optional enrollment offer was skipped, and the
requested account's home page confirmed success. No usable native autofill
suggestion appeared in that run; that path was not validated by this test.
Other websites may need different field selectors and offer additional
verification challenges.
