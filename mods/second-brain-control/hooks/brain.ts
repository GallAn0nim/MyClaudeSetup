import type { EngineInterface, ModelUsage, SessionMessage } from 'claude-code'

import type { Bucket, Buckets, Category, Costs, InboxItem } from '../types'

// The vault, the Inbox, captures, the prompts the actions send, and the cost ledger.

const S_INBOX = { plugin: 'second-brain-control', key: 'inbox' } as const
const S_COSTS = { plugin: 'second-brain-control', key: 'costs' } as const

export const env = { home: '', vault: '', sid: '', cwd: '' }
export const INBOX = '00-Inbox'
/** Prompts the actions send carry this, so the ledger knows what the turns were for. */
export type Marked = 'knowledge' | 'sanitize' | 'daily' | 'random'
export const MARK = (c: Marked) => `[second-brain:${c}]`

// ---------- dates and names ----------

const pad = (n: number) => String(n).padStart(2, '0')
export function day(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export function stamp(ms: number) {
  const d = new Date(ms)
  return `${day(ms)} ${pad(d.getHours())}${pad(d.getMinutes())}`
}
/** A file-name-safe title: keeps letters of any language, drops path and markup characters. */
export function safeTitle(t: string, max = 60) {
  const s = t
    .replace(/[\\/:*?"<>|#^[\]`\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > max ? s.slice(0, max).replace(/\s+\S*$/, '').trim() || s.slice(0, max) : s
}

// ---------- the Inbox ----------

export async function readInbox($: EngineInterface): Promise<InboxItem[]> {
  if (!env.vault) return []
  const list = await $.fs.list(`${env.vault}/${INBOX}`).catch(() => [])
  return list
    .filter(f => f.kind === 'file' && !f.name.startsWith('.'))
    .map(f => ({ name: f.name, size: f.size, mtimeMs: f.mtimeMs }))
    .sort((a, z) => z.mtimeMs - a.mtimeMs)
}

export async function refreshInbox($: EngineInterface) {
  const now = await readInbox($)
  const was = (await $.state.get(S_INBOX)).value ?? []
  if (JSON.stringify(now) !== JSON.stringify(was)) await $.state.set(S_INBOX, now)
}

/**
 * Creates a new file and never overwrites one (the shell's noclobber is an exclusive create).
 * When the name is taken it tries "name (2).md", "name (3).md".
 */
export async function createExclusive($: EngineInterface, dir: string, base: string, text: string): Promise<string> {
  for (let i = 1; i <= 20; i++) {
    const name = i === 1 ? `${base}.md` : `${base} (${i}).md`
    const path = `${dir}/${name}`
    const r = await $.process.run(['/bin/sh', '-c', 'set -C; cat > "$1"', 'sh', path], { stdin: text, timeoutMs: 10_000 })
    if (r.exitCode === 0) return path
    if (!(await $.fs.exists(path).catch(() => false))) throw new Error(r.stderr.trim() || 'could not write the file')
  }
  throw new Error('every file name is taken')
}

// ---------- capturing the conversation ----------

/** Text the person wrote, without the engine's reminders and wrappers around it. */
export function cleanUserText(t: string) {
  return t
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<(command-[a-z-]+|local-command-[a-z-]+|ide_[a-z_]+)>[\s\S]*?<\/\1>/g, '')
    .trim()
}

function toolLine(m: SessionMessage) {
  if (m.toolUses.length === 0) return ''
  const n = new Map<string, number>()
  for (const u of m.toolUses) n.set(u.tool, (n.get(u.tool) ?? 0) + 1)
  return `_(narzędzia: ${[...n].map(([t, c]) => (c > 1 ? `${t} ×${c}` : t)).join(', ')})_`
}

/** The conversation as Markdown: what I wrote and what Claude answered, tool calls named only. */
export function transcript(messages: SessionMessage[]) {
  const out: string[] = []
  let last: 'user' | 'assistant' | '' = ''
  let tools: string[] = []
  const flushTools = () => {
    if (tools.length) out.push(tools.join(' '), '')
    tools = []
  }
  for (const m of messages) {
    if (m.role === 'user') {
      const t = cleanUserText(m.text)
      if (!t) continue
      flushTools()
      out.push('## Ja', '', t, '')
      last = 'user'
      continue
    }
    const t = m.text.trim()
    const tl = toolLine(m)
    if (!t && !tl) continue
    if (last !== 'assistant') {
      flushTools()
      out.push('## Claude', '')
      last = 'assistant'
    }
    if (t) {
      flushTools()
      out.push(t, '')
    }
    if (tl) tools.push(tl)
  }
  flushTools()
  return out.join('\n').trim()
}

export function firstUserText(messages: SessionMessage[]) {
  for (const m of messages) if (m.role === 'user') {
    const t = cleanUserText(m.text)
    if (t && !t.startsWith('[second-brain:')) return t
  }
  return ''
}

/** Writes this conversation into 00-Inbox as a new note; returns its vault-relative path. */
export async function captureConversation($: EngineInterface, topics: string[]): Promise<string> {
  if (!env.vault) throw new Error('the vault was not found')
  const messages = await $.session.messages()
  const body = transcript(messages)
  if (!body) throw new Error('nothing to capture yet')
  const now = await $.clock.now()
  const title = safeTitle(topics[0] ?? firstUserText(messages).split('\n')[0] ?? '') || 'rozmowa'
  const intro = [
    `# Rozmowa z Claude: ${title}`,
    '',
    `> Zapis rozmowy z Claude Code z ${stamp(now).replace(/ (\d\d)(\d\d)$/, ' $1:$2')} (katalog \`${env.cwd}\`, sesja \`${env.sid}\`). Wywołania narzędzi są tylko wymienione z nazwy.`,
    ...(topics.length ? ['>', `> Potencjalne tematy: ${topics.join(', ')}.`] : []),
    '',
  ]
  const text = `---\ncreated: "${day(now)}"\n---\n\n${intro.join('\n')}\n${body}\n`
  const path = await createExclusive($, `${env.vault}/${INBOX}`, `${stamp(now)} Rozmowa - ${title}`, text)
  await refreshInbox($)
  return path.slice(env.vault.length + 1)
}

// ---------- the prompts the actions send ----------

/** Topics from the pane are hints only: sb-process (Scope) processes them only on an explicit request. */
const topicHint = (topics: string[]) =>
  topics.length
    ? ` A hint from the pane (not a request to save): potential topics of the conversation: ${topics.join(', ')}. Process only what is in the given files; list the rest in the report as not processed.`
    : ''

export function knowledgePrompt(rel: string, topics: string[]) {
  return `${MARK('knowledge')} Process my file \`${rel}\` from SecondBrain (${env.vault}) into Knowledge with the sb-process skill: read it in full, check the Knowledge.base index and the existing notes (update instead of duplicating), write the notes, connect them with wikilinks, move the original to 01-References, append to CHANGELOG and report.${topicHint(topics)}`
}

/** Every Inbox file, oldest first, each processed fully before the next (sb-process: one source at a time). */
export function knowledgeAllPrompt(rels: string[], topics: string[]) {
  return `${MARK('knowledge')} Process every file in my SecondBrain Inbox (${env.vault}) into Knowledge with the sb-process skill, oldest first, one at a time — each in full before you move to the next: read the file in full, check the Knowledge.base index and the existing notes (update instead of duplicating), write the notes, connect them with wikilinks, move the original to 01-References. Files:\n${rels.map(r => `- \`${r}\``).join('\n')}\nAt the end, append to CHANGELOG and report separately for each file.${topicHint(topics)}`
}

export function sanitizePrompt() {
  return `${MARK('sanitize')} Run the sb-sanitize skill for my SecondBrain (${env.vault}).`
}

// ---------- costs ----------

type Price = { input: number; output: number; read: number }
// US dollars per million tokens, the same table as the Stats mod. Cache writes are 1.25x input.
const PRICES: [RegExp, Price][] = [
  [/fable.?5.?2|mythos.?5.?2/i, { input: 8, output: 40, read: 0.2 }],
  [/fable|mythos/i, { input: 10, output: 50, read: 1 }],
  [/opus.?5.?5/i, { input: 4, output: 20, read: 0.2 }],
  [/opus/i, { input: 5, output: 25, read: 0.5 }],
  [/sonnet.?5.?5/i, { input: 2, output: 10, read: 0.1 }],
  [/sonnet.?5/i, { input: 2, output: 10, read: 0.2 }],
  [/sonnet/i, { input: 3, output: 15, read: 0.3 }],
  [/haiku.?5.?5/i, { input: 0.1, output: 0.5, read: 0.01 }],
  [/haiku/i, { input: 1, output: 5, read: 0.1 }],
]
const DEFAULT_PRICE: Price = { input: 4, output: 20, read: 0.2 }
export const priceOf = (model: string): Price => PRICES.find(([re]) => re.test(model))?.[1] ?? DEFAULT_PRICE

export const EMPTY: Bucket = { turns: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, thinking: 0, usdInput: 0, usdRead: 0, usdWrite: 0, usdOutput: 0, usdThinking: 0 }
export const usdOf = (b: Bucket) => b.usdInput + b.usdRead + b.usdWrite + b.usdOutput + b.usdThinking

/** One call's usage as a bucket. Thinking is not split out: it is billed as output. */
export function bucketOf(u: ModelUsage, model: string): Bucket {
  const p = priceOf(model)
  return {
    turns: 1,
    input: u.input_tokens,
    cacheRead: u.cache_read_input_tokens,
    cacheWrite: u.cache_creation_input_tokens,
    output: u.output_tokens,
    thinking: 0,
    usdInput: (u.input_tokens * p.input) / 1e6,
    usdRead: (u.cache_read_input_tokens * p.read) / 1e6,
    usdWrite: (u.cache_creation_input_tokens * p.input * 1.25) / 1e6,
    usdOutput: (u.output_tokens * p.output) / 1e6,
    usdThinking: 0,
  }
}

export function addBucket(a: Bucket | undefined, b: Bucket): Bucket {
  const x = a ?? EMPTY
  const out = { ...x }
  for (const k of Object.keys(EMPTY) as (keyof Bucket)[]) out[k] = x[k] + b[k]
  return out
}

export function total(bs: Buckets): Bucket {
  return Object.values(bs).reduce<Bucket>((acc, b) => addBucket(acc, b ?? EMPTY), { ...EMPTY })
}

let chain: Promise<unknown> = Promise.resolve()
/** Adds a call to this chat's and the all-time ledger, one at a time, the all-time one kept in the store. */
export function record($: EngineInterface, cat: Category, b: Bucket) {
  const run = chain.then(async () => {
    const now = await $.clock.now()
    const c: Costs = (await $.state.get(S_COSTS)).value ?? { session: {}, all: {}, since: now }
    const next: Costs = { ...c, session: { ...c.session, [cat]: addBucket(c.session[cat], b) }, all: { ...c.all, [cat]: addBucket(c.all[cat], b) } }
    await $.state.set(S_COSTS, next)
    await $.store.set('costs-all', { all: next.all, since: next.since }).catch(() => undefined)
    if (env.sid) await $.store.set(`costs:${env.sid}`, next.session).catch(() => undefined)
  })
  chain = run.catch(() => undefined)
  return run
}

// ---------- formatting ----------

export const tok = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n))
export const usd = (n: number) => (n >= 100 ? `$${n.toFixed(0)}` : n >= 0.995 ? `$${n.toFixed(2)}` : n >= 0.01 ? `$${n.toFixed(3)}` : n > 0 ? '<$0.01' : '$0')

/** "3m", "5h", "2d" ago. */
export function ago(ms: number, now: number) {
  const m = Math.max(0, Math.round((now - ms) / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`
}

export function parseTopics(text: string): string[] | null {
  const m = /\[[\s\S]*\]/.exec(text)
  if (!m) return null
  try {
    const v: unknown = JSON.parse(m[0])
    if (!Array.isArray(v)) return null
    return cleanTopics(v)
  } catch {
    return null
  }
}

export function cleanTopics(v: unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of v) {
    if (typeof x !== 'string') continue
    const t = x.replace(/\s+/g, ' ').trim().slice(0, 80)
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
  }
  return out.slice(0, 12)
}
