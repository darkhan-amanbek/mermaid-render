// Mermaid Viewer: shows a viewer page written by the mermaid-render Claude Code mod
// in a webview tab. Reached by the URI the mod opens,
//   vscode://darkhan-amanbek.mermaid-viewer/open?path=<file>
// and by the command "Mermaid Viewer: Open a viewer page…".
const vscode = require('vscode')
const fs = require('fs')
const os = require('os')
const path = require('path')

// Only pages under the folder the mod writes to are opened: the URI can come from any app.
const PAGES_DIR = path.join(fs.realpathSync(os.tmpdir()), 'mermaid-render')

function activate(context) {
  const panels = new Map()

  const open = file => {
    if (typeof file !== 'string' || file === '') return warn('no page named')
    let real
    try {
      real = fs.realpathSync(file)
    } catch {
      return warn(`no such page: ${file}`)
    }
    if (!real.startsWith(PAGES_DIR + path.sep) || !real.endsWith('.html')) {
      return warn(`only viewer pages under ${PAGES_DIR} are opened`)
    }
    const html = fs.readFileSync(real, 'utf8')
    const title = decode(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? 'Diagram')

    const shown = panels.get(real)
    if (shown !== undefined) {
      shown.title = title
      shown.webview.html = html
      shown.reveal(undefined, true)
      return
    }
    const panel = vscode.window.createWebviewPanel('mermaidViewer', title, vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    })
    panel.webview.html = html
    panel.webview.onDidReceiveMessage(message => handle(real, message))
    panel.onDidDispose(() => panels.delete(real))
    panels.set(real, panel)
  }

  const handle = async (file, message) => {
    if (message?.type === 'copy' && typeof message.text === 'string') {
      await vscode.env.clipboard.writeText(message.text)
      vscode.window.setStatusBarMessage('Mermaid source copied', 2000)
    } else if (message?.type === 'save' && typeof message.svg === 'string') {
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(os.homedir(), 'Downloads', 'diagram.svg')),
        filters: { SVG: ['svg'] },
      })
      if (target !== undefined) {
        fs.writeFileSync(target.fsPath, message.svg)
        vscode.window.setStatusBarMessage(`Saved ${path.basename(target.fsPath)}`, 2000)
      }
    }
  }

  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri) {
        if (uri.path !== '/open') return warn(`unknown action ${uri.path}`)
        open(new URLSearchParams(uri.query).get('path'))
      },
    }),
    vscode.commands.registerCommand('mermaidViewer.open', async () => {
      const picked = await vscode.window.showOpenDialog({
        defaultUri: vscode.Uri.file(PAGES_DIR),
        filters: { 'Viewer page': ['html'] },
      })
      if (picked?.[0] !== undefined) open(picked[0].fsPath)
    }),
  )
}

const warn = text => void vscode.window.showWarningMessage(`Mermaid Viewer: ${text}`)
const decode = text =>
  text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&')

module.exports = { activate, deactivate() {} }
