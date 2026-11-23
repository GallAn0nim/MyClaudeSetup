import type { EngineInterface, Register } from 'claude-code'

import type { Step } from '../types'
import { OFFER_AT, SNOOZE, blank, brainVault, copy, env, getPanel, isBusy, openFile, prune, restoreLast, run, saveToInbox, setPanel, startNew } from './run.ts'

// Handoff: at 300k context tokens a band offers Refresh. Refresh writes a handoff of the whole
// chat at low effort, shows its cost, and offers Copy / Start new chat / Open file / Save to Inbox.
// Nothing runs without a press: a request from Claude only brings up the offer.

const POLL_MS = 5000
const ACCENT = '#d97757'
const GOOD = '#16a34a'
const BAD = '#dc2626'
const SPIN = ['◐', '◓', '◑', '◒']
const BAR = 18

// Module variables reset on a reload; per-chat choices live in $.store under the session id.
let hiddenHere = false
let snoozedTo = OFFER_AT
let forced = false
let askAtTurnEnd = ''

const short = (tokens: number) => `${Math.round(tokens / 1000)}k`
const OFF_TEXT = 'Handoff is off. Turn it on in the Mods pane (/mods).'

// The Mods pane's switch: this mod steps aside while its name is in the list.
const MODS_OFF = { plugin: 'mods-panel', key: 'disabled' } as const

async function switchedOff($: EngineInterface) {
  const { value } = await $.state.get(MODS_OFF)
  return Array.isArray(value) && value.includes('handoff')
}

// Where the offer comes up, for Cache Clock's line to draw a fill bar; null while off or hidden.
const OFFER_LINE = { plugin: 'handoff', key: 'offerAt' } as const
let lastOfferAt: number | null | undefined
async function publishOfferAt($: EngineInterface, value: number | null) {
  if (value === lastOfferAt) return
  lastOfferAt = value
  await $.state.set(OFFER_LINE, value)
}

async function setHiddenHere($: EngineInterface, value: boolean) {
  hiddenHere = value
  if (env.sid) await $.store.set(`hidden:${env.sid}`, value).catch(() => undefined)
}

// Brings the Refresh offer up now, whatever the token count. Never starts a run.
async function showOffer($: EngineInterface, reason: string) {
  const p = await getPanel($)
  if (isBusy() || (p && p.phase !== 'offer')) return
  const { context } = await $.session.usage()
  forced = true
  await setPanel($, blank(context.tokens ?? 0, 'offer', reason))
}

// This chat's own choices. /clear goes on under a new session id with no session.start,
// so checkOffer notices the new id and loads that chat's choices afresh.
async function loadChat($: EngineInterface, sid: string) {
  env.sid = sid
  hiddenHere = (await $.store.get(`hidden:${sid}`).catch(() => undefined)) === true
  const saved = await $.store.get(`snooze:${sid}`).catch(() => undefined)
  snoozedTo = typeof saved === 'number' ? saved : OFFER_AT
  forced = false
}

async function checkOffer($: EngineInterface) {
  if (isBusy()) return
  const sid = await $.session.id().catch(() => env.sid)
  if (sid && sid !== env.sid) {
    await loadChat($, sid)
    const p = await getPanel($)
    if (p?.phase === 'offer') await setPanel($, null)
  }
  if (!env.sid) return
  if (await switchedOff($)) {
    await publishOfferAt($, null)
    const p = await getPanel($)
    if (p?.phase === 'offer') await setPanel($, null)
    return
  }
  const p = await getPanel($)
  if (p && p.phase !== 'offer') return
  if (forced && p) return
  forced = false
  if (hiddenHere) {
    await publishOfferAt($, null)
    if (p) await setPanel($, null)
    return
  }
  await publishOfferAt($, snoozedTo)
  const tokens = (await $.session.usage()).context.tokens ?? 0
  // A compaction or /clear brings the count down: the offer starts over.
  if (tokens < OFFER_AT && snoozedTo > OFFER_AT) {
    snoozedTo = OFFER_AT
    await $.store.set(`snooze:${env.sid}`, snoozedTo).catch(() => undefined)
  }
  if (tokens >= snoozedTo) {
    if (!p || Math.abs(p.tokens - tokens) >= 1000) await setPanel($, blank(tokens, 'offer'))
  } else if (p) {
    await setPanel($, null)
  }
}

async function close($: EngineInterface) {
  const p = await getPanel($)
  if (p?.phase === 'offer') {
    forced = false
    await setHiddenHere($, true)
    try {
      $.ui.toast('Refresh offer hidden in this chat. Type /fresh to show it.')
    } catch {
      // Only a hint.
    }
  } else if (p) {
    snoozedTo = Math.max(snoozedTo, p.tokens + SNOOZE)
    await $.store.set(`snooze:${env.sid}`, snoozedTo).catch(() => undefined)
  }
  await setPanel($, null)
}

function bar(progress: number, status: Step['status']) {
  const filled = Math.round(Math.max(0, Math.min(1, progress)) * BAR)
  const color = status === 'fail' ? BAD : status === 'done' ? GOOD : ACCENT
  return { on: '━'.repeat(filled), off: '━'.repeat(BAR - filled), color }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    env.home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
    env.verbatim = (await $.store.get('verbatim').catch(() => undefined)) !== false
    await loadChat($, await $.session.id())
    await $.command.register({
      name: 'handoff',
      description: 'Write a handoff of this chat now. "/handoff prompts off" stops quoting your prompts word for word; "on" brings it back',
      argumentHint: '[prompts on|off]',
    })
    await $.command.register({ name: 'fresh', description: 'Show the Refresh offer now (also un-hides it in this chat)', immediate: true })
    await $.tool.register({
      name: 'refresh',
      description:
        'Show the Refresh offer above the prompt, so the user can choose to write a handoff of this chat and move to a new one. Use when the user asks to refresh, hand off, or move this work to a new chat. Nothing runs until the user presses Refresh.',
      inputSchema: { type: 'object', properties: {} },
    })
    await restoreLast($).catch(() => undefined)
    void prune($)
    // A reload while the steps ran leaves a dead "working" band behind.
    const p = await getPanel($)
    if (p && p.phase === 'working') await setPanel($, null)
    $.clock.every(POLL_MS, () => void checkOffer($).catch(() => undefined))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    if (askAtTurnEnd) {
      const reason = askAtTurnEnd
      askAtTurnEnd = ''
      await setHiddenHere($, false)
      void showOffer($, reason).catch(() => undefined)
    } else void checkOffer($).catch(() => undefined)
    return result
  })

  on('command.run', { command: 'fresh' }, async $ => {
    if (await switchedOff($)) return { text: OFF_TEXT }
    await setHiddenHere($, false)
    const p = await getPanel($)
    if (p && p.phase !== 'offer') return { text: 'A handoff is already on screen above the prompt. Close it first to see the offer.' }
    await showOffer($, '')
    return { text: 'Refresh offer shown above the prompt.' }
  })

  on('command.run', { command: 'handoff' }, async ($, e) => {
    if (await switchedOff($)) return { text: OFF_TEXT }
    const [word = '', value = ''] = (e.args ?? '').trim().toLowerCase().split(/\s+/)
    if (word === 'prompts') {
      if (value !== 'on' && value !== 'off') return { text: `Word-for-word prompts are ${env.verbatim ? 'on' : 'off'}. Usage: /handoff prompts on|off` }
      env.verbatim = value === 'on'
      await $.store.set('verbatim', env.verbatim)
      return { text: env.verbatim ? 'Handoffs quote your prompts word for word again.' : 'Handoffs now summarise your prompts and never save them word for word.' }
    }
    if (word !== '') return { text: 'Usage: /handoff [prompts on|off]' }
    void run($).catch(() => undefined)
    return { text: 'Writing the handoff. Watch the panel above the prompt.' }
  })

  // Claude asking for a refresh only brings up the offer, when its turn ends.
  on('tool.call', async ($, e, next) => {
    if ((e.tool as string) !== 'mcp__handoff__refresh') return next(e)
    if (await switchedOff($)) return { result: 'Handoff is off in the Mods pane. Tell the user they can turn it on with /mods.' } as never
    askAtTurnEnd = 'Claude suggested a handoff.'
    return { result: 'The Refresh offer appears above the prompt when this turn ends; the user decides. Tell them in one short line, then end your turn.' } as never
  }).catch(($, e, next) => next(e))

  on('ui.press', { plugin: 'handoff', element: 'refresh' }, async ($, e) => {
    if (!(await switchedOff($))) void run($).catch(() => undefined)
    return { element: e.element }
  })
  on('ui.press', { plugin: 'handoff', element: 'retry' }, async ($, e) => {
    if (!(await switchedOff($))) void run($).catch(() => undefined)
    return { element: e.element }
  })
  on('ui.press', { plugin: 'handoff', element: 'copy' }, async ($, e) => {
    await copy($, e.surface)
    return { element: e.element }
  })
  on('ui.press', { plugin: 'handoff', element: 'start' }, async ($, e) => {
    void startNew($, e.surface).catch(() => undefined)
    return { element: e.element }
  })
  on('ui.press', { plugin: 'handoff', element: 'open' }, async ($, e) => {
    await openFile($).catch(() => undefined)
    return { element: e.element }
  })
  on('ui.press', { plugin: 'handoff', element: 'inbox' }, async ($, e) => {
    await saveToInbox($).catch(() => undefined)
    return { element: e.element }
  })
  on('ui.press', { plugin: 'handoff', element: 'close' }, async ($, e) => {
    await close($)
    return { element: e.element }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p = await getPanel($)
    if (!p || e.props.hasSurvey) return next(e)
    // Switched off in Mods: no offer and no finished band; a run already going still shows.
    if (p.phase !== 'working' && (await switchedOff($))) return next(e)
    if (p.phase === 'offer' && e.props.isWorking) return next(e)
    const rest = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const noop = () => undefined
    const vault = p.phase === 'ready' ? await brainVault($) : ''

    if (p.phase === 'offer') {
      return (
        <Box flexDirection="column">
          {rest}
          <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
            <Text>
              <Text color={ACCENT}>●</Text>
              <Text dimColor>{` ${p.reason ? `${p.reason} ` : ''}Context at ${short(p.tokens)}. Refresh writes a handoff (low effort) to move this work to a new chat.`}</Text>
            </Text>
            <Box flexDirection="row" gap={1}>
              <Button key="refresh" label="Refresh" variant="primary" onPress={noop} />
              <Button key="close" label="Hide here" role="dismiss" onPress={noop} />
            </Box>
          </Box>
        </Box>
      )
    }

    const title = p.phase === 'working' ? 'Refreshing: building your handoff' : p.phase === 'ready' ? `Handoff ready: ${p.words.toLocaleString('en-US')} words` : 'The handoff did not finish'
    const rows = p.steps.map((s, i) => {
      const icon =
        s.status === 'done' ? <Text color={GOOD}>✓</Text> : s.status === 'fail' ? <Text color={BAD}>✗</Text> : s.status === 'run' ? <Text color={ACCENT}>{SPIN[p.tick % SPIN.length]}</Text> : <Text dimColor>○</Text>
      const b = bar(s.progress, s.status)
      return (
        <Box key={`row${i}`} flexDirection="row" gap={1}>
          <Box width={2}>{icon}</Box>
          <Box width={34}>
            <Text dimColor={s.status === 'wait'} wrap="truncate-end">
              {i + 1}. {s.label}
            </Text>
          </Box>
          <Text>
            <Text color={b.color}>{b.on}</Text>
            <Text dimColor>{b.off}</Text>
          </Text>
          <Text dimColor wrap="truncate-end">
            {s.detail}
          </Text>
        </Box>
      )
    })

    return (
      <Box flexDirection="column">
        {rest}
        <Box flexDirection="column">
          <Text bold color={p.phase === 'failed' ? BAD : p.phase === 'ready' ? GOOD : ACCENT}>
            {title}
          </Text>
          {p.phase === 'ready' ? null : rows}
          {p.cost ? <Text dimColor>{`Session cost during the run: ${p.cost}`}</Text> : null}
          {p.phase === 'ready' ? (
            <Box flexDirection="column">
              <Text dimColor wrap="truncate-middle">
                {`Saved to ${p.file} (deleted after 2 days)`}
              </Text>
              <Box flexDirection="row" gap={1}>
                <Button key="copy" label="Copy handoff prompt" variant="primary" onPress={noop} />
                <Button key="start" label="Start new chat with it" variant="secondary" onPress={noop} />
                <Button key="open" label="Open file" onPress={noop} />
                {vault ? <Button key="inbox" label="Save to Inbox" onPress={noop} /> : null}
                <Button key="close" label="Close" role="dismiss" onPress={noop} />
              </Box>
            </Box>
          ) : null}
          {p.phase === 'failed' ? (
            <Box flexDirection="column">
              <Text color={BAD}>{p.error}</Text>
              {p.file ? <Text dimColor wrap="truncate-middle">{`Draft saved to ${p.file}`}</Text> : null}
              <Box flexDirection="row" gap={1}>
                <Button key="retry" label="Try again" variant="primary" onPress={noop} />
                {p.file ? <Button key="copy" label="Copy draft" onPress={noop} /> : null}
                {p.file ? <Button key="open" label="Open draft" onPress={noop} /> : null}
                <Button key="close" label="Close" role="dismiss" onPress={noop} />
              </Box>
            </Box>
          ) : null}
          {p.note ? <Text dimColor>{p.note}</Text> : null}
        </Box>
      </Box>
    )
  })
}
