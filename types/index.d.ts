/** How one diagram is viewed in the viewer pane: its zoom (1 is natural size, 0 fits the pane) and whether its source shows. */
export type View = { zoom: number; showSource: boolean }

/** The diagram the viewer pane shows: its id, mermaid source, rendered SVG and alt text. */
export type Viewer = { id: string; source: string; output: string; alt: string }

declare module 'claude-code' {
  interface PluginState {
    'mermaid-render': {
      views: Shaped<Record<string, View>>
      viewer: Shaped<Viewer | null>
    }
  }
}
