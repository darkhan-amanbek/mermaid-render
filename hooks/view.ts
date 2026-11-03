// How a drawn diagram is viewed: its zoom and whether its source shows.
// Pure helpers, so the tests and the hooks module share one idea of them.

export type Size = { width: number; height: number }

/** Zoom factors the toolbar steps through; 1 is the drawing's own size. */
export const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3] as const

/** The zoom that lets the surface fit the drawing to its slot. */
export const FIT = 0

/** A short stable id of a diagram's source, for state keys and Button keys. */
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

export function zoomIn(zoom: number): number {
  if (zoom === FIT) return 1.25
  return ZOOMS.find(step => step > zoom + 1e-9) ?? ZOOMS[ZOOMS.length - 1] ?? zoom
}

export function zoomOut(zoom: number): number {
  if (zoom === FIT) return 0.8
  return [...ZOOMS].reverse().find(step => step < zoom - 1e-9) ?? ZOOMS[0] ?? zoom
}

export function zoomLabel(zoom: number): string {
  return zoom === FIT ? 'fit' : `${Math.round(zoom * 100)}%`
}
