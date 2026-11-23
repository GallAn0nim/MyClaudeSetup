import type { EngineInterface, ModelForkResult, Register } from 'claude-code'

import type { Clock, Warm } from '../types'

// Cache Clock: a countdown above the prompt until this chat's prompt cache goes
// cold, and an opt-in keep warm that pings the cache shortly before it expires.
// Writes no files. Reads two other mods' state: the Mods pane's switch and Handoff's offer line.

const CLOCK = { plugin: 'cache-clock', key: 'clock' } as const
const WARM = { plugin: 'cache-clock', key: 'warm' } as const
// The Mods pane's switch: this mod steps aside while its name is in the list.
const MODS_OFF = { plugin: 'mods-panel', key: 'disabled' } as const
// While the Handoff band shows its steps or result, the clock steps aside: two bands crowd the prompt.
const HANDOFF_PANEL = { plugin: 'handoff', key: 'panel' } as const
const HANDOFF_AT = { plugin: 'handoff', key: 'offerAt' } as const
const HANDOFF_BAR = 6

// How full the chat is toward Handoff's offer, on the same line; nothing while Handoff is off.
async function handoffFill($: EngineInterface, tokens: number, Text: ReturnType<EngineInterface['ui']['resolve']>['Text']) {
  const at = (await $.state.get(HANDOFF_AT)).value
  if (typeof at !== 'number' || at <= 0) return null
  const share = Math.max(0, Math.min(1, tokens / at))
  const filled = Math.round(share * HANDOFF_BAR)
  const color = share >= 0.9 ? BAD : share >= 0.7 ? WARN : HANDOFF
  return (
    <Text>
      <Text dimColor>{'  ↪ '}</Text>
      <Text color={color}>{'━'.repeat(filled)}</Text>
      <Text dimColor>{'━'.repeat(HANDOFF_BAR - filled)}</Text>
      <Text dimColor>{` handoff at ${short(at)}`}</Text>
    </Text>
  )
}

async function handoffShowing($: EngineInterface) {
  const { value } = await $.state.get(HANDOFF_PANEL)
  return !!value && value.phase !== 'offer'
}

const OFF_TEXT = 'Cache Clock is off. Turn it on in the Mods pane (/mods).'

async function switchedOff($: EngineInterface) {
  const { value } = await $.state.get(MODS_OFF)
  return Array.isArray(value) && value.includes('cache-clock')
}

const FIVE_MIN = 5 * 60_000
const ONE_HOUR = 60 * 60_000
const BAR = 12

// Keep warm: one tiny fork about 45 s before the cache would go cold. A fork
// re-sends the main thread's last request with one line after it, so the API
// reads the chat from its cache and the cache's timer starts again.
const LEAD = 45_000
const MAX_PINGS = 30
const MAX_MS = 2 * 60 * 60_000
const MAX_FAILS = 3
const RETRY_MS = 20_000
// No `effort` on the fork: a level other than the session's can cost a full
// cache write on some models. Asking for haste in the prompt keeps the cache
// read and avoids paying for thinking.
const PING_PROMPT = 'You have no tools here. Reply with the single word ok, straight away, without thinking it over.'

// How much of the transcript's end is read to find the cache length.
const TAIL_BYTES = 600_000
// A turn.start that never got its turn.complete stops blocking the clock after this.
const STALE_TURN_MS = 30 * 60_000

// Turns that are not the person typing: they do not end keep warm.
const BACKGROUND = new Set(['task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay', 'channel', 'coordinator', 'observer', 'observer-activity', 'auto-continuation'])

const GOOD = '#16a34a'
const WARN = '#ca8a04'
const BAD = '#dc2626'
const COLD = '#2563eb'
const HANDOFF = '#d97757'

// Module variables reset on a reload; the clock itself lives in $.state.
let sid = ''
let home = ''
let hidden = false
let transcript = ''
let detected: 'unknown' | '5m' | '1h' = 'unknown'
let workingSince = 0
let pinging = false

const short = (tokens: number) => `${Math.round(tokens / 1000)}k`
const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const ago = (ms: number) => {
  const m = Math.floor(ms / 60_000)
  return m < 1 ? 'just now' : m === 1 ? '1 min ago' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`
}

function lengthLabel(c: Pick<Clock, 'ttlMs' | 'ttlSource'>) {
  if (c.ttlSource === 'detected') return `${c.ttlMs === ONE_HOUR ? '1 h' : '5 min'} cache`
  return '5 min cache (guess until the first reply)'
}

function ttl(): Pick<Clock, 'ttlMs' | 'ttlSource'> {
  if (detected === '1h') return { ttlMs: ONE_HOUR, ttlSource: 'detected' }
  if (detected === '5m') return { ttlMs: FIVE_MIN, ttlSource: 'detected' }
  return { ttlMs: FIVE_MIN, ttlSource: 'default' }
}

async function getClock($: EngineInterface): Promise<Clock | null> {
  return (await $.state.get(CLOCK)).value ?? null
}
async function setClock($: EngineInterface, c: Clock | null) {
  await $.state.set(CLOCK, c)
}
async function getWarm($: EngineInterface): Promise<Warm | null> {
  return (await $.state.get(WARM)).value ?? null
}
async function setWarm($: EngineInterface, w: Warm | null) {
  await $.state.set(WARM, w)
  redrawSoon($)
}

function redrawSoon($: EngineInterface) {
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // The next tick redraws anyway.
  }
}

function toast($: EngineInterface, text: string) {
  try {
    $.ui.toast(text)
  } catch {
    // A toast is only a hint.
  }
}

async function isWorking($: EngineInterface) {
  if (!workingSince) return false
  if ((await $.clock.now()) - workingSince > STALE_TURN_MS) workingSince = 0
  return workingSince !== 0
}

// ---- Cache length (5 min or 1 h) ----
// The mod API reports cache writes but not their length, so the newest
// main-thread reply in this chat's transcript is read for it. Only the usage
// fields are looked at; nothing is kept or written.

async function findTranscript($: EngineInterface) {
  if (transcript || !home || !sid) return transcript
  const projects = `${home}/.claude/projects`
  for (const d of await $.fs.list(projects).catch(() => [])) {
    if (d.kind !== 'dir' || d.name.startsWith('.')) continue
    const path = `${projects}/${d.name}/${sid}.jsonl`
    if (await $.fs.exists(path)) {
      transcript = path
      break
    }
  }
  return transcript
}

async function readTail($: EngineInterface, path: string): Promise<string> {
  const { size } = await $.fs.stat(path)
  if (size > TAIL_BYTES) {
    try {
      const r = await $.process.run(['tail', '-c', String(TAIL_BYTES), path], { timeoutMs: 10_000 })
      if (r.exitCode === 0) return r.stdout.split('\n').slice(1).join('\n')
    } catch {
      // No `tail` here: fall through to a whole read while that is allowed.
    }
    if (size > 4 * 1024 * 1024) return ''
  }
  const text = String(await $.fs.read(path))
  return text.length > TAIL_BYTES ? text.slice(-TAIL_BYTES) : text
}

async function detect($: EngineInterface) {
  const path = await findTranscript($)
  if (!path) return
  const lines = (await readTail($, path)).split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? ''
    if (!line.includes('"assistant"')) continue
    let j: { type?: string; isSidechain?: boolean; message?: { usage?: { cache_creation?: Record<string, number> } } }
    try {
      j = JSON.parse(line)
    } catch {
      continue
    }
    if (j?.type !== 'assistant' || j.isSidechain) continue
    const cc = j.message?.usage?.cache_creation ?? {}
    // A reply can write both: 1 h breakpoints come first, so the conversation's tail is on 5 min.
    if ((cc.ephemeral_5m_input_tokens ?? 0) > 0) return void (detected = '5m')
    if ((cc.ephemeral_1h_input_tokens ?? 0) > 0) return void (detected = '1h')
  }
}

// ---- Show / hide (remembered across chats) ----

async function setHidden($: EngineInterface, value: boolean) {
  hidden = value
  await $.store.set('hidden', value).catch(() => undefined)
  if (value) await stopWarm($, 'Keep warm stopped: Cache Clock is hidden.', false)
  redrawSoon($)
}

// ---- Keep warm ----

async function startWarm($: EngineInterface): Promise<'on' | 'none' | 'cold'> {
  const c = await getClock($)
  if (!c || !c.lastEnd) return 'none'
  // A cold cache would be written whole again by the first ping: that is no keep warm.
  if ((await $.clock.now()) >= c.lastEnd + c.ttlMs) return 'cold'
  if (hidden) await setHidden($, false)
  await setWarm($, { startedAt: await $.clock.now(), pings: 0, read: 0, write: 0, output: 0, cold: false, error: '', sending: false, failures: 0, retryAt: 0 })
  return 'on'
}

async function stopWarm($: EngineInterface, why: string, shout = true) {
  if (!(await getWarm($))) return
  await setWarm($, null)
  if (shout) toast($, why)
}

async function warmTick($: EngineInterface) {
  // Claimed before any await, so two ticks can never both send a ping.
  if (pinging) return
  pinging = true
  let sent = false
  try {
    const w = await getWarm($)
    if (!w || (await isWorking($))) return
    if (await switchedOff($)) return stopWarm($, 'Keep warm stopped: Cache Clock was turned off in /mods.')
    const now = await $.clock.now()
    if (now - w.startedAt >= MAX_MS) return stopWarm($, 'Keep warm stopped after 2 hours. Type /keepwarm to start it again.')
    if (w.pings >= MAX_PINGS) return stopWarm($, `Keep warm stopped after ${MAX_PINGS} pings. Type /keepwarm to start it again.`)
    if (now < w.retryAt) return
    const c = await getClock($)
    if (!c || !c.lastEnd || c.lastEnd + c.ttlMs - now > LEAD) return
    // Gone cold (a sleeping laptop, a slow ping): a ping now would rewrite the whole chat.
    if (now >= c.lastEnd + c.ttlMs) return stopWarm($, 'Keep warm stopped: the cache had already gone cold.')
    sent = true
    void ping($, now, w.startedAt)
      .catch(() => undefined)
      .finally(() => {
        pinging = false
      })
  } finally {
    if (!sent) pinging = false
  }
}

// `gen` is the keep warm run this ping belongs to (its startedAt): a run stopped meanwhile is never written back.
async function ping($: EngineInterface, start: number, gen: number) {
  const w0 = await getWarm($)
  if (!w0 || w0.startedAt !== gen) return
  await setWarm($, { ...w0, sending: true })
  let r: ModelForkResult | null = null
  try {
    r = await $.model.fork({ prompt: PING_PROMPT })
  } catch {
    r = null
  }
  if (r && !r.isAnswered && r.reason === 'nothing-to-fork') {
    return stopWarm($, 'Keep warm stopped: there is no reply to keep warm yet.')
  }
  const w = await getWarm($)
  // Stopped (or restarted) while the ping was out: a prompt, /keepwarm off.
  if (!w || w.startedAt !== gen) return
  const n = w.pings + 1
  const usage = r && 'usage' in r ? r.usage : null
  const read = usage?.cache_read_input_tokens ?? 0
  const write = usage?.cache_creation_input_tokens ?? 0
  const output = usage?.output_tokens ?? 0
  // An answer, or a reply with no words, still read the chat: the timer restarted.
  const ok = r !== null && (r.isAnswered || r.reason === 'empty-reply')
  const now = await $.clock.now()
  if (ok) {
    await setWarm($, { ...w, pings: n, read, write, output, cold: write > read, error: '', sending: false, failures: 0, retryAt: 0 })
    const c = await getClock($)
    if (c) await setClock($, { ...c, lastEnd: Math.max(c.lastEnd, start), now })
  } else {
    const error = r && !r.isAnswered && r.reason === 'api-error' ? `${r.error}${r.status ? ` ${r.status}` : ''}` : r && !r.isAnswered ? r.reason : 'error'
    const failures = w.failures + 1
    await setWarm($, { ...w, pings: n, error, sending: false, failures, retryAt: now + RETRY_MS })
    if (failures >= MAX_FAILS) return stopWarm($, `Keep warm stopped: ${MAX_FAILS} pings in a row failed (${error}).`)
  }
  if (n >= MAX_PINGS) await stopWarm($, `Keep warm stopped after ${MAX_PINGS} pings. Type /keepwarm to start it again.`)
}

function warmLine(w: Warm, left: number): string {
  const parts = ['Keeping warm']
  if (w.sending) parts.push(`sending ping ${w.pings + 1}`)
  else if (w.pings === 0) parts.push(`first ping in ${mmss(left - LEAD)}`)
  else parts.push(`ping ${w.pings}/${MAX_PINGS}`, `next in ${mmss(left - LEAD)}`)
  if (w.error) parts.push(`last ping failed (${w.error}), retrying`)
  else if (w.pings > 0 && w.cold) parts.push(`cache had gone cold: rewrote ${short(w.write)} tokens`)
  else if (w.pings > 0) parts.push(`last ping read ${short(w.read)} cached, ${w.output} output tokens`)
  return parts.join(' · ')
}

// ---- Clock ----

async function restart($: EngineInterface) {
  // /clear goes on under a new session id with no session.start: find the new transcript.
  const id = await $.session.id().catch(() => sid)
  if (id && id !== sid) {
    sid = id
    transcript = ''
    detected = 'unknown'
  }
  const now = await $.clock.now()
  const { context } = await $.session.usage()
  await detect($).catch(() => undefined)
  await setClock($, { lastEnd: now, ...ttl(), tokens: context.tokens ?? 0, now })
}

// Once a second while warm; once a minute after it went cold (for "since X").
async function tick($: EngineInterface) {
  const c = await getClock($)
  if (!c || hidden || !c.lastEnd || (await switchedOff($))) return
  const now = await $.clock.now()
  const wasCold = c.now - c.lastEnd >= c.ttlMs
  const sameMinute = Math.floor((now - c.lastEnd) / 60_000) === Math.floor((c.now - c.lastEnd) / 60_000)
  if (wasCold && sameMinute) return
  await setClock($, { ...c, now })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    sid = await $.session.id()
    home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
    transcript = ''
    detected = 'unknown'
    workingSince = 0
    hidden = (await $.store.get('hidden').catch(() => undefined)) === true
    await $.command.register({
      name: 'cacheclock',
      description: 'Cache Clock: "/cacheclock" shows its status, "/cacheclock hide" or "/cacheclock show" hides or shows it in every chat',
      argumentHint: '[show|hide]',
      immediate: true,
    })
    await $.command.register({
      name: 'keepwarm',
      description: 'Cache Clock: ping the cache 45 s before it goes cold (max 2 h / 30 pings). "/keepwarm off" stops it',
      argumentHint: '[on|off]',
      immediate: true,
    })
    $.clock.every(1000, () => {
      void tick($).catch(() => undefined)
      void warmTick($).catch(() => undefined)
    })
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const isPing = pinging && e.text === PING_PROMPT
    if (e.agentId === undefined && !isPing) workingSince = await $.clock.now()
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // A subagent's turn does not touch the main chat's cache.
    // The clock is kept right even while switched off, so turning it back on shows the truth.
    if (e.agentId === undefined) {
      workingSince = 0
      void restart($).catch(() => undefined)
    }
    return result
  })

  // The person is back: their own message ends keep warm. Its commands do not.
  on('prompt.submit', async ($, e, next) => {
    try {
      const text = (e.text ?? '').trim().toLowerCase()
      const own = text.startsWith('/keepwarm') || text.startsWith('/cacheclock') || text === PING_PROMPT.toLowerCase()
      if (!own && !BACKGROUND.has(e.origin?.kind ?? '')) {
        void stopWarm($, 'Keep warm stopped: you sent a message.').catch(() => undefined)
      }
    } catch {
      // Never hold up the person's prompt.
    }
    return next(e)
  })

  on('command.run', { command: 'keepwarm' }, async ($, e) => {
    if (await switchedOff($)) return { text: OFF_TEXT }
    const arg = (e.args ?? '').trim().toLowerCase()
    const w = await getWarm($)
    if (arg === 'off' || (arg === '' && w)) {
      await stopWarm($, 'Keep warm is off.', false)
      return { text: 'Keep warm is off.' }
    }
    if (arg !== '' && arg !== 'on') return { text: 'Usage: /keepwarm [on|off]' }
    if (w) return { text: 'Keep warm is already on. /keepwarm off stops it.' }
    const started = await startWarm($)
    if (started === 'none') return { text: "Nothing to keep warm yet: it works after Claude's first reply." }
    if (started === 'cold') return { text: 'The cache has already gone cold, so there is nothing to keep warm. Your next message warms it again.' }
    return { text: 'Keep warm is on: one tiny ping about 45 s before the cache goes cold. Stops after 2 h, 30 pings, 3 failures, or your next message.' }
  })

  on('command.run', { command: 'cacheclock' }, async ($, e) => {
    if (await switchedOff($)) return { text: OFF_TEXT }
    const arg = (e.args ?? '').trim().toLowerCase()
    if (arg === 'hide') {
      await setHidden($, true)
      return { text: 'Cache Clock hidden in every chat. /cacheclock show brings it back.' }
    }
    if (arg === 'show') {
      await setHidden($, false)
      return { text: 'Cache Clock shown.' }
    }
    if (arg !== '') return { text: 'Usage: /cacheclock [show|hide]' }
    const c = await getClock($)
    const w = await getWarm($)
    const now = await $.clock.now()
    const state = !c || !c.lastEnd ? 'waiting for the first reply' : c.lastEnd + c.ttlMs > now ? `warm for ${mmss(c.lastEnd + c.ttlMs - now)}` : `cold since ${ago(now - c.lastEnd - c.ttlMs)}`
    return { text: `Cache Clock ${hidden ? 'hidden' : 'shown'} · ${lengthLabel(c ?? ttl())} · ${state} · keep warm ${w ? `on (${w.pings} pings)` : 'off'}` }
  })

  on('ui.press', { plugin: 'cache-clock', element: 'keepwarm' }, async ($, e) => {
    if (await getWarm($)) await stopWarm($, 'Keep warm is off.')
    else {
      const started = await startWarm($)
      if (started === 'on') toast($, 'Keep warm is on. /keepwarm off stops it.')
      else if (started === 'cold') toast($, 'The cache has already gone cold: nothing to keep warm.')
    }
    return { element: e.element }
  })

  on('ui.press', { plugin: 'cache-clock', element: 'hide' }, async ($, e) => {
    await setHidden($, true)
    toast($, 'Cache Clock hidden. /cacheclock show brings it back.')
    return { element: e.element }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const c = await getClock($)
    if (hidden || !c || !c.lastEnd || (await switchedOff($)) || (await handoffShowing($)) || e.props.isWorking || e.props.hasSurvey || (await isWorking($))) return next(e)
    const rest = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const noop = () => undefined
    const left = c.lastEnd + c.ttlMs - c.now
    const w = await getWarm($)
    const buttons = (
      <Box flexDirection="row" gap={1} flexShrink={0} marginLeft={2}>
        <Button key="keepwarm" label={w ? 'Stop keeping warm' : 'Keep warm'} onPress={noop} />
        <Button key="hide" label="Hide" role="dismiss" onPress={noop} />
      </Box>
    )
    const fill = await handoffFill($, c.tokens, Text)
    const warmRow = w ? <Text color={w.cold || w.error ? BAD : COLD}>{warmLine(w, left)}</Text> : null

    if (left > 0) {
      const share = left / c.ttlMs
      const filled = Math.max(1, Math.round(share * BAR))
      const color = left <= 60_000 ? BAD : share < 0.5 ? WARN : GOOD
      return (
        <Box flexDirection="column">
          {rest}
          <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
            <Text>
              <Text color={color}>◷ Cache warm </Text>
              <Text bold color={color}>
                {mmss(left)}
              </Text>
              <Text> </Text>
              <Text color={color}>{'━'.repeat(filled)}</Text>
              <Text dimColor>{'━'.repeat(BAR - filled)}</Text>
              <Text dimColor>{` ${c.ttlSource === 'detected' ? (c.ttlMs === ONE_HOUR ? '1 h' : '5 min') : '5 min?'} · ${short(c.tokens)}`}</Text>
              {fill}
            </Text>
            {buttons}
          </Box>
          {warmRow}
        </Box>
      )
    }

    const writeRate = c.ttlMs === ONE_HOUR ? '2×' : '1.25×'
    return (
      <Box flexDirection="column">
        {rest}
        <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
          <Text>
            <Text color={COLD}>❄ Cache cold</Text>
            <Text dimColor>{` ${ago(-left)} · next message re-writes ${short(c.tokens)} (${writeRate})`}</Text>
            {fill}
          </Text>
          {buttons}
        </Box>
        {warmRow}
      </Box>
    )
  })
}
