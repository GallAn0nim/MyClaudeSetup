---
name: my-github
description: The user's GitHub flow (feature branch from develop, PR into develop, release from develop into master). Subcommands — push (branch out if needed, check for sensitive data, commit, push, open a PR), check-pr (review a PR, build it and run its tests when it changes code, fix what the user approves, merge on approval and delete the branch), release (PR from develop into master, merge, sync local branches). Use when the user asks to push their work or open a PR, check or merge a PR, or make a release, including "branch out, commit, push and do a PR" and Polish phrasings such as "zrób push", "wypchnij to", "sprawdź PR", "zmerguj PR", "zrób release". Prefer it over /ship and /steward for these.
---

# My GitHub flow: push, check-pr, release

Talk to the user in their language. Commits, branch names, PR titles and bodies are English.

The first word of the arguments picks the subcommand: `push`, `check-pr` (optionally followed by a PR number or URL) or `release`. With none, ask which one.

## Shared rules

- **Branches:** `develop` is the integration branch, `master` (or `main`) the release branch. If the repo has no `develop`, its default branch plays that role and there is no release step.
- **Branch names:** `features/<Name>` in PascalCase (`features/AddDockerSupport`). If the repo's existing branches (`git branch -r`) use another pattern (`feature/…`, kebab-case), follow the repo.
- **Identity:** `git config user.name` is `GallAn0nim` and `git config user.email` is the ProtonMail address. If the email is a `noreply` address or anything else, stop and ask; never change it on your own.
- **No attribution:** no `Co-Authored-By` lines, no "Generated with Claude" and no other Claude mention in commits or PRs.
- **Commit message:** one imperative line that says what changed (`Add retry to the export job`); a short body only when the reason is not obvious.
- **Merge method:** merge commits (`gh pr merge --merge`), unless the repo allows only another method.
- **Remote:** `<owner>/<repo>` comes from `git remote get-url origin`. Pass `--repo <owner>/<repo>` to every `gh` call.
- **Transport: SSH first.** SSH to GitHub is set up on the user's Mac (`~/.ssh/config` maps `github.com` to the user's key, passphrase in Keychain), so plain `git fetch` / `git push` / `git pull` work in Claude sessions too. If `origin` is an HTTPS URL (`https://github.com/...`), say so once and offer to switch it with `git remote set-url origin git@github.com:<owner>/<repo>.git`; switch only on a yes, and carry on either way.
- **HTTPS fallback:** only when SSH fails with `Permission denied (publickey)` or cannot connect (another machine, a cloud session, a broken key), use HTTPS with `gh` credentials, without touching the git config, and tell the user SSH failed:

  ```bash
  git -c credential.helper= -c credential.helper='!gh auth git-credential' push https://github.com/<owner>/<repo>.git "${B}:refs/heads/${B}"
  git -c credential.helper= -c credential.helper='!gh auth git-credential' fetch --prune https://github.com/<owner>/<repo>.git '+refs/heads/*:refs/remotes/origin/*'
  ```

  In zsh write `${B}:refs/...`, not `$B:refs/...` (`:r` is a zsh modifier).
- **Never** force-push, rewrite published history, push to `develop` or `master` directly, or delete `develop`, `master` or `main`.

## Sensitive data check

Run it on everything about to be committed (`git diff --cached` plus the names of staged files). Stage files by name after reading `git status`; never stage a file you have not looked at.

Stop and show the user every hit (mask secrets: first 4 characters, then `…`) when you find:

- **Files:** `.env`, `.env.*` (except `.env.example`), `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `credentials*`, `*secret*`, `*.local.json`, `settings.local.json`, `.credentials.json`, database dumps, files over 5 MB.
- **Keys and tokens:** `AKIA…`, `ghp_…`, `gho_…`, `github_pat_…`, `sk-ant-…`, `sk-…`, `xox[abp]-…`, `AIza…`, `-----BEGIN … PRIVATE KEY-----`, JWTs (`eyJ…\.eyJ…`), connection strings with a password, and assignments like `password|passwd|secret|token|api_key = "<non-empty literal>"`.
- **Personal data:** any e-mail address except the commit identity, `noreply` addresses and placeholder domains (`example.com`); this always covers the user's own account e-mail. Phone numbers, IBANs, PESEL numbers, card numbers.
- **Local paths:** `/Users/<name>/…`, `/home/<name>/…`, `C:\Users\<name>\…`. Use `~`, `$HOME` or a relative path instead.

After a hit, ask: remove it, add the file to `.gitignore`, or keep it on purpose. Commit only once every hit is resolved. A clean check is reported in one line.

A match that is only a pattern, placeholder or example in documentation (such as the lists above, `<token>`, `sk-…`) is not a hit: mention it in the one-line result as a false positive and go on.

## push

1. **Look:** `git status`, current branch, fetch. If there is nothing to commit and no unpushed commits, say so and stop.
2. **Pick the branch** by where you are:
   - **`develop`:** propose a name from the changes (`features/<Name>`), then branch from the fetched remote: `git switch -c features/<Name> origin/develop`; uncommitted changes move with you when they do not conflict. If local `develop` has commits that `origin/develop` lacks, stop and ask whether they belong in this PR. The PR base is `develop`.
   - **A feature branch:** ask whether to stay on it or branch off from it. Branching off: ask for (or propose) the new name, and whether its PR goes into `develop` or into the current branch. Staying: the PR base is the base of the branch's existing PR, else `develop`.
   - **`master` / `main`:** stop and commit nothing. Explain, and offer to carry the changes to a new `features/<Name>` from `origin/develop` (`git switch -c features/<Name> origin/develop`, which keeps uncommitted changes when they do not conflict).
   - **Detached HEAD or a rebase/merge in progress:** stop and explain.
3. **Stage and check:** stage the intended files by name, run the **Sensitive data check**, check the **Identity**.
4. **Commit** with a message as in **Shared rules**.
5. **Push** the branch (SSH with `git push -u origin <branch>`, else the HTTPS fallback). After an HTTPS push, update the remote-tracking refs with the HTTPS fetch and set the upstream: `git branch --set-upstream-to=origin/<branch>`.
6. **PR:** if the branch already has an open PR (`gh pr list --head <branch>`), report its URL; the push updated it. Otherwise `gh pr create --base <base> --head <branch>` with the commit subject as title (or a summary for several commits) and a short English body: what changed, as 2–5 bullets.
7. **Report:** branch, commit, PR link, and the one-line result of the sensitive data check.

## check-pr

1. **Target:** the PR from the arguments; else the open PR of the current branch; else list the open PRs (`gh pr list`) and ask which one.
2. **Read:** `gh pr view` (title, body, base, head, mergeable, checks) and `gh pr diff`. Read the repo's `CLAUDE.md` and style guidance if there are any.
3. **Review** the diff for: correctness bugs, security problems, the **Sensitive data check**, broken repo rules, missing tests for risky logic, leftovers (debug output, commented-out code, TODOs that should not ship), and failing CI checks with their reason.
4. **Build and test** when the PR changes code (anything beyond docs, Markdown, images or comments-only edits; skip it otherwise and say so in one line):
   - **Where:** in a temporary worktree of the PR head, so the user's checkout and uncommitted work stay untouched: `git fetch origin pull/<n>/head:pr-<n>` (or the HTTPS fallback), `git worktree add <scratch>/pr-<n> pr-<n>`. Remove the worktree and the `pr-<n>` branch afterwards.
   - **What to run**, first match wins: the commands in the repo's `CLAUDE.md` or README; the build and test steps in `.github/workflows/*.yml`; otherwise by project files — `package.json` (install with the lockfile's tool: `npm ci`, `pnpm install --frozen-lockfile`, `yarn install --frozen-lockfile`, `bun install`; then its `build` and `test` scripts if they exist), `*.sln` / `*.csproj` (`dotnet build`, `dotnet test`), `pyproject.toml` / `requirements*.txt` (`pytest`), `go.mod` (`go build ./...`, `go test ./...`), `Cargo.toml` (`cargo build`, `cargo test`), `pom.xml` (`mvn -B verify`), `build.gradle*` (`./gradlew build`), `Makefile` (`make`, `make test`). Build the whole solution, not only the changed project.
   - **How:** run long commands in the background and wait for them; do not start servers, deploy, run migrations against real databases, or touch anything outside the worktree. If a step needs secrets, services or tools that are missing, do not fake it: report what could not run and why.
   - **Result:** one line per step (build ok / failed; tests passed, failed, skipped). Each failure becomes a finding with its first relevant error lines.
5. **Report** the findings as a numbered list, most severe first, one or two lines each with `file:line`, then the build and test result. With no findings, say so in one line.
6. **Fix only on request:** ask which findings to fix (for example "1, 3" or "all" or "none"). Where to fix:
   - If the user's checkout is on the PR's head branch and has no uncommitted changes, fix there.
   - Otherwise leave the user's checkout alone and use a worktree on the head branch: `git worktree add <scratch>/fix-<n> <head>` if a local `<head>` branch exists and is not checked out elsewhere, else `git worktree add -b <head> <scratch>/fix-<n> origin/<head>`. Remove the worktree when done.
   - For a PR from a fork, ask first: pushing to someone else's fork needs their permission.

   Make the changes, run step 4 again, then commit and push with the **push** steps 3–5 (same branch, no new PR).
7. **Merge only on approval:** ask "Merge PR #N into <base>?" Merge only after a clear yes in the conversation for this PR; a yes for another PR or an earlier one does not count. If the PR is not mergeable, CI checks fail, or the build or tests from step 4 fail, say so and do not merge unless the user explicitly says to merge anyway.
8. **Merge and clean up**, in this order:
   1. `gh pr merge <n> --merge`.
   2. Fetch, switch to the base branch and fast-forward it (`git merge --ff-only`). Git cannot delete the branch you are on, so this comes first. If uncommitted changes block the switch, stop and say so.
   3. Delete the head branch on the remote (`git push <remote> --delete <head>`, with the HTTPS fallback), then locally (`git branch -D <head>`), and prune with a fetch. Skip the remote delete for a PR from a fork: that branch lives in another repo.
   4. Never delete `develop`, `master` or `main`.
9. **Report:** merge commit, deleted branches, where the local repo is now. If the base was `develop`, mention that `release` takes it to `master`.

## release

Calling `release` is the user's approval to merge the release PR.

1. **Check:** fetch; list what is in `develop` but not in `master`: `git log --oneline --merges origin/master..origin/develop`. If there is nothing, say so and stop. If there is an open PR from `develop` into `master` already, use it.
2. **PR:** `gh pr create --base master --head develop` with title `Release: <short summary>` and body `Release of <owner>/<repo>#N (<what it brings>).`, one entry per merged PR.
3. **Merge:** if it is mergeable and checks pass, `gh pr merge <n> --merge`. Otherwise stop and report why. Never delete `develop`.
4. **Sync locally:** fetch; fast-forward the checked-out branch (`git merge --ff-only`) and the other one without switching (`git fetch . origin/develop:develop` or `git fetch . origin/master:master`). Leave uncommitted work untouched.
5. **Report:** release PR link, merge commit, and that local `master` and `develop` match the remote.
