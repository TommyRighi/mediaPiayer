# Safe Release Checklist

Use this before publishing the repository or creating a public release.

## Repository Hygiene

- Confirm no runtime database files are tracked:

```bash
git ls-files data
git status --ignored --short data
```

- Keep runtime data out of commits. The repository ignores `data/`, database files and SQL backups, private key files, and environment variants. Only `.env.example` templates should be tracked.
- If database files were ever committed, purge them from history before publishing:

```bash
git filter-repo --path-glob 'data/*.db' --path-glob 'data/*.db-wal' --path-glob 'data/*.db-shm' --invert-paths
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

- Coordinate history rewrites with any collaborators before force-pushing.

## Secrets

- Do not commit `.env` or machine-specific config.
- Generate a random `JWT_SECRET` of at least 32 bytes in production. Empty values and known example secrets are rejected at startup.
- Rotate credentials if a real secret was ever committed or shared.

## Production Configuration

- Set `NODE_ENV=production`.
- Set `HOST=127.0.0.1` behind Tailscale Serve and configure `PUBLIC_ORIGIN` with the exact HTTPS origin.
- Set `CORS_ORIGIN` to the production origin instead of allowing broad browser access.
- Review Helmet settings before internet exposure, including whether a production CSP can be enabled for the deployed frontend.
- Run behind HTTPS when accessed outside a private network.

## Install Scripts

- `setup-ssh-menu.sh` must not modify shell startup files unless run with `--install-shell-hook`.
- Document any command menu entries that perform network or package-manager actions.

## Final Checks

```bash
npm run build
npm run lint --prefix frontend
npm test
npm test --prefix desktop
npm audit
npm audit --prefix frontend
npm audit --prefix desktop
```

The security regressions exercise social shutdown, WebSocket frame and account limits, catalog responses without local paths, secret validation, and ignored sensitive files. Deploy the frontend and backend together because catalog responses use availability flags instead of filesystem paths.

Desktop dependencies override `@electron/get`'s `global-agent` to 4.1.3 to remove the vulnerable `roarr`/`sprintf-js` chain. Preserve the downloader's proxy bootstrap behavior when updating or removing this override.
