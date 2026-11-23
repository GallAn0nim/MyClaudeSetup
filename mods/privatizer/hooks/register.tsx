import type { EngineInterface, Register } from 'claude-code'

import { mask, maskDeep } from './mask.ts'

// Privatizer: /privatizer turns it on or off for this chat. While on, transcript rows draw
// emails, phones, money, IBAN, PESEL, card numbers and secrets as fixed-width bars.
// Only the drawing changes: the stored chat, and what Claude reads, stay real.
// Not covered: the prompt you are typing, permission dialogs, other mods' panes.

const ON = { plugin: 'privatizer', key: 'on' } as const
const ACCENT = '#d97757'
const BAND_TEXT = ' Privatizer on: emails, phones, amounts, IBAN, PESEL, cards and secrets hidden. Not covered: your prompt box, permission dialogs.'

let sid = ''

// The Mods pane's switch: this mod steps aside while its name is in the list.
const MODS_OFF = { plugin: 'mods-panel', key: 'disabled' } as const

async function switchedOff($: EngineInterface) {
  const { value } = await $.state.get(MODS_OFF)
  return Array.isArray(value) && value.includes('privatizer')
}

async function isOn($: EngineInterface) {
  return (await $.state.get(ON)).value === true && !(await switchedOff($))
}

async function setMode($: EngineInterface, on: boolean) {
  await $.state.set(ON, on)
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // The state write redraws anyway.
  }
  try {
    $.ui.status(on ? 'Privatizer on' : undefined)
  } catch {
    // Only a hint.
  }
  if (sid) await $.store.set(`on:${sid}`, on).catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'privatizer',
      description: 'Privatizer on or off: hides emails, phones, amounts, IBAN, PESEL, cards and secrets on screen (Claude still reads the real data)',
      argumentHint: '[on|off]',
      immediate: true,
    })
    sid = await $.session.id().catch(() => '')
    // A reload or resume keeps the mode this chat had.
    if (sid && (await $.store.get(`on:${sid}`).catch(() => undefined)) === true && (await $.state.get(ON)).value !== true) {
      await $.state.set(ON, true)
      try {
        if (!(await switchedOff($))) $.ui.status('Privatizer on')
      } catch {
        // Only a hint.
      }
    }
    return next(e)
  })

  on('command.run', { command: 'privatizer' }, async ($, e) => {
    if (await switchedOff($)) return { text: 'Privatizer is off. Turn it on in the Mods pane (/mods).' }
    const arg = (e.args ?? '').trim().toLowerCase()
    if (arg !== '' && arg !== 'on' && arg !== 'off') return { text: 'Usage: /privatizer [on|off]' }
    const want = arg === 'on' ? true : arg === 'off' ? false : !(await isOn($))
    await setMode($, want)
    return {
      text: want
        ? 'Privatizer on. Private data shows as ▒▒▒▒▒▒ on screen; Claude still reads the real data. Your prompt box and permission dialogs are not masked. /privatizer off to stop.'
        : 'Privatizer off. Everything shows as normal.',
    }
  })

  on('ui.press', { plugin: 'privatizer', element: 'off' }, async ($, e) => {
    await setMode($, false).catch(() => undefined)
    return { element: e.element }
  })

  // Transcript rows. Each reads the mode while drawing, so a switch redraws every row.

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    const text = mask(e.props.text)
    return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } })
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    const text = mask(e.props.text)
    return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } })
  })

  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    const text = mask(e.props.text)
    return text === e.props.text ? next(e) : next({ ...e, props: { ...e.props, text } })
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    const input = maskDeep(e.props.input)
    const output = maskDeep(e.props.output)
    if (input === e.props.input && output === e.props.output) return next(e)
    return next({ ...e, props: { ...e.props, input, output } })
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    const output = maskDeep(e.props.output)
    return output === e.props.output ? next(e) : next({ ...e, props: { ...e.props, output } })
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!(await isOn($))) return next(e)
    const calls = maskDeep(e.props.calls)
    return calls === e.props.calls ? next(e) : next({ ...e, props: { ...e.props, calls } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await isOn($))) return next(e)
    const rest = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {rest}
        <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
          <Text wrap="truncate-end">
            <Text color={ACCENT}>●</Text>
            <Text dimColor>{BAND_TEXT}</Text>
          </Text>
          <Button key="off" label="Turn off" onPress={() => undefined} />
        </Box>
      </Box>
    )
  })
}
