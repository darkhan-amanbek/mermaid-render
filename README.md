# mermaid-render

A Claude Code mod that draws mermaid diagrams in assistant replies. When a reply holds a closed fenced code block whose language is `mermaid`, the block is drawn as a picture instead of as code.

This is a fork of [ceyeoh/mermaid-render](https://github.com/ceyeoh/mermaid-render) that adds a viewer: one button under every drawn diagram opens it in the browser with trackpad pinch-zoom, wheel zoom, drag to pan, the mermaid source and a download.

- In the desktop app, VS Code and the mobile app, the diagram is an SVG. Its colors follow the light or dark color scheme.
- In the terminal, the diagram is drawn with Unicode box-drawing characters.

## The viewer

Under each drawn diagram there is one button, **⤢ View**. It writes the diagram to `$TMPDIR/mermaid-render/<id>.html` (with the SVG beside it) and opens that page: in a tab inside VS Code when the companion extension is installed (below), else in your default browser. The page holds the SVG inline and fetches nothing. On it:

- a trackpad **pinch**, or **⌘ / Ctrl + scroll**, zooms around the pointer; a two-finger **scroll** or a **drag** pans;
- **−** / **+**, **1:1** and **Fit** on the toolbar, and the keys `-`, `+`, `1`, `0`; a **double-click** toggles between fit and natural size;
- **Source** (key `s`) shows the mermaid text, **Copy** copies it, **Download** saves the SVG;
- the page follows the light or dark color scheme of the system.

### Inside VS Code

The Claude Code extension draws an SVG as a static image and passes no wheel or pinch to a mod, and the mods API has no modal dialog of its own, so the viewer is a page. To have it open as a tab beside the chat, install the small companion extension from [`vscode-extension/`](vscode-extension/):

```bash
code --install-extension vscode-extension/mermaid-viewer-0.4.0.vsix
```

With it installed, ⤢ View runs `code --open-url vscode://darkhan-amanbek.mermaid-viewer/open?path=<page>` and the extension shows the page in a webview panel. VS Code asks once whether the extension may open the URI; tick "Do not ask me again". The extension opens only pages under `<os temp dir>/mermaid-render/`.

Without the extension, the page opens with `open` on macOS, `xdg-open` on Linux and `start` on Windows; when none starts, a toast names the file.

In the chat itself the diagram draws at its own size: a small diagram is never stretched to the width of the chat. The terminal keeps its box-drawing text and has no button.

## Supported diagrams

Flowcharts (`graph` / `flowchart`), sequence diagrams, state diagrams, class diagrams and ER diagrams. Rendering comes from [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) 1.1.3, vendored in `renderer/`.

## When a diagram is not drawn

The block stays the code block it is today when any of these holds:

- the diagram type is one beautiful-mermaid does not draw (pie, gantt, mindmap, gitGraph and others), or the source does not parse;
- the fence is still streaming and has not closed yet;
- in the terminal, the drawing is wider than the window;
- the SVG would be over 131072 characters, or would reference anything outside itself;
- no JavaScript runtime could start.

Text written between two tool calls is often drawn as a summary of itself, and a summary holds no fence, so a diagram shows reliably only in the text that ends a reply.

## Install

This repository is its own plugin marketplace.

```bash
claude plugin marketplace add darkhan-amanbek/mermaid-render
```

```bash
claude plugin install mermaid-render@darkhan-amanbek --scope user
```

If the upstream `mermaid-render@mermaid-render` is installed, uninstall it first: two mods drawing the same message would race.

A user-scope install loads in every new terminal session and in the desktop app's Code tab.

## Requirements

Mods (function-hooks plugins) need a recent Claude Code. The upstream mod was built and tested on Claude Code 2.1.310; this fork on 2.1.314 (the VS Code extension of the same version).

The renderer runs as a separate process, because its bundle is larger than a hooks module may import. It needs `node` (or `bun`) on the machine. The mod tries `node`, `/opt/homebrew/bin/node`, `/usr/local/bin/node`, `bun` and `/opt/homebrew/bin/bun`, in that order, and uses the first that starts. When none starts, every diagram stays code and one line goes to the debug log (`claude --debug`).

## What it runs and sends

- When a finished reply holds a closed mermaid block, the mod starts `node` (or `bun`) on your machine with this plugin's `renderer/render.mjs`. It writes the diagram sources to the process as JSON on stdin and reads SVG or text back from stdout. One process draws every new diagram in a reply.
- To find a runtime, it runs each candidate with `--version` until one starts. It does this once per session.
- A diagram already drawn comes from an in-memory cache of up to 256 entries. The cache is gone when Claude Code exits.
- The renderer makes no network requests, reads no files besides its own code, and writes nothing to disk. Nothing leaves your machine.
- The only write to disk is the **⤢ View** button, which saves that one diagram's SVG and viewer page under `$TMPDIR/mermaid-render/` before opening the page.
- beautiful-mermaid's SVG asks for Google Fonts through a CSS `@import`. The renderer strips that line, and it throws away any SVG that still references a URL other than the SVG namespace, so a drawn diagram never fetches anything.

## Vendored code

`renderer/beautiful-mermaid.mjs` holds beautiful-mermaid 1.1.3 and its dependencies elkjs 0.11.1 and entities 7.0.1, all from npm, bundled unminified into one file by `scripts/vendor.sh`. It is not edited by hand. With bun 1.4.4, `scripts/vendor.sh` rebuilds it byte for byte, so `git status` stays clean afterwards.

Most of the file reads as plain JavaScript. The elkjs part is elkjs's own published build, which is compiled from Java and is hard to read in any form. elkjs can start a Web Worker when it is given a worker URL. beautiful-mermaid never gives one, so layout runs inside the renderer process.

## Development

- `claude plugin test .` runs the hook and parser tests.
- `hooks/viewer-page.ts` holds the viewer page: its CSS and script are plain strings, with no build step.
- `node renderer/render.check.mjs` runs the real renderer over a batch of diagrams.
- `scripts/vendor.sh` rebuilds `renderer/beautiful-mermaid.mjs` from the pinned npm release, with its license files.

## License

MIT, as upstream. Copyright of the original code belongs to ceyeoh. The vendored bundle includes beautiful-mermaid (MIT, `renderer/LICENSE-beautiful-mermaid`), elkjs (EPL-2.0, `renderer/LICENSE-elkjs`) and entities (BSD-2-Clause, `renderer/LICENSE-entities`).
