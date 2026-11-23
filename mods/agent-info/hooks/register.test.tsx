import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

type Band = { steps: Array<{ text: string; status: string }> } | null
const seen: { plan: Band } = { plan: null }
let clock: { settle: () => Promise<void> }

function engine(on: On, runs: string[][]) {
  mock.store(on)
  clock = mock.clock(on, { now: 1_000_000 })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sid-1' }))
  on('env.get', () => ({ value: '/Users/me' }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.close', () => ({ value: undefined }) as never)
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('prompt.compose', () => ({ sections: [] }) as never)
  on('state.get', () => ({ value: { value: undefined, version: 0 } }) as never)
  on('state.set', (_, e) => {
    const ref = (e as { ref?: { key?: string }; key?: string }).ref ?? (e as { key?: string })
    if (ref.key === 'plan') seen.plan = (e as { value: Band }).value
    return { value: { isSet: true, version: 1 } } as never
  })
}

const UPDATE = 'mcp__ccd_turn__update_plan'

test("the bar follows the app's update_plan", async ($, on) => {
  engine(on, [])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({
    tool: UPDATE,
    items: [
      { content: 'Read code', status: 'in_progress' },
      { content: 'Write mod', status: 'pending' },
      { content: 'Test it', status: 'pending' },
    ],
    scope: 'continuation',
  } as never)
  await clock.settle()
  let p = seen.plan
  expect(p?.steps.map(s => s.status)).toEqual(['in_progress', 'pending', 'pending'])

  await $.tool.call({ tool: UPDATE, advance: true } as never)
  await clock.settle()
  p = seen.plan
  expect(p?.steps.map(s => s.status)).toEqual(['completed', 'in_progress', 'pending'])

  await $.tool.call({ tool: UPDATE, done: [2], start: 3 } as never)
  await clock.settle()
  p = seen.plan
  expect(p?.steps.map(s => s.status)).toEqual(['completed', 'completed', 'in_progress'])
})

test('no prompt section and no reminders', async ($, on) => {
  engine(on, [])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const c = await $.prompt.compose({ traits: [], model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['desktop'], tools: [], outputStyle: null, sections: [] } as never)
  expect((c as { sections: unknown[] }).sections.length).toBe(0)
  for (let i = 0; i < 15; i++) {
    const r = (await $.tool.call({ tool: 'Read', file_path: '/x' } as never)) as { context?: string[] }
    expect(r.context).toBe(undefined)
  }
})

test('the plan writes no files', async ($, on) => {
  const runs: string[][] = []
  engine(on, runs)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: UPDATE, items: [{ content: 'A', status: 'in_progress' }] } as never)
  expect(runs.length).toBe(0)
})

test('wrap_up finishes the plan: 100%, then the band hides', async ($, on) => {
  engine(on, [])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: UPDATE, items: [{ content: 'A', status: 'completed' }, { content: 'B', status: 'in_progress' }, { content: 'C', status: 'pending' }], scope: 'first_task' } as never)
  await clock.settle()
  await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', recap: 'done' } as never)
  await clock.settle()
  expect(seen.plan?.steps.map(s => s.status)).toEqual(['completed', 'completed', 'completed'])
  await (clock as unknown as { advance: (ms: number) => Promise<void> }).advance(21_000)
  expect((seen.plan as { shown?: boolean } | null)?.shown).toBe(false)
})

test('a new_task list replaces an unfinished plan', async ($, on) => {
  engine(on, [])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: UPDATE, items: [{ content: 'Old 1', status: 'in_progress' }, { content: 'Old 2', status: 'pending' }], scope: 'first_task' } as never)
  await clock.settle()
  await $.tool.call({ tool: UPDATE, items: [{ content: 'New 1', status: 'in_progress' }], scope: 'new_task' } as never)
  await clock.settle()
  expect(seen.plan?.steps.map(s => s.text)).toEqual(['New 1'])
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
  expect(opened.filter(id => id === 'agent-info')).toHaveLength(0)
  for (let i = 0; i < 3; i += 1) await $.prompt.submit({ text: `message ${i}` } as never)
  // Opening runs after the hook returns: later messages give it time to land.
  for (let i = 0; i < 5; i += 1) await $.prompt.submit({ text: 'more' } as never)
  // The panes open in a fixed order, each after its own delay on the clock.
  await clock.advance(2000)
  for (let i = 0; i < 3; i += 1) await $.prompt.submit({ text: 'later' } as never)
  expect(opened.filter(id => id === 'agent-info')).toHaveLength(1)
})
