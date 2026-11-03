import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { diagramId } from './view'

const FLOW = 'graph TD\n  A --> B'
const SEQUENCE = 'sequenceDiagram\n  A->>B: hi'
const PIE = 'pie title Pets\n  "Dogs" : 3'
const fence = (source: string) => '```mermaid\n' + source + '\n```'
const svgOf = (source: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><title>${source.length}</title></svg>`
const asciiOf = (source: string) => `┌──┐\n│${source.split('\n')[0]}│\n└──┘`

type Renderer = { renderCalls: string[][]; logs: string[]; opened: string[][] }

function fakeRenderer(
  on: On,
  { startable = ['node'], failFirstRender = false, openers = [] as string[], extensions = undefined as string[] | undefined } = {},
): Renderer {
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
    if (argv0 === 'code' && extensions !== undefined) {
      if (script === '--list-extensions') return { value: { ...ok, stdout: extensions.join('\n') + '\n' } }
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

test('a diagram draws at its own size with one ⛶ button under it', async ($, on) => {
  fakeRenderer(on)
  for (const surface of ['desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...message(fence(FLOW)), surface })
    const svg = await ui.find({ type: 'Svg' })
    expect(svg?.props.width).toBe(300)
    expect(svg?.props.height).toBe(200)
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map(button => button.props.key)).toEqual([`view:${diagramId(FLOW)}:0`])
    expect(buttons[0]?.props.label).toBe('⛶')
    await ui.unmount()
  }
})

test('⛶ writes the SVG and a viewer page to the temp folder and opens the page in the browser', async ($, on) => {
  const renderer = fakeRenderer(on, { openers: ['open'], extensions: ['ms-python.python'] })
  on('env.get', () => ({ value: '/tmp/t/' }))
  const writes: { path: string; text: string }[] = []
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  const id = diagramId(FLOW)
  const ui = await $.ui.mount({ ...message(fence(FLOW)), surface: 'vscode' })
  await ui.press({ key: `view:${id}:0` })
  expect(writes.map(write => write.path)).toEqual([`/tmp/t/mermaid-render/${id}.svg`, `/tmp/t/mermaid-render/${id}.html`])
  expect(writes[0]?.text).toBe(svgOf(FLOW))
  const page = writes[1]?.text ?? ''
  expect(page).toContain('<!doctype html>')
  expect(page).toContain(svgOf(FLOW))
  expect(page).toContain('<title>graph TD</title>')
  expect(page).toContain('wheel')
  expect(page).toContain('gesturechange')
  expect(page).toContain('acquireVsCodeApi')
  expect(renderer.opened).toEqual([['open', `/tmp/t/mermaid-render/${id}.html`]])
  await ui.unmount()
})

test('with the viewer extension installed, ⛶ opens the page in VS Code through its URI, not the browser', async ($, on) => {
  const renderer = fakeRenderer(on, { openers: ['open'], extensions: ['ms-python.python', 'darkhan-amanbek.mermaid-viewer'] })
  on('env.get', () => ({ value: '/tmp/t' }))
  on('fs.write', () => ({ value: undefined }))
  const id = diagramId(FLOW)
  const ui = await $.ui.mount({ ...message(`${fence(FLOW)}\n${fence(SEQUENCE)}`), surface: 'vscode' })
  await ui.press({ key: `view:${id}:0` })
  await ui.press({ key: `view:${diagramId(SEQUENCE)}:1` })
  const url = (page: string) => `vscode://darkhan-amanbek.mermaid-viewer/open?path=${encodeURIComponent(page)}`
  expect(renderer.opened).toEqual([
    ['code', '--open-url', url(`/tmp/t/mermaid-render/${id}.html`)],
    ['code', '--open-url', url(`/tmp/t/mermaid-render/${diagramId(SEQUENCE)}.html`)],
  ])
  expect(renderer.renderCalls).toHaveLength(1)
  await ui.unmount()
})

test('the viewer page escapes the mermaid source it shows', async ($, on) => {
  const renderer = fakeRenderer(on, { openers: ['open'] })
  on('env.get', () => ({ value: undefined }))
  const writes: string[] = []
  on('fs.write', (_, e) => {
    writes.push(e.text)
    return { value: undefined }
  })
  const source = 'graph TD\n  A["<b>x</b> & y"] --> B'
  const ui = await $.ui.mount({ ...message(fence(source)), surface: 'desktop' })
  await ui.press({ key: `view:${diagramId(source)}:0` })
  expect(writes[1]).toContain('A[&quot;&lt;b&gt;x&lt;/b&gt; &amp; y&quot;] --&gt; B')
  expect(renderer.opened[0]?.[1]?.startsWith('/tmp/mermaid-render/')).toBe(true)
  await ui.unmount()
})

test('when no opener starts, a toast names the viewer page', async ($, on) => {
  fakeRenderer(on)
  on('env.get', () => ({ value: '/tmp/t' }))
  on('fs.write', () => ({ value: undefined }))
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const id = diagramId(FLOW)
  const ui = await $.ui.mount({ ...message(fence(FLOW)), surface: 'vscode' })
  await ui.press({ key: `view:${id}:0` })
  expect(toasts).toEqual([`Could not open a browser; the viewer is at /tmp/t/mermaid-render/${id}.html`])
  await ui.unmount()
})
