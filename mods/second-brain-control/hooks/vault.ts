import type { EngineInterface } from 'claude-code'

import type { BrainReport, BrainStep } from '../types'
import { MARK, day, env, stamp } from './brain.ts'

// Picking Knowledge notes for Daily question and Random topic, the prompts those actions send,
// and spotting when Claude reaches into the vault, for the pane's brain indicator.

export const KNOWLEDGE = '02-Knowledge'

export type NoteInfo = { rel: string; title: string; lastModified: string }

/** Every Knowledge note with its YAML `last_modified` (the file's mtime when it has none). */
export async function knowledgeNotes($: EngineInterface): Promise<NoteInfo[]> {
  if (!env.vault) return []
  const dir = `${env.vault}/${KNOWLEDGE}`
  const list = await $.fs.list(dir).catch(() => [])
  const out: NoteInfo[] = []
  for (const f of list) {
    if (f.kind !== 'file' || !f.name.endsWith('.md') || f.name.startsWith('.')) continue
    const text = await $.fs.read(`${dir}/${f.name}`).catch(() => '')
    const front = /^---\n([\s\S]*?)\n---/.exec(typeof text === 'string' ? text : '')?.[1] ?? ''
    const lm = /^last_modified:\s*["']?(\d{4}-\d{2}-\d{2})/m.exec(front)?.[1] ?? day(f.mtimeMs)
    out.push({ rel: `${KNOWLEDGE}/${f.name}`, title: f.name.replace(/\.md$/, ''), lastModified: lm })
  }
  return out
}

const pick = <T,>(xs: readonly T[]): T | undefined => xs[Math.floor(Math.random() * xs.length)]

/** One note at random, and one at random among the five least recently modified (not the same one when there is a choice). */
export function pickDaily(notes: NoteInfo[]) {
  const oldest = [...notes].sort((a, z) => a.lastModified.localeCompare(z.lastModified) || a.rel.localeCompare(z.rel)).slice(0, 5)
  const old = pick(oldest)
  const rest = notes.filter(n => n.rel !== old?.rel)
  const random = pick(rest.length ? rest : notes)
  return { random, old }
}

const link = (n: NoteInfo) => `[[${n.rel.replace(/\.md$/, '')}]]`

/** The pane picks the notes and the file name; the procedure lives in the sb-checkin skill. */
const checkin = (mode: 'daily' | 'random', what: string, noteLines: string[], file: string) =>
  `${MARK(mode)} ${what} for my SecondBrain (${env.vault}). Use the sb-checkin skill in ${mode} mode with these inputs.
Notes:
${noteLines.length ? noteLines.join('\n') : '- (none)'}
File: \`00-Inbox/${file}\``

export function dailyPrompt(now: number, notes: NoteInfo[]) {
  const { random, old } = pickDaily(notes)
  const noteLines = [
    random ? `- A random note: ${link(random)} (\`${random.rel}\`)` : '',
    old ? `- One of the five least recently modified notes: ${link(old)} (\`${old.rel}\`, last_modified ${old.lastModified})` : '',
  ].filter(Boolean)
  return checkin('daily', 'Daily question', noteLines, `${stamp(now)} Daily question.md`)
}

export function randomPrompt(now: number, notes: NoteInfo[]) {
  const note = pick(notes)
  const fromNote = note && Math.random() < 0.6
  const noteLines = fromNote ? [`- ${link(note)} (\`${note.rel}\`)`] : []
  return checkin('random', 'Random topic', noteLines, `${stamp(now)} Random topic.md`)
}

// ---------- spotting vault use ----------

const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)

function inside(p: unknown, cwdInVault: boolean): p is string {
  if (typeof p !== 'string' || !p || !env.vault) return false
  if (p === env.vault || p.startsWith(`${env.vault}/`)) return true
  const tilde = env.home && env.vault.startsWith(`${env.home}/`) ? `~${env.vault.slice(env.home.length)}` : ''
  if (tilde && (p === tilde || p.startsWith(`${tilde}/`))) return true
  return cwdInVault && !p.startsWith('/') && !p.startsWith('~')
}

function rel(p: string) {
  const v = env.vault
  if (p.startsWith(`${v}/`)) return p.slice(v.length + 1)
  const tilde = env.home && v.startsWith(`${env.home}/`) ? `~${v.slice(env.home.length)}/` : ''
  if (tilde && p.startsWith(tilde)) return p.slice(tilde.length)
  return p.replace(/^\.\//, '')
}

/**
 * What a tool call did in the vault, as one line for the pane, or null when it did nothing there.
 * Reading CLAUDE.md and the mod's own tools do not count: they are not looking for knowledge.
 */
export function vaultStep(tool: string, input: Record<string, unknown>, cwdInVault: boolean): BrainStep | null {
  if (!env.vault) return null
  if (tool === 'Skill') {
    const sb = /(?:^|[:/])(sb-[\w-]+)$/.exec(String(input.skill ?? ''))
    if (sb) return { kind: 'skill', text: `Loaded the ${sb[1]} skill` }
  }
  if (tool === 'Read' && inside(input.file_path, cwdInVault)) {
    const r = rel(input.file_path)
    if (/Knowledge\.base$/.test(r)) return { kind: 'base', text: 'Checked Knowledge.base' }
    if (r === 'CLAUDE.md' || r.startsWith('.obsidian/')) return null
    return { kind: 'read', text: r }
  }
  if (tool === 'Grep' || tool === 'Glob') {
    const path = typeof input.path === 'string' && input.path ? input.path : cwdInVault ? env.vault : ''
    if (!inside(path, cwdInVault)) return null
    const where = typeof input.path === 'string' && input.path ? ` in ${rel(input.path)}` : ''
    return { kind: 'search', text: cut(`Searched "${String(input.pattern ?? input.glob ?? '')}"${where}`, 90) }
  }
  if (tool === 'Bash') {
    const cmd = String(input.command ?? '')
    if (/Knowledge\.base|obsidian\s+base/.test(cmd)) return { kind: 'base', text: 'Checked Knowledge.base' }
    const tilde = env.home && env.vault.startsWith(`${env.home}/`) ? `~${env.vault.slice(env.home.length)}` : '\u0000'
    const touches =
      cmd.includes(env.vault) || cmd.includes(tilde) || /(^|[\s;&|])obsidian\s/.test(cmd) || (cwdInVault && /0[0-2]-(Inbox|References|Knowledge)|99-System/.test(cmd))
    if (!touches) return null
    if (/\b(grep|rg|find|ugrep)\b/.test(cmd)) return { kind: 'search', text: cut(`Searched: ${cmd.replace(/\s+/g, ' ')}`, 90) }
    return { kind: 'cli', text: cut(`Ran: ${cmd.replace(/\s+/g, ' ')}`, 90) }
  }
  return null
}

/** The report tool's input, cleaned. */
export function cleanReport(x: Record<string, unknown>): BrainReport {
  const notes = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      .map(n => (typeof n === 'string' ? { note: n, why: '' } : n && typeof n === 'object' ? { note: String((n as { note?: unknown }).note ?? ''), why: String((n as { why?: unknown }).why ?? '') } : null))
      .filter((n): n is { note: string; why: string } => !!n && !!n.note.trim())
      .map(n => ({ note: cut(n.note.trim(), 120), why: cut(n.why.trim(), 160) }))
      .slice(0, 15)
  return {
    status: cut(String(x.status ?? '').trim(), 40) || (x.found ? 'Found information' : 'Nothing relevant'),
    found: x.found === true,
    used: notes(x.used),
    unused: notes(x.unused),
  }
}
