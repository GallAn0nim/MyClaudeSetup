/** Names of the mods switched off with the Mods pane, kept in every chat. */
export type ModsPanelDisabled = string[]

/** A line under the list after a press: "Cache Clock is off." */
export type ModsPanelNote = string

/** Commands registered in this chat, to tell which mods are loaded; empty when not known yet. */
export type ModsPanelLoaded = string[]

/** The mod whose options are unfolded; '' when all are folded. */
export type ModsPanelOpen = string

/** True once the pane has been opened for this chat's first message. */
export type ModsPanelShown = boolean

declare module 'claude-code' {
  interface PluginState {
    'mods-panel': { disabled: ModsPanelDisabled; note: ModsPanelNote; loaded: ModsPanelLoaded; open: ModsPanelOpen; shown: ModsPanelShown }
  }
}
