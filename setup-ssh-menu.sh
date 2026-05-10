#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MENU_SCRIPT="$APP_DIR/ssh-menu.sh"
BASHRC="$HOME/.bashrc"

cat > "$MENU_SCRIPT" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR" || exit 1

pause() { read -rp "Press Enter to continue..."; }

load_scripts() {
  if [[ ! -f package.json ]]; then
    return 0
  fi

  node -e '
    const fs = require("fs");
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    for (const name of Object.keys(pkg.scripts || {})) {
      console.log(name);
    }
  '
}

while true; do
  mapfile -t scripts < <(load_scripts)

  clear
  echo "=== mediapiayer SSH Menu ==="
  echo "Dir: $(pwd)"
  echo
  echo "1) git pull"
  echo "2) npm install"
  idx=3
  for script in "${scripts[@]}"; do
    echo "$idx) npm run $script"
    ((idx++))
  done
  echo "s) Show scripts table"
  echo "x) Open shell in mediapiayer"
  echo "0) Exit SSH"
  echo
  read -rp "Choose: " choice

  case "$choice" in
    1) git pull; pause ;;
    2) npm install; pause ;;
    s) npm run || true; pause ;;
    x) exec bash ;;
    0) exit 0 ;;
    *)
      if [[ "$choice" =~ ^[0-9]+$ ]]; then
        script_index=$((choice - 3))
        if ((script_index >= 0 && script_index < ${#scripts[@]})); then
          npm run "${scripts[$script_index]}"
          pause
          continue
        fi
      fi
      echo "Invalid choice"
      sleep 1
      ;;
  esac
done
EOF

chmod +x "$MENU_SCRIPT"
touch "$BASHRC"

TMP_FILE="$(mktemp)"
awk '
  /^# >>> MEDIAPIAYER_SSH_MENU >>>$/ {skip=1; next}
  /^# <<< MEDIAPIAYER_SSH_MENU <<<$/{skip=0; next}
  !skip {print}
' "$BASHRC" > "$TMP_FILE"

cat >> "$TMP_FILE" <<EOF

# >>> MEDIAPIAYER_SSH_MENU >>>
if [[ -n "\${SSH_CONNECTION:-}" && \$- == *i* ]]; then
  cd "$APP_DIR" || exit
  "$MENU_SCRIPT"
fi
# <<< MEDIAPIAYER_SSH_MENU <<<
EOF

mv "$TMP_FILE" "$BASHRC"

echo "Done."
echo "Menu script: $MENU_SCRIPT"
echo "Now reconnect via SSH to see the menu."
