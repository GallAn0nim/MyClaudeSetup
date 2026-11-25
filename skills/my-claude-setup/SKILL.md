---
name: my-claude-setup
description: Show or update the user's Claude setup kept in the MyClaudeSetup repo (~/Projects/MyClaudeSetup). Subcommands — info (short summary of what the repo holds) and update (sync the live ~/.claude setup — settings, mods, skills, statusline, plugin versions — into the repo, refresh the README, then push it with my-github). Use when the user asks what their Claude setup is, or to update or sync it, including Polish phrasings such as "zaktualizuj mój claude setup", "co mam w setupie", "zsynchronizuj setup".
---

# My Claude setup: info and update

The repo is `~/Projects/MyClaudeSetup`. Its README is the description of the setup; the live setup is `~/.claude`. Talk to the user in their language; everything written to the repo is English.

The first word of the arguments picks the subcommand: `info` or `update`. With none, run `info`.

## Repo rules

- What the user wrote lives in the repo as files. What someone else wrote, or what the user publishes as its own repo, is only a **link** to its GitHub source, never a copy.
- `~/.claude/mods` and `~/.claude/skills` are plain **copies** of the repo folders, not symlinks. Never propose symlinking them.
- Never commit credentials, sessions, chat history, caches, plugin install folders, backups, `projects/` memory, or anything with a personal path or e-mail. The repo is public.

## Fetching

SSH keys are usually missing in Claude sessions. If `git fetch` fails with `Permission denied (publickey)`, fetch over HTTPS with `gh` credentials:

```bash
git -c credential.helper= -c credential.helper='!gh auth git-credential' fetch --prune https://github.com/<owner>/<repo>.git '+refs/heads/*:refs/remotes/origin/*'
```

`<owner>/<repo>` comes from `git remote get-url origin`.

## info

1. Fetch, then read the README from the latest release: `git show origin/master:README.md`.
2. Reply with a short summary (about 10–15 lines): modes and their versions, own skills, mods, statusline, settings worth knowing (permission mode, turned-off skills), the latest release (`git log -1 --format='%h %s (%cs)' origin/master`).
3. Run a quick drift check (`diff -rq` of mods and skills, the settings comparison from **update** step 3). If anything differs, end with one line: what differs and that `/my-claude-setup update` syncs it. Change nothing.

## update

1. **Start clean.** In the repo: `git status` must be clean. If not, stop and show what is uncommitted. Fetch, switch to `develop` and fast-forward it to `origin/develop` (`git merge --ff-only`). If the repo has no `develop`, use its default branch.
2. **Compare.** The live `~/.claude` is the source of truth. If a repo file is newer than its live copy (`stat` mtime), show both versions and ask which one wins before copying.
3. **Settings:** compare `~/.claude/settings.json` with `settings/settings.json` as sorted JSON (`python3 -m json.tool --sort-keys`). In the repo copy, absolute home paths stay written as `$HOME/...` or `~/...`, so a difference that is only `/Users/<name>` vs `$HOME` is not a change. Copy every real change, except secret values: tokens and keys in `env`, MCP server headers, `apiKeyHelper` output and the like never go into the repo. Write a placeholder such as `"<set locally>"` in their place and tell the user which keys got one. On later runs, a placeholder in the repo against a real value in `~/.claude` is not a change. If `skillOverrides` changed, update the README section **Skills I turned off** and its "last synced" date.
4. **Mods:** `diff -rq mods ~/.claude/mods`, ignoring `node_modules/` and compiled `*.js` files that sit next to a `.ts` / `.tsx` source. Copy changed source files.
   - A **new mod** in `~/.claude/mods`: copy it, add it to the README table **My mods**, to `CLAUDE_CODE_PLUGIN_DIRS` in `settings/settings.json`, and to the `MODS` list in `mods/mods-panel/hooks/register.tsx` (check the live copy first, it may already be there).
   - A mod **gone** from `~/.claude/mods`: ask before deleting it from the repo.
   - A mod the user published as its own repo (Corpore Sano, Ipsa Scientia, and any `~/.claude/dev-mods/*` one with a GitHub source) is a **link** in the README, never copied.
5. **Skills:** compare `skills/*/` with `~/.claude/skills/*/`. Copy changed and new skills; for a removed skill, ask before deleting. Keep the README table **My own (files in this repo)** in sync, one row per skill.
6. **Statusline:** `diff statusline/statusline-combined.sh ~/.claude/statusline-combined.sh`; copy if changed.
7. **Plugins:** read `~/.claude/plugins/installed_plugins.json` and `known_marketplaces.json`. Update the versions in the README (`I run vX.Y.Z`) and, for a new plugin or marketplace, add a link row with its GitHub source. Do not copy plugin files.
8. **README:** fix every place the changes touch: the **How I use Claude** bullets, the tables, **Repo layout**, **Set up on a new machine**. Keep the existing tone and structure; short, plain sentences.
9. **Report** to the user: a short list of what changed and what was left out on purpose (for example a path difference only). If nothing changed, say so and stop.
10. **Push:** continue with the `my-github` skill, subcommand `push`. It checks for sensitive data, branches from `develop`, commits, pushes and opens the PR.
