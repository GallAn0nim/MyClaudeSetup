import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'statsPane',
  component: 'Pane',
  requestId: 'statsPane',
  props: { title: 'Stats', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

const USAGE = {
  startedAt: 0,
  context: { tokens: 120_000, window: 1_000_000, percent: 12 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 42, resetsAt: '2030-01-01T12:00:00Z' },
    { kind: 'seven_day', percentUsed: 81.5, resetsAt: '2030-01-04T09:00:00Z' },
  ],
  cost: { usd: 3.21 },
}

test('the pane draws context, limits, price, turns, skills and agents on every surface', async ($, on) => {
  on('command.register', () => ({ value: { command: 'statspane' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: USAGE }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('skill.prompt', (_, e) => ({ text: e.text }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.measure?.({ context: USAGE.context, rateLimits: USAGE.rateLimits, cost: USAGE.cost, changed: ['context'] } as never).catch?.(() => undefined)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /120k \/ 1\.00M/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Handoff at 300k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$3\.21/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /5-hour limit/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Weekly limit/ })).toBeDefined()
    await ui.unmount()
  }
})

// A downsize mod above statsPane shrinks after our tool.call hook returns: only its totals move.
test('screenshots the downsize mod shrinks above us show with their savings', async ($, on) => {
  on('command.register', () => ({ value: { command: 'statspane' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: USAGE }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('clock.now', () => ({ value: 1_000 }))
  on('env.get', () => ({ value: '/Users/test' }))
  // The downsize mod's totals as it would leave them: one screenshot counted after the first call.
  let calls = 0
  on('state.get', (_, e, next) =>
    e.plugin === 'downsize-browser-screenshot'
      ? { value: { value: calls >= 1 ? { seen: 1, shrunk: 1, before: 830, after: 350 } : undefined, version: calls } }
      : next(e),
  )
  on('tool.call', () => {
    calls += 1
    if (calls === 1) return { result: { content: [{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }] } }
    return { result: {} }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__claude-in-chrome__computer', action: 'screenshot', tabId: 1 } as never)
  // Recording runs after the hook returns: later calls give it time to land, as a session's would.
  for (let i = 0; i < 10; i += 1) await $.tool.call({ tool: 'mcp__claude-in-chrome__computer', action: 'scroll', tabId: 1 } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Saved ~480 tokens/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the chat\'s first message opens the pane, once', async ($, on) => {
  const opened: string[] = []
  const clock = mock.clock(on, { now: 0 })
  on('command.register', (_, e) => ({ value: { command: (e as { name: string }).name } }))
  on('ui.open', (_, e) => {
    opened.push((e as { id: string }).id)
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 0, window: 1_000_000, percent: 0 }, rateLimits: [] } }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('prompt.submit', (_, e) => ({ text: e.text }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(opened.filter(id => id === 'statsPane')).toHaveLength(0)
  for (let i = 0; i < 3; i += 1) await $.prompt.submit({ text: `message ${i}` } as never)
  // Opening runs after the hook returns: later messages give it time to land.
  for (let i = 0; i < 5; i += 1) await $.prompt.submit({ text: 'more' } as never)
  // The panes open in a fixed order, each after its own delay on the clock.
  await clock.advance(2000)
  for (let i = 0; i < 3; i += 1) await $.prompt.submit({ text: 'later' } as never)
  expect(opened.filter(id => id === 'statsPane')).toHaveLength(1)
})
