/** What `$.session.usage()` last answered, flattened for drawing. */
export type Snapshot = {
  /** Context tokens of the last response; null before the first one. */
  tokens: number | null
  window: number
  /** Session cost in US dollars; null where the host keeps no ledger. */
  usd: number | null
  limits: { kind: string; percentUsed: number; resetsAt: string | null }[]
}

/** The /context breakdown, kept small: the rows and the lists under them. */
export type Detail = {
  model: string
  total: number
  max: number
  autoCompactAt: number | null
  rows: { name: string; tokens: number; kind: string }[]
  memory: { path: string; type: string; tokens: number }[]
  mcp: { server: string; tools: number; loaded: number; tokens: number }[]
  skills: { count: number; tokens: number; top: { name: string; tokens: number }[] }
  agents: { name: string; tokens: number }[]
  /** Clock time it was measured. */
  at: number
}

export type SkillUse = { name: string; count: number; last: number }

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number; turns: number; usd: number; model: string }

export type AgentCost = {
  id: string
  description: string
  type: string
  model: string
  phase: 'working' | 'done'
  tokens: number
  usd: number
  startedAt: number
}

export type Shot = {
  id: string
  at: number
  tool: string
  w: number
  h: number
  nw: number
  nh: number
  before: number
  after: number
  usdSaved: number
  /** Small JPEG, base64, for the desktop pane; empty until made or when it failed. */
  thumb: string
  /** The same thumbnail as a PNG file, for the terminal's Image. */
  file: string
}

declare module 'claude-code' {
  interface PluginState {
    statsPane: {
      snap: Snapshot
      detail: Detail | null
      open: boolean
      skills: Shaped<SkillUse[]>
      tokens: Shaped<Tokens>
      agents: Shaped<AgentCost[]>
      shots: Shaped<Shot[]>
      now: number
      /** Ids of the sections folded shut. */
      folded: string[]
      /** True once the pane has been opened for this chat's first message. */
      shown: boolean
    }
    /** Read only: the Mods pane's list of mods switched off. */
    'mods-panel': { disabled: string[] }
    /** Read only: the handoff mod's trigger. */
    handoff: { offerAt: number | null }
    /** Read only: the downsize mod's running totals. */
    'downsize-browser-screenshot': { totals: { seen: number; shrunk: number; before: number; after: number } }
  }
}
