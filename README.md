# mermaid-render

A Claude Code mod that draws mermaid diagrams in assistant replies. When a reply holds a closed fenced code block whose language is `mermaid`, the block is drawn as a picture instead of as code.

This is a fork of [ceyeoh/mermaid-render](https://github.com/ceyeoh/mermaid-render) that adds a viewer: one button under every drawn diagram opens it in the browser with trackpad pinch-zoom, wheel zoom, drag to pan, the mermaid source and a download.

- In the desktop app, VS Code and the mobile app, the diagram is an SVG. Its colors follow the light or dark color scheme.
- In the terminal, the diagram is drawn with Unicode box-drawing characters.

## The diagram tool: a picture between paragraphs

The mod registers a tool, `mcp__mermaid-render__diagram`, that takes a mermaid `source` and an optional `caption`. Claude calls it where a picture belongs; the call's row in the transcript is drawn as the picture, with the ⛶ button and the caption under it, and the text before and after the call stays the chat's own markdown. That is the way to get a diagram as an insert: a ```mermaid fence in a reply is drawn too, but the whole message block is then one drawing of the mod's, which VS Code frames and labels "From the mermaid-render plugin".

The tool runs nothing and changes nothing, so the mod answers its permission check with allow. Its result tells the model whether the source drew, with the parse error when it did not. A diagram call that lands in a folded run of tool calls unfolds that run, so the picture shows.

## The viewer

Under each drawn diagram there is one small button, **⛶** (as VS Code marks "maximize"). It writes the diagram to `$TMPDIR/mermaid-render/<id>.html` (with the SVG beside it) and opens that page: in a tab inside VS Code when the companion extension is installed (below), else in your default browser. The page holds the SVG inline and fetches nothing. On it:

- a trackpad **pinch**, or **⌘ / Ctrl + scroll**, zooms around the pointer; a two-finger **scroll** or a **drag** pans;
- **−** / **+**, **1:1** and **Fit** on the toolbar, and the keys `-`, `+`, `1`, `0`; a **double-click** toggles between fit and natural size. The zoom sets the SVG's own size, so the picture is redrawn from its vectors at every scale and stays sharp;
- **Source** (key `s`) shows the mermaid text, **Copy** copies it, **Download** saves the SVG;
- inside VS Code the page takes the editor's colors, button colors and fonts from the current theme; in a browser it follows the system's light or dark scheme.

### Inside VS Code

The Claude Code extension draws an SVG as a static image and passes no wheel or pinch to a mod, and the mods API has no modal dialog of its own, so the viewer is a page. To have it open as a tab beside the chat, install the small companion extension from [`vscode-extension/`](vscode-extension/):

```bash
code --install-extension vscode-extension/mermaid-viewer-0.5.0.vsix
```

With it installed, ⛶ runs `code --open-url vscode://darkhan-amanbek.mermaid-viewer/open?path=<page>` and the extension shows the page in a webview panel. VS Code asks once whether the extension may open the URI; tick "Do not ask me again". The extension opens only pages under `<os temp dir>/mermaid-render/`.

Without the extension, the page opens with `open` on macOS, `xdg-open` on Linux and `start` on Windows; when none starts, a toast names the file.

In the chat itself the diagram draws at its own size: a small diagram is never stretched to the width of the chat. The terminal keeps its box-drawing text and has no button.

## What the model is told

The mod adds one section to the end of the system prompt, `mermaid-render:diagrams`, so that Claude reaches for the diagram tool and uses it well: where a picture says more than prose, only the kinds this mod draws, a few words per node, about 15 nodes at most, and always as an insert within an ordinary markdown reply rather than as the whole answer. The text is `DIAGRAM_GUIDANCE` in `hooks/register.tsx`; edit it there to change the house style. In a session under a Team or Enterprise login, Claude Code's built-in guard passes the prompt events over user-installed mods, so the section does not reach the model there; put the same rules in `~/.claude/CLAUDE.md` instead. The tool's own description reaches the model either way.

## The frame around a reply

In VS Code a reply that holds a diagram is drawn inside a frame labelled "From the mermaid-render plugin". That frame is the chat's own mark for a message a plugin drew, not something the mod adds, and the mods API has no way to leave it out: the whole message block is one drawing site, so the mod has to draw the text around the diagram too.

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
- The only write to disk is the **⛶** button, which saves that one diagram's SVG and viewer page under `$TMPDIR/mermaid-render/` before opening the page.
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
