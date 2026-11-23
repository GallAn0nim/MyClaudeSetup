import type { EngineInterface, ModelForkResult, RenderSurface } from 'claude-code'

import type { Panel, Step } from '../types'
import { costLine, draftText, forkPrompt, gatherFiles, gatherLinks, gatherSkills, redact, slug, tildeOf } from './gather.ts'
import type { Gathered } from './gather.ts'

// The handoff run (five steps with bars), the band state, and the button actions.

const PANEL = { plugin: 'handoff', key: 'panel' } as const

export const OFFER_AT = 300_000
export const SNOOZE = 100_000
// Saved handoffs and drafts older than this are deleted at session start.
const KEEP_MIN = 2 * 24 * 60
// A claude:// link longer than this falls back to Copy.
const MAX_URL = 8000
const TICK_MS = 110
const MIN_STEP_MS = 650
const WRITE_SCALE_MS = 40_000

const LABELS = ['Reading the conversation', 'Finding the files you used', 'Listing skills, tools and links', 'Writing the handoff (low effort)', 'Saving and checking']

export const env = { sid: '', home: '', verbatim: true }
let busy = false
let handoffText = ''
let handoffPath = ''
let ticker: { cancel: () => void } | null = null
let writeStartedAt = 0
let writeMs = 0
let running = -1
let stepStartedAt = 0

export const isBusy = () => busy
export const dir = () => `${env.home}/.claude/handoffs`
const tilde = (p: string) => tildeOf(env.home)(p)

export function freshSteps(): Step[] {
  return LABELS.map(label => ({ label, detail: '', status: 'wait', progress: 0 }))
}

export function blank(tokens: number, phase: Panel['phase'], reason = ''): Panel {
  return { phase, tokens, steps: freshSteps(), tick: 0, file: '', words: 0, error: '', note: '', reason, cost: '' }
}

export async function getPanel($: EngineInterface): Promise<Panel | null> {
  return (await $.state.get(PANEL)).value ?? null
}
export async function setPanel($: EngineInterface, p: Panel | null) {
  await $.state.set(PANEL, p)
}

async function patchStep($: EngineInterface, i: number, change: Partial<Step>) {
  const p = await getPanel($)
  if (p) await setPanel($, { ...p, steps: p.steps.map((s, k) => (k === i ? { ...s, ...change } : s)) })
}

// Writes only over the copy it read (ifVersion), so a step or the final result written
// meanwhile is never undone by an older frame.
async function tick($: EngineInterface) {
  if (!busy) return
  const read = await $.state.get(PANEL)
  const p = read.value ?? null
  if (!p || p.phase !== 'working') return
  const now = await $.clock.now()
  const steps = p.steps.map((s, k) => {
    if (k !== running || s.status !== 'run') return s
    if (k === 3) {
      const t = now - writeStartedAt
      return { ...s, progress: Math.min(0.95, 1 - Math.exp(-t / WRITE_SCALE_MS)), detail: `${Math.round(t / 1000)} s` }
    }
    return { ...s, progress: Math.min(0.9, (now - stepStartedAt) / MIN_STEP_MS) }
  })
  await $.state.set(PANEL, { ...p, steps, tick: p.tick + 1 }, { ifVersion: read.version })
}

async function step<T>($: EngineInterface, i: number, work: () => Promise<T>, detail: (v: T) => string): Promise<T> {
  running = i
  stepStartedAt = await $.clock.now()
  if (i === 3) writeStartedAt = stepStartedAt
  await patchStep($, i, { status: 'run', progress: 0.02 })
  const value = await work()
  const left = MIN_STEP_MS - ((await $.clock.now()) - stepStartedAt)
  if (left > 0 && i !== 3) await $.clock.sleep(left)
  await patchStep($, i, { status: 'done', progress: 1, detail: detail(value) })
  return value
}

async function stamp($: EngineInterface) {
  const d = new Date(await $.clock.now())
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

const plural = (n: number, w: string) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`
async function spent($: EngineInterface): Promise<number | null> {
  return (await $.session.usage()).cost?.usd ?? null
}

export async function run($: EngineInterface) {
  if (busy) return
  busy = true
  let draftPath = ''
  try {
    const { context } = await $.session.usage()
    await setPanel($, blank(context.tokens ?? 0, 'working'))
    ticker?.cancel()
    ticker = $.clock.every(TICK_MS, () => void tick($).catch(() => undefined))
    const cwd = await $.session.cwd()
    const messages = await step($, 0, () => $.session.messages(), ms => plural(ms.length, 'message'))
    const files = await step($, 1, () => gatherFiles($, env.home, messages), fs => plural(fs.length, 'file'))
    const found = await step($, 2, async () => ({ skills: gatherSkills(messages), links: gatherLinks(messages) }), f => `${plural(f.skills.length, 'skill')}, ${plural(f.links.length, 'link')}`)
    const g: Gathered = { messages, files, ...found }
    draftPath = `${dir()}/${await stamp($)}-draft.md`
    const draft = redact(draftText(cwd, g, tilde, env.verbatim))
    await $.fs.write(draftPath, draft)
    handoffText = draft
    handoffPath = draftPath
    const before = await spent($)
    let forkCost = ''
    const reply: ModelForkResult = await step(
      $,
      3,
      async () => {
        const r = await $.model.fork({ prompt: forkPrompt(cwd, g, tilde, env.verbatim), effort: 'low' })
        writeMs = (await $.clock.now()) - writeStartedAt
        const after = await spent($)
        const usage = 'usage' in r ? r.usage : null
        forkCost = costLine(before !== null && after !== null ? after - before : null, usage)
        // Thrown inside the step, so step 4 shows ✗, not ✓.
        if (!r.isAnswered) throw Object.assign(new Error(r.reason === 'api-error' ? `the model call failed (${r.status ?? '?'})` : `no handoff came back (${r.reason})`), { cost: forkCost })
        return r
      },
      () => `${Math.round(writeMs / 1000)} s`,
    )
    const cost = forkCost
    if (!reply.isAnswered) throw new Error('no handoff came back')
    const text = redact(reply.text.trim().replace(/^```(?:markdown|md)?\n([\s\S]*)\n```$/, '$1').trim())
    const saved = await step(
      $,
      4,
      async () => {
        const path = `${dir()}/${await stamp($)}-${slug(text)}.md`
        await $.fs.write(path, `${text}\n`)
        if (String(await $.fs.read(path)).trim() !== text) throw new Error('the saved file does not match')
        return path
      },
      p => p.split('/').pop() ?? '',
    )
    handoffText = text
    handoffPath = saved
    const p = await getPanel($)
    if (p) await setPanel($, { ...p, phase: 'ready', file: tilde(saved), words: text.split(/\s+/).length, cost })
    if (env.sid) await $.store.set(`last:${env.sid}`, { path: saved })
    await $.process.run(['rm', '-f', draftPath]).catch(() => undefined)
  } catch (err) {
    const p = await getPanel($)
    const steps = (p?.steps ?? freshSteps()).map((s, k) => (k === running && s.status === 'run' ? { ...s, status: 'fail' as const } : s))
    const cost = typeof (err as { cost?: unknown }).cost === 'string' ? String((err as { cost: string }).cost) : ''
    await setPanel($, {
      ...(p ?? blank(0, 'failed')),
      steps,
      phase: 'failed',
      error: String(err instanceof Error ? err.message : err).slice(0, 160),
      file: draftPath ? tilde(draftPath) : '',
      note: draftPath ? 'A basic draft is saved. Open it or copy it, or try again.' : '',
      cost,
    })
  } finally {
    ticker?.cancel()
    ticker = null
    running = -1
    busy = false
  }
}

export async function note($: EngineInterface, text: string) {
  const p = await getPanel($)
  if (p) await setPanel($, { ...p, note: text })
}

// The app's own clipboard (the surface that was pressed); pbcopy only as a fallback.
export async function copy($: EngineInterface, surface?: RenderSurface, prefix = '') {
  if (!handoffText) return
  let ok = false
  try {
    ok = (await $.ui.copy({ text: handoffText, ...(surface ? { surface } : {}) })).isCopied
  } catch {
    ok = false
  }
  if (!ok) ok = (await $.process.run(['pbcopy'], { stdin: handoffText }).catch(() => null))?.exitCode === 0
  await note($, ok ? `${prefix}Copied. Paste it into a new chat with ⌘V.` : `${prefix}Copy failed. Use Open file instead.`)
}

// The new chat gets a short prompt that points at the saved file, so the link stays short.
export function newChatPrompt(path: string) {
  return `Continue the work from my last chat. First read the handoff file ${path} in full, then follow its Next steps.`
}

export async function startNew($: EngineInterface, surface?: RenderSurface) {
  if (!handoffText) return
  const text = handoffPath ? newChatPrompt(handoffPath) : handoffText
  const url = `claude://code/new?q=${encodeURIComponent(text)}`
  if (url.length > MAX_URL) return copy($, surface, 'Too long for a new-chat link. ')
  const r = await $.process.run(['open', url]).catch(() => null)
  if (!r || r.exitCode !== 0) return copy($, surface, 'The new chat did not open. ')
  await note($, 'A new chat opened with a prompt that points to the handoff file. Press Return there to start it.')
}

// The Second Brain mod publishes its vault; a handoff can go into its 00-Inbox as a new note.
const BRAIN_VAULT = { plugin: 'second-brain-control', key: 'vault' } as const

export async function brainVault($: EngineInterface): Promise<string> {
  const v = (await $.state.get(BRAIN_VAULT)).value
  return typeof v === 'string' ? v : ''
}

export async function saveToInbox($: EngineInterface) {
  const vault = await brainVault($)
  if (!handoffText || !vault) return
  const d = new Date(await $.clock.now())
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const title = (/^#\s*Handoff:\s*(.+)$/m.exec(handoffText)?.[1] ?? 'sesja').replace(/[\\/:*?"<>|#^[\]`]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
  const text = `---\ncreated: "${day}"\n---\n\n${handoffText}\n`
  // Exclusive create (noclobber): never overwrites a note already in the Inbox.
  for (let i = 1; i <= 20; i++) {
    const name = `${day} ${pad(d.getHours())}${pad(d.getMinutes())} Handoff - ${title}${i === 1 ? '' : ` (${i})`}.md`
    const r = await $.process.run(['/bin/sh', '-c', 'set -C; cat > "$1"', 'sh', `${vault}/00-Inbox/${name}`], { stdin: text, timeoutMs: 10_000 }).catch(() => null)
    if (r?.exitCode === 0) return note($, `Saved to Second Brain: 00-Inbox/${name}`)
    if (!r) break
  }
  await note($, 'Could not save the handoff to the Second Brain Inbox.')
}

export async function openFile($: EngineInterface) {
  if (handoffPath && (await $.fs.exists(handoffPath).catch(() => false))) await $.process.run(['open', handoffPath])
}

export async function restoreLast($: EngineInterface) {
  const last = (await $.store.get(`last:${env.sid}`).catch(() => undefined)) as { path?: string } | undefined
  if (last?.path && (await $.fs.exists(last.path).catch(() => false))) {
    handoffPath = last.path
    handoffText = String(await $.fs.read(last.path)).trim()
  }
}

// Handoffs and drafts older than 2 days go. Only *.md directly in ~/.claude/handoffs.
export async function prune($: EngineInterface) {
  if (!env.home) return
  await $.process.run(['/usr/bin/find', dir(), '-maxdepth', '1', '-type', 'f', '-name', '*.md', '-mmin', `+${KEEP_MIN}`, '-delete'], { timeoutMs: 10_000 }).catch(() => undefined)
}
