# Git workflow

"Branch out, commit, push and do a PR" always means the steps below. The [`my-github`](../skills/my-github/SKILL.md) skill runs them: `/my-github push`, `/my-github check-pr`, `/my-github release`.

1. `git fetch`, then branch from **`develop`**, never from `master`:
   `git switch -c features/<Name> origin/develop`
2. Name: `features/<Name>`. PascalCase (`features/AddDockerSupport`) is my default; some repos use kebab-case (`features/add-docker-support`). Follow what the repo already does.
3. Commit there, push, open the PR with **base `develop`**: `gh pr create --base develop`.
4. `master` is the release branch. Work lands in `develop` first; a release is a PR from `develop` into `master`.
5. After the PR is merged, delete the feature branch (remote and local).

No `Co-Authored-By` lines and no Claude attribution in commits or PRs (set in `settings/settings.json`: `includeCoAuthoredBy: false`, empty `attribution`).

## Pushing from a Claude session

Git talks to GitHub over SSH, from my terminal and from Claude sessions alike. Remotes use `git@github.com:<owner>/<repo>.git`. The key has a passphrase kept in the macOS Keychain, so no ssh-agent is needed. `~/.ssh/config` points GitHub at it:

```
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_github
  IdentitiesOnly yes
  AddKeysToAgent yes
  UseKeychain yes
```

Check it with `ssh -T git@github.com`. To move an HTTPS remote to SSH: `git remote set-url origin git@github.com:<owner>/<repo>.git`.

### HTTPS fallback

Where SSH fails (`Permission denied (publickey)`, another machine, a cloud session), `gh` is logged in, so push over HTTPS with its credentials, without touching the git config:

```bash
git -c credential.helper= -c credential.helper='!gh auth git-credential' push https://github.com/<owner>/<repo>.git <branch>:<branch>
```

In zsh write `${N}:refs/...`, not `$N:refs/...`, because `:r` is a zsh modifier.
