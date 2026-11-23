import type { EngineInterface, RenderInput } from 'claude-code'

import type { BrainStep, BrainUse, Category } from '../types'
import { EMPTY, ago, tok, total, usd, usdOf } from './brain.ts'

// The pane, drawn in the Stats mod's look: dim uppercase headings, label-left value-right rows,
// muted tones, a terracotta accent.

const S_TOPICS = { plugin: 'second-brain-control', key: 'topics' } as const
const S_INBOX = { plugin: 'second-brain-control', key: 'inbox' } as const
const S_COSTS = { plugin: 'second-brain-control', key: 'costs' } as const
const S_COSTVIEW = { plugin: 'second-brain-control', key: 'costView' } as const
const S_NOTE = { plugin: 'second-brain-control', key: 'note' } as const
const S_VAULT = { plugin: 'second-brain-control', key: 'vault' } as const
const S_BRAIN = { plugin: 'second-brain-control', key: 'brain' } as const
const S_BRAINOPEN = { plugin: 'second-brain-control', key: 'brainOpen' } as const
const S_COSTOPEN = { plugin: 'second-brain-control', key: 'costOpen' } as const
const S_TOPICSOPEN = { plugin: 'second-brain-control', key: 'topicsOpen' } as const
const S_INBOXOPEN = { plugin: 'second-brain-control', key: 'inboxOpen' } as const
const S_FOLDED = { plugin: 'second-brain-control', key: 'folded' } as const
const ACCENT ='#d97757'
const GOOD = '#7fb685'
const WARN = '#d4a24c'
const BAD = '#e0645c'
const SHOW_INBOX = 8

const CAT_LABEL: Record<Category, string> = {
  chat: 'Chat in the vault',
  knowledge: 'Making Knowledge',
  sanitize: 'Sanitize',
  daily: 'Daily question',
  random: 'Random topic',
  topics: 'Topic refresh',
  subagents: 'Subagents',
}

const cut = (t: string, n: number) => (n <= 0 ? '' : t.length > n ? `${t.slice(0, Math.max(0, n - 1))}…` : t)

/** A brain outline, two hemispheres and folds, in one colour. */
export const brainSvg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 0 0-6 .2A3.6 3.6 0 0 0 3.7 11a3.7 3.7 0 0 0 .8 6A3.4 3.4 0 0 0 12 18.5Z"/><path d="M12 5a3 3 0 0 1 6 .2A3.6 3.6 0 0 1 20.3 11a3.7 3.7 0 0 1-.8 6A3.4 3.4 0 0 1 12 18.5Z"/><path d="M12 5v13.5"/><path d="M8.5 9.5c1 .3 1.8 1 2 2M15.5 9.5c-1 .3-1.8 1-2 2M7 14.5c1-.6 2.2-.6 3 0M17 14.5c-1-.6-2.2-.6-3 0"/></svg>`

export function brainStatus(b: BrainUse) {
  const attempted = b.steps.length > 0 || !!b.report
  const reads = b.steps.filter(s => s.kind === 'read').length
  const text = !b.prompt
    ? 'No prompt yet'
    : !attempted
      ? 'Vault not used for this prompt'
      : b.report
        ? b.report.status
        : reads
          ? `Read ${reads} note${reads === 1 ? '' : 's'}`
          : 'Searched, read nothing'
  const color = !attempted ? BAD : b.report && !b.report.found ? WARN : GOOD
  return { attempted, text, color }
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const MUTED = '#9a9a9a'
const STEP_LABEL: Record<BrainStep['kind'], string> = { base: 'KNOWLEDGE.BASE', skill: 'SKILL', search: 'SEARCH', read: 'READ NOTE', cli: 'OBSIDIAN CLI' }

/** The status as a badge: the brain icon, the status in its colour, and what happened in counts. */
export function statusSvg(b: BrainUse, text: string, color: string) {
  const reads = b.steps.filter(s => s.kind === 'read').length
  const other = b.steps.length - reads
  const used = b.report?.used.length ?? 0
  const parts = [other ? `${other} lookup${other === 1 ? '' : 's'}` : '', reads ? `${reads} read` : '', b.report ? `${used} used` : ''].filter(Boolean)
  const sub = parts.join(' · ') || (b.prompt ? 'nothing done in the vault' : 'waiting for a prompt')
  const icon = brainSvg(color).replace('<svg ', '<svg x="10" y="11" ')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 40" width="300" height="40" font-family="-apple-system,Segoe UI,sans-serif"><rect x="0.5" y="0.5" width="299" height="39" rx="10" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-opacity="0.5"/>${icon}<text x="38" y="17" font-size="12.5" font-weight="600" fill="${color}">${esc(cut(text, 34))}</text><text x="38" y="31" font-size="10.5" fill="${MUTED}">${esc(cut(sub, 44))}</text></svg>`
}

type FlowNode = { label: string; text: string; color: string; tip?: string }

/** What happened for the prompt, as a top-to-bottom flow: prompt, each vault step, the notes used and not, the result. */
export function flowSvg(b: BrainUse, statusText: string, statusColor: string) {
  const nodes: FlowNode[] = [{ label: 'PROMPT', text: `“${b.prompt || '…'}”`, color: ACCENT, tip: b.prompt }]
  const MAXSTEPS = 10
  for (const s of b.steps.slice(0, MAXSTEPS)) nodes.push({ label: STEP_LABEL[s.kind], text: s.text, color: s.kind === 'read' ? ACCENT : MUTED, tip: s.text })
  if (b.steps.length > MAXSTEPS) nodes.push({ label: 'MORE', text: `and ${b.steps.length - MAXSTEPS} more steps`, color: MUTED })
  for (const n of b.report?.used ?? []) nodes.push({ label: 'USED', text: n.note.replace(/^.*\//, ''), color: GOOD, tip: n.why ? `${n.note} — ${n.why}` : n.note })
  for (const n of b.report?.unused ?? []) nodes.push({ label: 'NOT USED', text: n.note.replace(/^.*\//, ''), color: WARN, tip: n.why ? `${n.note} — ${n.why}` : n.note })
  nodes.push({ label: 'RESULT', text: statusText, color: statusColor })

  const W = 300, H = 40, GAP = 16, X = 10
  const height = nodes.length * H + (nodes.length - 1) * GAP + 2
  const parts: string[] = []
  nodes.forEach((n, i) => {
    const y = 1 + i * (H + GAP)
    if (i > 0) {
      const ay = y - GAP
      parts.push(`<line x1="${X + 14}" y1="${ay}" x2="${X + 14}" y2="${y - 4}" stroke="${MUTED}" stroke-opacity="0.6" stroke-width="1.5"/><path d="M${X + 10} ${y - 8} L${X + 14} ${y - 3} L${X + 18} ${y - 8}" fill="none" stroke="${MUTED}" stroke-opacity="0.6" stroke-width="1.5"/>`)
    }
    const tip = n.tip ? `<title>${esc(n.tip)}</title>` : ''
    parts.push(
      `<g>${tip}<rect x="${X}" y="${y}" width="${W - 2 * X}" height="${H}" rx="9" fill="${n.color}" fill-opacity="0.12" stroke="${n.color}" stroke-opacity="0.55"/>` +
        `<circle cx="${X + 14}" cy="${y + H / 2}" r="4" fill="${n.color}"/>` +
        `<text x="${X + 26}" y="${y + 15}" font-size="9" font-weight="700" letter-spacing="0.6" fill="${n.color}">${esc(n.label)}</text>` +
        `<text x="${X + 26}" y="${y + 30}" font-size="11.5" fill="${MUTED}">${esc(cut(n.text, 40))}</text></g>`,
    )
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" font-family="-apple-system,Segoe UI,sans-serif">${parts.join('')}</svg>`
}

export async function renderPane($: EngineInterface, e: RenderInput) {
  const els = $.ui.resolve(e)
  const { Box, Text, Button } = els
  const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
  const noop = () => undefined
  const list = (await $.state.get(S_TOPICS)).value ?? []
  const inbox = (await $.state.get(S_INBOX)).value ?? []
  const costs = (await $.state.get(S_COSTS)).value ?? { session: {}, all: {}, since: 0 }
  const view = (await $.state.get(S_COSTVIEW)).value ?? 'session'
  const msg = (await $.state.get(S_NOTE)).value ?? ''
  const vault = (await $.state.get(S_VAULT)).value ?? ''
  const brain = (await $.state.get(S_BRAIN)).value ?? { prompt: '', steps: [], report: null }
  const open = (await $.state.get(S_BRAINOPEN)).value !== false
  const costOpen = (await $.state.get(S_COSTOPEN)).value !== false
  const topicsOpen = (await $.state.get(S_TOPICSOPEN)).value !== false
  const inboxOpen = (await $.state.get(S_INBOXOPEN)).value !== false
  const folded = (await $.state.get(S_FOLDED)).value ?? []
  const hidden = (id: string) => folded.includes(id)
  const now = await $.clock.now()
  const W = Math.max(30, ((e.props as { bodyColumns?: number }).bodyColumns ?? 40) - 1)

  const head = (t: string, right?: string) => (
    <Box marginTop={1} flexDirection="row" justifyContent="space-between">
      <Text bold dimColor>
        {t.toUpperCase()}
      </Text>
      {right ? <Text dimColor>{right}</Text> : null}
    </Box>
  )
  /** A heading that folds its section: press to show or hide it. */
  const fold = (key: string, t: string, isOpen: boolean, right?: string) => (
    <Box marginTop={1} flexDirection="row" justifyContent="space-between">
      <Button key={key} plain onPress={noop}>
        <Text bold dimColor>{`${isOpen ? '▾' : '▸'} ${t.toUpperCase()}`}</Text>
      </Button>
      {right ? <Text dimColor>{right}</Text> : null}
    </Box>
  )
  const row = (key: string, left: string, right: string, dim = false) => (
    <Box key={key} flexDirection="row" justifyContent="space-between">
      <Text dimColor={dim}>{cut(left, Math.max(4, W - right.length - 1))}</Text>
      <Text dimColor={dim}>{right}</Text>
    </Box>
  )

  // ---- status (last) ----
  const st = brainStatus(brain)
  // The flow's natural size, passed explicitly so the host does not shrink it to a thumbnail.
  const flow = flowSvg(brain, st.text, st.color)
  const flowH = Number(/viewBox="0 0 \d+ (\d+)"/.exec(flow)?.[1] ?? 200)
  const textDetail = (
    <Box flexDirection="column" borderStyle="round" paddingX={1} marginTop={1}>
      {brain.prompt ? <Text dimColor wrap="truncate-end">{`“${brain.prompt}”`}</Text> : null}
      {!st.attempted ? <Text dimColor wrap="wrap">Claude did not check Knowledge.base, search or read any note for this prompt.</Text> : null}
      {brain.steps.map((s, i) => (
        <Text key={`st${i}`} wrap="wrap">
          <Text color={s.kind === 'read' ? ACCENT : undefined} dimColor={s.kind !== 'read'}>
            {s.kind === 'read' ? '▸ Read ' : '· '}
          </Text>
          {s.text}
        </Text>
      ))}
      {brain.report?.used.map((n, i) => (
        <Text key={`u${i}`} wrap="wrap">
          <Text color={GOOD}>✓ Used </Text>
          {n.note}
          {n.why ? <Text dimColor>{` — ${n.why}`}</Text> : null}
        </Text>
      ))}
      {brain.report?.unused.map((n, i) => (
        <Text key={`n${i}`} wrap="wrap">
          <Text color={WARN}>✗ Not used </Text>
          {n.note}
          {n.why ? <Text dimColor>{` — ${n.why}`}</Text> : null}
        </Text>
      ))}
      {st.attempted && !brain.report ? <Text dimColor wrap="wrap">Claude has not said which notes it used.</Text> : null}
    </Box>
  )
  const status = Svg ? (
    <Box flexDirection="column">
      <Svg key="status-badge" source={statusSvg(brain, st.text, st.color)} alt={`Second Brain: ${st.text}`} width={300} height={40} />
      <Button key="brain" plain onPress={noop}>
        <Text dimColor>{open ? '▾ Hide flow' : '▸ Show what happened'}</Text>
      </Button>
      {open ? <Svg key="status-flow" source={flow} alt={`Flow for this prompt: ${brain.steps.length} steps, ${st.text}`} width={300} height={flowH} isInteractive /> : null}
    </Box>
  ) : (
    <Box flexDirection="column">
      <Button key="brain" plain onPress={noop}>
        <Text color={st.color}>{`● ${st.text}`}</Text>
        <Text dimColor>{open ? ' ▾' : ' ▸'}</Text>
      </Button>
      {open ? textDetail : null}
    </Box>
  )

  // ---- cost ----
  const bs = view === 'all' ? costs.all : costs.session
  const sum = total(bs)
  const cats = (Object.keys(CAT_LABEL) as Category[]).filter(c => (bs[c]?.turns ?? 0) > 0)

  return (
    <Box flexDirection="column" width={W}>
      {!vault ? <Text color={WARN}>Vault not found. Set it with /secondbrain vault &lt;path&gt;.</Text> : null}

      {fold('topics-toggle', 'Potential topics', topicsOpen, list.length ? String(list.length) : undefined)}
      {!topicsOpen ? null : (
      <Box flexDirection="column">
      {list.length === 0 ? <Text dimColor wrap="wrap">None yet. They refresh by themselves after each answer.</Text> : null}
      <Box flexDirection="column" marginTop={list.length ? 1 : 0}>
        {list.map((t, i) => (
          <Box key={`t${i}`} flexDirection="row" gap={1} marginBottom={i < list.length - 1 ? 1 : 0}>
            <Text color={ACCENT} bold>
              {`${String(i + 1).padStart(2, ' ')}.`}
            </Text>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="wrap">{t}</Text>
            </Box>
          </Box>
        ))}
      </Box>
      <Box flexDirection="row" gap={2} marginTop={list.length ? 1 : 0}>
        <Button key="topics-refresh" plain onPress={noop}>
          <Text dimColor>↻ Refresh now</Text>
        </Button>
        {list.length ? (
          <Button key="topics-clear" plain onPress={noop}>
            <Text dimColor>Clear</Text>
          </Button>
        ) : null}
      </Box>
      </Box>
      )}

      {fold('capture-toggle', 'Capture', !hidden('capture'))}
      {hidden('capture') ? null : <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Button key="capture" label="Capture chat" variant="primary" onPress={noop} />
        <Button key="knowledge" label="Capture + Knowledge" variant="secondary" onPress={noop} />
      </Box>}
      {msg && !hidden('capture') ? (
        <Text color={/^Could not|No |not found|still running|already being/.test(msg) ? WARN : GOOD} wrap="wrap">
          {msg}
        </Text>
      ) : null}

      {fold('inbox-toggle', 'Inbox', inboxOpen, inbox.length ? `${inbox.length} file${inbox.length === 1 ? '' : 's'}` : 'empty')}
      {!inboxOpen ? null : inbox.length === 0 ? <Text dimColor>Nothing waiting.</Text> : (
        <Box flexDirection="column">
          {inbox.slice(0, SHOW_INBOX).map((f, i) => (
            <Box key={`in${i}`} flexDirection="column">
              <Text wrap="truncate-end">{f.name}</Text>
              <Text dimColor>{`${ago(f.mtimeMs, now)} ago`}</Text>
            </Box>
          ))}
          {inbox.length > SHOW_INBOX ? <Text dimColor>{`and ${inbox.length - SHOW_INBOX} more`}</Text> : null}
        </Box>
      )}
      {inbox.length ? (
        <Box flexDirection="row" marginTop={1}>
          <Button key="knowledge-all" label={`Make Knowledge (${inbox.length})`} variant="primary" onPress={noop} />
        </Box>
      ) : null}

      {fold('actions-toggle', 'More actions', !hidden('actions'))}
      {hidden('actions') ? null : <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Button key="sanitize" label="Sanitize" variant="secondary" onPress={noop} />
        <Button key="daily" label="Daily question" variant="secondary" onPress={noop} />
        <Button key="random" label="Random topic" variant="secondary" onPress={noop} />
      </Box>}

      <Box marginTop={1} flexDirection="row" justifyContent="space-between">
        <Button key="cost" plain onPress={noop}>
          <Text bold dimColor>{`${costOpen ? '▾' : '▸'} COST`}</Text>
        </Button>
        <Text dimColor>{`${view === 'all' ? 'all time' : 'this chat'} · `}<Text>{usd(usdOf(sum))}</Text></Text>
      </Box>
      {!costOpen ? null : cats.length === 0 ? (
        <Text dimColor wrap="wrap">
          Nothing counted yet. Turns count while the chat runs in the vault or an action runs.
        </Text>
      ) : (
        <Box flexDirection="column">
          {row('in', 'Input', `${tok(sum.input)} · ${usd(sum.usdInput)}`)}
          {row('cr', 'Cache read', `${tok(sum.cacheRead)} · ${usd(sum.usdRead)}`)}
          {row('cw', 'Cache write', `${tok(sum.cacheWrite)} · ${usd(sum.usdWrite)}`)}
          {row('out', 'Output', `${tok(sum.output + sum.thinking)} · ${usd(sum.usdOutput + sum.usdThinking)}`)}
          <Box marginTop={1} flexDirection="column">
            {cats.map(c => {
              const b = bs[c] ?? EMPTY
              return row(`c-${c}`, CAT_LABEL[c], `${b.turns} turn${b.turns === 1 ? '' : 's'} · ${usd(usdOf(b))}`, true)
            })}
          </Box>
        </Box>
      )}
      {costOpen ? (
        <Button key="cost-view" plain onPress={noop}>
          <Text dimColor>{view === 'all' ? '⇄ Show this chat' : '⇄ Show all time'}</Text>
        </Button>
      ) : null}

      {fold('status-toggle', 'Status', !hidden('status'))}
      {hidden('status') ? null : status}
    </Box>
  )
}
