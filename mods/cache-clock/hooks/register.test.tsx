import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'cache-clock',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const TURN = { answer: 'hi', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' } as const

function engine(on: On, forks: { n: number }) {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sid-1' }))
  on('env.get', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 152_000 }, rateLimits: [] } }) as never)
  on('turn.start', () => ({}) as never)
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('model.fork', () => {
    forks.n += 1
    return { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 150_000, cache_creation_input_tokens: 0 } } } as never
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`counts down after a reply, then shows cold (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on)
    engine(on, { n: 0 })
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.turn.complete(TURN)
    await clock.settle()

    let ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /Cache warm/ }))?.text).toContain('5:00')
    await ui.unmount()

    await clock.advance(6 * 60_000)
    ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /Cache cold/ }))?.text).toContain('1.25×')
    await ui.unmount()
  })

  test(`hide is remembered and drawing stops (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on)
    engine(on, { n: 0 })
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.turn.complete(TURN)
    await clock.settle()
    const r = await $.command.run({ command: 'cacheclock', args: 'hide' } as never)
    expect(r.text).toContain('hidden')
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /Cache warm/ })).toBe(undefined)
    await ui.unmount()
  })
}

test('keep warm needs a first reply', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  engine(on, { n: 0 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'keepwarm', args: '' } as never)
  expect(r.text).toContain('Nothing to keep warm yet')
})

test('keep warm pings once, 45 s before the cache goes cold', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const forks = { n: 0 }
  engine(on, forks)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(TURN)
  await clock.settle()
  const r = await $.command.run({ command: 'keepwarm', args: '' } as never)
  expect(r.text).toContain('Keep warm is on')
  await clock.advance(4 * 60_000)
  expect(forks.n).toBe(0)
  await clock.advance(20_000)
  expect(forks.n).toBe(1)
  // The ping restarted the clock, so no second ping right away.
  await clock.advance(5_000)
  expect(forks.n).toBe(1)
})

test('keep warm refuses a cache that has already gone cold', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const forks = { n: 0 }
  engine(on, forks)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(TURN)
  await clock.settle()
  await clock.advance(6 * 60_000)
  const r = await $.command.run({ command: 'keepwarm', args: '' } as never)
  expect(r.text).toContain('already gone cold')
  await clock.advance(60_000)
  expect(forks.n).toBe(0)
})

test('your own message stops keep warm', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const forks = { n: 0 }
  engine(on, forks)
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.complete(TURN)
  await clock.settle()
  await $.command.run({ command: 'keepwarm', args: '' } as never)
  await $.prompt.submit({ text: 'hello again', origin: { kind: 'user' } } as never)
  await clock.settle()
  await clock.advance(5 * 60_000)
  expect(forks.n).toBe(0)
})
