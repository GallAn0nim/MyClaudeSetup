/** One file in the vault's 00-Inbox. */
export type InboxItem = { name: string; size: number; mtimeMs: number }

/** What SecondBrain work is billed for, by kind of work. */
export type Category = 'chat' | 'knowledge' | 'sanitize' | 'daily' | 'random' | 'topics' | 'subagents'

/** Tokens and dollars of one category. Thinking is an estimate: the API bills it as output. */
export type Bucket = {
  turns: number
  input: number
  cacheRead: number
  cacheWrite: number
  /** Visible output: text and tool calls. */
  output: number
  /** Estimated thinking: output tokens minus what the visible output takes. */
  thinking: number
  usdInput: number
  usdRead: number
  usdWrite: number
  usdOutput: number
  usdThinking: number
}

/** One thing Claude did in the vault while answering the current prompt. */
export type BrainStep = { kind: 'base' | 'skill' | 'search' | 'read' | 'cli'; text: string }

/** What Claude said it took from the vault (the report tool). */
export type BrainReport = {
  /** A short status, e.g. "Found information". */
  status: string
  found: boolean
  used: { note: string; why: string }[]
  unused: { note: string; why: string }[]
}

/** Vault use for the current prompt; reset when a new prompt is sent. */
export type BrainUse = { prompt: string; steps: BrainStep[]; report: BrainReport | null }

export type Buckets = Partial<Record<Category, Bucket>>

export type Costs = {
  /** This chat. */
  session: Buckets
  /** Every chat since the mod was installed (kept in the store). */
  all: Buckets
  /** Clock time the all-time count started. */
  since: number
}

declare module 'claude-code' {
  interface PluginState {
    'second-brain-control': {
      /** Potential Knowledge topics of this chat, newest understanding. */
      topics: string[]
      inbox: InboxItem[]
      costs: Costs
      /** A line under the actions after a press. */
      note: string
      /** The vault's absolute path; '' when it is not found. Other mods (handoff) read it. */
      vault: string
      /** Which cost table is shown: this chat or all time. */
      costView: 'session' | 'all'
      /** Vault use for the current prompt, drawn as the brain indicator. */
      brain: BrainUse
      /** Whether the indicator's list is unfolded. */
      brainOpen: boolean
      /** Whether the cost line is unfolded into its breakdown. */
      costOpen: boolean
      /** Set once the pane has opened on this chat's first message. */
      shown: boolean
      /** Whether the potential-topics list is unfolded (undefined counts as open). */
      topicsOpen: boolean
      /** Whether the Inbox file list is unfolded (undefined counts as open). */
      inboxOpen: boolean
      /** Ids of the sections folded shut (capture, actions, status). */
      folded: string[]
    }
    /** Read only: the Mods pane's list of mods switched off. */
    'mods-panel': { disabled: string[] }
  }
}
