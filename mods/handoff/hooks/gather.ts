import type { EngineInterface, SessionMessage } from 'claude-code'

// Pure helpers: what the handoff pulls from the transcript, the prompts, redaction.

export type Gathered = { messages: SessionMessage[]; files: string[]; skills: string[]; links: string[] }

const PATH_RE = /(?:~|\/Users)\/[^\s'"`<>()|;,*]+/g
const URL_RE = /https?:\/\/[^\s'"`<>()\]]+/g

export const tildeOf = (home: string) => (p: string) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p)

export async function gatherFiles($: EngineInterface, home: string, messages: SessionMessage[]) {
  const count = new Map<string, number>()
  const add = (raw: string, weight: number) => {
    let p = raw.replace(/[.:]+$/, '')
    if (p.startsWith('~/')) p = home + p.slice(1)
    if (p.includes('/.claude/projects/') || p.includes('/tool-results/') || p.startsWith('/private/tmp') || p.startsWith('/tmp')) return
    count.set(p, (count.get(p) ?? 0) + weight)
  }
  for (const m of messages) {
    for (const u of m.toolUses) {
      const fp = u.input.file_path ?? u.input.notebook_path ?? u.input.path
      if (typeof fp === 'string' && fp.startsWith('/')) add(fp, u.tool === 'Read' ? 2 : 3)
      if (u.tool === 'Bash' && typeof u.input.command === 'string') {
        for (const hit of u.input.command.match(PATH_RE) ?? []) add(hit, 1)
      }
    }
  }
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p)
  const kept: string[] = []
  for (const p of ranked) {
    if (kept.length >= 30) break
    if (await $.fs.exists(p).catch(() => false)) kept.push(p)
  }
  return kept
}

export function gatherSkills(messages: SessionMessage[]) {
  const skills = new Set<string>()
  const servers = new Set<string>()
  for (const m of messages) {
    for (const u of m.toolUses) {
      if (u.tool === 'Skill' && typeof u.input.skill === 'string') skills.add(`/${u.input.skill}`)
      if (u.tool.startsWith('mcp__')) servers.add(u.tool.split('__')[1] ?? u.tool)
    }
  }
  return [...skills, ...[...servers].map(s => `MCP ${s}`)]
}

export function gatherLinks(messages: SessionMessage[]) {
  const links = new Set<string>()
  for (const m of messages) {
    for (const hit of m.text.match(URL_RE) ?? []) {
      const url = hit.replace(/[.,:;]+$/, '')
      if (!/localhost|127\.0\.0\.1|example\.com/.test(url)) links.add(url)
    }
  }
  return [...links].slice(-20)
}

const list = (xs: string[]) => (xs.length ? xs.map(x => `- ${x}`).join('\n') : '- none found')

export function forkPrompt(cwd: string, g: Gathered, tilde: (p: string) => string, verbatim: boolean) {
  const asked = verbatim
    ? "Every request in this chat, in order, with the user's own key words. Mark each one: done, in progress, or not started."
    : "Every request in this chat, in order, summarised in your own words: never quote the user's messages word for word. Mark each one: done, in progress, or not started."
  return `Write a handoff prompt for a fresh Claude Code session that continues this work. Do not call any tool. Reply with the prompt only: no preamble, no code fence around it.

The reader starts with an empty context. It can open files on this machine, but it cannot see this chat. It loads CLAUDE.md, AGENTS.md and its memory index by itself, so do not repeat those.

Facts pulled from this transcript (check them against what you remember; drop what does not matter for the next step):
Working directory: ${cwd}
Files read or changed, most used first:
${list(g.files.map(tilde))}
Skills and MCP servers used:
${list(g.skills)}
Links in the chat:
${list(g.links)}

Use this shape in plain, short language. Leave out a section that has nothing in it.

# Handoff: <the goal, in a few words>

Continue work in \`${tilde(cwd)}\`. Goal: <what the user is working toward right now>.

## What the user asked for
${asked}

## Where things stand
What is done and checked, the key decisions and why, and what was tested and what was not.

## Rules the user set
Standing constraints and preferences given in this chat.

## Files to open first
- \`<path>\`: why it matters, in one line. Only files the next step needs, at most 15. Paths only; never copy file content.

## Skills and tools to use
- \`<skill, CLI or connector>\`: when to use it, and any trap found in this chat.

## Errors already solved
- <the error>: <the fix>.

## Carried-over data
Only data that exists nowhere on disk: ids, URLs, numbers and decisions that live only in this chat.

## Next steps
1. The very next action, specific enough to start without asking a question.

Never write an API key, token or password; write where it lives instead. Keep it under 1,500 words.`
}

// A plain handoff from the transcript alone, saved before the model step.
export function draftText(cwd: string, g: Gathered, tilde: (p: string) => string, verbatim: boolean) {
  const users = g.messages.filter(m => m.role === 'user' && m.text.trim() && !m.text.trim().startsWith('<'))
  const asks = verbatim
    ? users
        .slice(-25)
        .map(m => `- ${m.text.trim().replace(/\s+/g, ' ').slice(0, 300)}`)
        .join('\n') || '- none found'
    : `- ${users.length} message(s); not copied here (word-for-word prompts are off).`
  return `# Handoff draft (no model step)

Continue work in \`${tilde(cwd)}\`. This draft was saved before the model wrote the full handoff. Open the files, then ask the user what is next.

## What the user asked for (newest last)
${asks}

## Files to open first
${list(g.files.slice(0, 15).map(f => `\`${tilde(f)}\``))}

## Skills and tools used
${list(g.skills)}

## Links in the chat
${list(g.links)}
`
}

// Anything shaped like a secret is cut out before the handoff is saved or copied.
export function redact(text: string) {
  return text
    .replace(
      /\b(sk-[A-Za-z0-9_-]{16,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}|pk_live_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|AKIA[0-9A-Z]{16})\b/g,
      '<secret removed>',
    )
    // PEM private keys, JWTs, npm tokens, passwords inside URLs (https://user:pass@host)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '<private key removed>')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '<secret removed>')
    .replace(/\bnpm_[A-Za-z0-9]{30,}\b/g, '<secret removed>')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi, '$1<secret removed>@')
    .replace(/((?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]{12,}/g, '$1<secret removed>')
    // name=value and name: value, quoted or not; $VAR, <placeholder> and plain numbers stay
    .replace(
      /((?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|access[_-]?key|private[_-]?key|secret|token|password|passwd|pwd|has(?:ło|lo))(?:[_-][A-Za-z0-9]+)*["']?\s*[:=]\s*)(["']?)(?![$<{/])(?![0-9]+\2(?:[\s,}]|$))([^\s"']{4,}|(?<=["'])[^"'\n]{4,}(?=["']))\2/giu,
      '$1$2<secret removed>$2',
    )
    // UPPER_CASE names ending in _KEY: AWS_SECRET_ACCESS_KEY=..., STRIPE_KEY: ...
    .replace(/\b([A-Z0-9_]*_KEY\s*[:=]\s*)(["']?)(?![$<])(?![0-9]+\2(?:\s|$))[^\s"']{4,}\2/g, '$1$2<secret removed>$2')
}

export function slug(text: string) {
  const title = /^#\s*Handoff:\s*(.+)$/m.exec(text)?.[1] ?? 'session'
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'session'
  )
}

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))

/** "$0.42 · 250k cache read, 3k cache write, 1.2k in, 900 out" */
export function costLine(usd: number | null, u: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number } | null) {
  const parts: string[] = []
  if (usd !== null && usd > 0) parts.push(`$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`)
  if (u) parts.push(`${k(u.cache_read_input_tokens)} cache read, ${k(u.cache_creation_input_tokens)} cache write, ${k(u.input_tokens)} in, ${k(u.output_tokens)} out`)
  return parts.join(' · ')
}
