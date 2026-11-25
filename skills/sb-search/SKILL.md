---
name: sb-search
description: Answer from the SecondBrain Obsidian vault first. Use before answering any message that raises a topic, asks a question, or requests research while working in the SecondBrain vault — query 99-System/Knowledge.base, read the matching notes, build the answer on them with wikilink citations, list gaps, and close with a coverage paragraph. Also use when a blocking question needs a fact about the user's preferences, projects, decks, setup or life. Read-only; never writes to the vault.
---

# SecondBrain: search and answer from the vault

The vault's `CLAUDE.md` defines permissions and takes precedence over this skill. This skill is **read-only**: searching never authorizes writing, capturing, or updating notes.

## When to skip

Skip only for small talk, acknowledgements, and work on the vault's tooling (mods, skills, configuration) unless it concerns notes.

## 1. Find candidate notes

`99-System/Knowledge.base` (view `Knowledge`) is the primary dynamic index; Markdown notes remain the source of truth. Do not maintain a separate static index.

1. Query the base for titles, tags, and `summary`:
   - With the Obsidian app running: `obsidian vault=SecondBrain base:query path="99-System/Knowledge.base" view="Knowledge" format=json` (see `sb-obsidian-cli`).
   - Otherwise: search the YAML of `02-Knowledge/*.md` directly (grep `summary:`, `tags:`, and file names).
2. For a broader sweep, `search:context` or a grep over `02-Knowledge/` for key terms.
3. **Read selectively, never exhaustively.** Open only notes whose title, tags, or summary match the topic. Do not scan unrelated personal notes. Follow wikilinks from a matching note when they are relevant.

## 2. Build the answer

- **Relevant notes found → build the answer on them.** Treat the notes as source material, not text to copy: select, interpret, and analyse what is relevant to the question, citing each vault-derived point with a wikilink. Use general knowledge to explain, connect, and analyse that material, but not to replace it. Do not use web search unless asked.
- **Partial coverage → answer and list gaps.** Answer the part the notes cover; list the uncovered parts as explicit gaps. Do not fill them silently.
- **Stale notes → flag, don't check.** When a note may be outdated (e.g. card legality, prices, versions), flag it in the closing paragraph. Do not verify it on the web unprompted.
- **No relevant notes → research normally.** Answer from general knowledge and web research as needed, with external URLs, without asking first; the Second Brain pane shows that no note was found.
- **Explicit request wins.** When the user asks for deeper or web research, do it, labelling outside points and keeping them apart from vault-derived content.

## 3. Closing paragraph (when notes were used)

End with a short paragraph stating:
- that the answer is based on the local Second Brain (notes used),
- how well the notes covered the question (full / partial / thin),
- any gaps and stale or conflicting notes,
- when coverage is partial or thin, a suggestion of what deeper research would add.

## Blocking questions → vault first, then confirm

When you need information you cannot proceed without (a preference, past decision, fact about projects, decks, setup, or life), stop and search the vault. If it has an answer, present the question with the vault's answer and a wikilink, and wait for the user to confirm or correct it:

> *Question:* Do you avoid tutors in this deck?
> *From your vault ([[02-Knowledge/…]]):* Yes — you prefer constrained deckbuilding without tutors.
> Is this still correct?

If the vault has nothing, ask the question plainly and wait for the answer.

## Report

If the `brain_report` tool (Second Brain pane) is available, call it at the end of every turn in which you consulted the vault, listing notes used and notes looked at but not used.

## Scope

These rules govern answers and research in chat. When processing knowledge into notes, the research step in `sb-process` applies instead.
