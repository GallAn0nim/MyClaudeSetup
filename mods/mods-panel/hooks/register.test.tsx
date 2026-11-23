import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'mods-panel',
  component: 'Pane',
  requestId: 'mods-panel',
  props: { title: 'Mods', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

function engine(on: On, filled: string[]) {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: ['cacheclock', 'downsize', 'handoff', 'privatizer', 'agent-info', 'mods'].map(name => ({ name })) }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true } as never
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`switches a mod off and back on, remembered across chats (${surface})`, async ($, on) => {
    const store = new Map<string, unknown>()
    on('store.get', (_, e) => ({ value: store.get(e.key) }) as never)
    on('store.set', (_, e) => {
      store.set(e.key, e.value)
      return { value: undefined } as never
    })
    engine(on, [])
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.command.run({ command: 'mods', args: '' } as never)
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'toggle-privatizer' } as never)
    expect(store.get('disabled')).toEqual(['privatizer'])
    await ui.press({ key: 'toggle-privatizer' } as never)
    expect(store.get('disabled')).toEqual([])
    await ui.unmount()
  })

  test(`an option button runs its command (${surface})`, async ($, on) => {
    mock.store(on)
    const filled: string[] = []
    const ran: string[] = []
    engine(on, filled)
    on('command.run', { command: 'downsize' }, (_, e) => {
      ran.push(`${e.command} ${e.args}`)
      return { text: 'ok' } as never
    })
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.command.run({ command: 'mods', args: '' } as never)
    const ui = await $.ui.mount({ ...PANE, surface })
    // Options are folded until the mod's name is pressed.
    await ui.press({ key: 'more-downsize-browser-screenshot' } as never)
    // Downsize is the 2nd mod; its 2nd option is "Next full size".
    await ui.press({ key: 'opt-1-1' } as never)
    expect(ran).toEqual(['downsize full'])
    expect(filled).toEqual([])
    await ui.unmount()
  })

}

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
  expect(opened.filter(id => id === 'mods-panel')).toHaveLength(0)
  for (let i = 0; i < 3; i += 1) await $.prompt.submit({ text: `message ${i}` } as never)
  // Opening runs after the hook returns: later messages give it time to land.
  for (let i = 0; i < 5; i += 1) await $.prompt.submit({ text: 'more' } as never)
  // The panes open in a fixed order, each after its own delay on the clock.
  await clock.advance(2000)
  for (let i = 0; i < 3; i += 1) await $.prompt.submit({ text: 'later' } as never)
  expect(opened.filter(id => id === 'mods-panel')).toHaveLength(1)
})
