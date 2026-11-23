# Git workflow

"Branch out, commit, push and do a PR" always means:

1. `git fetch`, then branch from **`develop`**, never from `master`:
   `git switch -c features/<Name> origin/develop`
2. Name: `features/<Name>`. PascalCase (`features/AddDockerSupport`) is my default; some repos use kebab-case (`features/add-docker-support`). Follow what the repo already does.
3. Commit there, push, open the PR with **base `develop`**: `gh pr create --base develop`.
4. `master` is the release branch. Work lands in `develop` first.

No `Co-Authored-By` lines and no Claude attribution in commits or PRs (set in `settings/settings.json`: `includeCoAuthoredBy: false`, empty `attribution`).

## Pushing from a Claude session

SSH keys are not available inside Claude sessions, so `git push` to a `git@github.com:` remote fails with `Permission denied (publickey)`. `gh` is logged in, so push over HTTPS with its credentials, without touching the git config:

```bash
git -c credential.helper= -c credential.helper='!gh auth git-credential' push https://github.com/<owner>/<repo>.git <branch>:<branch>
```

In zsh write `${N}:refs/...`, not `$N:refs/...`, because `:r` is a zsh modifier.
