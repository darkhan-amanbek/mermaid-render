# Mermaid Viewer for Claude Code

A small VS Code extension that shows the viewer pages written by the [mermaid-render](https://github.com/darkhan-amanbek/mermaid-render) Claude Code mod as a tab inside VS Code, instead of in the browser.

When it is installed, the mod's **⤢ View** button opens the diagram beside the chat, with trackpad pinch-zoom, wheel zoom, drag to pan, the mermaid source, copy and save. Without it, the mod opens the same page in the browser.

## Install

```bash
cd vscode-extension
npx -y @vscode/vsce package
code --install-extension mermaid-viewer-0.1.0.vsix
```

## How it works

The mod opens `vscode://darkhan-amanbek.mermaid-viewer/open?path=<page>`. The extension loads that page into a webview panel with scripts on. Only pages under `<os temp dir>/mermaid-render/` are opened, since any program can open such a URI. The command **Mermaid Viewer: Open a viewer page…** opens one by hand.
