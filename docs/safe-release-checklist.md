# Safe Release Checklist

Use this before publishing the repository or creating a public release.

## Repository Hygiene

- Confirm no runtime database files are tracked:

```bash
git ls-files data
git status --ignored --short data
```

- Keep runtime data out of commits. The repository ignores `data/`, `*.db`, `*.db-wal`, and `*.db-shm`.
- If database files were ever committed, purge them from history before publishing:

```bash
git filter-repo --path-glob 'data/*.db' --path-glob 'data/*.db-wal' --path-glob 'data/*.db-shm' --invert-paths
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

- Coordinate history rewrites with any collaborators before force-pushing.

## Secrets

- Do not commit `.env` or machine-specific config.
- Use a long random `JWT_SECRET` in production.
- Rotate credentials if a real secret was ever committed or shared.

## Production Configuration

- Set `NODE_ENV=production`.
- Set `CORS_ORIGIN` to the production origin instead of allowing broad browser access.
- Review Helmet settings before internet exposure, including whether a production CSP can be enabled for the deployed frontend.
- Run behind HTTPS when accessed outside a private network.

## Install Scripts

- `setup-ssh-menu.sh` must not modify shell startup files unless run with `--install-shell-hook`.
- Document any command menu entries that perform network or package-manager actions.

## Final Checks

```bash
npm run build
cd frontend && npm run lint
```

The project has no configured test runner, so build and lint are the current automated release checks.
