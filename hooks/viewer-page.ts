// The viewer page: one HTML file holding the diagram's SVG inline, with pinch,
// wheel and drag navigation, that the browser opens. Nothing on it is fetched:
// no scripts, styles or fonts from the network.

const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

const STYLE = `
  /* Inside a VS Code webview the theme arrives as --vscode-* variables, which the page follows:
     editor colors, the button colors, the UI and editor fonts. In a browser those are unset and
     the fallbacks apply, light or dark after the system. */
  :root {
    color-scheme: light dark;
    --page-bg: var(--vscode-editor-background, #ffffff);
    --page-fg: var(--vscode-editor-foreground, #27272a);
    --dim: var(--vscode-descriptionForeground, #71717a);
    --bar: var(--vscode-editorWidget-background, #fafafa);
    --line: var(--vscode-widget-border, var(--vscode-panel-border, #e4e4e7));
    --btn: var(--vscode-button-secondaryBackground, #f4f4f5);
    --btn-fg: var(--vscode-button-secondaryForeground, #27272a);
    --btn-h: var(--vscode-button-secondaryHoverBackground, #e4e4e7);
    --focus: var(--vscode-focusBorder, #3b82f6);
    --font: var(--vscode-font-family, system-ui, -apple-system, sans-serif);
    --font-size: var(--vscode-font-size, 13px);
    --mono: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --page-bg: var(--vscode-editor-background, #1f1f1e);
      --page-fg: var(--vscode-editor-foreground, #e8e6e3);
      --dim: var(--vscode-descriptionForeground, #a1a1aa);
      --bar: var(--vscode-editorWidget-background, #262625);
      --line: var(--vscode-widget-border, var(--vscode-panel-border, #3f3f46));
      --btn: var(--vscode-button-secondaryBackground, #2a2a29);
      --btn-fg: var(--vscode-button-secondaryForeground, #e8e6e3);
      --btn-h: var(--vscode-button-secondaryHoverBackground, #3a3a39);
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; overflow: hidden; background: var(--page-bg); color: var(--page-fg); font: var(--font-size)/1.4 var(--font); }
  #bar { position: fixed; top: 0; left: 0; right: 0; display: flex; gap: 6px; align-items: center; padding: 8px 12px; background: var(--bar); border-bottom: 1px solid var(--line); z-index: 2; flex-wrap: wrap; }
  #bar b { margin-right: auto; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40vw; }
  button { font: inherit; color: var(--btn-fg); background: var(--btn); border: 1px solid transparent; border-radius: 4px; padding: 4px 10px; cursor: pointer; }
  button:hover { background: var(--btn-h); }
  button:focus-visible { outline: 1px solid var(--focus); outline-offset: 1px; }
  #zoom { min-width: 4.5em; text-align: center; font-variant-numeric: tabular-nums; color: var(--dim); }
  #stage { position: absolute; inset: 0; cursor: grab; touch-action: none; overflow: hidden; }
  #stage.dragging { cursor: grabbing; }
  /* The zoom sets the SVG's own width and height, so the browser draws the vectors afresh at
     every scale; a CSS transform would scale a bitmap of the picture and blur it. */
  #canvas { position: absolute; left: 0; top: 0; }
  #canvas svg { display: block; --bg: var(--page-bg); --fg: var(--page-fg); }
  #source { position: fixed; left: 0; right: 0; bottom: 0; max-height: 40vh; overflow: auto; margin: 0; padding: 12px 16px; background: var(--bar); border-top: 1px solid var(--line); font: 12px/1.5 var(--mono); white-space: pre; display: none; z-index: 2; }
  #source.shown { display: block; }
  #hint { position: fixed; right: 12px; bottom: 10px; color: var(--dim); font-size: 12px; pointer-events: none; z-index: 1; }
`

const SCRIPT = `
  const stage = document.getElementById('stage')
  const canvas = document.getElementById('canvas')
  const svg = canvas.querySelector('svg')
  const zoomLabel = document.getElementById('zoom')
  const source = document.getElementById('source')
  const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null
  const MIN = 0.1, MAX = 20
  let scale = 1, x = 0, y = 0

  const natural = () => {
    if (natural.size) return natural.size
    const box = svg.viewBox && svg.viewBox.baseVal
    const w = parseFloat(svg.getAttribute('width')) || (box && box.width) || svg.getBoundingClientRect().width || 1
    const h = parseFloat(svg.getAttribute('height')) || (box && box.height) || svg.getBoundingClientRect().height || 1
    if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h)
    natural.size = { w, h }
    return natural.size
  }
  const room = () => {
    const bar = document.getElementById('bar').getBoundingClientRect().height
    const src = source.classList.contains('shown') ? source.getBoundingClientRect().height : 0
    return { top: bar, w: innerWidth, h: innerHeight - bar - src }
  }
  const base = natural()
  svg.setAttribute('preserveAspectRatio', 'xMinYMin meet')
  const apply = () => {
    svg.setAttribute('width', String(base.w * scale))
    svg.setAttribute('height', String(base.h * scale))
    canvas.style.transform = 'translate(' + x + 'px,' + y + 'px)'
    zoomLabel.textContent = Math.round(scale * 100) + '%'
  }
  const center = (s) => {
    const { w, h } = natural(), r = room()
    scale = Math.min(MAX, Math.max(MIN, s))
    x = (r.w - w * scale) / 2
    y = r.top + Math.max(16, (r.h - h * scale) / 2)
    apply()
  }
  const fit = () => {
    const { w, h } = natural(), r = room()
    center(Math.min((r.w - 32) / w, (r.h - 32) / h))
  }
  const zoomAt = (factor, cx, cy) => {
    const next = Math.min(MAX, Math.max(MIN, scale * factor))
    const k = next / scale
    x = cx - (cx - x) * k
    y = cy - (cy - y) * k
    scale = next
    apply()
  }
  const zoomCenter = (factor) => { const r = room(); zoomAt(factor, r.w / 2, r.top + r.h / 2) }

  // A trackpad pinch arrives as a wheel event with ctrlKey (Chrome, Edge, Firefox);
  // two-finger scroll pans; cmd/ctrl + wheel on a mouse zooms too.
  stage.addEventListener('wheel', (e) => {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002))
      zoomAt(factor, e.clientX, e.clientY)
    } else {
      x -= e.deltaX
      y -= e.deltaY
      apply()
    }
  }, { passive: false })

  // Safari reports a pinch as gesture events instead.
  let gestureScale = 1
  stage.addEventListener('gesturestart', (e) => { e.preventDefault(); gestureScale = 1 })
  stage.addEventListener('gesturechange', (e) => {
    e.preventDefault()
    zoomAt(e.scale / gestureScale, e.clientX, e.clientY)
    gestureScale = e.scale
  })
  stage.addEventListener('gestureend', (e) => e.preventDefault())

  // Drag to pan; pointer events cover mouse, trackpad and touch alike.
  let drag = null
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    drag = { px: e.clientX, py: e.clientY, x, y }
    stage.setPointerCapture(e.pointerId)
    stage.classList.add('dragging')
  })
  stage.addEventListener('pointermove', (e) => {
    if (drag === null) return
    x = drag.x + (e.clientX - drag.px)
    y = drag.y + (e.clientY - drag.py)
    apply()
  })
  const endDrag = () => { drag = null; stage.classList.remove('dragging') }
  stage.addEventListener('pointerup', endDrag)
  stage.addEventListener('pointercancel', endDrag)
  stage.addEventListener('dblclick', (e) => {
    if (Math.abs(scale - 1) < 0.01) fit(); else center(1)
  })

  const act = {
    in: () => zoomCenter(1.25),
    out: () => zoomCenter(0.8),
    natural: () => center(1),
    fit,
    source: () => { source.classList.toggle('shown'); fit() },
    copy: () => vscodeApi ? vscodeApi.postMessage({ type: 'copy', text: source.textContent }) : navigator.clipboard.writeText(source.textContent),
    save: () => {
      const markup = new XMLSerializer().serializeToString(svg)
      if (vscodeApi) return vscodeApi.postMessage({ type: 'save', svg: markup })
      const a = document.createElement('a')
      a.href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup)
      a.download = 'diagram.svg'
      a.click()
    },
  }
  document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act[b.dataset.act]()))
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey) return
    if (e.key === '+' || e.key === '=') act.in()
    else if (e.key === '-') act.out()
    else if (e.key === '0') act.fit()
    else if (e.key === '1') act.natural()
    else if (e.key === 's') act.source()
    else if (e.key === 'Escape' && source.classList.contains('shown')) act.source()
  })
  addEventListener('resize', fit)

  const { w, h } = natural(), r = room()
  if (w <= r.w - 32 && h <= r.h - 32) center(1); else fit()
`

export function viewerPage({ alt, svg, source }: { alt: string; svg: string; source: string }): string {
  const title = escapeHtml(alt)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<div id="bar">
  <b title="${title}">${title}</b>
  <button data-act="out" title="Zoom out (−)">−</button>
  <span id="zoom">100%</span>
  <button data-act="in" title="Zoom in (+)">+</button>
  <button data-act="natural" title="Natural size (1)">1:1</button>
  <button data-act="fit" title="Fit to window (0)">Fit</button>
  <button data-act="source" title="Show the mermaid source (s)">Source</button>
  <button data-act="copy" title="Copy the mermaid source">Copy</button>
  <button data-act="save" title="Save the SVG">Download</button>
</div>
<div id="stage"><div id="canvas">${svg}</div></div>
<pre id="source">${escapeHtml(source)}</pre>
<div id="hint">pinch or ⌘ + scroll to zoom · scroll or drag to pan · double-click to fit</div>
<script>${SCRIPT}</script>
</body>
</html>
`
}
