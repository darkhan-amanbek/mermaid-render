import type { EngineInterface, Register, RenderElement, RenderInput, RenderSurface, RenderViewport } from 'claude-code'
import { parseSegments, type Segment } from './segments'
import { diagramId, sizeOf, type Size } from './view'
import { viewerPage } from './viewer-page'

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

// What opens the viewer page when the VS Code extension is not installed: the OS's default browser.
const OPENERS: readonly (readonly string[])[] = [['open'], ['xdg-open'], ['cmd', '/c', 'start', '']]
const OPEN_TIMEOUT_MS = 10_000
// The companion VS Code extension (vscode-extension/ in this repository) shows the page in a tab
// inside VS Code. It is reached through VS Code's CLI, by the first of these that starts.
const CODE_CLIS = ['code', '/opt/homebrew/bin/code', '/usr/local/bin/code']
const VIEWER_EXTENSION = 'darkhan-amanbek.mermaid-viewer'
const viewerUrl = (page: string) => `vscode://${VIEWER_EXTENSION}/open?path=${encodeURIComponent(page)}`

const cache = new Map<string, Promise<Rendered>>()
let runtime: Promise<string | undefined> | undefined
let hasLoggedNoRuntime = false
let codeWithViewer: Promise<string | undefined> | undefined

// The `code` CLI that has the viewer extension installed, found once per session; undefined when none.
function findCodeWithViewer($: EngineInterface): Promise<string | undefined> {
  codeWithViewer ??= (async () => {
    for (const candidate of CODE_CLIS) {
      try {
        const { exitCode, stdout } = await $.process.run([candidate, '--list-extensions'], { timeoutMs: OPEN_TIMEOUT_MS })
        if (exitCode === 0) return stdout.toLowerCase().includes(VIEWER_EXTENSION) ? candidate : undefined
      } catch {}
    }
    return undefined
  })()
  return codeWithViewer
}

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

// What the model is told about diagrams, as a section at the end of the system prompt: when a
// picture earns its place, which kinds draw, and that a diagram is an insert within prose.
export const DIAGRAM_GUIDANCE = `# Diagrams

A fenced \`\`\`mermaid block in your reply is drawn as a picture in the chat, with a ⛶ button that opens it large with zoom. Use that where a picture says more than prose: a flow with branches, a sequence of calls between services, a state machine, a data model. Most replies need no diagram; one that does usually needs exactly one.

Rules:
- A diagram is an insert within an ordinary markdown reply, never its container. Headings, lists, explanations and code stay as markdown text around it; node labels hold a few words, not sentences.
- Only these kinds are drawn: flowchart / graph, sequenceDiagram, stateDiagram-v2, classDiagram, erDiagram. Any other kind (pie, gantt, mindmap, gitGraph, timeline, ...) stays a code block, so do not write one.
- Keep a diagram small enough to read at a glance: about 15 nodes or 12 messages at most. A bigger picture becomes two or three diagrams, each introduced by a sentence.
- Prefer a table or a sentence where it says the same thing; prefer flowchart LR for short chains and TD for deep trees.
- Write the block only once it is complete; a diagram that fails to parse stays a code block.`

export const register: Register = on => {
  on('prompt.compose', async ($, e, next) => {
    const { sections } = await next(e)
    return { sections: [...sections, { id: 'mermaid-render:diagrams', text: DIAGRAM_GUIDANCE, scope: 'session' }] }
  })

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
}

// Writes the viewer page beside a copy of the SVG and opens it: in a VS Code tab when the
// viewer extension is installed, else in the browser. Either way a trackpad pinch, the wheel
// and a drag move the picture.
async function openViewer($: EngineInterface, diagram: Diagram): Promise<void> {
  const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/[\\/]+$/, '')
  const dir = `${tmp}/mermaid-render`
  const page = `${dir}/${diagram.id}.html`
  await $.fs.write(`${dir}/${diagram.id}.svg`, diagram.output)
  await $.fs.write(page, viewerPage({ alt: diagram.alt, svg: diagram.output, source: diagram.source }))
  const code = await findCodeWithViewer($)
  if (code !== undefined) {
    try {
      const { exitCode } = await $.process.run([code, '--open-url', viewerUrl(page)], { timeoutMs: OPEN_TIMEOUT_MS })
      if (exitCode === 0) return
    } catch {}
  }
  for (const opener of OPENERS) {
    try {
      const { exitCode } = await $.process.run([...opener, page], { timeoutMs: OPEN_TIMEOUT_MS })
      if (exitCode === 0) return
    } catch {}
  }
  $.ui.toast(`Could not open a browser; the viewer is at ${page}`)
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
          <Button key={`view:${id}:${index}`} label="⛶" onPress={() => openViewer($, diagram)} />
        </Box>
      </Box>
    )
  }
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
