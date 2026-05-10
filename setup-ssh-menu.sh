#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MENU_SCRIPT="$APP_DIR/ssh-menu.sh"
MENU_CLI="$APP_DIR/ssh-menu-cli.js"
BASHRC="$HOME/.bashrc"

cat > "$MENU_CLI" <<'EOF'
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { spawnSync } = require('child_process');
const { stdin, stdout } = require('process');

const appDir = __dirname;
process.chdir(appDir);

function clearScreen() {
  stdout.write('\x1Bc');
}

function run(command) {
  const result = spawnSync('bash', ['-lc', command], {
    cwd: appDir,
    stdio: 'inherit',
  });
  return result.status ?? 1;
}

function runArgv(file, args) {
  const result = spawnSync(file, args, {
    cwd: appDir,
    stdio: 'inherit',
  });
  return result.status ?? 1;
}

function readScripts() {
  const pkgPath = path.join(appDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return Object.keys(pkg.scripts || {});
  } catch {
    return [];
  }
}

async function pause(rl) {
  await rl.question('\nPress Enter to continue...');
}

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      const scripts = readScripts();
      const dynamicStart = 3;

      clearScreen();
      console.log('=== mediapiayer SSH Menu ===');
      console.log(`Dir: ${process.cwd()}\n`);
      console.log('1) git pull');
      console.log('2) npm install');
      scripts.forEach((script, index) => {
        console.log(`${dynamicStart + index}) npm run ${script}`);
      });
      console.log('s) Show scripts table');
      console.log('x) Open shell in mediapiayer');
      console.log('0) Exit SSH\n');

      const choice = (await rl.question('Choose: ')).trim();
      if (choice === '1') {
        runArgv('git', ['pull']);
        await pause(rl);
        continue;
      }
      if (choice === '2') {
        runArgv('npm', ['install']);
        await pause(rl);
        continue;
      }
      if (choice === 's') {
        runArgv('npm', ['run']);
        await pause(rl);
        continue;
      }
      if (choice === 'x') {
        run('exec bash');
        continue;
      }
      if (choice === '0') {
        break;
      }

      const n = Number.parseInt(choice, 10);
      if (Number.isFinite(n)) {
        const scriptIndex = n - dynamicStart;
        if (scriptIndex >= 0 && scriptIndex < scripts.length) {
          const scriptName = scripts[scriptIndex];
          runArgv('npm', ['run', scriptName]);
          await pause(rl);
          continue;
        }
      }

      console.log('\nInvalid choice');
      await pause(rl);
    }
  } finally {
    rl.close();
  }
}

main();
EOF

cat > "$MENU_SCRIPT" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR" || exit 1
exec node "$APP_DIR/ssh-menu-cli.js"
EOF

chmod +x "$MENU_CLI"
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
