---
name: sb-checkin
description: Run a SecondBrain check-in — the Daily question or the Random topic — then save the questions and answers verbatim to the vault's 00-Inbox. Use when a prompt starts with [second-brain:daily] or [second-brain:random] (sent by the Second Brain pane), or when the user asks for their daily question or a random topic from their SecondBrain. Asks and captures only; processing the capture into Knowledge is sb-process.
---

# SecondBrain: check-in (Daily question, Random topic)

The vault's `CLAUDE.md` defines permissions and takes precedence over this skill. A check-in is an explicit request to capture in `00-Inbox/`; it never authorizes processing into Knowledge or editing any other note.

## Inputs

The Second Brain pane picks the inputs in code and passes them in the prompt. Use them as given; do not pick other notes or another file name.

- **Mode:** `daily` or `random`.
- **Notes:** the Knowledge notes to ask about, as wikilinks with their paths. Daily gets up to two (a random one and one of the five least recently modified). Random gets one note, or none, which means "ask about the whole vault".
- **File:** the Inbox file name to save to, `00-Inbox/YYYY-MM-DD HHMM Daily question.md` or `… Random topic.md`.

When the user starts a check-in without the pane, use the current local time for the file name and choose the notes yourself the same way.

## Daily mode

**Step 1.** Ask these questions in one message, worded exactly like this, and wait for the answers:

1. How was your day?
2. Did anything good happen?
3. Did anything bad happen?
4. Did you train today?
5. Did you drink a Monster?
6. Did you learn something new?

**Step 2.** After the answers, read each given note **in full** and ask one question per note whose answer would add real value to it: a gap, an outdated fact, a missing reason, example or decision. Name the note next to its question, then wait for the answers. With no notes given, skip this step.

**Step 3.** Save (see **Saving**).

A short, human reaction to the day answers is fine before Step 2 (for example to bad news), but do not lecture or give advice nobody asked for.

## Random mode

- **With a note:** read it in full and ask one question whose answer would add real value to that note (a gap, an outdated fact, a missing reason, example or decision). Name the note.
- **Without a note:** look over the vault through `99-System/Knowledge.base` (titles, tags, summaries) and ask one thought-provoking question that would add value: a gap between notes, a link nobody made, or a topic the notes touch but never explain. Name the notes it relates to.

Then wait for the answer and save (see **Saving**).

## Good note questions

- Ask about what the note is missing, not what it already says. Read it first; never ask from the title or summary alone.
- One question per note, specific enough to answer in a few sentences.
- Prefer questions about the owner (a decision, a reason, the current state, what happened next) over trivia the web could answer.

## Saving

1. Check that the given file name is free in `00-Inbox/`. If it is taken, add ` (2)`, ` (3)` and so on. Create the file exclusively and never overwrite (for example `set -o noclobber` with a heredoc).
2. Use `99-System/Templates/Inbox.md`: the YAML holds only `created` (`YYYY-MM-DD`, Mac-local).
3. Body: each question as a `##` heading, the answer under it **verbatim**, with no corrections of spelling, wording or language.
4. For note questions, start the heading with the wikilink to the note (`[[02-Knowledge/Title]]: question…`).
5. Do not process the capture into Knowledge and do not edit any other note. How a capture is processed later is defined in `sb-process` (section "Daily question and random topic captures").
6. Report the saved path in one or two sentences, in the user's language.

## Report tool

If the `brain_report` tool is available, call it at the end of each turn in which you read vault notes, listing the notes used.
