# Shared login plan

Inspect the current website once and use observed selectors and transitions.
`scripts/google-plan.mjs` contains the previously observed Google password/TOTP
flow; verify its controls still match before using it. Both routes use the same
bounded engine. Plans contain routing metadata only, never credentials.

Save a plan outside the repository, for example under
`~/.cache/bitwarden-login/` with directory mode 0700 and file mode 0600:

```json
{
  "version": 1,
  "spaceId": 7,
  "pageLabel": "p1",
  "username": "user@example.com",
  "origin": "https://accounts.example.com",
  "query": { "id": "00000000-0000-0000-0000-000000000001" },
  "states": [
    {
      "name": "password",
      "match": { "origin": "https://accounts.example.com", "selector": "#password" },
      "fill": [{ "source": "password", "selector": "#password" }],
      "click": { "selector": "button[type=submit]" }
    },
    {
      "name": "signed_in",
      "match": { "origin": "https://accounts.example.com", "selector": "#account", "text": "$username" },
      "result": "success"
    }
  ]
}
```

Add `guardIdentifier` returned by `prepareBackground` if a passkey guard is
already installed. Executors renew and remove it. If abandoning the plan,
remove the guard or close the agent-created page.

Use an exact `query.id` for the extension. Agent Access also supports
`query.domain` for a unique hostname match and optional `session` for the
intended paired-provider fingerprint. The saved URI must match `origin`
exactly after HTTPS normalization, and the username must match the account.

State matchers need one visible CSS match. Optional `text` matches text or
accessible label; `pathPrefix` narrows the URL path. Fill sources are `username`,
`password` and `totp`. Terminal states are `success`, `human_required` and
`rejected`. Success must include `"text": "$username"` to bind it to the account.

The engine permits at most twelve actions in ninety seconds and one submission
per credential state. An unknown transition or rejected credential stops the
flow. Do not add recovery steps, change verification settings, sign out other
accounts or retry submitted credentials to make a plan pass.
