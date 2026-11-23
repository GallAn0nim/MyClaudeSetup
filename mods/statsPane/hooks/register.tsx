import { atom, read } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentCost, Detail, Shot, SkillUse, Snapshot, Tokens } from '../types'
import {
  addAgent, baselineDownsize, cleanThumbs, NAME, noteAgentTurn, noteMainTurn, noteSkill, readDetail, readUsage, seenImagesSynced, setHome, syncDownsize,
} from './track'
import { at, bar, barSvg, cut, findImages, shrinkNotes, span, thumbSvg, tok, usd } from './util'

// statsPane: one side pane with this chat's numbers. Context (press it for the /context
// breakdown) against the 300k handoff line, skills used, tokens and price, the 5-hour and
// weekly limits, subagent costs, and the pictures the downsize mod shrank, with what it saved.

const PANE = 'statsPane'
// State refs and atoms are written out in each file that uses them (the engine lists state per
// file), so these repeat track.ts: keep the refs and shape tags the same in both.
const SNAP = { plugin: 'statsPane', key: 'snap' } as const
const DETAIL = { plugin: 'statsPane', key: 'detail' } as const
const EMPTY_TOKENS: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0, usd: 0, model: '' }
const skills = atom({ plugin: 'statsPane', key: 'skills' } as const, [] as SkillUse[], { shape: 'skills-1' })
const tokens = atom({ plugin: 'statsPane', key: 'tokens' } as const, EMPTY_TOKENS, { shape: 'tokens-1' })
const agents = atom({ plugin: 'statsPane', key: 'agents' } as const, [] as AgentCost[], { shape: 'agents-1' })
const shots = atom({ plugin: 'statsPane', key: 'shots' } as const, [] as Shot[], { shape: 'shots-1' })
const OPEN = { plugin: 'statsPane', key: 'open' } as const
const FOLDED = { plugin: 'statsPane', key: 'folded' } as const
const NOW = { plugin: 'statsPane', key: 'now' } as const
const SHOWN = { plugin: 'statsPane', key: 'shown' } as const
const MODS_OFF = { plugin: 'mods-panel', key: 'disabled' } as const
const HANDOFF = { plugin: 'handoff', key: 'offerAt' } as const
const TITLE = 'Stats'
const HANDOFF_AT = 300_000
const TICK_MS = 30_000

// Muted tones that sit with Claude's own UI: terracotta accent, soft status colours.
const ACCENT = '#d97757'
const GOOD = '#7fb685'
const WARN = '#d4a24c'
const BAD = '#e0645c'

let ticker: { cancel(): void } | null = null

async function switchedOff($: EngineInterface) {
  const { value } = await $.state.get(MODS_OFF)
  return Array.isArray(value) && value.includes(NAME)
}

const safe = (p: Promise<unknown>) => void p.catch(() => undefined)
const limitColor = (pct: number) => (pct >= 90 ? BAD : pct >= 70 ? WARN : GOOD)
const limitName = (kind: string) => (kind === 'five_hour' ? '5-hour limit' : kind === 'seven_day' ? 'Weekly limit' : kind === 'spend_limit' ? 'Spend limit' : kind.replace(/_/g, ' '))

// First-message order: Stats 0, Second Brain 500, Agent Info 1000, Mods 1500 ms.
const OPEN_DELAY_MS = 0

/** Waits on the engine's clock: the four panes open one after another, in a fixed order. */
const later = ($: EngineInterface, ms: number) => new Promise<void>(r => void $.clock.after(ms, () => r()))

/** The chat's first message opens the pane, unless it is switched off in the Mods pane. */
async function openOnFirstMessage($: EngineInterface) {
  const { value, version } = await $.state.get(SHOWN)
  if (value === true) return
  if (!(await $.state.set(SHOWN, true, { ifVersion: version })).isSet) return
  await later($, OPEN_DELAY_MS)
  if (await switchedOff($)) return
  await readUsage($).catch(() => undefined)
  safe(readDetail($, true))
  await $.ui.open({ id: PANE, title: TITLE })
}

async function toggleFold($: EngineInterface, id: string) {
  const { value: cur = [] } = await $.state.get(FOLDED)
  await $.state.set(FOLDED, cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id])
}

async function toggleDetail($: EngineInterface) {
  const { value: open = false } = await $.state.get(OPEN)
  await $.state.set(OPEN, !open)
  if (!open) await readDetail($, true)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    setHome((await $.env.get('HOME').catch(() => undefined)) ?? '')
    await $.command.register({ name: 'statspane', description: 'statsPane: open the Stats side pane', immediate: true })
    safe(readUsage($))
    safe(cleanThumbs($))
    safe(baselineDownsize($))
    ticker?.cancel()
    ticker = $.clock.every(TICK_MS, () => {
      safe($.clock.now().then(n => $.state.set(NOW, n)))
      safe(readUsage($))
      safe(syncDownsize($))
    })
    safe($.clock.now().then(n => $.state.set(NOW, n)))
    return next(e)
  })

  // Opens the Stats pane on the chat's first message, once per chat.
  on('prompt.submit', async ($, e, next) => {
    const r = await next(e)
    void openOnFirstMessage($).catch(() => undefined)
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'statspane' }, async $ => {
    if (await switchedOff($)) return { text: 'statsPane is off in the Mods pane. Turn it on there (/mods).' }
    await readUsage($).catch(() => undefined)
    safe(readDetail($, true))
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Stats pane opened.' }
  })

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    safe(readUsage($))
    const { value: open = false } = await $.state.get(OPEN)
    if (open) safe(readDetail($))
    return r
  })

  on('skill.prompt', async ($, e, next) => {
    safe(noteSkill($, e.skill))
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    const id = (r as { agentId?: string }).agentId
    if (id) safe(addAgent($, id, e.description || 'Subagent', e.subagentType || 'subagent', e.model ?? (r as { model?: string }).model ?? ''))
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) safe(noteAgentTurn($, e.agentId, e.usage))
    else if (e.usage) safe(noteMainTurn($, e.usage))
    safe(readUsage($))
    safe(syncDownsize($))
    return r
  }).catch(($, e, next) => next(e))

  // Pictures. A downsize mod beneath us leaves its note in the result; one above us shrinks after
  // we return, and track.ts picks that up from its totals at the next sync.
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    const res = r as { result?: unknown; context?: readonly string[]; deny?: unknown; isError?: boolean }
    if (res.deny !== undefined || res.isError || res.result === undefined) return r
    const b64 = findImages(res.result)
    if (b64.length) safe(seenImagesSynced($, e.tool_use_id, e.tool as string, b64, shrinkNotes(res.context)))
    else safe(syncDownsize($))
    return r
  }).catch(($, e, next) => next(e))

  // If another plugin's writes do reach this hook, sync right away (counting is idempotent).
  on('state.set', { plugin: 'downsize-browser-screenshot', key: 'totals' }, async ($, e, next) => {
    const r = await next(e)
    if ('isSet' in r && r.isSet) safe(syncDownsize($))
    return r
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (await switchedOff($)) return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : null
    const Image = e.surface === 'terminal' && 'Image' in els ? els.Image : null

    const { value: snap = { tokens: null, window: 0, usd: null, limits: [] } as Snapshot } = await $.state.get(SNAP)
    const { value: detail = null } = await $.state.get(DETAIL)
    const { value: open = false } = await $.state.get(OPEN)
    const { value: folded = [] } = await $.state.get(FOLDED)
    const { value: now = Date.now() } = await $.state.get(NOW)
    const { value: offerAt } = await $.state.get(HANDOFF)
    const skillList = await read($, skills)
    const tk = await read($, tokens)
    const agentList = await read($, agents)
    const shotList = await read($, shots)

    const W = Math.max(30, e.props.bodyColumns)
    const px = Math.floor(W * 6.5)
    const barW = Math.max(10, W - 2)

    const meter = (key: string, frac: number, color: string, mark?: number) => {
      if (Svg) return <Svg key={key} source={barSvg(frac, px, color, mark, BAD)} alt={`${Math.round(frac * 100)}%`} width={px} height={10} />
      const [a, b] = bar(frac, barW)
      if (mark !== undefined && mark > 0 && mark < 1) {
        // Terminal: draw the mark as a red │ inside the bar.
        const m = Math.min(barW - 1, Math.round(mark * barW))
        const s = (a + b).split('')
        const filled = a.length
        return (
          <Text key={key}>
            <Text color={color}>{s.slice(0, Math.min(m, filled)).join('')}</Text>
            <Text dimColor>{s.slice(Math.min(m, filled), m).join('')}</Text>
            <Text color={BAD}>│</Text>
            <Text color={color}>{s.slice(m + 1, Math.max(m + 1, filled)).join('')}</Text>
            <Text dimColor>{s.slice(Math.max(m + 1, filled)).join('')}</Text>
          </Text>
        )
      }
      return (
        <Text key={key}>
          <Text color={color}>{a}</Text>
          <Text dimColor>{b}</Text>
        </Text>
      )
    }
    const head = (id: string, t: string, right?: string) => (
      <Box marginTop={1} flexDirection="row" justifyContent="space-between">
        <Button key={`fold-${id}`} plain onPress={() => safe(toggleFold($, id))}>
          <Text bold dimColor>{`${folded.includes(id) ? '▸' : '▾'} ${t.toUpperCase()}`}</Text>
        </Button>
        {right ? <Text dimColor>{right}</Text> : null}
      </Box>
    )
    const shut = (id: string) => folded.includes(id)
    const row = (key: string, left: string, right: string, dim = false) => (
      <Box key={key} flexDirection="row" justifyContent="space-between">
        <Text dimColor={dim}>{cut(left, Math.max(4, W - right.length - 1))}</Text>
        <Text dimColor={dim}>{right}</Text>
      </Box>
    )

    // ---- context ----
    const handoff = typeof offerAt === 'number' ? offerAt : HANDOFF_AT
    const ctx = snap.tokens ?? 0
    const win = snap.window || 1
    const ctxPct = Math.round((ctx / win) * 100)
    const ctxColor = ctx >= handoff ? BAD : ctx >= handoff * 0.8 ? WARN : ACCENT
    const toHandoff = handoff - ctx

    const detailRows = (d: Detail) => {
      const used = d.rows.filter(r => r.kind === 'used').sort((a, z) => z.tokens - a.tokens)
      const other = d.rows.filter(r => r.kind !== 'used')
      return (
        <Box flexDirection="column" borderStyle="round" paddingX={1} marginTop={1}>
          <Text dimColor>
            {d.model} · {tok(d.total)} / {tok(d.max)}
            {d.autoCompactAt ? ` · autocompact at ${tok(d.autoCompactAt)}` : ''}
          </Text>
          {used.map(r => row(`r-${r.name}`, r.name, `${tok(r.tokens)} · ${Math.round((r.tokens / d.max) * 100)}%`))}
          {other.map(r => row(`o-${r.name}`, r.name, tok(r.tokens), true))}
          {d.memory.length > 0 && <Text bold>Memory files</Text>}
          {d.memory.map(m => row(`m-${m.path}`, `${m.type} · ${m.path.split('/').slice(-2).join('/')}`, tok(m.tokens), true))}
          {d.mcp.length > 0 && <Text bold>MCP servers</Text>}
          {d.mcp.map(s => row(`s-${s.server}`, `${s.server} (${s.loaded}/${s.tools} loaded)`, tok(s.tokens), true))}
          {d.skills.count > 0 && <Text bold>Skill listing · {d.skills.count} skills · {tok(d.skills.tokens)}</Text>}
          {d.skills.top.slice(0, 8).map(s => row(`k-${s.name}`, s.name, tok(s.tokens), true))}
          {d.agents.length > 0 && <Text bold>Agent types</Text>}
          {d.agents.map(a => row(`a-${a.name}`, a.name, tok(a.tokens), true))}
          <Button key="refresh" plain onPress={() => safe(Promise.all([readDetail($, true), readUsage($)]))}>
            <Text dimColor>↻ Refresh breakdown</Text>
          </Button>
        </Box>
      )
    }

    // ---- tokens ----
    const sessionTok = tk.input + tk.output + tk.cacheRead + tk.cacheWrite
    const agentTok = agentList.reduce((n, a) => n + a.tokens, 0)
    const agentUsd = agentList.reduce((n, a) => n + a.usd, 0)

    // ---- images ----
    const savedTok = shotList.reduce((n, s) => n + (s.before - s.after), 0)
    const savedUsd = shotList.reduce((n, s) => n + s.usdSaved, 0)
    const cols = Math.max(1, Math.floor(W / 18))
    const thumbPx = Math.floor((px - (cols - 1) * 8) / cols)
    const thumb = (s: (typeof shotList)[number]) => {
      const label = `−${tok(s.before - s.after)} · ${usd(s.usdSaved)}`
      const size = s.w ? `${s.w}×${s.h}→${s.nw || '?'}×${s.nh || '?'}` : ''
      const pic = Svg && s.thumb ? (
        <Svg source={thumbSvg(s.thumb, thumbPx, Math.round(thumbPx * 0.62))} alt={`Screenshot from ${s.tool}`} width={thumbPx} height={Math.round(thumbPx * 0.62)} />
      ) : Image && s.file ? (
        <Image source={{ file: s.file, format: 'png' }} columns={16} rows={5} alt="screenshot" />
      ) : (
        <Text dimColor>▢ picture</Text>
      )
      return (
        <Box key={`shot-${s.id}`} flexDirection="column" width={Math.floor(W / cols)} marginBottom={1}>
          {pic}
          <Text color={GOOD}>{cut(label, Math.floor(W / cols) - 1)}</Text>
          {size && <Text dimColor>{cut(size, Math.floor(W / cols) - 1)}</Text>}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" width={W}>
        <Box flexDirection="row" justifyContent="space-between">
          <Button key="ctx" plain onPress={() => safe(toggleDetail($))}>
            <Text dimColor>{open ? '▾ ' : '▸ '}</Text>
            <Text bold>Context</Text>
          </Button>
          <Text>
              {snap.tokens === null ? (
                <Text dimColor>no reading yet</Text>
              ) : (
                <Text>
                  {tok(ctx)} <Text dimColor>/ {tok(win)} · </Text>
                  {ctxPct}%
                </Text>
              )}
          </Text>
        </Box>
        {meter('ctx-bar', ctx / Math.max(win, handoff), ctxColor, handoff / Math.max(win, handoff))}
        <Box flexDirection="row" justifyContent="space-between">
          <Text dimColor>
            <Text color={BAD}>│</Text> Handoff at {tok(handoff)}
          </Text>
          <Text color={toHandoff <= 0 ? BAD : undefined} dimColor={toHandoff > 0}>
            {toHandoff > 0 ? `${tok(toHandoff)} to go` : `${tok(-toHandoff)} past`}
          </Text>
        </Box>
        {open && (detail ? detailRows(detail) : <Text dimColor>Measuring…</Text>)}

        {head('session', 'Session')}
        {shut('session') ? null : (
        <Box flexDirection="column">
        {row('price', 'Price (/cost)', snap.usd === null ? '—' : usd(snap.usd))}
        {row('tok', `Tokens · ${tk.turns} turn${tk.turns === 1 ? '' : 's'}`, tok(sessionTok + agentTok))}
        {row('tok-io', '  in / out', `${tok(tk.input)} / ${tok(tk.output)}`, true)}
        {row('tok-cache', '  cache read / write', `${tok(tk.cacheRead)} / ${tok(tk.cacheWrite)}`, true)}
        {agentTok > 0 && row('tok-agents', '  subagents', tok(agentTok), true)}
        </Box>
        )}

        {head('limits', 'Limits')}
        {shut('limits') ? null : (
        <Box flexDirection="column">
        {snap.limits.length === 0 && <Text dimColor>No reading yet (only on a subscription, after a reply).</Text>}
        {snap.limits.map((l, i) => (
          <Box key={`lim-${l.kind}`} flexDirection="column" marginTop={i ? 1 : 0}>
            <Box flexDirection="row" justifyContent="space-between">
              <Text>{limitName(l.kind)}</Text>
              <Text color={l.percentUsed >= 70 ? limitColor(l.percentUsed) : undefined}>{l.percentUsed}%</Text>
            </Box>
            {meter(`lim-b-${l.kind}`, l.percentUsed / 100, limitColor(l.percentUsed))}
            {l.resetsAt && (
              <Text dimColor>
                resets in {span(Date.parse(l.resetsAt) - now)} · {at(l.resetsAt, now)}
              </Text>
            )}
          </Box>
        ))}
        </Box>
        )}

        {head('skills', 'Skills used', skillList.length ? String(skillList.length) : undefined)}
        {shut('skills') ? null : (
        <Box flexDirection="column">
        {skillList.length === 0 && <Text dimColor>None yet.</Text>}
        {[...skillList].sort((a, z) => z.last - a.last).map(s => row(`sk-${s.name}`, s.name, s.count > 1 ? `×${s.count}` : '', false))}
        </Box>
        )}

        {head('agents', 'Subagents', agentList.length ? `${agentList.length} · ~${usd(agentUsd)}` : undefined)}
        {shut('agents') ? null : (
        <Box flexDirection="column">
        {agentList.length === 0 && <Text dimColor>None yet.</Text>}
        {agentList.map(a => (
          <Box key={`ag-${a.id}`} flexDirection="column">
            <Box flexDirection="row" justifyContent="space-between">
              <Text>
                <Text color={a.phase === 'working' ? ACCENT : GOOD}>{a.phase === 'working' ? '●' : '✓'}</Text> {cut(a.description, W - 12)}
              </Text>
              <Text dimColor>{a.usd ? `~${usd(a.usd)}` : '…'}</Text>
            </Box>
            <Text dimColor>
              {'  '}
              {cut([a.type, a.model, a.tokens ? `${tok(a.tokens)} tok` : ''].filter(Boolean).join(' · '), W - 2)}
            </Text>
          </Box>
        ))}
        </Box>
        )}

        {head('images', 'Downsized images', shotList.length ? String(shotList.length) : undefined)}
        {shut('images') ? null : (
        <Box flexDirection="column">
        {shotList.length === 0 ? (
          <Text dimColor>None yet. Pictures the downsize mod shrinks show here.</Text>
        ) : (
          <Box flexDirection="column">
            <Text color={GOOD}>
              Saved ~{tok(savedTok)} tokens · ~{usd(savedUsd)} on first read
            </Text>
            <Box flexDirection="row" flexWrap="wrap" marginTop={1}>
              {[...shotList].reverse().map(thumb)}
            </Box>
          </Box>
        )}
        </Box>
        )}
      </Box>
    )
  })
}
