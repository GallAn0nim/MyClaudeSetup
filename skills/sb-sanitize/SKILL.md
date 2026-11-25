---
name: sb-sanitize
description: Sanitize the SecondBrain vault's Knowledge — targeted clean-up in five modes (full, tags, summary, links, knowledge), always with a plan and the user's approval before any change, and a CHANGELOG entry. Use only when the user asks for it: /sb-sanitize, the Sanitize button in the Second Brain pane (a prompt starting with [second-brain:sanitize]), or a request in words such as "zrób sanitize", "sanitize tagów", "run sanitize links". Never start it on your own initiative.
---

# SecondBrain: sanitize Knowledge

The vault's `CLAUDE.md` defines permissions and takes precedence over this skill. Sanitize is a targeted clean-up of the whole Knowledge layer: tags, summaries, links, and the division of notes. Use `sb-obsidian-cli` for CLI details and `sb-process` for every rule about writing Knowledge (voice, language, metadata, rename and merge safeguards).

## Modes

| Mode | What it does |
| --- | --- |
| `full` | All four modes below, one after another. |
| `tags` | Checks every tag and merges, renames, removes or adds tags. |
| `summary` | Refreshes the `summary` of a chosen number of the oldest notes. |
| `links` | Fixes broken links and connects notes that have no links. |
| `knowledge` | Re-reads a group of related notes as a whole and decides their division anew. |

Take the mode from the request ("sanitize tagów" → `tags`, "zrób sanitize linków" → `links`, "pełny sanitize" → `full`). When the request names no mode (for example the pane's Sanitize button), ask which one and wait.

## Rules for every mode

- **Plan first, then changes.** Every mode has one approval step, and nothing changes before it. In `tags` and `links` the plan is the list of proposed changes, each with a one-line reason from the content; the user may approve all, some, or none. In `summary` the plan is the number of notes to refresh; in `knowledge` it is the group of notes to rework. Once that is approved, apply without asking again.
- **Content decides.** Read a note in full before proposing a change to it. Never infer from a title or tag alone.
- **Permissions.** Change only `02-Knowledge/`. Files in `01-References/`, `00-Inbox/`, `99-System/`, `CLAUDE.md` and `.obsidian/` are read-only: problems found there go to the report.
- **Metadata.** After applying, update `last_modified` (Mac-local `YYYY-MM-DD`) on every changed note, and verify YAML and links as in `sb-process` → Verify.
- **Changelog.** Every mode ends by appending its entry to `CHANGELOG.md` (see **Changelog**).
- **Earlier decisions.** Before proposing, check earlier sanitize entries in `CHANGELOG.md` and the user's recorded preferences (for example a tag decision) so a rejected or settled change is not proposed again without a new reason.

## Mode: tags

1. **Scan** all tags with their counts (`obsidian vault=SecondBrain tags counts`, or the YAML of `02-Knowledge/*.md`). Flag:
   - duplicates written differently: singular/plural, Polish/English, spelling or hyphenation variants;
   - tags that should be merged because they cover the same notes or the same idea;
   - tags to remove: used on one note only and too narrow, or always co-occurring with another tag;
   - groups of related notes with no shared tag (prefer an existing tag);
   - notes without tags;
   - tags that break the convention in `sb-process` → **Tags** (for example an English tag where a Polish word fits and the term is not a proper name or established term).
2. **Confirm:** read in full every note a proposed change would touch; keep a change only if the content supports it.
3. **Plan:** a table of tag changes (from → to, number of notes, reason), then the notes affected. Wait for approval.
4. **Apply** the approved changes, update `last_modified`, verify, and append the changelog entry.

Tag form and language follow `sb-process` → **Tags**.

## Mode: summary

1. **Order:** list every Knowledge note by age, oldest first. A note's age is the later of its `last_modified` and the date of its last review in a sanitize summary entry of `CHANGELOG.md`, so notes reviewed without changes go to the back of the queue.
2. **Plan = the size and the way.** Report: "Sanitize summary obejmie N notatek; najstarsza: <title> (<date>)", and ask how many to refresh, as a number or a percentage, and whether to run here or with subagents, one per note (see **Subagents**). Wait for the answer; it is the approval for this mode. Reading notes is the expensive part, so read nothing before it. No answer on the way means here.
3. **Refresh** the chosen number of oldest notes, each read in full, without a second approval. Rewrite the `summary` where the current one does not match the body, misses something important, or is vague. Write it from the body alone, adding no facts: in Polish, 2–3 concrete sentences. Leave a summary that is already accurate unchanged. With subagents, each note goes to its own subagent with these rules (see **Subagents → summary**).
4. **Apply:** update `last_modified` on every note whose summary changed, verify YAML, and append the changelog entry listing the notes changed and the notes reviewed without changes; the next run's order depends on that list. With subagents, the verification and the changelog entry are yours, built from their results.
5. **Report** content that may be outdated (prices, versions, legality, dates) without changing it.

## Mode: links

1. **Scan:**
   - broken links: `obsidian vault=SecondBrain unresolved verbose format=json`, plus heading links (`[[Note#Heading]]`) checked against the target's headings, plus `sources` entries whose file does not exist;
   - orphans: Knowledge notes with no links to other Knowledge notes and no backlinks from them (`backlinks`, `links`);
   - weakly linked notes: related by topic or tags but not linked to each other.
2. **Propose a fix for each:**
   - a broken link: point it to the right note or heading when the right target is clear from the content; otherwise propose removing the link markup and keeping the text, and say so;
   - an orphan or weak link: read both notes and propose links that add value, placed in the text where they explain the connection or in `## Powiązania`, with the reason.
3. **Plan:** the list of fixes per note. Wait for approval. Broken links inside read-only folders go to the report only.
4. **Apply** the approved fixes, update `last_modified`, verify links, and append the changelog entry.

## Mode: knowledge

1. **Plan = the group.** If the user named notes, propose those as the group. Otherwise suggest a few groups of notes worth re-reading as a whole, from titles, summaries, tags and links: overlapping topics, one topic scattered over many small notes, a note covering several topics, a hub with parts that grew apart. Give each group its notes and a one-line reason, and let the user pick (or add notes). The user's choice is the approval for this mode. Here, do one group at a time. When the user picks two or more groups, also ask whether to run them here, one after another, or with subagents, one per group (see **Subagents**); no answer means here. Groups run by subagents must not share a note: move a shared note into one of them, or run those groups here.
2. **Read** every note of the chosen group in full, and its References where needed to judge the content.
3. **Apply under `sb-process`**, without a second approval: decide the new division (five notes may become one, three may become five, and keeping the current division is a valid result), then write it. Preserve every unique piece of information, quote and source; delete a note only after a verified merge; repair incoming links and `sources`; write each `summary` last. With subagents, each group goes to its own subagent (see **Subagents → knowledge**).
4. **Finish:** update `last_modified`, verify YAML and links, append the changelog entry, and report the new division (which notes were merged, split, renamed or kept, and why). With subagents, finish once all of them are done: one changelog entry for the whole run, with a section per group.

## Mode: full

Run `knowledge`, then `links`, then `tags`, then `summary`: restructuring first, so links, tags and summaries are fixed on the final notes. Each mode keeps its own questions, plan and approval. The user may skip a mode or stop after any of them.

## Subagents

An option in `summary` and `knowledge` only, never the default: use it only when the user chose it at the approval step. It keeps each note or group's reading out of the main context and runs them in parallel. The approval, the plan, the final verification, the changelog entry and the report stay with you; subagents never ask the user anything and never touch `CHANGELOG.md`.

Start them with the Agent tool (type `general-purpose`), all in one message, at most 10 at a time; with more, start the next wave when one finishes. Each prompt must be self-contained, because a subagent sees nothing of this conversation:

- the vault path and that it must first read the vault's `CLAUDE.md` and load the `sb-process` skill, which take precedence over the prompt;
- exactly which files it may change (below), and that every other file is read-only for it, because other subagents are writing at the same time;
- today's Mac-local date for `last_modified`;
- what to return (below), as a short structured report, not the note's text.

### summary

One subagent per note. Give it the note's path and the rules of step 3 of **Mode: summary**. It may change only that note, and only its `summary` and `last_modified` fields (`last_modified` only when the summary changed). It returns: changed or unchanged; the old and new summary when changed; content that may be outdated (step 5). Then verify the YAML of every changed note yourself.

### knowledge

One subagent per group. Give it the group's note paths, the reason the group was chosen, and steps 2–3 of **Mode: knowledge**. It may create notes in `02-Knowledge/`, and change or delete only the notes of its own group; it never renames with the CLI (that rewrites links in other files) and never edits notes outside its group. Instead it returns, besides the new division and why:

- renames it wants (old title → new title);
- notes it deleted after a verified merge, and the note each was merged into;
- every change needed outside its group: incoming links to repair (file, old link → new link) and `sources` to update.

When all subagents are done, apply those outside changes yourself, one after another: renames first (with the CLI, so links follow), then the link and `sources` repairs, then check that no link points to a deleted or renamed note. Then **Finish** as in step 4.

## Changelog

Append one `CHANGELOG.md` entry per mode, headed with the date and the mode (for example `## 2026-12-01 (sanitize: summary)`), listing the notes changed and the notes reviewed without changes. A `full` run appends one entry for each mode it ran, so the summary queue can find its own entries. Append only; never rewrite earlier entries.

## Report

Report the mode, changed file paths, the result, what was proposed but not approved, and any check you could not run (for example the CLI when the Obsidian app is closed).
