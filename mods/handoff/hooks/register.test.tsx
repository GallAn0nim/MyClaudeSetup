import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { redact } from './gather.ts'

const BAND = {
  plugin: 'handoff',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

type World = {
  tokens: number
  usd: number
  files: Map<string, string>
  runs: string[][]
  forks: Array<{ prompt: string; effort?: string }>
  reply: string
  sid: string
}

function world(over: Partial<World> = {}): World {
  return { tokens: 100_000, usd: 1, files: new Map(), runs: [], forks: [], reply: '# Handoff: test\n\nDo the next thing.', sid: 'sid-1', ...over }
}

function engine(on: On, w: World) {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', () => ({ value: undefined }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: w.sid }))
  on('session.cwd', () => ({ value: '/Users/me/work' }))
  on('env.get', () => ({ value: '/Users/me' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: w.tokens }, rateLimits: [], cost: { usd: w.usd } } }) as never)
  on('session.messages', () => ({ value: [{ role: 'user', text: 'SECRET-PROMPT-TEXT please do it', toolUses: [] }] }) as never)
  on('fs.exists', (_, e) => ({ value: w.files.has(e.path) }) as never)
  on('fs.read', (_, e) => ({ value: w.files.get(e.path) ?? '' }) as never)
  on('fs.write', (_, e) => {
    w.files.set(e.path, String(e.text))
    return { value: undefined } as never
  })
  on('process.run', (_, e) => {
    w.runs.push([...e.argv])
    if (e.argv[0] === 'rm') for (const p of e.argv.slice(2)) w.files.delete(p)
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('model.fork', (_, e) => {
    w.forks.push({ prompt: e.prompt, effort: e.effort })
    w.usd += 0.25
    return { value: { isAnswered: true, text: w.reply, usage: { input_tokens: 10, output_tokens: 900, cache_read_input_tokens: 290_000, cache_creation_input_tokens: 2000 } } } as never
  })
  on('turn.complete', () => ({ text: '' }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}

async function start($: Engine, on: On, w: World) {
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on, w)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  return clock
}

const TURN = { answer: 'a', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

test('offers at 300k, not at 250k', async ($, on) => {
  mock.store(on)
  const w = world({ tokens: 250_000 })
  const clock = await start($, on, w)
  await $.turn.complete(TURN)
  await clock.settle()
  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', key: 'refresh' } as never)).toBe(undefined)
  await ui.unmount()
  w.tokens = 300_000
  await $.turn.complete(TURN)
  await clock.settle()
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', key: 'refresh' } as never)).not.toBe(undefined)
  await ui.unmount()
})

test('Hide applies to this chat only', async ($, on) => {
  const w = world({ tokens: 310_000 })
  const store = new Map<string, unknown>()
  on('store.get', (_, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined } as never
  })
  const clock = await start($, on, w)
  await $.turn.complete(TURN)
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'close' } as never)
  await ui.unmount()
  expect(store.get('hidden:sid-1')).toBe(true)
  expect([...store.keys()].some(k => k === 'hidden' || k === 'handoff:hidden')).toBe(false)
})


test('Refresh runs at low effort and shows the cost', async ($, on) => {
  mock.store(on)
  const w = world({ tokens: 310_000 })
  const clock = await start($, on, w)
  await $.command.run({ command: 'handoff', args: '' } as never)
  await clock.advance(10_000)
  expect(w.forks.length).toBe(1)
  expect(w.forks[0]?.effort).toBe('low')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Session cost during the run/ }))?.text).toContain('$0.25')
  await ui.unmount()
})

test('prompts off keeps your words out of the draft and the prompt', async ($, on) => {
  mock.store(on)
  const w = world()
  const clock = await start($, on, w)
  await $.command.run({ command: 'handoff', args: 'prompts off' } as never)
  await $.command.run({ command: 'handoff', args: '' } as never)
  await clock.advance(10_000)
  expect(w.forks[0]?.prompt).toContain('never quote')
  const saved = [...w.files.entries()].filter(([p]) => p.endsWith('.md'))
  for (const [, text] of saved) expect(text.includes('SECRET-PROMPT-TEXT')).toBe(false)
})

test('Start new chat opens a short link that points to the saved file', async ($, on) => {
  mock.store(on)
  const w = world({ reply: `# Handoff: long\n\n${'word '.repeat(4000)}` })
  const clock = await start($, on, w)
  await $.command.run({ command: 'handoff', args: '' } as never)
  await clock.advance(10_000)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'start' } as never)
  await ui.unmount()
  const open = w.runs.find(r => r[0] === 'open')
  expect(open?.[1]?.startsWith('claude://code/new?q=')).toBe(true)
  expect((open?.[1]?.length ?? 0) < 1000).toBe(true)
  expect(decodeURIComponent(open?.[1] ?? '')).toContain('/Users/me/.claude/handoffs/')
})

test('Copy uses the app clipboard of the pressed surface', async ($, on) => {
  mock.store(on)
  const w = world()
  const copied: Array<{ text: string; surface?: string }> = []
  on('ui.copy', (_, e) => {
    copied.push({ text: e.text, surface: e.surface })
    return { value: { isCopied: true } } as never
  })
  const clock = await start($, on, w)
  await $.command.run({ command: 'handoff', args: '' } as never)
  await clock.advance(10_000)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'copy' } as never)
  await ui.unmount()
  expect(copied[0]?.text).toContain('# Handoff: test')
  expect(copied[0]?.surface).toBe('desktop')
  expect(w.runs.some(r => r[0] === 'pbcopy')).toBe(false)
})

test('a reply wrapped in a code fence still saves', async ($, on) => {
  mock.store(on)
  const w = world({ reply: '```markdown\n# Handoff: fenced\n\nBody.\n\n```' })
  const clock = await start($, on, w)
  await $.command.run({ command: 'handoff', args: '' } as never)
  await clock.advance(10_000)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', key: 'copy' } as never)).not.toBe(undefined)
  await ui.unmount()
})

test('redaction covers colon forms, URLs, keys and tokens', async () => {
  const out = redact(
    [
      '"api_key": "zzzz-1234-abcd"',
      'password: hunter2xyz',
      'AWS_SECRET_ACCESS_KEY: AbCdEfGh12345678',
      'https://user:s3cretpass@example.com/x',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----',
      'jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4fw',
      'npm_abcdefghijklmnopqrstuvwxyz0123456789',
      'MAX_TOKENS=8000 and password=$PASSWORD',
    ].join('\n'),
  )
  for (const leak of ['zzzz-1234', 'hunter2xyz', 'AbCdEfGh1234', 's3cretpass', 'MIIEow', 'SflKxwRJ', 'npm_abcdef']) expect(out.includes(leak)).toBe(false)
  expect(out).toContain('MAX_TOKENS=8000')
  expect(out).toContain('password=$PASSWORD')
})
