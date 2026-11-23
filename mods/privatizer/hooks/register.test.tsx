import { expect, mock, test } from 'claude-code/testing'

const ROW = { plugin: 'privatizer', component: 'UserMessage', props: { text: 'Mail anna@example.pl, PESEL 44051401359' } } as const

test('rows are masked only while on, on every surface', async ($, on) => {
  mock.store(on)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sid-1' }))
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    const text = (e.props as { text?: string }).text ?? ''
    return <Text>{text}</Text>
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    let ui = await $.ui.mount({ ...ROW, surface } as never)
    expect((await ui.find({ type: 'Text' }))?.text).toContain('anna@example.pl')
    await ui.unmount()

    await $.command.run({ command: 'privatizer', args: 'on' } as never)
    ui = await $.ui.mount({ ...ROW, surface } as never)
    const shown = (await ui.find({ type: 'Text' }))?.text ?? ''
    expect(shown.includes('anna@example.pl')).toBe(false)
    expect(shown.includes('44051401359')).toBe(false)
    await ui.unmount()

    await $.command.run({ command: 'privatizer', args: 'off' } as never)
  }
})
