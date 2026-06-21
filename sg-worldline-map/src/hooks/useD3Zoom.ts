/**
 * D3 zoom & pan React 훅.
 * SVG <g> 요소의 transform을 D3가 제어, 내부 요소 애니메이션은 GSAP이 담당 (역할 분리).
 */

import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'

export interface ZoomTransform {
  x: number
  y: number
  k: number
}

export function useD3Zoom<SVGSVG extends SVGSVGElement>(
  svgRef: React.RefObject<SVGSVG | null>,
  opts: { scaleExtent?: [number, number] } = {},
) {
  const [transform, setTransform] = useState<ZoomTransform>({ x: 0, y: 0, k: 1 })
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVG, unknown> | null>(null)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    const selection = d3.select(svg)
    const zoom = d3
      .zoom<SVGSVG, unknown>()
      .scaleExtent(opts.scaleExtent ?? [0.3, 8])
      .on('zoom', (event) => {
        setTransform({
          x: event.transform.x,
          y: event.transform.y,
          k: event.transform.k,
        })
      })

    selection.call(zoom)
    zoomRef.current = zoom

    return () => {
      selection.on('.zoom', null)
    }
  }, [svgRef, opts.scaleExtent])

  /** 특정 영역으로 줌 (재생 모드에서 사용) */
  const zoomTo = (
    x: number,
    y: number,
    k: number,
    durationMs: number = 750,
  ) => {
    const svg = svgRef.current
    if (!svg || !zoomRef.current) return
    const sel = d3.select(svg)
    sel
      .transition()
      .duration(durationMs)
      .call(
        zoomRef.current.transform,
        d3.zoomIdentity.translate(x, y).scale(k),
      )
  }

  const reset = () => {
    const svg = svgRef.current
    if (!svg || !zoomRef.current) return
    d3.select(svg)
      .transition()
      .duration(500)
      .call(zoomRef.current.transform, d3.zoomIdentity)
  }

  return { transform, zoomTo, reset }
}
