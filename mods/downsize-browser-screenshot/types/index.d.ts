/**
 * This chat's running totals. seen: pictures in tool results the mod looked at.
 * shrunk: the ones it made smaller. before / after: their estimated image tokens.
 */
export type Totals = { seen: number; shrunk: number; before: number; after: number }

declare module 'claude-code' {
  interface PluginState {
    /** Read only: the Mods pane's list of mods switched off. */
    'mods-panel': { disabled: string[] }
    'downsize-browser-screenshot': { totals: Totals }
  }
}
