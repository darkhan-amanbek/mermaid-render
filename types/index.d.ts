/** How one diagram is viewed: its zoom (1 is natural size, 0 fits the slot) and whether its source shows. */
export type View = { zoom: number; showSource: boolean }

declare module 'claude-code' {
  interface PluginState {
    'mermaid-render': { views: Shaped<Record<string, View>> }
  }
}
