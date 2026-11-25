---
name: sb-process
description: Process SecondBrain material into Knowledge notes and maintain them. Use before ANY write to the vault's 02-Knowledge/ or 01-References/ — processing Inbox sources into Knowledge, creating or updating a Knowledge note, moving a processed original to References, renaming or merging notes — when the user explicitly asks (e.g. "process the Inbox", "opracuj w Knowledge", "update my note on X"). Defines what a Knowledge note must be, the processing steps, metadata, and safeguards.
---

# SecondBrain: process knowledge

The vault's `CLAUDE.md` defines permissions and takes precedence over this skill, as do the templates in `99-System/Templates/`. Use `sb-obsidian-cli` for syntax and CLI details.

## What a Knowledge note is

A Knowledge note is an **article written for the vault owner to re-read in a year**, not a summary of its source. A note that only restates a source in fewer words is a defect.

- **Voice:** Write in the owner's voice, first person singular ("mój deck", "wybrałem"). Never write "użytkownik" or "the user" inside a note.
- **Depth:** Keep every significant thread, decision, argument, number, name, link, and example from the source. Leave out only repetition and filler. The Reference should be needed for the full original wording, not for substance.
- **Work on the text:** Quote the passages that carry the meaning or the voice, verbatim, as blockquotes. Then analyse them: compare, connect, draw conclusions, record what changed and why. Cite the Reference in the body next to what it supports, with a heading link where the Reference is Markdown (`[[01-References/File.md#Heading]]`) or the section name where it is not. Listing a file in `sources` is not citation.
- **Data stays usable:** When the source is data (a list, a table, a set of links), carry the data itself into the note, including URLs. Do not replace it with statistics about it.
- **Research and your own analysis:** Add them when they make the note better, and always when the source is raw material that cannot be understood alone (for example a decklist). Put them in a clearly named section of their own, separate from the owner's material, with external URLs. Verify against primary sources before asserting. Never infer how something works from its name.
- **Personal content:** This is a private vault. Preserve personal material (reflections, psychology, family, health, finances) in full, without softening it or asking first, and add the tag `osobiste`.
- **Structure:** The template's sections are a starting point, not a limit. Add whatever sections the article needs. One source may become several notes: split by topic, not by length, and connect the parts through a hub note.
- **Uncertainty:** State it once, where it matters. Do not hedge every paragraph.

## Language

Write new Knowledge notes and newly authored or substantially revised Knowledge content **in Polish**, including titles, headings, body text, and YAML `summary`. Keep YAML field names and required values (such as `type: knowledge`) unchanged. Preserve established technical terms, code, API identifiers, and proper nouns in their original language when translating them would reduce clarity. Do not rewrite otherwise unchanged Knowledge notes solely to enforce this convention.

Quotes stay in the source language, untranslated. Use established English terms as they are (for example Commander, mana curve, bracket, ramp, tutor) instead of coining Polish equivalents.

## Process knowledge

Work through one source at a time, without asking for a plan first:

1. Read the whole source, in parts if it is large. Headings and samples are not enough.
2. Check the index before writing anything. Query `99-System/Knowledge.base` (titles, tags, `summary`; `sb-search` method) and grep `02-Knowledge/` for the source's key terms. If a note covers the same or a closely related topic, update it; create a new, self-contained note only when none fits. Do not duplicate another Knowledge note; repeating what a Reference contains is expected. In the report, name the candidate notes you checked and why you updated or created.
3. List the source's threads and decide how they map to notes.
4. Do the research the note needs.
5. Write the body, connect related notes with valid wikilinks, then write `summary` last, from the finished note.
6. Go back through the source and check every thread against the notes.

## Scope

Write only what was asked for.

- When the user names sources (files) to process, the notes cover only the content of those sources. Do not add material from the earlier conversation, from other files, or from your own memory of the session, except research that serves the named source.
- When the user asks to save specific topics, write only those topics, and only the parts of the conversation or sources that concern them. Do not save the surrounding conversation or other threads.
- Topic suggestions that are not part of the named sources (for example a list of "potential topics" attached to the request) are not processed unless the user explicitly asks for them. List them in the report as not processed, with the reason.

## Daily question and random topic captures

Inbox files named `… Daily question.md` and `… Random topic.md` come from the Second Brain pane and follow these rules:

- **Day answers** (how the day went, good, bad, training, Monster, what I learned) go to the journal note `02-Knowledge/Dziennik - codzienne pytania.md` as a new dated entry, plus a row in its habits table. This is the default.
- **Exception:** create a new note, or update another existing note, only when an answer clearly calls for it: a topic substantial enough to stand alone (a new project, a health finding with details, a decision) or one that an existing note already covers (check the index first). Keep a short entry and a wikilink in the journal either way.
- **Answers to questions about a specific note** go to that note, in a section of their own, with the question's context. The journal entry keeps only a one-line pointer to it.
- A random-topic capture has no day answers, so it updates only the note it asks about, unless an answer clearly calls for a new note.

## Preserve sources

Follow this order for every processed original, so links and `sources` stay consistent:

1. **While writing**, cite the original in the note body at its **final** path, `01-References/<file name>` (Markdown) or `01-References/Attachments/<file name>` (other formats), with heading links where possible. These links resolve once the move is done.
2. **After the note is written and coverage is checked**, move the original from `00-Inbox/` to that destination without overwriting (`mv -n`, or check the destination first). Confirm the file is at the destination and gone from `00-Inbox/`. Preserve its contents and metadata exactly.
3. **Only then** add the destination to the note's `sources`.
4. **Then** run the link checks from **Verify**.

If the move cannot be completed safely (for example the destination name is taken), keep the original in `00-Inbox/`, do not add it to `sources`, change the body citations back to the Inbox path, and report the incomplete operation. Do not treat this procedure as permission to modify other files in References.

## Create safely

Check for an existing destination and use exclusive creation for new files, so a concurrent operation cannot overwrite one. Updating an existing Knowledge note is a separate, deliberate operation.

## Rename or merge Knowledge

Rename only when the content justifies a better title. Delete a note **only after a verified merge into another Knowledge note** that preserves all unique information, sources, and relevant links. Repair incoming references. If protected files would need editing or link integrity/completeness cannot be verified, do not rename or delete.

## Note types and metadata

Use the read-only templates in `99-System/Templates/` for **new** Markdown notes and resolve template variables before saving. Dates use Mac-local `YYYY-MM-DD`. Preserve `created`; update `last_modified` only when content or meaningful metadata changes.

- **Knowledge:** Use `Knowledge.md`. Required: `type: knowledge`, `created`, `last_modified`, a concrete 2–3 sentence `summary` written after the body, and `sources` (a list, which may be `[]`). `tags` are optional but recommended.
- **New Reference note:** Use `Reference.md`. Required: `type: reference`, `created`, `last_modified`. Optional: `summary`, `tags`, `source_url`. **A Markdown original moved from Inbox is not a newly authored Reference note:** preserve its original content and YAML unchanged.
- **Tags:** follow **Tags** below.
- **Sources:** `sources` contains only quoted Obsidian wikilinks to **existing files in References**, e.g. `sources: ["[[01-References/Article.md]]"]`. Put external URLs in note content or a Reference note's `source_url`, not in `sources`.

## Tags

1. **Look before tagging.** Get the vault's tags with their counts (`obsidian vault=SecondBrain tags counts`, or the `tags` of `02-Knowledge/*.md`) and pick from existing tags first.
2. **New tag only when needed:** when no existing tag fits and the tag is likely to cover more than one note. Name every new tag in the report.
3. **No variants.** Never add a tag that differs from an existing one only by number, language, spelling or hyphenation (`baza-danych` next to `bazy-danych`, `health` next to `zdrowie`). Follow the owner's earlier tag decisions (sanitize entries in `CHANGELOG.md`, recorded preferences).
4. **Language:** tags are Polish. Exceptions: proper names and established terms, which keep their usual form (`claude-code`, `edh`, `mtg`, `csharp`).
5. **Form:** lowercase, flat (no `/` or `#`), words joined with `-`. Personal content always gets `osobiste`.

## Verify

After writing, check coverage against the source, quotes against the original wording, YAML (required fields, quoted wikilinks), and that every `sources` target exists. Seek approval before risky or bulk operations.

Check links with the Obsidian CLI (details in `sb-obsidian-cli`):

- Run `obsidian vault=SecondBrain unresolved verbose format=json` **before and after** the changes and compare. Only new entries are yours to fix; older ones are reported, not silently fixed.
- `unresolved` does not check headings. For every `[[Note#Heading]]` link you wrote, confirm that the heading exists in the target note.
- If the Obsidian app is not running, do not launch it. Check links by matching wikilink targets against files in the vault and headings against the targets' `#` lines, and say in the report that the CLI check was not run.

## Changelog and report

- Append a concise `CHANGELOG.md` entry after significant changes to Knowledge (append only; never rewrite earlier entries).
- Report changed file paths, the result, and any unresolved limitations.
- After processing, also report per source: the notes created or updated, the threads they cover, what was left out and why, and what remains unverified.
