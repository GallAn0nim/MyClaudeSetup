# My Claude Setup

How I work with Claude Code: my modes, skills, mods, statusline, settings and code guidance, in one place.

**The rule of this repo:** what I wrote lives here as files. What someone else wrote (or what I publish as its own repo) is only a **link** to its GitHub source, never a copy.

## How I use Claude

- **Where:** mostly the Claude desktop app, Code tab, on macOS. Sometimes the `claude` CLI in a terminal.
- **Language:** I chat in Polish (sometimes English). Everything that lands in a repo (code, comments, commits, docs) is English.
- **Always on in my coding projects:** [Ponytail](#ponytail) (less code, tests on risky logic) and [Caveman](#caveman) (fewer tokens, shorter answers). They are enabled per project with [`settings/project-settings.json`](settings/project-settings.json).
- **Side panes while I work:** my own [mods](#my-mods) show stats, cost, cache countdown, subagents, the Second Brain pane, and a Mods panel to switch them on and off.
- **Long chats:** at 300k tokens the `handoff` mod offers a Refresh: a short handoff of the chat that starts a new one.
- **Waiting for Claude:** during long turns [Corpore Sano](https://github.com/GallAn0nim/CorporeSano) gives me a short workout and [Ipsa Scientia](https://github.com/GallAn0nim/IpsaScientia) shows one true fact.
- **Notes:** an Obsidian vault called SecondBrain. Claude works in it with my six [`sb-*` skills](#my-own-files-in-this-repo) and the `second-brain-control` mod.
- **Permissions:** auto mode by default (`permissions.defaultMode: "auto"` in [`settings/settings.json`](settings/settings.json)).
- **Upkeep:** now and then I run `/doctor` (setup health, unused skills) and `/insights` (a report on how I use Claude Code). [`/my-claude-setup update`](skills/my-claude-setup/SKILL.md) syncs my live `~/.claude` into this repo.
- **Git:** feature branch from `develop`, PR into `develop`, no Claude attribution. See [guidance/git-workflow.md](guidance/git-workflow.md). The [`my-github`](skills/my-github/SKILL.md) skill runs this flow.

## Modes

### Ponytail

The lazy senior dev: says little, writes the smallest change that works, and makes sure risky logic ships with a test.
Source: **[github.com/DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail)** (I run v5.3.3).

| Command | What it does |
|---|---|
| `/ponytail lite` \| `full` \| `ultra` \| `off` | Intensity. **I run `full`.** `ultra` when the codebase has wronged me personally. |
| `/ponytail-review` | Review the current diff (bugs, security, untested risky code, what to cut). |
| `/ponytail-audit` | Same check for the whole repo. |
| `/ponytail-debt` | Collect deferred `shortcut:` comments into a ledger. |
| `/ponytail-help` | Quick reference. |

My config: `"ledger": false` (in [`settings/settings.json`](settings/settings.json)).

### Caveman

Makes the agent say less and read less. Code stays exact.
Source: **[github.com/JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman)** (I run v4.1.0).

| Command | What it does |
|---|---|
| `/caveman` | Short caveman voice. **My default mode.** `/caveman status`, `/caveman off`. |
| `/ultracave`, `/megacave` | Even shorter. |
| `/caveman-commit` | One-line Conventional Commit. |
| `/caveman-review` | One finding per line. |
| `/caveman-compress <file>` | Shrink a memory file like `CLAUDE.md` (keeps a backup). |
| `/caveman-stats` | Real token usage of this session. |

## Skills

### My own (files in this repo)

| Skill | What it does |
|---|---|
| [`my-claude-setup`](skills/my-claude-setup/SKILL.md) | `info`: a short summary of this repo. `update`: syncs settings, mods, skills, statusline and plugin versions from `~/.claude` into the repo, updates this README, then runs `my-github push`. |
| [`my-github`](skills/my-github/SKILL.md) | `push`: feature branch from `develop`, sensitive data check, commit, push, PR into `develop`. `check-pr`: review, build and tests for code changes, fix what I approve, merge on my yes, delete the branch. `release`: PR from `develop` into `master`, merge, sync local branches. |
| [`sb-search`](skills/sb-search/SKILL.md) | Answers from the SecondBrain vault first: queries `Knowledge.base`, reads the matching notes, cites them with wikilinks, lists gaps. Read-only. |
| [`sb-add`](skills/sb-add/SKILL.md) | Captures material into `00-Inbox` as is, only when I ask ("dodaj do moich notatek"). |
| [`sb-checkin`](skills/sb-checkin/SKILL.md) | Daily question and Random topic from the Second Brain pane; saves the answers to `00-Inbox`. |
| [`sb-process`](skills/sb-process/SKILL.md) | Processes Inbox material into Knowledge notes, moves originals to `01-References`. Rules for notes, metadata and tags. |
| [`sb-sanitize`](skills/sb-sanitize/SKILL.md) | Clean-up of Knowledge (full, tags, summary, links, knowledge), always with a plan and my approval first. |
| [`sb-obsidian-cli`](skills/sb-obsidian-cli/SKILL.md) | Obsidian Flavored Markdown and the Obsidian CLI (Bases, backlinks, unresolved links, tags, rename/move). |

The vault's own `CLAUDE.md` always wins over the `sb-*` skills.

### From others (links only)

Plugins in my claude.ai account. They load in the desktop app. Most of their skills are switched off now, see [Skills I turned off](#skills-i-turned-off).

| Plugin | What it is for | Source |
|---|---|---|
| **frontend-design** | Distinctive UI design instead of template defaults. Its skill is off. | [anthropics/claude-code › plugins/frontend-design](https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design) |
| **design** | Design critique, accessibility review, handoff, design system, research and UX copy. All seven skills are off. | [anthropics/knowledge-work-plugins › design](https://github.com/anthropics/knowledge-work-plugins/tree/main/design) |
| **cowork-plugin-management** | Create and customize plugins. Both skills are off. | [anthropics/knowledge-work-plugins › cowork-plugin-management](https://github.com/anthropics/knowledge-work-plugins/tree/main/cowork-plugin-management) |
| **VectorLab UX skills** | Design rules (spacing, typography, forms, motion...) and `/ux-audit`. All of them are off. | claude.ai plugin directory (no public GitHub repo found) |
| **anthropic-skills** | Documents, PDFs, spreadsheets, slides, deep research, skill creation and similar. Most are off. | claude.ai plugin directory |

Ponytail and Caveman also ship skills; see [Modes](#modes).

### Skills I turned off

I switch off the skills I never call, so their descriptions stop filling the context of every chat. They are listed under `skillOverrides` in [`settings/settings.json`](settings/settings.json), which matches my `~/.claude/settings.json` (last synced 2026-11-25):

- **VectorLab UX skills:** all of them, including `ux-audit` and `setup-ui-ux-skills`.
- **design:** all seven.
- **frontend-design:** `frontend-design`.
- **cowork-plugin-management:** both skills.
- **anthropic-skills:** `canvas-design`, `computer-use`, `consolidate-memory`, `deep-research`, `docx`, `explain-usage`, `google-workspace`, `pdf`, `pptx`, `setup-claude`, `setup-cowork`, `xlsx`, `skill-creator`, `docs`.

To turn one back on, remove its line from `skillOverrides`.

## Mods

Mods are local Claude Code plugins that change the app's interface (panes, bands above the prompt, slash commands, hooks).

### My mods (files in this repo, [`mods/`](mods))

| Mod | What it does |
|---|---|
| [`agent-info`](mods/agent-info) | Purple task progress bar above the prompt, and a side pane with one live card per subagent and the chat cost. |
| [`cache-clock`](mods/cache-clock) | Countdown until the prompt cache goes cold. Optional keep-warm ping with hard caps. |
| [`downsize-browser-screenshot`](mods/downsize-browser-screenshot) | Shrinks browser screenshots before Claude reads them, keeping click coordinates right. |
| [`handoff`](mods/handoff) | At 300k tokens offers Refresh: writes a handoff, shows its cost, copies it or starts a new chat with it. Handoffs are deleted after 2 days. |
| [`mods-panel`](mods/mods-panel) | Mods side pane: turn each mod on or off and put its common commands in the prompt box. |
| [`privatizer`](mods/privatizer) | `/privatizer` hides emails, phones, money, IBAN, PESEL, cards and secrets on screen for recording. Display only. |
| [`second-brain-control`](mods/second-brain-control) | `/secondbrain` pane: Knowledge topics of the chat, Inbox, Capture / Sanitize actions, and what vault work costs. |
| [`statsPane`](mods/statsPane) | `/statspane`: context, the 300k handoff line, skills used, tokens and price, 5-hour and weekly limits, subagent costs. |

They load in every chat through `CLAUDE_CODE_PLUGIN_DIRS` in [`settings/settings.json`](settings/settings.json). A new mod must be added there **and** to the `MODS` list in [`mods/mods-panel/hooks/register.tsx`](mods/mods-panel/hooks/register.tsx).

### My mods published as their own repos (links only)

| Mod | What it does | Source |
|---|---|---|
| **Corpore Sano** | Every 45 minutes, during a longer Claude turn, an animated figure gives you a short exercise. Easy, Hard, Beat AI and Hardcore levels. | [github.com/GallAn0nim/CorporeSano](https://github.com/GallAn0nim/CorporeSano) |
| **Ipsa Scientia** | During a longer turn, now and then, one short sourced fact above the prompt. 892 facts in 18 categories. | [github.com/GallAn0nim/IpsaScientia](https://github.com/GallAn0nim/IpsaScientia) |

## Statusline

[`statusline/statusline-combined.sh`](statusline/statusline-combined.sh) shows the Caveman and Ponytail badges together (Claude Code allows only one `statusLine` command). It calls the two badge scripts that the plugins install themselves:

- `~/.claude/hooks/caveman-statusline.sh` from [Caveman](https://github.com/JuliusBrussee/caveman)
- `~/.claude/ponytail-statusline.sh` from [Ponytail](https://github.com/DietrichGebert/ponytail)

## Code guidance

- [guidance/code-style.md](guidance/code-style.md): Golden Rule, 20 principles (KISS, YAGNI, no comments, no AI fingerprints...), my formatting rules (Allman braces in C# and TypeScript, block bodies, blank lines, no tuples, no nested ternaries), naming, async and errors, Honest Work project rules, and a block ready to paste into `CLAUDE.md`.
- [guidance/git-workflow.md](guidance/git-workflow.md): branches, PRs, pushing from a Claude session.

## Repo layout

```
README.md
guidance/        code style and git workflow rules
mods/            my local mods (copied to ~/.claude/mods)
settings/        settings.json (user) and project-settings.json (per project)
skills/          my own skills (copied to ~/.claude/skills)
statusline/      combined statusline script
```

## Set up on a new machine

1. Install the external plugins (in a Claude Code terminal session):

   ```
   /plugin marketplace add DietrichGebert/ponytail
   /plugin install ponytail@ponytail
   /plugin marketplace add JuliusBrussee/caveman
   /plugin install caveman@caveman
   /plugin install corpore-sano --marketplace GallAn0nim/CorporeSano
   /plugin install ipsa-scientia --marketplace GallAn0nim/IpsaScientia
   ```

2. Copy my own files into `~/.claude` (plain copies, not symlinks; `/my-claude-setup update` brings changes back here):

   ```bash
   mkdir -p ~/.claude/mods ~/.claude/skills && cp -R mods/. ~/.claude/mods/ && cp -R skills/. ~/.claude/skills/
   ```

   ```bash
   cp statusline/statusline-combined.sh ~/.claude/statusline-combined.sh
   ```

3. Merge [`settings/settings.json`](settings/settings.json) into `~/.claude/settings.json`.
4. In each coding project, copy [`settings/project-settings.json`](settings/project-settings.json) to `.claude/settings.json`.
5. Turn on the claude.ai plugins listed under [From others](#from-others-links-only) in the desktop app, then switch off the skills listed under [Skills I turned off](#skills-i-turned-off).

## Not in this repo

Credentials, sessions, chat history, caches, plugin install folders, and Claude's per-project memory. Those stay in `~/.claude` and never get committed.
