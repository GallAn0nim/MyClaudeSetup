import type { EngineInterface, Register } from 'claude-code'

import type { BrainUse, Bucket, Buckets, Category, Costs } from '../types'
import { INBOX, MARK, bucketOf, captureConversation, cleanTopics, env, knowledgeAllPrompt, knowledgePrompt, parseTopics, sanitizePrompt, record, refreshInbox, total, usd, usdOf } from './brain.ts'
import type { Marked } from './brain.ts'
import { renderPane } from './pane.tsx'
import { cleanReport, dailyPrompt, knowledgeNotes, randomPrompt, vaultStep } from './vault.ts'

// Second Brain: a pane with whether Claude used the vault for the current prompt, the potential
// Knowledge topics of this chat, five actions (Capture, Capture + Knowledge, Sanitize, Daily
// question, Random topic), the Inbox and what SecondBrain work costs.
// Nothing is written to the vault without a press; the topic list lives in this mod alone.

const S_TOPICS = { plugin: 'second-brain-control', key: 'topics' } as const
const S_INBOX = { plugin: 'second-brain-control', key: 'inbox' } as const
const S_COSTS = { plugin: 'second-brain-control', key: 'costs' } as const
const S_NOTE = { plugin: 'second-brain-control', key: 'note' } as const
const S_VAULT = { plugin: 'second-brain-control', key: 'vault' } as const
const S_COSTVIEW = { plugin: 'second-brain-control', key: 'costView' } as const
const S_BRAIN = { plugin: 'second-brain-control', key: 'brain' } as const
const S_BRAINOPEN = { plugin: 'second-brain-control', key: 'brainOpen' } as const
const S_SHOWN = { plugin: 'second-brain-control', key: 'shown' } as const
const S_COSTOPEN = { plugin: 'second-brain-control', key: 'costOpen' } as const
const S_FOLDED = { plugin: 'second-brain-control', key: 'folded' } as const
const S_TOPICSOPEN = { plugin: 'second-brain-control', key: 'topicsOpen' } as const
const S_INBOXOPEN = { plugin: 'second-brain-control', key: 'inboxOpen' } as const
const PANE = 'second-brain'
const TITLE = 'Second Brain'
const MOD = 'second-brain-control'
const INBOX_POLL_MS = 20_000
const OFF_TEXT = 'Second Brain is off. Turn it on in the Mods pane (/mods).'
const NO_BRAIN: BrainUse = { prompt: '', steps: [], report: null }
/** Actions whose follow-up turns all belong to them: once sent, the rest of the chat counts as theirs. */
const WHOLE_CHAT: Marked[] = ['sanitize', 'daily', 'random']

let action: Category | null = null
let busy = ''

const MODS_OFF = { plugin: 'mods-panel', key: 'disabled' } as const
async function switchedOff($: EngineInterface) {
  const { value } = await $.state.get(MODS_OFF)
  return Array.isArray(value) && value.includes(MOD)
}

const inVault = () => !!env.vault && (env.cwd === env.vault || env.cwd.startsWith(`${env.vault}/`))
const note = ($: EngineInterface, text: string) => $.state.set(S_NOTE, text)

async function setTopics($: EngineInterface, list: string[]) {
  await $.state.set(S_TOPICS, list)
  if (env.sid) await $.store.set(`topics:${env.sid}`, list).catch(() => undefined)
}
const topics = async ($: EngineInterface) => (await $.state.get(S_TOPICS)).value ?? []

/** Moves an old 'cleanup' bucket into 'sanitize'; true when it changed anything. */
function renameCleanup(b: Buckets): boolean {
  const old = (b as Record<string, Bucket | undefined>).cleanup
  if (!old) return false
  const cur = b.sanitize
  b.sanitize = cur ? (Object.fromEntries(Object.keys(old).map(k => [k, (old as Record<string, number>)[k]! + ((cur as Record<string, number>)[k] ?? 0)])) as Bucket) : old
  delete (b as Record<string, unknown>).cleanup
  return true
}

async function findVault($: EngineInterface) {
  const saved = await $.store.get('vault').catch(() => undefined)
  const candidates = [typeof saved === 'string' ? saved : '', `${env.home}/Obsidian/SecondBrain`].filter(Boolean)
  for (const c of candidates) if (await $.fs.exists(`${c}/${INBOX}`).catch(() => false)) return c
  return ''
}

// ---------- actions ----------

async function capture($: EngineInterface): Promise<string> {
  if (busy) return `${busy} is still running.`
  busy = 'Capture'
  try {
    const rel = await captureConversation($, await topics($))
    const msg = `Saved to ${rel}.`
    await note($, msg)
    return msg
  } catch (err) {
    const msg = `Could not capture: ${err instanceof Error ? err.message : String(err)}.`
    await note($, msg)
    return msg
  } finally {
    busy = ''
  }
}

async function captureAndKnowledge($: EngineInterface): Promise<string> {
  const msg = await capture($)
  if (!msg.startsWith('Saved to ')) return msg
  return processFile($, msg.slice('Saved to '.length, -1), `${msg} Claude is making Knowledge from it`)
}

/**
 * Sends a prompt as a turn of its own. A command or press hook may not submit while it runs
 * (it would wait on itself), so the prompt goes from a timer; if the engine refuses it, the
 * text goes into the prompt box for the person to send.
 */
function sendLater($: EngineInterface, text: string, failNote: string, cat: Marked = 'knowledge') {
  $.clock.after(150, () => void sendNow($, text, failNote, cat).catch(() => undefined))
}

async function sendNow($: EngineInterface, text: string, failNote: string, cat: Marked) {
  action = cat
  const r = await $.prompt.submit({ text, asUser: true }).catch(() => null)
  if (r && !('deny' in r && r.deny)) return
  action = null
  const fill = await $.prompt.fill({ text }).catch(() => null)
  await note($, fill?.isFilled ? `${failNote} The prompt is in the prompt box: press Return.` : `${failNote} Could not send the prompt.`)
}

async function processFile($: EngineInterface, rel: string, lead = `Claude is making Knowledge from ${rel}`) {
  sendLater($, knowledgePrompt(rel, await topics($)), lead.replace(/ Claude is making.*$/, '') || rel)
  const m = `${lead} (it starts when the current turn ends).`
  await note($, m)
  return m
}

/**
 * Sends the action's prompt in this chat (start a new session first for a clean context).
 * The prompt's mark makes prompt.submit attribute the rest of the chat to the action.
 */
async function inThisChat($: EngineInterface, cat: Marked, text: string, what: string, done: string): Promise<string> {
  sendLater($, text, `The ${what} did not start.`, cat)
  const m = `Claude starts the ${what} in this chat (when the current turn ends); ${done}`
  await note($, m)
  return m
}

const sanitize = ($: EngineInterface) => inThisChat($, 'sanitize', sanitizePrompt(), 'sanitize', 'it shows a plan and waits for your OK.')

async function daily($: EngineInterface) {
  if (!env.vault) return note($, 'Vault not found.').then(() => 'Vault not found.')
  return inThisChat($, 'daily', dailyPrompt(await $.clock.now(), await knowledgeNotes($)), 'daily question', 'Claude asks, then saves your answers to the Inbox.')
}

async function random($: EngineInterface) {
  if (!env.vault) return note($, 'Vault not found.').then(() => 'Vault not found.')
  return inThisChat($, 'random', randomPrompt(await $.clock.now(), await knowledgeNotes($)), 'random topic', 'Claude asks, then saves your answer to the Inbox.')
}

/** Set when Claude called the topics tool this turn, so the automatic refresh can skip. */
let topicsTold = false

/** Its own flag, so a background refresh never blocks Capture. */
let refreshing = false

async function refreshTopics($: EngineInterface, quiet = false): Promise<string> {
  if (refreshing) return 'Topics are already being refreshed.'
  refreshing = true
  if (!quiet) await note($, 'Looking for topics…')
  try {
    const r = await $.model.fork({
      prompt:
        'You have no tools. Answer straight away without deliberating. List the topics of this conversation that could become notes in my SecondBrain Knowledge base (a new project, an architecture decision, a technique, a person, a reflection). Short labels of 2-6 words, in the language of the conversation, most important first, at most 10. Reply with a JSON array of strings only.',
      effort: 'low',
    })
    if ('usage' in r && r.usage) await record($, 'topics', bucketOf(r.usage, ''))
    let m: string
    if (!r.isAnswered) m = r.reason === 'nothing-to-fork' ? 'Nothing to read yet: send a message first.' : `No topics came back (${r.reason}).`
    else {
      const list = parseTopics(r.text)
      if (list) await setTopics($, list)
      m = !list ? 'Could not read the topics that came back.' : list.length ? `${list.length} topic${list.length === 1 ? '' : 's'} found.` : 'No topics worth a note yet.'
    }
    if (!quiet) await note($, m)
    return m
  } finally {
    refreshing = false
  }
}

async function onPress($: EngineInterface, el: string) {
  if (el === 'capture') return capture($)
  if (el === 'knowledge') return captureAndKnowledge($)
  if (el === 'sanitize') return sanitize($)
  if (el === 'daily') return daily($)
  if (el === 'random') return random($)
  if (el === 'topics-refresh') return refreshTopics($)
  if (el === 'topics-clear') return setTopics($, []).then(() => note($, 'Topics cleared.'))
  if (el === 'brain') return $.state.set(S_BRAINOPEN, (await $.state.get(S_BRAINOPEN)).value === false)
  if (el === 'cost') return $.state.set(S_COSTOPEN, (await $.state.get(S_COSTOPEN)).value === false)
  if (el === 'cost-view') {
    const v = (await $.state.get(S_COSTVIEW)).value
    return $.state.set(S_COSTVIEW, v === 'all' ? 'session' : 'all')
  }
  if (el === 'capture-toggle' || el === 'actions-toggle' || el === 'status-toggle') {
    const id = el.replace('-toggle', '')
    const cur = (await $.state.get(S_FOLDED)).value ?? []
    return $.state.set(S_FOLDED, cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id])
  }
  if (el === 'topics-toggle') return $.state.set(S_TOPICSOPEN, (await $.state.get(S_TOPICSOPEN)).value === false)
  if (el === 'inbox-toggle') return $.state.set(S_INBOXOPEN, (await $.state.get(S_INBOXOPEN)).value === false)
  if (el === 'knowledge-all') {
    // The whole Inbox in one run, oldest first, each file finished before the next.
    const items = (await $.state.get(S_INBOX)).value ?? []
    if (!env.vault) return note($, 'Vault not found.')
    if (!items.length) return note($, 'No Inbox file to make Knowledge from.')
    const rels = [...items].sort((a, b) => a.mtimeMs - b.mtimeMs).map(f => `${INBOX}/${f.name}`)
    sendLater($, knowledgeAllPrompt(rels, await topics($)), `${rels.length} Inbox file${rels.length === 1 ? '' : 's'}.`)
    return note($, `Claude is making Knowledge from ${rels.length} Inbox file${rels.length === 1 ? '' : 's'} (it starts when the current turn ends).`)
  }
}

// ---------- vault use for the current prompt ----------

let brainChain: Promise<unknown> = Promise.resolve()
function changeBrain($: EngineInterface, fn: (b: BrainUse) => BrainUse) {
  brainChain = brainChain.then(async () => $.state.set(S_BRAIN, fn((await $.state.get(S_BRAIN)).value ?? NO_BRAIN))).catch(() => undefined)
  return brainChain
}

// ---------- opening on the first message ----------

// First-message order: Stats 0, Second Brain 500, Agent Info 1000, Mods 1500 ms.
const OPEN_DELAY_MS = 500
const later = ($: EngineInterface, ms: number) => new Promise<void>(r => void $.clock.after(ms, () => r()))

/** The chat's first message opens the pane, once per chat, unless it is switched off. */
async function openOnFirstMessage($: EngineInterface) {
  const { value, version } = await $.state.get(S_SHOWN)
  if (value === true) return
  if (!(await $.state.set(S_SHOWN, true, { ifVersion: version })).isSet) return
  await later($, OPEN_DELAY_MS)
  if (await switchedOff($)) return
  await $.ui.open({ id: PANE, title: TITLE })
}

// ---------- hooks ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    env.home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
    env.sid = await $.session.id().catch(() => '')
    env.cwd = await $.session.cwd().catch(() => e.cwd)
    env.vault = await findVault($)
    await $.state.set(S_VAULT, env.vault)
    const savedTopics = await $.store.get(`topics:${env.sid}`).catch(() => undefined)
    await $.state.set(S_TOPICS, Array.isArray(savedTopics) ? cleanTopics(savedTopics) : [])
    const all = (await $.store.get('costs-all').catch(() => undefined)) as { all?: Buckets; since?: number } | undefined
    const session = (await $.store.get(`costs:${env.sid}`).catch(() => undefined)) as Buckets | undefined
    // Cleanup is now Sanitize: carry costs counted under the old name over to the new one.
    if (all?.all && renameCleanup(all.all)) await $.store.set('costs-all', all).catch(() => undefined)
    if (session && renameCleanup(session)) await $.store.set(`costs:${env.sid}`, session).catch(() => undefined)
    const now = await $.clock.now()
    const costs: Costs = { session: session ?? {}, all: all?.all ?? {}, since: all?.since ?? now }
    await $.state.set(S_COSTS, costs)
    if (!all) await $.store.set('costs-all', { all: costs.all, since: costs.since }).catch(() => undefined)
    if ((await $.state.get(S_COSTVIEW)).value === undefined) await $.state.set(S_COSTVIEW, 'session')
    if ((await $.state.get(S_BRAIN)).value === undefined) await $.state.set(S_BRAIN, NO_BRAIN)
    if ((await $.state.get(S_BRAINOPEN)).value === undefined) await $.state.set(S_BRAINOPEN, false)
    if ((await $.state.get(S_COSTOPEN)).value === undefined) await $.state.set(S_COSTOPEN, false)
    await $.state.set(S_NOTE, '')
    const stored = await $.store.get(`action:${env.sid}`).catch(() => undefined)
    const saved = stored === 'cleanup' ? 'sanitize' : stored
    action = WHOLE_CHAT.includes(saved as Marked) ? (saved as Category) : null

    await $.command.register({
      name: 'secondbrain',
      description: 'Second Brain pane. Also: capture, knowledge, sanitize, daily, random, topics, costs, vault <path>',
      argumentHint: '[capture|knowledge|sanitize|daily|random|topics|costs|vault <path>]',
    })
    await $.tool.register({
      name: 'topics',
      description:
        "Keeps the list of potential SecondBrain Knowledge topics of this conversation, shown in the user's Second Brain pane. Call it at the end of a turn whenever the conversation reaches a topic that would make a good Knowledge note (a new project, its infrastructure, a technique such as authorization in .NET, a decision, a reflection), passing the FULL updated list: short labels of 2-6 words in the conversation's language, most important first, at most 10. Do not call it when the list would not change, and never more than once a turn. Do not mention the call to the user. It writes nothing to the vault.",
      inputSchema: {
        type: 'object',
        properties: { topics: { type: 'array', items: { type: 'string' }, description: 'The full list of potential topics, replacing the previous one.' } },
        required: ['topics'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'brain_report',
      description:
        "Reports, in the user's Second Brain pane, what you took from the SecondBrain vault for the current prompt. Call it once, at the end of any turn in which you consulted the vault (Knowledge.base, a search, reading notes), and not in other turns. List every note you looked at: in `used` the ones whose content went into your answer, in `unused` the ones that turned out irrelevant, each with a few words why. Do not mention the call to the user. It writes nothing to the vault.",
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'At most 4 words, e.g. "Found information", "Nothing relevant", "Partly relevant".' },
          found: { type: 'boolean', description: 'Whether the vault had something that helped the answer.' },
          used: { type: 'array', items: { type: 'object', properties: { note: { type: 'string' }, why: { type: 'string' } }, required: ['note'] } },
          unused: { type: 'array', items: { type: 'object', properties: { note: { type: 'string' }, why: { type: 'string' } }, required: ['note'] } },
        },
        required: ['status', 'found'],
      },
      isDeferred: false,
    })
    await refreshInbox($).catch(() => undefined)
    $.clock.every(INBOX_POLL_MS, () => void refreshInbox($).catch(() => undefined))
    return next(e)
  })

  // A new prompt starts a new vault-use record. Our marked prompts say what the turns are for;
  // one the person typed ends a Knowledge run's attribution.
  on('prompt.submit', async ($, e, next) => {
    const text = typeof e.text === 'string' ? e.text : ''
    const marked = (['knowledge', ...WHOLE_CHAT] as Marked[]).find(c => text.includes(MARK(c)))
    if (marked) {
      action = marked
      if (marked !== 'knowledge' && env.sid) await $.store.set(`action:${env.sid}`, marked).catch(() => undefined)
    } else if (action === 'knowledge' && e.origin.kind !== 'plugin') action = null
    const first = text.replace(/^\[second-brain:[a-z]+\]\s*/, '').replace(/\s+/g, ' ').trim()
    await changeBrain($, () => ({ prompt: first.slice(0, 80), steps: [], report: null }))
    await $.state.set(S_BRAINOPEN, false)
    const r = await next(e)
    void openOnFirstMessage($).catch(() => undefined)
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    try {
      if (e.usage) {
        const cat: Category | null = e.agentId !== undefined ? (action || inVault() ? 'subagents' : null) : (action ?? (inVault() ? 'chat' : null))
        if (cat) await record($, cat, bucketOf(e.usage, e.usage.model))
      }
    } catch {
      // The ledger is best effort.
    }
    void refreshInbox($).catch(() => undefined)
    // Topics refresh on their own after each answered main-thread turn of an ordinary chat in
    // the vault, unless Claude already kept them this turn. It forks the cached transcript.
    const told = topicsTold
    if (e.agentId === undefined) topicsTold = false
    if (e.agentId === undefined && e.reason === 'answer' && !told && action === null && inVault() && !(await switchedOff($))) {
      $.clock.after(300, () => void refreshTopics($, true).catch(() => undefined))
    }
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const tool = e.tool as string
    const input = e as unknown as Record<string, unknown>
    if (tool === `mcp__${MOD}__topics`) {
      if (await switchedOff($)) return { result: 'Second Brain is off; topics are not kept. Do not call this again in this chat.' } as never
      const list = Array.isArray(input.topics) ? cleanTopics(input.topics) : []
      await setTopics($, list)
      topicsTold = true
      return { result: `Kept ${list.length} topic(s). Do not mention this to the user.` } as never
    }
    if (tool === `mcp__${MOD}__brain_report`) {
      const report = cleanReport(input)
      await changeBrain($, b => ({ ...b, report }))
      return { result: 'Reported. Do not mention this to the user.' } as never
    }
    const step = vaultStep(tool, input, inVault())
    if (step) void changeBrain($, b => (b.steps.some(s => s.text === step.text) ? b : { ...b, steps: [...b.steps, step].slice(-30) }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'secondbrain' }, async ($, e) => {
    if (await switchedOff($)) return { text: OFF_TEXT }
    const [word = '', ...rest] = (e.args ?? '').trim().split(/\s+/)
    switch (word.toLowerCase()) {
      case '': {
        const r = await $.ui.open({ id: PANE, title: TITLE }).catch(() => null)
        return { text: r && r.isPlaced === false ? 'The Second Brain pane is ready but no window can show it right now.' : 'Opened the Second Brain pane.' }
      }
      case 'capture':
        return { text: await capture($) }
      case 'knowledge':
        return { text: await captureAndKnowledge($) }
      case 'sanitize':
        return { text: await sanitize($) }
      case 'daily':
        return { text: await daily($) }
      case 'random':
        return { text: await random($) }
      case 'topics':
        return { text: await refreshTopics($) }
      case 'costs': {
        const c = (await $.state.get(S_COSTS)).value
        return { text: `Second Brain cost: this chat ${usd(usdOf(total(c?.session ?? {})))}, all time ${usd(usdOf(total(c?.all ?? {})))}. Open /secondbrain for the breakdown.` }
      }
      case 'vault': {
        const path = rest.join(' ').replace(/^~(?=\/)/, env.home).replace(/\/$/, '')
        if (!path) return { text: `Vault: ${env.vault || 'not found'}. Usage: /secondbrain vault <path>` }
        if (!(await $.fs.exists(`${path}/${INBOX}`).catch(() => false))) return { text: `No ${INBOX} folder in ${path}.` }
        env.vault = path
        await $.store.set('vault', path)
        await $.state.set(S_VAULT, path)
        await refreshInbox($)
        return { text: `Vault set to ${path}.` }
      }
      default:
        return { text: 'Usage: /secondbrain [capture|knowledge|sanitize|daily|random|topics|costs|vault <path>]' }
    }
  })

  on('ui.press', { plugin: MOD }, async ($, e) => {
    if (!(await switchedOff($))) void onPress($, e.element).catch(() => undefined)
    return { element: e.element }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (await switchedOff($)) {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>{OFF_TEXT}</Text>
    }
    return renderPane($, e)
  })
}
