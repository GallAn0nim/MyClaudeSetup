export type Clock = {
  /** When the last main-chat reply ended, in ms. 0 before the first reply. */
  lastEnd: number
  /** How long the cache stays warm after a reply, in ms. */
  ttlMs: number
  /** detected: read from this chat's transcript. default: a 5 min guess. */
  ttlSource: 'detected' | 'default'
  /** Context tokens the next message re-sends. */
  tokens: number
  /** The clock's last tick, in ms, so the band redraws. */
  now: number
}

export type Warm = {
  /** When keep warm was turned on, in ms: it stops by itself 2 hours later. */
  startedAt: number
  /** Pings sent so far: it stops by itself after 30. */
  pings: number
  /** Cache read tokens of the last ping. */
  read: number
  /** Cache write tokens of the last ping. */
  write: number
  /** Output tokens of the last ping. */
  output: number
  /** True when the last ping had to write the chat to the cache again. */
  cold: boolean
  /** Why the last ping failed, or ''. */
  error: string
  /** True while a ping is out. */
  sending: boolean
  /** Failed pings in a row: it stops after 3. */
  failures: number
  /** No new ping before this time, in ms (after a failure). */
  retryAt: number
}

declare module 'claude-code' {
  interface PluginState {
    /** Read only: the Mods pane's list of mods switched off. */
    'mods-panel': { disabled: string[] }
    /** Read only: the Handoff band, so the clock steps aside while it shows, and where its offer comes up. */
    handoff: { panel: { phase: string } | null; offerAt: number | null }
    'cache-clock': { clock: Clock | null; warm: Warm | null }
  }
}
