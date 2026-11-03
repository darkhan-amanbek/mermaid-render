// Pure helpers over a drawn diagram, shared by the hooks module and the tests.

export type Size = { width: number; height: number }

/** A short stable id of a diagram's source, for file names and Button keys. */
export function diagramId(source: string): string {
  let hash = 5381
  for (let i = 0; i < source.length; i++) hash = ((hash << 5) + hash + source.charCodeAt(i)) | 0
  return (hash >>> 0).toString(36)
}

/** The SVG's own size in CSS pixels, from its root's width/height or viewBox. */
export function sizeOf(svg: string): Size | undefined {
  const open = /<svg\b[^>]*>/.exec(svg)?.[0]
  if (open === undefined) return undefined
  const attr = (name: string) => {
    const value = new RegExp(`\\s${name}="([^"]*)"`).exec(open)?.[1]
    return value === undefined ? NaN : parseFloat(value)
  }
  let width = attr('width')
  let height = attr('height')
  if (!(width > 0 && height > 0)) {
    const box = /\sviewBox="([^"]*)"/.exec(open)?.[1]?.trim().split(/[\s,]+/).map(Number)
    if (box !== undefined && box.length === 4) {
      width = box[2] ?? NaN
      height = box[3] ?? NaN
    }
  }
  return width > 0 && height > 0 ? { width, height } : undefined
}
