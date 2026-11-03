# mermaid-render

A Claude Code mod that draws mermaid diagrams in assistant replies. When a reply holds a closed fenced code block whose language is `mermaid`, the block is drawn as a picture instead of as code.

This is a fork of [ceyeoh/mermaid-render](https://github.com/ceyeoh/mermaid-render) that adds a toolbar under every drawn diagram: zoom in and out, natural size, fit to width, a toggle that shows the mermaid source, and a button that opens the SVG in VS Code (or your OS's default viewer).

- In the desktop app, VS Code and the mobile app, the diagram is an SVG. Its colors follow the light or dark color scheme.
- In the terminal, the diagram is drawn with Unicode box-drawing characters.

## The toolbar

Under each diagram, on the desktop app, VS Code and mobile:

- **−** / **+** step the zoom through 50%, 67%, 80%, 100%, 125%, 150%, 200% and 300% of the drawing's own size. The current zoom shows between them.
- **1:1** returns to the drawing's own size, which is also the default. A small diagram is never stretched to the width of the chat.
- **Fit** lets the surface size the drawing to its slot.
- **Source** shows the mermaid text under the picture; press again to hide it.
- **Open** writes the SVG to `$TMPDIR/mermaid-render/<id>.svg` and opens it with `code --reuse-window`, falling back to `open` (macOS) or `xdg-open` (Linux). When nothing could open it, a toast names the file.

The zoom and the source toggle of each diagram are kept for the session, so a diagram you zoomed stays zoomed when the message is drawn again. The terminal keeps its box-drawing text and has no toolbar.

VS Code draws an SVG as an image, so hover and tooltips inside the picture do not work there; the desktop app draws it in a sandboxed frame where they do.

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
- The only write to disk is the **Open** button, which saves that one SVG under `$TMPDIR/mermaid-render/` before opening it.
- beautiful-mermaid's SVG asks for Google Fonts through a CSS `@import`. The renderer strips that line, and it throws away any SVG that still references a URL other than the SVG namespace, so a drawn diagram never fetches anything.

## Vendored code

`renderer/beautiful-mermaid.mjs` holds beautiful-mermaid 1.1.3 and its dependencies elkjs 0.11.1 and entities 7.0.1, all from npm, bundled unminified into one file by `scripts/vendor.sh`. It is not edited by hand. With bun 1.4.4, `scripts/vendor.sh` rebuilds it byte for byte, so `git status` stays clean afterwards.

Most of the file reads as plain JavaScript. The elkjs part is elkjs's own published build, which is compiled from Java and is hard to read in any form. elkjs can start a Web Worker when it is given a worker URL. beautiful-mermaid never gives one, so layout runs inside the renderer process.

## Development

- `claude plugin test .` runs the hook and parser tests.
- `node renderer/render.check.mjs` runs the real renderer over a batch of diagrams.
- `scripts/vendor.sh` rebuilds `renderer/beautiful-mermaid.mjs` from the pinned npm release, with its license files.

## License

MIT, as upstream. Copyright of the original code belongs to ceyeoh. The vendored bundle includes beautiful-mermaid (MIT, `renderer/LICENSE-beautiful-mermaid`), elkjs (EPL-2.0, `renderer/LICENSE-elkjs`) and entities (BSD-2-Clause, `renderer/LICENSE-entities`).
