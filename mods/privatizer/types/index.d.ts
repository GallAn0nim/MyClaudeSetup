/** True while Privatizer hides private data on screen. */
export type PrivatizerOn = boolean

declare module 'claude-code' {
  interface PluginState {
    /** Read only: the Mods pane's list of mods switched off. */
    'mods-panel': { disabled: string[] }
    privatizer: { on: PrivatizerOn }
  }
}
