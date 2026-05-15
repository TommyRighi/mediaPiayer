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
const readline = require('readline');
const { spawnSync } = require('child_process');
const { stdin, stdout } = require('process');

const appDir = __dirname;
process.chdir(appDir);

function runArgv(file, args) {
  const result = spawnSync(file, args, {
    cwd: appDir,
    stdio: 'inherit',
  });
  return result.status ?? 1;
}

function runArgvCapture(file, args) {
  const result = spawnSync(file, args, {
    cwd: appDir,
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf8',
  });
  return (result.stdout || '').trim();
}

function shell(command) {
  return runArgv('bash', ['-lc', command]);
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

function readBranch() {
  return runArgvCapture('git', ['rev-parse', '--abbrev-ref', 'HEAD']) || '-';
}

function readDirtyFlag() {
  const out = runArgvCapture('git', ['status', '--porcelain']);
  return out ? 'dirty' : 'clean';
}

function clearScreen() {
  stdout.write('\x1Bc');
}

function setRawMode(enabled) {
  if (stdin.isTTY) stdin.setRawMode(enabled);
}

function waitForEnter() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    rl.question('\nPress Enter to return to menu...', () => {
      rl.close();
      resolve();
    });
  });
}

function waitForKeypress() {
  return new Promise((resolve) => {
    const onKeypress = (str, key) => {
      stdin.off('keypress', onKeypress);
      resolve({ str, key });
    };
    stdin.on('keypress', onKeypress);
  });
}

function render(items, selected, message) {
  const branch = readBranch();
  const dirty = readDirtyFlag();

  clearScreen();
  console.log('┌──────────────────────────────────────────────────────────────────────┐');
  console.log('│                         mediapiayer local-cli                        │');
  console.log('└──────────────────────────────────────────────────────────────────────┘');
  console.log(` path: ${process.cwd()}`);
  console.log(` git : ${branch} (${dirty})`);
  console.log('');

  items.forEach((item, index) => {
    const pointer = index === selected ? '❯' : ' ';
    const line = index === selected ? `\x1b[36m${item.label}\x1b[0m` : item.label;
    console.log(` ${pointer} ${line}`);
  });

  console.log('');
  console.log(' controls: ↑/↓ move • enter run • r refresh • q exit');
  if (message) console.log(` status: ${message}`);
}

function menuItems(scripts) {
  const dynamicScripts = scripts.map((script) => ({
    label: `npm run ${script}`,
    run: async () => {
      setRawMode(false);
      runArgv('npm', ['run', script]);
      await waitForEnter();
      setRawMode(true);
      return `Ran npm run ${script}`;
    },
  }));

  return [
    {
      label: 'git pull',
      run: async () => {
        setRawMode(false);
        runArgv('git', ['pull']);
        await waitForEnter();
        setRawMode(true);
        return 'Ran git pull';
      },
    },
    {
      label: 'npm install',
      run: async () => {
        setRawMode(false);
        runArgv('npm', ['install']);
        await waitForEnter();
        setRawMode(true);
        return 'Ran npm install';
      },
    },
    ...dynamicScripts,
    {
      label: 'Show scripts table (npm run)',
      run: async () => {
        setRawMode(false);
        runArgv('npm', ['run']);
        await waitForEnter();
        setRawMode(true);
        return 'Listed scripts';
      },
    },
    {
      label: 'Open shell in mediapiayer',
      run: async () => {
        setRawMode(false);
        shell('exec bash');
        setRawMode(true);
        return 'Returned from shell';
      },
    },
    {
      label: 'Exit SSH',
      run: async () => 'EXIT',
    },
  ];
}

async function main() {
  if (!stdin.isTTY || !stdout.isTTY) {
    console.error('This menu requires an interactive terminal (TTY).');
    process.exit(1);
  }

  readline.emitKeypressEvents(stdin);
  setRawMode(true);

  let selected = 0;
  let message = '';
  while (true) {
    const items = menuItems(readScripts());
    if (selected >= items.length) selected = items.length - 1;
    if (selected < 0) selected = 0;

    render(items, selected, message);
    const { key } = await waitForKeypress();
    message = '';

    if (!key) continue;
    if (key.name === 'up') {
      selected = selected <= 0 ? items.length - 1 : selected - 1;
      continue;
    }
    if (key.name === 'down') {
      selected = selected >= items.length - 1 ? 0 : selected + 1;
      continue;
    }
    if (key.name === 'return') {
      const result = await items[selected].run();
      if (result === 'EXIT') break;
      message = result;
      continue;
    }
    if (key.name === 'r') {
      message = 'Menu refreshed';
      continue;
    }
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
      break;
    }
  }

  setRawMode(false);
  clearScreen();
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
