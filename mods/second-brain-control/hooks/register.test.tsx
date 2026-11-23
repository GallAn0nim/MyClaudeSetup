import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { bucketOf, parseTopics, transcript, usdOf } from './brain.ts'

const VAULT = '/Users/me/Obsidian/SecondBrain'
const PANE = {
  plugin: 'second-brain-control',
  component: 'Pane',
  requestId: 'second-brain',
  props: { title: 'Second Brain', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

type World = { files: Map<string, string>; runs: string[][]; submits: string[]; cwd: string }

function engine(on: On, w: World) {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', () => ({ value: undefined }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sid-1' }))
  on('session.cwd', () => ({ value: w.cwd }))
  on('env.get', () => ({ value: '/Users/me' }))
  on('session.messages', () =>
    ({
      value: [
        { role: 'user', text: '<system-reminder>x</system-reminder>Nowy projekt: autoryzacja w .NET', toolUses: [] },
        { role: 'assistant', text: 'Użyj JWT bearer.', toolUses: [{ tool: 'Read', input: { file_path: '/a' } }] },
      ],
    }) as never,
  )
  on('fs.exists', (_, e) => ({ value: e.path === `${VAULT}/00-Inbox` || w.files.has(e.path) }) as never)
  on('fs.list', () => ({ value: [...w.files.keys()].map(p => ({ name: p.split('/').pop(), kind: 'file', size: 1, mtimeMs: 0, isLink: false })) }) as never)
  on('process.run', (_, e) => {
    w.runs.push([...e.argv])
    const path = e.argv[4]
    if (e.argv[0] === '/bin/sh' && path) {
      if (w.files.has(path)) return { value: { exitCode: 1, stdout: '', stderr: 'exists' } } as never
      w.files.set(path, String((e as { init?: { stdin?: string } }).init?.stdin ?? (e as { stdin?: string }).stdin ?? ''))
    }
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('prompt.submit', (_, e) => {
    w.submits.push(e.text)
    return { text: e.text } as never
  })
  on('turn.complete', () => ({ text: '' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
}

async function start($: Engine, on: On, w: World) {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.UTC(2026, 10, 11, 12, 0) })
  engine(on, w)
  await $.session.start({ cwd: w.cwd, surface: 'desktop', isInteractive: true })
  return clock
}

const world = (over: Partial<World> = {}): World => ({ files: new Map(), runs: [], submits: [], cwd: VAULT, ...over })

test('the transcript keeps both sides, drops reminders and names tools', () => {
  const md = transcript([
    { role: 'user', text: '<system-reminder>r</system-reminder>Pytanie', toolUses: [] },
    { role: 'assistant', text: 'Odpowiedź', toolUses: [{ tool: 'Read', input: {} } as never, { tool: 'Read', input: {} } as never] },
  ])
  expect(md).toContain('## Ja\n\nPytanie')
  expect(md).toContain('## Claude\n\nOdpowiedź')
  expect(md).toContain('Read ×2')
  expect(md.includes('system-reminder')).toBe(false)
})

test('topics parse from a fenced JSON reply', () => {
  expect(parseTopics('```json\n["Nowy projekt", "Autoryzacja w .NET", "nowy projekt"]\n```')).toEqual(['Nowy projekt', 'Autoryzacja w .NET'])
})

test('output is priced whole, with no thinking split', () => {
  const b = bucketOf({ input_tokens: 0, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, 'claude-opus-5-5')
  expect(b.thinking).toBe(0)
  expect(b.output).toBe(1000)
  expect(Math.round(usdOf(b) * 1e6)).toBe(20_000)
})

test('the topics tool fills the pane list', async ($, on) => {
  const w = world()
  await start($, on, w)
  await $.tool.call({ tool: 'mcp__second-brain-control__topics', topics: ['Nowy projekt', 'Autoryzacja w .NET'] } as never)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Autoryzacja/ }))?.text).toBe('Autoryzacja w .NET')
  await ui.unmount()
})

test('capture writes a new Inbox note and never overwrites', async ($, on) => {
  const w = world()
  await start($, on, w)
  await $.command.run({ command: 'secondbrain', args: 'capture' } as never)
  await $.command.run({ command: 'secondbrain', args: 'capture' } as never)
  const paths = [...w.files.keys()]
  expect(paths.length).toBe(2)
  expect(paths[1]!.endsWith(' (2).md')).toBe(true)
  const text = w.files.get(paths[0]!) ?? ''
  expect(text.startsWith('---\ncreated: "2026-11-11"\n---')).toBe(true)
  expect(text).toContain('Nowy projekt: autoryzacja w .NET')
})

test('capture + knowledge sends the Knowledge prompt for the new file', async ($, on) => {
  const w = world()
  const mockedClock = start($, on, w)
  const clock = await mockedClock
  await $.command.run({ command: 'secondbrain', args: 'knowledge' } as never)
  await clock.advance(500)
  expect(w.submits.length).toBe(1)
  expect(w.submits[0]).toContain('[second-brain:knowledge]')
  expect(w.submits[0]).toContain('00-Inbox/')
})

test('turns in the vault are counted in the cost table', async ($, on) => {
  const w = world()
  await start($, on, w)
  await $.turn.complete({
    answer: 'a',
    durationMs: 1,
    isAborted: false,
    turnId: 't',
    reason: 'answer',
    usage: { input_tokens: 100, output_tokens: 500, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 1000, model: 'claude-opus-5-5' },
  } as never)
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Chat in the vault/ })).toBe(undefined)
  await ui.press({ key: 'cost' } as never)
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Chat in the vault/ })).not.toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /Thinking/ })).toBe(undefined)
  await ui.unmount()
})

test('the brain indicator is red until Claude reads the vault, then green with the report', async ($, on) => {
  const w = world()
  on('tool.call', () => ({ result: 'ok' }) as never)
  await start($, on, w)
  await $.prompt.submit({ text: 'Co wiem o CQRS?' } as never)
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Vault not used/ })).not.toBe(undefined)
  await ui.unmount()
  await $.tool.call({ tool: 'Read', file_path: `${VAULT}/02-Knowledge/CQRS.md` } as never)
  await $.tool.call({ tool: 'mcp__second-brain-control__brain_report', status: 'Found information', found: true, used: [{ note: 'CQRS', why: 'definicja' }], unused: [{ note: 'DDD', why: 'nie na temat' }] } as never)
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Found information/ })).not.toBe(undefined)
  await ui.press({ key: 'brain' } as never)
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /02-Knowledge\/CQRS\.md/ })).not.toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /DDD/ })).not.toBe(undefined)
  await ui.unmount()
})

test('sanitize sends its prompt in this chat, with no new chat', async ($, on) => {
  const w = world()
  const clock = await start($, on, w)
  await $.command.run({ command: 'secondbrain', args: 'sanitize' } as never)
  await clock.advance(500)
  expect(w.runs.some(r => r[0] === 'open')).toBe(false)
  expect(w.submits.length).toBe(1)
  expect(w.submits[0]).toContain('[second-brain:sanitize]')
})

test('costs counted under the old Cleanup name move to Sanitize', async ($, on) => {
  const w = world()
  const b = bucketOf({ input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, 'claude-opus-5-5')
  const store = new Map<string, unknown>([['costs-all', { all: { cleanup: b }, since: 0 }]])
  on('store.get', (_, e) => ({ value: store.get(e.key) }) as never)
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined } as never
  })
  mock.clock(on, { now: Date.UTC(2026, 10, 11, 12, 0) })
  engine(on, w)
  await $.session.start({ cwd: w.cwd, surface: 'desktop', isInteractive: true })
  const saved = store.get('costs-all') as { all: Record<string, unknown> }
  expect(saved.all.cleanup).toBe(undefined)
  expect(saved.all.sanitize).not.toBe(undefined)
})

test('daily question is sent in this chat with the questions and two notes', async ($, on) => {
  const w = world()
  w.files.set(`${VAULT}/02-Knowledge/A.md`, '---\nlast_modified: 2026-01-01\n---\nA')
  w.files.set(`${VAULT}/02-Knowledge/B.md`, '---\nlast_modified: 2026-10-01\n---\nB')
  on('fs.read', (_, e) => ({ value: w.files.get(e.path) ?? '' }) as never)
  const clock = await start($, on, w)
  await $.command.run({ command: 'secondbrain', args: 'daily' } as never)
  await clock.advance(500)
  expect(w.runs.some(r => r[0] === 'open')).toBe(false)
  const q = w.submits[0] ?? ''
  expect(q).toContain('[second-brain:daily]')
  expect(q).toContain('Did anything good happen?')
  expect(q).toContain('Did you drink a Monster?')
  expect(q).toContain('02-Knowledge/A.md')
  expect(q).toContain('00-Inbox/')
})

test('the desktop status is a badge whose press shows the flow', async ($, on) => {
  const w = world()
  on('tool.call', () => ({ result: 'ok' }) as never)
  await start($, on, w)
  await $.prompt.submit({ text: 'Co wiem o CQRS?' } as never)
  await $.tool.call({ tool: 'Read', file_path: `${VAULT}/02-Knowledge/CQRS.md` } as never)
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.findAll({ type: 'Svg' })).length).toBe(1)
  await ui.press({ key: 'brain' } as never)
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.findAll({ type: 'Svg' })).length).toBe(2)
  await ui.unmount()
})
