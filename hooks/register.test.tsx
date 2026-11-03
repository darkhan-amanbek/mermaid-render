import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { diagramId } from './view'

const FLOW = 'graph TD\n  A --> B'
const SEQUENCE = 'sequenceDiagram\n  A->>B: hi'
const PIE = 'pie title Pets\n  "Dogs" : 3'
const fence = (source: string) => '```mermaid\n' + source + '\n```'
const svgOf = (source: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><title>${source.length}</title></svg>`
const asciiOf = (source: string) => `┌──┐\n│${source.split('\n')[0]}│\n└──┘`

type Renderer = { renderCalls: string[][]; logs: string[]; opened: string[][] }

function fakeRenderer(on: On, { startable = ['node'], failFirstRender = false, openers = [] as string[] } = {}): Renderer {
  const renderer: Renderer = { renderCalls: [], logs: [], opened: [] }
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('ui.log', (_, e) => {
    renderer.logs.push(e.text)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    const [argv0 = '', script = ''] = e.argv
    const ok = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
    if (openers.includes(argv0)) {
      renderer.opened.push([...e.argv])
      return { value: { ...ok, stdout: '' } }
    }
    if (!startable.includes(argv0)) return { deny: `${argv0}: not found` }
    if (script === '--version') return { value: { ...ok, stdout: 'v26.0.0\n' } }

    const { format, sources } = JSON.parse(e.init?.stdin ?? '{}') as { format: string; sources: string[] }
    renderer.renderCalls.push(sources)
    if (failFirstRender && renderer.renderCalls.length === 1) return { deny: 'renderer timed out' }
    const results = sources.map(source =>
      source.startsWith('pie')
        ? { ok: false, reason: 'Invalid mermaid header' }
        : { ok: true, output: format === 'svg' ? svgOf(source) : asciiOf(source) },
    )
    return { value: { ...ok, stdout: JSON.stringify(results) } }
  })
  return renderer
}

const message = (text: string) => ({
  plugin: 'mermaid-render',
  component: 'AssistantMessage',
  props: { text, isFirstOfReply: true },
}) as const

test('on svg surfaces, text then diagram then text draws Markdown, diagram Box, Markdown in order', async ($, on) => {
  fakeRenderer(on)
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...message(`Here is the flow:\n\n${fence(FLOW)}\n\nThat is all.`), surface })
    const box = await ui.find({ type: 'Box' })
    expect(box?.children.map(child => (child as { type: string }).type)).toEqual(['Markdown', 'Box', 'Markdown'])

    const svg = await ui.find({ type: 'Svg' })
    expect(svg?.props.source).toBe(svgOf(FLOW))
    expect(svg?.props.alt).toBe('graph TD')
    expect((await ui.find({ type: 'Markdown', text: /Here is the flow/ }))?.text).not.toContain('```')
    expect(await ui.find({ type: 'Markdown', text: /That is all/ })).toBeDefined()
    await ui.unmount()
  }
})

test('on the terminal, a diagram draws as a Code holding the box-drawing text', async ($, on) => {
  fakeRenderer(on)
  const ui = await $.ui.mount({
    ...message(`Look:\n${fence(SEQUENCE)}`),
    surface: 'terminal',
    viewport: { columns: 80, rows: 24 },
  })
  const code = await ui.find({ type: 'Code' })
  expect(code?.props.source).toBe(asciiOf(SEQUENCE))
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /⏺/ }))?.text).toBe('⏺ ')
  await ui.unmount()
})

test('on a terminal narrower than the drawing, the message is the engine drawing', async ($, on) => {
  fakeRenderer(on)
  const ui = await $.ui.mount({
    ...message(`Look:\n${fence(SEQUENCE)}`),
    surface: 'terminal',
    viewport: { columns: 5, rows: 24 },
  })
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await ui.unmount()
})

test('a diagram the renderer cannot draw keeps its fence as Markdown beside one it can', async ($, on) => {
  fakeRenderer(on)
  const ui = await $.ui.mount({ ...message(`${fence(PIE)}\n\n${fence(FLOW)}`), surface: 'desktop' })
  expect((await ui.findAll({ type: 'Svg' })).map(svg => svg.props.source)).toEqual([svgOf(FLOW)])
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain(fence(PIE))
  await ui.unmount()
})

test('a message whose only diagram cannot be drawn is the engine drawing', async ($, on) => {
  fakeRenderer(on)
  const ui = await $.ui.mount({ ...message(`Pets:\n${fence(PIE)}`), surface: 'desktop' })
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await ui.unmount()
})

test('a message without mermaid is the engine drawing and runs nothing', async ($, on) => {
  const renderer = fakeRenderer(on)
  const ui = await $.ui.mount({ ...message('```js\n// mermaid\n```\nplain text'), surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(renderer.renderCalls).toEqual([])
  await ui.unmount()
})

test('a summary block is the engine drawing', async ($, on) => {
  const renderer = fakeRenderer(on)
  const ui = await $.ui.mount({
    plugin: 'mermaid-render',
    component: 'AssistantMessage',
    props: { text: fence(FLOW), isFirstOfReply: true, isSummary: true },
    surface: 'desktop',
  })
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(renderer.renderCalls).toEqual([])
  await ui.unmount()
})

test('a still-streaming, unclosed fence makes no process call', async ($, on) => {
  const renderer = fakeRenderer(on)
  const ui = await $.ui.mount({ ...message('Drawing:\n```mermaid\ngraph TD\n  A --> '), surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(renderer.renderCalls).toEqual([])
  await ui.unmount()
})

test('two diagrams in one message are rendered by exactly one process call', async ($, on) => {
  const renderer = fakeRenderer(on)
  const ui = await $.ui.mount({ ...message(`${fence(FLOW)}\nand\n${fence(SEQUENCE)}`), surface: 'desktop' })
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(2)
  expect(renderer.renderCalls).toEqual([[FLOW, SEQUENCE]])

  await ui.redraw()
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(2)
  expect(renderer.renderCalls).toHaveLength(1)
  await ui.unmount()
})

test('a failed renderer run is retried on the next redraw', async ($, on) => {
  const renderer = fakeRenderer(on, { failFirstRender: true })
  const ui = await $.ui.mount({ ...message(fence(FLOW)), surface: 'desktop' })
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()

  await ui.redraw()
  expect((await ui.find({ type: 'Svg' }))?.props.source).toBe(svgOf(FLOW))
  expect(renderer.renderCalls).toHaveLength(2)
  await ui.unmount()
})

test('the renderer starts under the first runtime found when node is not on PATH', async ($, on) => {
  const renderer = fakeRenderer(on, { startable: ['/usr/local/bin/node'] })
  const ui = await $.ui.mount({ ...message(fence(FLOW)), surface: 'desktop' })
  expect((await ui.find({ type: 'Svg' }))?.props.source).toBe(svgOf(FLOW))
  expect(renderer.logs).toEqual([])
  await ui.unmount()
})

test('with no runtime at all, diagrams stay code and one debug line says why', async ($, on) => {
  const renderer = fakeRenderer(on, { startable: [] })
  for (const source of [FLOW, SEQUENCE]) {
    const ui = await $.ui.mount({ ...message(fence(source)), surface: 'desktop' })
    expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
    await ui.unmount()
  }
  expect(renderer.renderCalls).toEqual([])
  expect(renderer.logs).toHaveLength(1)
  expect(renderer.logs[0]).toContain('no node or bun')
})

const PANE = {
  plugin: 'mermaid-render',
  component: 'Pane',
  requestId: 'mermaid-viewer',
  props: { title: 'viewer', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

/** Draws a message with the diagram and presses ⤢ View under it, as the person does to open the viewer. */
async function openViewerOf($: Engine, source: string, surface: 'desktop' | 'vscode') {
  const ui = await $.ui.mount({ ...message(fence(source)), surface })
  await ui.press({ key: `view:${diagramId(source)}:0` })
  await ui.unmount()
}

test('a diagram draws at its own size with one ⤢ View button under it', async ($, on) => {
  fakeRenderer(on)
  for (const surface of ['desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...message(fence(FLOW)), surface })
    const svg = await ui.find({ type: 'Svg' })
    expect(svg?.props.width).toBe(300)
    expect(svg?.props.height).toBe(200)
    expect((await ui.findAll({ type: 'Button' })).map(button => button.props.key)).toEqual([`view:${diagramId(FLOW)}:0`])
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    await ui.unmount()
  }
})

test('the viewer pane is empty until ⤢ View is pressed, then shows that diagram with its toolbar', async ($, on) => {
  fakeRenderer(on)
  const opened: { id: string; title?: string }[] = []
  on('ui.open', (_, e) => {
    opened.push({ id: e.id, title: e.title })
    return { value: { isPlaced: true } }
  })
  const empty = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect(await empty.find({ type: 'Text', text: /Press ⤢ View/ })).toBeDefined()
  expect(await empty.find({ type: 'Svg' })).toBeUndefined()
  await empty.unmount()

  await openViewerOf($, FLOW, 'vscode')
  expect(opened).toEqual([{ id: 'mermaid-viewer', title: 'graph TD' }])

  const pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const svg = await pane.find({ type: 'Svg' })
  expect(svg?.props.source).toBe(svgOf(FLOW))
  expect(svg?.props.width).toBe(300)
  expect(await pane.find({ type: 'Text', text: '100%' })).toBeDefined()
  for (const key of ['zoom-out', 'zoom-in', 'zoom-reset', 'zoom-fit', 'source', 'save', 'close']) {
    expect(await pane.find({ type: 'Button', key })).toBeDefined()
  }
  await pane.unmount()
})

test('in the viewer, + and − scale the Svg, 1:1 restores it, Fit leaves the size to the surface', async ($, on) => {
  fakeRenderer(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await openViewerOf($, FLOW, 'vscode')
  const pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await pane.press({ key: 'zoom-in' })
  expect((await pane.find({ type: 'Svg' }))?.props.width).toBe(375)
  expect(await pane.find({ type: 'Text', text: '125%' })).toBeDefined()
  await pane.press({ key: 'zoom-in' })
  expect((await pane.find({ type: 'Svg' }))?.props.width).toBe(450)
  await pane.press({ key: 'zoom-out' })
  expect((await pane.find({ type: 'Svg' }))?.props.width).toBe(375)
  await pane.press({ key: 'zoom-reset' })
  expect((await pane.find({ type: 'Svg' }))?.props.width).toBe(300)
  await pane.press({ key: 'zoom-fit' })
  expect((await pane.find({ type: 'Svg' }))?.props.width).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: 'fit' })).toBeDefined()
  await pane.unmount()
})

test('each diagram keeps its own zoom when the viewer switches between them', async ($, on) => {
  fakeRenderer(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await openViewerOf($, FLOW, 'desktop')
  const first = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await first.press({ key: 'zoom-in' })
  await first.unmount()

  await openViewerOf($, SEQUENCE, 'desktop')
  const second = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await second.find({ type: 'Svg' }))?.props.source).toBe(svgOf(SEQUENCE))
  expect((await second.find({ type: 'Svg' }))?.props.width).toBe(300)
  await second.unmount()

  await openViewerOf($, FLOW, 'desktop')
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await again.find({ type: 'Svg' }))?.props.width).toBe(375)
  await again.unmount()
})

test('Source shows the mermaid text under the picture and hides it again', async ($, on) => {
  fakeRenderer(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await openViewerOf($, SEQUENCE, 'vscode')
  const pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await pane.press({ key: 'source' })
  const code = await pane.find({ type: 'Code' })
  expect(code?.props.source).toBe(SEQUENCE)
  expect(code?.props.language).toBe('mermaid')
  expect(await pane.find({ type: 'Button', text: 'Hide source' })).toBeDefined()
  await pane.press({ key: 'source' })
  expect(await pane.find({ type: 'Code' })).toBeUndefined()
  await pane.unmount()
})

test('Open as file writes the SVG to a temp file and hands it to the first opener that starts', async ($, on) => {
  const renderer = fakeRenderer(on, { openers: ['/opt/homebrew/bin/code'] })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('env.get', () => ({ value: '/tmp/t/' }))
  const writes: { path: string; text: string }[] = []
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  await openViewerOf($, FLOW, 'vscode')
  const pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await pane.press({ key: 'save' })
  expect(writes).toEqual([{ path: `/tmp/t/mermaid-render/${diagramId(FLOW)}.svg`, text: svgOf(FLOW) }])
  expect(renderer.opened).toEqual([['/opt/homebrew/bin/code', '--reuse-window', writes[0]?.path]])
  await pane.unmount()
})

test('Close closes the viewer pane', async ($, on) => {
  fakeRenderer(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const closed: string[] = []
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  await openViewerOf($, FLOW, 'vscode')
  const pane = await $.ui.mount({ ...PANE, surface: 'vscode' })
  await pane.press({ key: 'close' })
  expect(closed).toEqual(['mermaid-viewer'])
  await pane.unmount()
})

test('on the terminal the viewer shows the mermaid source as code', async ($, on) => {
  fakeRenderer(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await openViewerOf($, FLOW, 'desktop')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await pane.find({ type: 'Code' }))?.props.source).toBe(FLOW)
  expect(await pane.find({ type: 'Svg' })).toBeUndefined()
  await pane.unmount()
})
