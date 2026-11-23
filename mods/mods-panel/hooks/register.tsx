import type { EngineInterface, Register } from 'claude-code'

// Mods pane: one row per mod with an On/Off switch and quick-option buttons.
// Off is a list this mod owns in $.state (each mod reads it and steps aside) and keeps in
// $.store, so it holds in every chat. Option buttons run their command at once; where the
// engine refuses that, the command goes into the prompt box instead.

const PANE = 'mods-panel'
const TITLE = 'Mods'
const DISABLED = { plugin: 'mods-panel', key: 'disabled' } as const
const NOTE = { plugin: 'mods-panel', key: 'note' } as const
const LOADED = { plugin: 'mods-panel', key: 'loaded' } as const
const OPEN = { plugin: 'mods-panel', key: 'open' } as const
const SHOWN = { plugin: 'mods-panel', key: 'shown' } as const
const WARN = '#ca8a04'
const GOOD = '#16a34a'

type Option = { label: string; text: string }
type Mod = { name: string; title: string; what: string; command: string; options: Option[] }

export const MODS: readonly Mod[] = [
  {
    name: 'cache-clock',
    title: 'Cache Clock',
    what: 'Countdown until the prompt cache goes cold; optional keep warm',
    command: 'cacheclock',
    options: [
      { label: 'Status', text: '/cacheclock' },
      { label: 'Keep warm', text: '/keepwarm on' },
      { label: 'Stop warm', text: '/keepwarm off' },
      { label: 'Show', text: '/cacheclock show' },
    ],
  },
  {
    name: 'downsize-browser-screenshot',
    title: 'Downsize Screenshots',
    what: 'Shrinks browser screenshots before Claude reads them',
    command: 'downsize',
    options: [
      { label: 'Status', text: '/downsize' },
      { label: 'Next full size', text: '/downsize full' },
      { label: 'All tools on', text: '/downsize all on' },
      { label: 'Browser only', text: '/downsize all off' },
    ],
  },
  {
    name: 'handoff',
    title: 'Handoff',
    what: 'At 300k offers a handoff to a fresh chat',
    command: 'handoff',
    options: [
      { label: 'Show offer', text: '/fresh' },
      { label: 'Hand off now', text: '/handoff' },
    ],
  },
  {
    name: 'privatizer',
    title: 'Privatizer',
    what: 'Hides private data on screen for recording',
    command: 'privatizer',
    options: [
      { label: 'Turn on', text: '/privatizer on' },
      { label: 'Turn off', text: '/privatizer off' },
    ],
  },
  {
    name: 'agent-info',
    title: 'Agent Info',
    what: 'Task progress bar and subagent cards',
    command: 'agent-info',
    options: [{ label: 'Open pane', text: '/agent-info' }],
  },
  {
    name: 'statsPane',
    title: 'Stats',
    what: 'Context, limits, price, skills, subagent costs and downsized images',
    command: 'statspane',
    options: [{ label: 'Open pane', text: '/statspane' }],
  },
  {
    name: 'second-brain-control',
    title: 'Second Brain',
    what: 'Vault-use indicator, topics, Inbox, Capture / Knowledge / Sanitize / Daily question / Random topic and costs',
    command: 'secondbrain',
    options: [
      { label: 'Open pane', text: '/secondbrain' },
      { label: 'Capture chat', text: '/secondbrain capture' },
      { label: 'Capture + Knowledge', text: '/secondbrain knowledge' },
      { label: 'Sanitize', text: '/secondbrain sanitize' },
      { label: 'Daily question', text: '/secondbrain daily' },
      { label: 'Random topic', text: '/secondbrain random' },
    ],
  },
]

async function disabled($: EngineInterface): Promise<string[]> {
  const { value } = await $.state.get(DISABLED)
  return Array.isArray(value) ? value : []
}

// Kept in $.state, so it survives a reload and the pane redraws when it changes.
async function refreshLoaded($: EngineInterface) {
  try {
    const list = await $.command.list()
    await $.state.set(LOADED, list.map(c => c.name))
  } catch {
    // Unknown: every row is drawn as loaded.
  }
}

async function toggle($: EngineInterface, name: string) {
  const mod = MODS.find(m => m.name === name)
  if (!mod) return
  // Versioned write: two quick presses never lose one another.
  for (let i = 0; i < 5; i++) {
    const read = await $.state.get(DISABLED)
    const now = Array.isArray(read.value) ? read.value : []
    const turningOff = !now.includes(name)
    const next = turningOff ? [...now, name] : now.filter(n => n !== name)
    const r = await $.state.set(DISABLED, next, { ifVersion: read.version })
    if (!r.isSet) continue
    const kept = await $.store
      .set('disabled', next)
      .then(() => true)
      .catch(() => false)
    await $.state.set(NOTE, `${mod.title} is ${turningOff ? 'off' : 'on'}${kept ? ' (in every chat).' : ' in this chat only: could not save it for other chats.'}`)
    return
  }
}

// Runs the command as if typed. Where the engine refuses, it goes into the prompt box instead.
async function runOption($: EngineInterface, text: string) {
  const [, command = '', args = ''] = /^\/(\S+)\s*(.*)$/.exec(text) ?? []
  const ran = await $.command
    .run({ command, args } as never)
    .then(() => true)
    .catch(() => false)
  if (ran) {
    await $.state.set(NOTE, `Ran ${text}.`)
    return
  }
  const r = await $.prompt.fill({ text, mode: 'replace' }).catch(() => null)
  const ok = !!r && (r as { isFilled?: boolean }).isFilled !== false
  await $.state.set(NOTE, ok ? `Could not run ${text} from here: it is in the prompt box, press Return.` : `Could not run ${text}. Type it yourself.`)
}

// First-message order: Stats 0, Second Brain 500, Agent Info 1000, Mods 1500 ms.
const OPEN_DELAY_MS = 1500

/** Waits on the engine's clock: the four panes open one after another, in a fixed order. */
const later = ($: EngineInterface, ms: number) => new Promise<void>(r => void $.clock.after(ms, () => r()))

/** The chat's first message opens the Mods pane. */
async function openOnFirstMessage($: EngineInterface) {
  const { value, version } = await $.state.get(SHOWN)
  if (value === true) return
  if (!(await $.state.set(SHOWN, true, { ifVersion: version })).isSet) return
  await later($, OPEN_DELAY_MS)
  await refreshLoaded($)
  await $.ui.open({ id: PANE, title: TITLE })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('disabled').catch(() => undefined)
    await $.state.set(DISABLED, Array.isArray(saved) ? saved.filter((x): x is string => typeof x === 'string') : [])
    await $.state.set(NOTE, '')
    await $.state.set(OPEN, '')
    await $.command.register({ name: 'mods', description: 'Open the Mods pane: turn each mod on or off and reach its options', immediate: true })
    // The other mods register their commands at their own session start: look a moment later.
    $.clock.after(3000, () => void refreshLoaded($).catch(() => undefined))
    return next(e)
  })

  // Opens the Mods pane on the chat's first message, once per chat.
  on('prompt.submit', async ($, e, next) => {
    const r = await next(e)
    void openOnFirstMessage($).catch(() => undefined)
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'mods' }, async $ => {
    await refreshLoaded($)
    const r = await $.ui.open({ id: PANE, title: TITLE }).catch(() => null)
    return { text: r && r.isPlaced === false ? 'The Mods pane is ready but no window can show it right now.' : 'Opened the Mods pane.' }
  })

  on('ui.press', { plugin: 'mods-panel', element: /^toggle-.+$/ }, async ($, e) => {
    await toggle($, e.element.slice('toggle-'.length))
    return { element: e.element }
  })

  on('ui.press', { plugin: 'mods-panel', element: /^opt-.+$/ }, async ($, e) => {
    const [, mi = '', oi = ''] = /^opt-(\d+)-(\d+)$/.exec(e.element) ?? []
    const opt = MODS[Number(mi)]?.options[Number(oi)]
    if (opt) await runOption($, opt.text)
    return { element: e.element }
  })

  // The title unfolds a mod's options; one mod at a time, pressing it again folds it.
  on('ui.press', { plugin: 'mods-panel', element: /^more-.+$/ }, async ($, e) => {
    const name = e.element.slice('more-'.length)
    const now = (await $.state.get(OPEN)).value ?? ''
    await $.state.set(OPEN, now === name ? '' : name)
    return { element: e.element }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const off = await disabled($)
    const note = (await $.state.get(NOTE)).value ?? ''
    const open = (await $.state.get(OPEN)).value ?? ''
    const loadedList = (await $.state.get(LOADED)).value ?? []
    const loaded = new Set(loadedList)
    const noop = () => undefined

    const rows = MODS.map((m, mi) => {
      const isOff = off.includes(m.name)
      const isLoaded = loaded.size === 0 || loaded.has(m.command)
      const canOpen = !isOff && isLoaded && m.options.length > 0
      const isOpen = canOpen && open === m.name
      return (
        <Box key={`row-${m.name}`} flexDirection="column" marginTop={mi === 0 ? 0 : 1}>
          <Box flexDirection="row" gap={1} alignItems="center">
            {/* The switch: a green dot and On, or an empty dot and Off. */}
            <Button key={`toggle-${m.name}`} label={isOff ? '⚪ Off' : '🟢 On'} variant={isOff ? 'secondary' : 'primary'} onPress={noop} />
            {canOpen ? (
              <Button key={`more-${m.name}`} label={`${m.title} ${isOpen ? '▾' : '▸'}`} plain onPress={noop} />
            ) : (
              <Text bold dimColor={isOff} wrap="truncate-end">
                {m.title}
              </Text>
            )}
          </Box>
          {isOpen || isOff || !isLoaded ? (
            <Text dimColor wrap="wrap">
              {!isLoaded ? 'Not loaded in this chat' : isOff ? 'Off in every chat' : m.what}
            </Text>
          ) : null}
          {isOpen ? (
            <Box flexDirection="row" gap={1} flexWrap="wrap" marginTop={1}>
              {m.options.map((o, oi) => (
                <Button key={`opt-${mi}-${oi}`} label={o.label} variant="secondary" onPress={noop} />
              ))}
            </Box>
          ) : null}
        </Box>
      )
    })

    return (
      <Box flexDirection="column">
        {rows}
        <Box marginTop={1} flexDirection="column">
          {note ? <Text color={/^Could not|could not/.test(note) ? WARN : GOOD}>{note}</Text> : null}
          <Text dimColor wrap="wrap">
            Press a mod's name for its options.
          </Text>
        </Box>
      </Box>
    )
  })
}
