---
name: sb-add
description: Capture material into the SecondBrain vault's 00-Inbox, faithfully and without processing. Use when the user explicitly asks to save, add, or capture something to their notes / vault / SecondBrain / brain / Inbox, including Polish phrasings such as "dodaj do moich notatek", "zapisz w SecondBrain", "wrzuć do Inboxa". Do not use for processing Inbox material into Knowledge (that is sb-process), and never capture on your own initiative.
---

# SecondBrain: capture to Inbox

The vault's `CLAUDE.md` defines permissions and takes precedence over this skill. Capture happens **only on an explicit request**; useful information in a conversation is not a reason to save it.

## What capture is

Save user-supplied material faithfully, without summarizing or processing it. Capturing alone does **not** authorize moving it to Knowledge or References, and must not silently turn into a knowledge-processing workflow. If the user also wants it processed, that is a separate step with `sb-process`.

If it is unclear *what* to capture (the whole message? a quoted fragment? the conversation?), ask one brief question before writing.

## Steps

1. **Pick a file name** in `00-Inbox/`: `YYYY-MM-DD HHMM <title>` (Mac-local time, the same pattern the Second Brain pane uses), where the title describes the material. Check that no file with that name exists; never overwrite. Use exclusive creation so a concurrent operation cannot overwrite one (e.g. `set -o noclobber` or create-only file APIs).
2. **Markdown material:** use the template `99-System/Templates/Inbox.md`. YAML contains only the required `created` field (Mac-local `YYYY-MM-DD`, resolved — no `{{...}}` left). Below it, the submitted text exactly as given: no rewording, no translation, no added headings or summaries.
3. **Non-Markdown files** (images, PDFs, audio, …): copy them into `00-Inbox/` unchanged, without frontmatter and without sidecar metadata.
4. **Verify:** re-read the file, check the YAML is valid and the content matches what the user supplied.

## Rules

- Inbox permissions: create **new** files only. Do not edit or delete existing Inbox files.
- Keep the source language; do not translate.
- Raw Inbox capture needs **no** `CHANGELOG.md` entry.
- Report the created file path(s).
