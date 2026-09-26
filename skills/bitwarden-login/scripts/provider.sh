#!/usr/bin/env bash
# Run directly in the user's own terminal, never in a recorded agent PTY.
set -euo pipefail
umask 077
login_server=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --region)
      case "${2:-}" in
        eu) login_server='https://vault.bitwarden.eu' ;;
        us) login_server='https://vault.bitwarden.com' ;;
        *) printf '%s\n' 'Use --region eu or --region us.' >&2; exit 2 ;;
      esac
      shift 2
      ;;
    -h|--help)
      printf '%s\n' 'Usage: provider.sh [--region eu|us]' 'Without --region, preserve the configured Bitwarden server.'
      exit 0
      ;;
    *) printf '%s\n' 'Usage: provider.sh [--region eu|us]' >&2; exit 2 ;;
  esac
done
if [[ ! -t 0 || ! -t 1 ]]; then
  printf '%s\n' 'Open this script in your own terminal to unlock Bitwarden and approve requests.' >&2
  exit 1
fi
for required_tool in bw aac node; do
  command -v "$required_tool" >/dev/null || { printf 'Missing %s; use the repository Nix login shell.\n' "$required_tool" >&2; exit 1; }
done
login_lock="$HOME/.cache/bitwarden-login/provider.lock"
mkdir -p "${login_lock%/*}"
if ! mkdir "$login_lock" 2>/dev/null; then
  login_pid=''
  [[ -f "$login_lock/pid" ]] && read -r login_pid < "$login_lock/pid"
  if [[ "$login_pid" =~ ^[0-9]+$ ]] && ! kill -0 "$login_pid" 2>/dev/null; then
    rm "$login_lock/pid"
    rmdir "$login_lock"
    mkdir "$login_lock"
  else
    printf '%s\n' 'A provider is already running (or its startup lock is still present). Use that terminal instead of unlocking the CLI again.' >&2
    exit 1
  fi
fi
printf '%s\n' "$$" > "$login_lock/pid"
login_unlocked=0
cleanup() {
  unset BW_SESSION
  if [[ "$login_unlocked" == 1 ]]; then bw lock >/dev/null 2>&1 || true; fi
  rm -f "$login_lock/pid"
  rmdir "$login_lock" 2>/dev/null || true
}
trap cleanup EXIT
vault_status=$(bw status | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).status));')
current_server=$(bw config server)
if [[ -n "$login_server" && "${current_server%/}" != "$login_server" ]]; then
  if [[ "$vault_status" != unauthenticated ]]; then
    printf '%s\n' 'The CLI is signed in to a different server. Run bw logout in this Nix shell before changing region.' >&2
    exit 1
  fi
  bw config server "$login_server" >/dev/null
  current_server=$(bw config server)
  if [[ "${current_server%/}" != "$login_server" ]]; then
    printf '%s\n' 'The requested Bitwarden server was not configured; login was not started.' >&2
    exit 1
  fi
fi
printf 'Bitwarden server: %s\n' "$current_server" >&2
case "$vault_status" in
  unauthenticated) BW_SESSION=$(bw login --raw) ;;
  locked) BW_SESSION=$(bw unlock --raw) ;;
  unlocked) : ;;
  *) printf '%s\n' 'Could not determine Bitwarden CLI state.' >&2; exit 1 ;;
esac
if [[ -z "${BW_SESSION:-}" ]]; then
  printf '%s\n' 'No CLI session was returned; the provider was not started.' >&2
  exit 1
fi
export BW_SESSION
login_unlocked=1
bw sync >/dev/null
vault_status=$(bw status | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).status));')
if [[ "$vault_status" != unlocked ]]; then
  printf '%s\n' 'The CLI session is not unlocked; the provider was not started.' >&2
  exit 1
fi
printf '%s\n' 'Keep this provider terminal running; /exit stops it and locks the CLI.' \
  'After pairing, /exit is fine in the SECOND (aac connect) terminal only.' \
  'Approve only the requested item and the paired login client.'
aac listen --provider bitwarden
