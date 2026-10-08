#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MENU_SCRIPT="$APP_DIR/ssh-menu.sh"
BASHRC="$HOME/.bashrc"
ACTION=manual
usage() {
  cat <<'HELP'
Usage: ./setup-ssh-menu.sh [--install-shell-hook | --uninstall-shell-hook] [--shell-file PATH]

Checks the Admin CLI. No shell files change unless a hook option is selected.
The optional hook starts the CLI only for interactive SSH sessions in Bash.
HELP
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-shell-hook) ACTION=install ;;
    --uninstall-shell-hook) ACTION=uninstall ;;
    --shell-file) [[ $# -ge 2 ]] || { usage >&2; exit 1; }; BASHRC="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
  esac
  shift
done
command -v node >/dev/null || { echo 'Install Node.js 24 first.' >&2; exit 1; }
node "$APP_DIR/scripts/admin.js" --help
if [[ "$ACTION" != manual ]]; then
  mkdir -p "$(dirname "$BASHRC")"
  touch "$BASHRC"
  cp -p "$BASHRC" "$BASHRC.mediapiayer-backup-$(date +%s)"
  TMP_FILE="$(mktemp)"
  trap 'rm -f "$TMP_FILE"' EXIT
  awk '
    /^# >>> MEDIAPIAYER_SSH_MENU >>>$/ {skip=1; next}
    /^# <<< MEDIAPIAYER_SSH_MENU <<<$/{skip=0; next}
    !skip {print}
  ' "$BASHRC" > "$TMP_FILE"
  if [[ "$ACTION" == install ]]; then
    MENU_ESCAPED="$(printf '%q' "$MENU_SCRIPT")"
    cat >> "$TMP_FILE" <<HOOK

# >>> MEDIAPIAYER_SSH_MENU >>>
if [[ -n "\${SSH_CONNECTION:-}" && \$- == *i* && -t 0 && -t 1 ]]; then
  $MENU_ESCAPED
fi
# <<< MEDIAPIAYER_SSH_MENU <<<
HOOK
  fi
  cat "$TMP_FILE" > "$BASHRC"
  echo "SSH hook: $ACTION in $BASHRC"
else
  echo 'Run npm run admin or ./ssh-menu.sh. No shell files were modified.'
fi
