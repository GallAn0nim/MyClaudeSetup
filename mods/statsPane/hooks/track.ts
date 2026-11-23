import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { AgentCost, Detail, Shot, SkillUse, Snapshot, Tokens } from '../types'
import { imageTokens, priceOf, shortModel, usageTotal, usageUsd } from './util'
import type { Usage } from './util'

export const NAME = 'statsPane'
const SNAP = { plugin: 'statsPane', key: 'snap' } as const
const DETAIL = { plugin: 'statsPane', key: 'detail' } as const

// register.tsx declares the same atoms (same refs and shape tags): the engine lists state per file.
const EMPTY_TOKENS: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0, usd: 0, model: '' }
const skills = atom({ plugin: 'statsPane', key: 'skills' } as const, [] as SkillUse[], { shape: 'skills-1' })
const tokens = atom({ plugin: 'statsPane', key: 'tokens' } as const, EMPTY_TOKENS, { shape: 'tokens-1' })
const agents = atom({ plugin: 'statsPane', key: 'agents' } as const, [] as AgentCost[], { shape: 'agents-1' })
const shots = atom({ plugin: 'statsPane', key: 'shots' } as const, [] as Shot[], { shape: 'shots-1' })

const MAX_SHOTS = 24
let home = ''
let seq = 0
export const setHome = (h: string) => (home = h)
const thumbDir = () => `${home}/.claude/mods-tmp/statsPane`

// ---- usage ----

export async function readUsage($: EngineInterface) {
  const u = await $.session.usage()
  const snap: Snapshot = {
    tokens: typeof u.context.tokens === 'number' ? u.context.tokens : null,
    window: u.context.window,
    usd: typeof u.cost?.usd === 'number' ? u.cost.usd : null,
    limits: u.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt ?? null })),
  }
  await $.state.set(SNAP, snap)
}

let lastDetail = 0
export async function readDetail($: EngineInterface, force = false) {
  const now = await $.clock.now()
  if (!force && now - lastDetail < 15_000) return
  lastDetail = now
  const u = await $.session.usage({ breakdown: 'summary' })
  const b = u.context.breakdown
  if (!b) return
  const servers = new Map<string, { server: string; tools: number; loaded: number; tokens: number }>()
  for (const t of b.mcpTools) {
    const s = servers.get(t.serverName) ?? { server: t.serverName, tools: 0, loaded: 0, tokens: 0 }
    s.tools += 1
    if (t.isLoaded) {
      s.loaded += 1
      s.tokens += t.tokens
    }
    servers.set(t.serverName, s)
  }
  const detail: Detail = {
    model: b.model,
    total: b.totalTokens,
    max: b.rawMaxTokens,
    autoCompactAt: b.isAutoCompactEnabled && typeof b.autoCompactThreshold === 'number' ? b.autoCompactThreshold : null,
    rows: b.categories.map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind })),
    memory: b.memoryFiles.map(m => ({ path: m.path, type: m.type, tokens: m.tokens })),
    mcp: [...servers.values()].sort((a, z) => z.tokens - a.tokens),
    skills: {
      count: b.skills?.totalSkills ?? 0,
      tokens: b.skills?.tokens ?? 0,
      top: (b.skills?.skillFrontmatter ?? []).map(s => ({ name: s.name, tokens: s.tokens })).sort((a, z) => z.tokens - a.tokens),
    },
    agents: b.agents.map(a => ({ name: a.agentType, tokens: a.tokens })),
    at: now,
  }
  await $.state.set(DETAIL, detail)
}

// ---- skills, tokens, agents ----

export async function noteSkill($: EngineInterface, name: string) {
  const now = await $.clock.now()
  await update($, skills, list => {
    const had = list.find(s => s.name === name)
    const rest = list.filter(s => s.name !== name)
    return [...rest, { name, count: (had?.count ?? 0) + 1, last: now }]
  })
}

export async function noteMainTurn($: EngineInterface, u: Usage & { model: string }) {
  await update($, tokens, t => ({
    input: t.input + u.input_tokens,
    output: t.output + u.output_tokens,
    cacheRead: t.cacheRead + u.cache_read_input_tokens,
    cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
    turns: t.turns + 1,
    usd: t.usd + usageUsd(u, u.model),
    model: u.model || t.model,
  }))
}

export async function addAgent($: EngineInterface, id: string, description: string, type: string, model: string) {
  const now = await $.clock.now()
  await update($, agents, list =>
    list.some(a => a.id === id)
      ? list
      : [...list, { id, description, type, model: shortModel(model), phase: 'working' as const, tokens: 0, usd: 0, startedAt: now }].slice(-50),
  )
}

export async function noteAgentTurn($: EngineInterface, id: string, u: (Usage & { model: string }) | undefined) {
  await update($, agents, list => {
    const known = list.some(a => a.id === id)
    const base = known ? list : [...list, { id, description: 'Subagent', type: 'subagent', model: '', phase: 'working' as const, tokens: 0, usd: 0, startedAt: 0 }]
    return base.map(a =>
      a.id !== id
        ? a
        : {
            ...a,
            phase: 'done' as const,
            model: u?.model ? shortModel(u.model) : a.model,
            tokens: a.tokens + (u ? usageTotal(u) : 0),
            usd: a.usd + (u ? usageUsd(u, u.model) : 0),
          },
    )
  })
}

// ---- downsized images ----

/** Pictures of the last call that came through at full size: the downsize mod may sit above this one. */
let pending: { id: string; tool: string; b64: string[]; at: number } | null = null

async function mainModel($: EngineInterface) {
  return (await read($, tokens)).model
}

async function addShot($: EngineInterface, shot: Omit<Shot, 'thumb' | 'file'>, b64: string | undefined) {
  const full: Shot = { ...shot, thumb: '', file: '' }
  await update($, shots, list => [...list.filter(s => s.id !== shot.id), full].slice(-MAX_SHOTS))
  if (b64) void makeThumb($, shot.id, b64).catch(() => undefined)
}

async function seenImages($: EngineInterface, callId: string, tool: string, b64: string[], notes: { w: number; h: number; nw: number; nh: number }[]) {
  const now = await $.clock.now()
  if (notes.length === 0) {
    pending = { id: callId, tool, b64, at: now }
    return
  }
  pending = null
  const price = priceOf(await mainModel($)).input
  // Each note names one shrunk picture; they come in the order of the pictures shrunk.
  const n = Math.min(notes.length, b64.length)
  for (let i = 0; i < n; i += 1) {
    const s = notes[i]!
    const before = imageTokens(s.w, s.h)
    const after = imageTokens(s.nw, s.nh)
    await addShot($, { id: `${callId}-${i}`, at: now, tool, ...s, before, after, usdSaved: ((before - after) * price) / 1e6 }, b64[i]!)
  }
}

/** The downsize mod raised its totals: pictures the last call saw at full size were shrunk above this mod. */
async function downsizeDelta($: EngineInterface, d: Counts) {
  if (d.shrunk <= 0) return
  const p = pending
  pending = null
  const now = await $.clock.now()
  const price = priceOf(await mainModel($)).input
  const before = Math.round(d.before / d.shrunk)
  const after = Math.round(d.after / d.shrunk)
  // Without the pictures (a reload lost them), the savings still count, shown without a thumbnail.
  for (let i = 0; i < d.shrunk; i += 1) {
    const id = p ? `${p.id}-${i}` : `downsize-${now}-${i}`
    const b64 = p?.b64[i]
    await addShot($, { id, at: now, tool: p?.tool ?? 'browser', w: 0, h: 0, nw: 0, nh: 0, before, after, usdSaved: ((before - after) * price) / 1e6 }, b64)
  }
}

// ---- following the downsize mod's totals ----
// The downsize mod usually sits above this one, so its note never reaches our tool.call hook,
// and another plugin's state.set may not reach our hooks either. So we compare its totals with
// what we last accounted for, at every chance: our tool.call, turn.complete, the ticker.

type Counts = { shrunk: number; before: number; after: number }
const DOWNSIZE = { plugin: 'downsize-browser-screenshot', key: 'totals' } as const
let accounted: Counts | null = null
let chain: Promise<unknown> = Promise.resolve()

async function downsizeTotals($: EngineInterface): Promise<Counts> {
  const { value } = await $.state.get(DOWNSIZE)
  return { shrunk: value?.shrunk ?? 0, before: value?.before ?? 0, after: value?.after ?? 0 }
}

// One at a time, so two callers never record the same increase twice.
function serial<T>(f: () => Promise<T>): Promise<T> {
  const run = chain.then(f, f)
  chain = run.catch(() => undefined)
  return run
}

/** At session start (and after a reload): what the downsize mod did before now is not ours to show. */
export function baselineDownsize($: EngineInterface) {
  return serial(async () => {
    accounted = await downsizeTotals($)
  })
}

/** Records whatever the downsize mod shrank since we last looked. */
export function syncDownsize($: EngineInterface) {
  return serial(async () => {
    const now = await downsizeTotals($)
    if (!accounted || now.shrunk < accounted.shrunk) {
      accounted = now
      return
    }
    const d = { shrunk: now.shrunk - accounted.shrunk, before: now.before - accounted.before, after: now.after - accounted.after }
    accounted = now
    await downsizeDelta($, d)
  })
}

/** Pictures this hook saw, with the downsize notes when it sits beneath us. */
export function seenImagesSynced($: EngineInterface, callId: string, tool: string, b64: string[], notes: { w: number; h: number; nw: number; nh: number }[]) {
  return serial(async () => {
    // A call earlier than this one may still be waiting for its increase.
    const now = await downsizeTotals($)
    if (accounted && now.shrunk > accounted.shrunk && notes.length === 0) {
      const d = { shrunk: now.shrunk - accounted.shrunk, before: now.before - accounted.before, after: now.after - accounted.after }
      accounted = now
      await downsizeDelta($, d)
    }
    await seenImages($, callId, tool, b64, notes)
    // With notes, these pictures are already in the totals: count them as accounted for.
    if (notes.length > 0) accounted = await downsizeTotals($)
  })
}

// Decodes stdin, writes a 160 px PNG (terminal) and a 160 px JPEG (printed as base64), prints sizes.
const THUMB = `set -e
in="$1"; png="$2"; jpg="$3"
mkdir -p "$(dirname "$in")"
trap 'rm -f "$in" "$jpg"' EXIT
base64 -D > "$in"
sips -g pixelWidth -g pixelHeight "$in" | awk '/pixelWidth/{w=$2} /pixelHeight/{h=$2} END{print "IN", w, h}'
sips -Z 160 -s format png "$in" --out "$png" >/dev/null
sips -Z 160 -s format jpeg -s formatOptions 60 "$in" --out "$jpg" >/dev/null
base64 -i "$jpg"`

async function makeThumb($: EngineInterface, id: string, b64: string) {
  if (!home) return
  seq += 1
  const stem = `${thumbDir()}/${Date.now()}-${seq}`
  const png = `${stem}.png`
  const r = await $.process.run(['/bin/sh', '-c', THUMB, 'sh', `${stem}-in`, png, `${stem}.jpg`], { stdin: b64, timeoutMs: 20_000 })
  if (r.exitCode !== 0) return
  const lines = r.stdout.split(/\r?\n/)
  const head = /^IN (\d+) (\d+)$/.exec(lines[0] ?? '')
  const thumb = lines.slice(1).join('').replace(/\s+/g, '')
  await update($, shots, list =>
    list.map(s => {
      if (s.id !== id) return s
      // Shrunk above this mod: the picture seen was the original, so its size is the "before".
      // The new size is not in the totals: estimate it from the token ratio (tokens go with area).
      const w = Number(head?.[1] ?? 0)
      const h = Number(head?.[2] ?? 0)
      const k = s.before > 0 ? Math.sqrt(s.after / s.before) : 0
      const sized = s.w === 0 && head ? { w, h, nw: Math.round(w * k), nh: Math.round(h * k) } : {}
      return { ...s, ...sized, thumb, file: png }
    }),
  )
}

export async function cleanThumbs($: EngineInterface) {
  if (!home) return
  await $.process.run(['/usr/bin/find', thumbDir(), '-type', 'f', '-mtime', '+2', '-delete'], { timeoutMs: 10_000 }).catch(() => undefined)
}
