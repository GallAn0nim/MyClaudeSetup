export type StepStatus = 'wait' | 'run' | 'done' | 'fail'

export type Step = {
  label: string
  /** A short result on the right of the bar: "412 messages", "23 s". */
  detail: string
  status: StepStatus
  /** 0 to 1. */
  progress: number
}

export type Panel = {
  /** offer: the Refresh row. working: the steps. ready: the buttons. failed: the error and Try again. */
  phase: 'offer' | 'working' | 'ready' | 'failed'
  tokens: number
  steps: Step[]
  /** Spinner frame, moved by the ticker while working. */
  tick: number
  /** Where the handoff is saved, with ~ for the home folder. */
  file: string
  words: number
  error: string
  /** A line under the buttons: "Copied", "Starting the new chat". */
  note: string
  /** Why the offer is up when not by the token count: "Claude asked", "Another mod asked". */
  reason: string
  /** What the model step cost: dollars and tokens. */
  cost: string
}

declare module 'claude-code' {
  interface PluginState {
    /** Read only: the Mods pane's list of mods switched off. */
    'mods-panel': { disabled: string[] }
    /** Read only: the Second Brain mod's vault path; '' when it has none. */
    'second-brain-control': { vault: string }
    handoff: {
      panel: Panel | null
      /** Context tokens at which the offer comes up (300k, later if snoozed); null while off or hidden in this chat. */
      offerAt: number | null
    }
  }
}
