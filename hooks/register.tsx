import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput, RenderSurface, RenderViewport } from 'claude-code'
import { parseSegments, type Segment } from './segments'
import { FIT, diagramId, sizeOf, zoomIn, zoomLabel, zoomOut, type Size } from './view'
import type { View, Viewer } from '../types'

type Format = 'svg' | 'ascii'
type Rendered = { ok: true; output: string } | { ok: false; reason: string }
type Diagram = { kind: 'diagram'; id: string; index: number; source: string; output: string; alt: string; size: Size | undefined }
type Block = { kind: 'markdown'; text: string } | Diagram

const FORMAT_BY_SURFACE = {
  desktop: 'svg',
  vscode: 'svg',
  mobile: 'svg',
  terminal: 'ascii',
} as const satisfies Record<RenderSurface, Format>

const widestLine = (text: string) => Math.max(...text.split('\n').map(line => [...line].length))

const FITS: Record<Format, (output: string, viewport: RenderViewport | undefined) => boolean> = {
  svg: () => true,
  ascii: (output, viewport) => viewport === undefined || widestLine(output) <= viewport.columns,
}

// The renderer runs out of process: its bundle (beautiful-mermaid with elkjs) is 3.4 MB,
// and the hooks module may not import a file over 1 MiB.
const RENDERER = 'renderer/render.mjs'
const RUNTIMES = ['node', '/opt/homebrew/bin/node', '/usr/local/bin/node', 'bun', '/opt/homebrew/bin/bun']
const RENDER_TIMEOUT_MS = 20_000
const CACHE_LIMIT = 256

// What "Open" tries, in order: VS Code's CLI, then the OS's default opener.
const OPENERS: readonly (readonly string[])[] = [
  ['code', '--reuse-window'],
  ['/opt/homebrew/bin/code', '--reuse-window'],
  ['/usr/local/bin/code', '--reuse-window'],
  ['open'],
  ['xdg-open'],
]
const OPEN_TIMEOUT_MS = 10_000

const DEFAULT_VIEW: View = { zoom: 1, showSource: false }
const VIEWER = 'mermaid-viewer'

// Per-diagram view state, keyed by the diagram's id, kept for the session so a
// zoomed diagram stays zoomed across redraws and reloads of this module.
const views = atom({ plugin: 'mermaid-render', key: 'views' } as const, {}, { shape: 'views-1' })
// The diagram the viewer pane shows, null while it shows nothing.
const viewer = atom({ plugin: 'mermaid-render', key: 'viewer' } as const, null, { shape: 'viewer-1' })

const cache = new Map<string, Promise<Rendered>>()
let runtime: Promise<string | undefined> | undefined
let hasLoggedNoRuntime = false

function findRuntime($: EngineInterface): Promise<string | undefined> {
  runtime ??= (async () => {
    for (const candidate of RUNTIMES) {
      try {
        await $.process.run([candidate, '--version'], { timeoutMs: 5_000 })
        return candidate
      } catch {}
    }
    // A run can also reject because its dispatch was abandoned, so a miss is retried on the next draw.
    runtime = undefined
    if (!hasLoggedNoRuntime) {
      hasLoggedNoRuntime = true
      $.ui.log(`no node or bun could start (tried ${RUNTIMES.join(', ')}); mermaid fences stay code`, { to: 'debug' })
    }
    return undefined
  })()
  return runtime
}

function parseRendered(stdout: string, count: number): Rendered[] {
  const parsed: unknown = JSON.parse(stdout)
  const isRendered = (value: unknown): value is Rendered =>
    typeof value === 'object' &&
    value !== null &&
    (('ok' in value && value.ok === true && 'output' in value && typeof value.output === 'string') ||
      ('ok' in value && value.ok === false && 'reason' in value && typeof value.reason === 'string'))
  if (!Array.isArray(parsed) || parsed.length !== count || !parsed.every(isRendered)) {
    throw new Error(`renderer answered ${stdout.slice(0, 80)}`)
  }
  return parsed
}

async function runRenderer($: EngineInterface, format: Format, sources: string[]): Promise<Rendered[]> {
  const argv0 = await findRuntime($)
  if (argv0 === undefined) throw new Error('no runtime')
  const { exitCode, stdout, stderr } = await $.process.run([argv0, `${$.plugin.root}/${RENDERER}`], {
    stdin: JSON.stringify({ format, sources }),
    timeoutMs: RENDER_TIMEOUT_MS,
  })
  if (exitCode !== 0) throw new Error(`renderer exited ${exitCode}: ${stderr.slice(0, 200)}`)
  return parseRendered(stdout, sources.length)
}

function remember(key: string, rendered: Promise<Rendered>): void {
  cache.set(key, rendered)
  for (const oldest of cache.keys()) {
    if (cache.size <= CACHE_LIMIT) break
    cache.delete(oldest)
  }
}

function renderAll($: EngineInterface, format: Format, sources: string[]): Promise<Rendered[]> {
  const keyOf = (source: string) => `${format}\0${source}`
  const missing = [...new Set(sources)].filter(source => !cache.has(keyOf(source)))
  if (missing.length > 0) {
    const batch = runRenderer($, format, missing).then(
      results => ({ isTransportFailure: false, results }),
      (error: unknown) => ({
        isTransportFailure: true,
        results: missing.map((): Rendered => ({ ok: false, reason: String(error) })),
      }),
    )
    missing.forEach((source, index) => {
      const key = keyOf(source)
      const rendered = batch.then(({ isTransportFailure, results }) => {
        if (isTransportFailure && cache.get(key) === rendered) cache.delete(key)
        return results[index] ?? { ok: false as const, reason: 'missing result' }
      })
      remember(key, rendered)
    })
  }
  return Promise.all(
    sources.map(source => cache.get(keyOf(source)) ?? Promise.resolve({ ok: false as const, reason: 'evicted' })),
  )
}

function toBlocks(segments: Segment[], rendered: Rendered[]): Block[] {
  const blocks: Block[] = []
  let diagramIndex = 0
  const pushMarkdown = (text: string) => {
    const last = blocks.at(-1)
    if (last?.kind !== 'markdown') blocks.push({ kind: 'markdown', text })
    else last.text += (last.text.endsWith('\n') || text.startsWith('\n') ? '' : '\n') + text
  }
  for (const segment of segments) {
    if (segment.kind === 'markdown') {
      pushMarkdown(segment.text)
      continue
    }
    const index = diagramIndex++
    const result = rendered[index]
    if (result?.ok === true) {
      const alt = segment.source.trim().split('\n')[0]?.trim() || 'mermaid diagram'
      blocks.push({
        kind: 'diagram',
        id: diagramId(segment.source),
        index,
        source: segment.source,
        output: result.output,
        alt,
        size: sizeOf(result.output),
      })
    } else {
      pushMarkdown(segment.fence)
    }
  }
  return blocks
}

export const register: Register = on => {
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary === true) return next(e)
    const segments = parseSegments(e.props.text)
    const sources = segments.flatMap(segment => (segment.kind === 'mermaid' ? [segment.source] : []))
    if (sources.length === 0) return next(e)

    const format = FORMAT_BY_SURFACE[e.surface]
    const fitting = (result: Rendered): Rendered =>
      result.ok && !FITS[format](result.output, e.viewport) ? { ok: false, reason: 'too wide' } : result
    const blocks = toBlocks(segments, (await renderAll($, format, sources)).map(fitting))
    if (blocks.every(block => block.kind === 'markdown')) return next(e)

    return drawBlocks($, e, blocks)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: VIEWER }, async ($, e) => {
    const shown = await read($, viewer)
    const viewed = await read($, views)
    return drawViewer($, e, shown, viewed)
  })
}

async function openViewer($: EngineInterface, diagram: Diagram): Promise<void> {
  const { id, source, output, alt } = diagram
  await update($, viewer, () => ({ id, source, output, alt }))
  await $.ui.open({ id: VIEWER, title: alt, focus: true, closeOnEscape: true })
}

async function setView($: EngineInterface, id: string, change: (view: View) => View): Promise<void> {
  await update($, views, all => ({ ...all, [id]: change(all[id] ?? DEFAULT_VIEW) }))
}

// Writes the SVG to a temp file and hands it to VS Code, or to the OS's opener.
async function openOutside($: EngineInterface, diagram: Viewer): Promise<void> {
  const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/[\\/]+$/, '')
  const path = `${tmp}/mermaid-render/${diagram.id}.svg`
  await $.fs.write(path, diagram.output)
  for (const opener of OPENERS) {
    try {
      const { exitCode } = await $.process.run([...opener, path], { timeoutMs: OPEN_TIMEOUT_MS })
      if (exitCode === 0) return
    } catch {}
  }
  $.ui.toast(`Diagram saved to ${path}`)
}

function diagramDrawer($: EngineInterface, e: RenderInput<'AssistantMessage'>): (diagram: Diagram) => RenderElement {
  if (e.surface === 'terminal') {
    const { Code } = $.ui.resolve(e)
    return ({ output }) => <Code source={output} wrap="truncate-end" />
  }
  const { Box, Button, Svg } = $.ui.resolve(e)
  return diagram => {
    const { id, index, output, alt, size } = diagram
    const natural = size === undefined ? {} : { width: size.width, height: size.height }
    return (
      <Box flexDirection="column">
        <Svg source={output} alt={alt} isInteractive={e.surface === 'desktop'} {...natural} />
        <Box flexDirection="row">
          <Button key={`view:${id}:${index}`} onPress={() => openViewer($, diagram)}>
            ⤢ View
          </Button>
        </Box>
      </Box>
    )
  }
}

// The viewer pane: one diagram large, with zoom, its source and a way to save it.
function drawViewer(
  $: EngineInterface,
  e: RenderInput<'Pane'>,
  shown: Viewer | null,
  viewed: Record<string, View>,
): RenderElement {
  const { Box, Text, Button } = $.ui.resolve(e)
  if (shown === null) {
    return (
      <Box padding={1}>
        <Text dimColor>Press ⤢ View under a diagram to show it here.</Text>
      </Box>
    )
  }
  const { id, source, output, alt } = shown
  const view = viewed[id] ?? DEFAULT_VIEW
  const zoom = (change: (zoom: number) => number) => () => setView($, id, v => ({ ...v, zoom: change(v.zoom) }))
  const { Code } = $.ui.resolve(e)
  const picture = (() => {
    if (e.surface === 'terminal') return <Code source={source} language="mermaid" />
    const { Svg } = $.ui.resolve(e)
    const size = sizeOf(output)
    const scaled = view.zoom !== FIT && size !== undefined ? { width: size.width * view.zoom, height: size.height * view.zoom } : {}
    return <Svg source={output} alt={alt} isInteractive={e.surface === 'desktop'} {...scaled} />
  })()
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Button key="zoom-out" onPress={zoom(zoomOut)}>−</Button>
        <Text dimColor>{zoomLabel(view.zoom)}</Text>
        <Button key="zoom-in" onPress={zoom(zoomIn)}>+</Button>
        <Button key="zoom-reset" onPress={zoom(() => 1)}>1:1</Button>
        <Button key="zoom-fit" onPress={zoom(() => FIT)}>Fit</Button>
        <Button key="source" onPress={() => setView($, id, v => ({ ...v, showSource: !v.showSource }))}>
          {view.showSource ? 'Hide source' : 'Source'}
        </Button>
        <Button key="save" onPress={() => openOutside($, shown)}>Open as file</Button>
        <Button key="close" role="dismiss" onPress={() => $.ui.close({ id: VIEWER })}>Close</Button>
      </Box>
      {picture}
      {view.showSource && <Code source={source} language="mermaid" />}
    </Box>
  )
}

function drawBlocks($: EngineInterface, e: RenderInput<'AssistantMessage'>, blocks: Block[]): RenderElement {
  const { Box, Markdown } = $.ui.resolve(e)
  const drawDiagram = diagramDrawer($, e)
  const body = (
    <Box flexDirection="column" gap={1}>
      {blocks.map(block => (block.kind === 'markdown' ? <Markdown text={block.text} /> : drawDiagram(block)))}
    </Box>
  )
  if (e.surface !== 'terminal') return body
  // The terminal's reply bullet and gutter belong to the component this tree replaces.
  const { Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="row">
      <Text>{e.props.isFirstOfReply ? '⏺ ' : '  '}</Text>
      {body}
    </Box>
  )
}
