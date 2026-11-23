import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BIG = 'iVBORbig'
const SMALL = 'iVBORsmall=='

function shot() {
  return {
    content: [
      { type: 'text', text: 'Screenshot size: 1600x1000' },
      { type: 'image', data: BIG, mimeType: 'image/png' },
    ],
  }
}

function engine(on: On, sips: { calls: number; fail?: boolean }, ctx?: string[]) {
  mock.store(on)
  mock.clock(on, { now: 1_000_000 })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', () => ({ value: '/Users/me' }))
  on('ui.status', () => ({ value: undefined }) as never)
  on('process.run', (_, e) => {
    if (e.argv[0] === '/usr/bin/find') return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
    sips.calls += 1
    if (sips.fail) return { value: { exitCode: 1, stdout: '', stderr: 'boom' } } as never
    return { value: { exitCode: 0, stdout: `IN 1600 1000\nOUT 800 500\n${SMALL}\n`, stderr: '' } } as never
  })
  on('tool.call', () => ({ result: shot(), ...(ctx ? { context: ctx } : {}) }) as never)
}

const call = (tool: string) => ({ tool, action: 'screenshot', tool_use_id: 'tu1' }) as never

test('a browser screenshot is shrunk and its frame kept', async ($, on) => {
  const sips = { calls: 0 }
  engine(on, sips)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const r = (await $.tool.call(call('mcp__Claude_Browser__computer'))) as { result: { content: Array<{ data?: string; text?: string }> }; context?: string[] }
  expect(sips.calls).toBe(1)
  expect(r.result.content[1]?.data).toBe(SMALL)
  expect(r.result.content[0]?.text).toContain('Screenshot size: 800x500 0.5-scale view; coordinate frame: 1600x1000')
  expect(r.context?.[0]).toContain('shrank this screenshot')
})

test('a non-browser image is left alone by default', async ($, on) => {
  const sips = { calls: 0 }
  engine(on, sips)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const r = (await $.tool.call(call('mcp__some_server__get_image'))) as { result: { content: Array<{ data?: string }> } }
  expect(sips.calls).toBe(0)
  expect(r.result.content[1]?.data).toBe(BIG)
})

test('other tools are shrunk after /downsize all on', async ($, on) => {
  const sips = { calls: 0 }
  engine(on, sips)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'downsize', args: 'all on' } as never)
  const r = (await $.tool.call(call('mcp__some_server__get_image'))) as { result: { content: Array<{ data?: string }> } }
  expect(sips.calls).toBe(1)
  expect(r.result.content[1]?.data).toBe(SMALL)
})

test('when shrinking fails the original passes through', async ($, on) => {
  const sips = { calls: 0, fail: true }
  engine(on, sips)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const r = (await $.tool.call(call('mcp__claude-in-chrome__computer'))) as { result: { content: Array<{ data?: string; text?: string }> }; context?: string[] }
  expect(sips.calls).toBe(1)
  expect(r.result.content[1]?.data).toBe(BIG)
  expect(r.result.content[0]?.text).toBe('Screenshot size: 1600x1000')
  expect(r.context).toBe(undefined)
})

test('/downsize full lets one screenshot through', async ($, on) => {
  const sips = { calls: 0 }
  engine(on, sips)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'downsize', args: 'full' } as never)
  const first = (await $.tool.call(call('mcp__Claude_Browser__computer'))) as { result: { content: Array<{ data?: string }> } }
  expect(first.result.content[1]?.data).toBe(BIG)
  const second = (await $.tool.call(call('mcp__Claude_Browser__computer'))) as { result: { content: Array<{ data?: string }> } }
  expect(second.result.content[1]?.data).toBe(SMALL)
})

test('switched off in the Mods pane: the screenshot passes untouched', async ($, on) => {
  const sips = { calls: 0 }
  engine(on, sips)
  on('state.get', (_, e) => {
    const ref = e as unknown as { plugin?: string; key?: string }
    const value = ref.plugin === 'mods-panel' && ref.key === 'disabled' ? ['downsize-browser-screenshot'] : undefined
    return { value: { value, version: 1 } } as never
  })
  on('state.set', () => ({ value: { isSet: true, version: 1 } }) as never)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const r = (await $.tool.call(call('mcp__Claude_Browser__computer'))) as { result: { content: Array<{ data?: string }> } }
  expect(sips.calls).toBe(0)
  expect(r.result.content[1]?.data).toBe(BIG)
})

test('cut-off sips output never replaces the original', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: 1_000_000 })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', () => ({ value: '/Users/me' }))
  on('ui.status', () => ({ value: undefined }) as never)
  on('process.run', (_, e) => {
    if (e.argv[0] === '/usr/bin/find') return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
    return { value: { exitCode: 0, stdout: `IN 4000 3000\nOUT 2000 1500\nAAAAB`, stderr: '', isStdoutTruncated: true } } as never
  })
  on('tool.call', () => ({ result: shot() }) as never)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const r = (await $.tool.call(call('mcp__Claude_Browser__computer'))) as { result: { content: Array<{ data?: string }> } }
  expect(r.result.content[1]?.data).toBe(BIG)
})

test('context from a hook beneath is kept', async ($, on) => {
  const sips = { calls: 0 }
  engine(on, sips, ['note from beneath'])
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const r = (await $.tool.call(call('mcp__Claude_Browser__computer'))) as { context?: string[] }
  expect(r.context?.[0]).toBe('note from beneath')
  expect(r.context?.[1]).toContain('shrank this screenshot')
})
