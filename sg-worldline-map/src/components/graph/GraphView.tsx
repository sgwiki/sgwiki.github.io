/**
 * 온톨로지 그래프 재사용 뷰 (P0-4) — D3 force simulation.
 * mode: 'global'(탐색기 탭) | 'embed'(위키 iframe 1홉 이웃).
 *
 * React는 컨테이너/SVG 골격만 소유하고, 노드·엣지 DOM과 위치 갱신은
 * effect 안에서 D3가 직접 조작한다 (tick마다 React 리렌더 회피).
 * 타임라인의 useD3Zoom은 wheel을 차단하지만(페이지 스크롤 우선),
 * 그래프 모드는 휠 줌이 핵심 인터랙션이라 자체 zoom을 쓴다 (계획 P0-4).
 */

import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import type { GraphEdge, GraphNode } from '@/types/ontology'
import { nodeColor, nodeLabel, nodeRadius } from './nodeStyles'
import { RELATION_STYLES } from './edgeStyles'
import { buildAdjacency } from './subgraph'

export type GraphViewMode = 'global' | 'embed'
export type GraphTheme = 'dark' | 'light'

interface Props {
  nodes: GraphNode[]
  edges: GraphEdge[]
  mode: GraphViewMode
  theme?: GraphTheme
  /** 중앙 배치 + 강조할 노드 (딥링크 ?focus=) */
  focusNodeId?: string | null
  selectedNodeId?: string | null
  onNodeClick?: (node: GraphNode) => void
  onBackgroundClick?: () => void
}

interface SimNode extends d3.SimulationNodeDatum {
  id: string
  data: GraphNode
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  edge: GraphEdge
}

const THEME = {
  dark: { bg: '#050B15', label: '#C0D8F0', halo: '#050B15', ring: '#FF8C00' },
  light: { bg: '#f8fafc', label: '#1e293b', halo: '#f8fafc', ring: '#C25200' },
}

export function GraphView({
  nodes,
  edges,
  mode,
  theme = 'dark',
  focusNodeId,
  selectedNodeId,
  onNodeClick,
  onBackgroundClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  /** 필터 토글/선택 변경 시 배치가 리셋되지 않도록 노드 위치 캐시 */
  const posCache = useRef<Map<string, { x: number; y: number }>>(new Map())
  const [size, setSize] = useState({ w: 800, h: 600 })

  // 콜백은 ref로 — 부모의 인라인 람다 때문에 시뮬레이션이 재구성되지 않도록
  const onNodeClickRef = useRef(onNodeClick)
  onNodeClickRef.current = onNodeClick
  const onBackgroundClickRef = useRef(onBackgroundClick)
  onBackgroundClickRef.current = onBackgroundClick

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () =>
      setSize({ w: el.clientWidth || 800, h: el.clientHeight || 600 })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const svgEl = svgRef.current
    if (!svgEl) return
    const { w, h } = size
    const t = THEME[theme]
    const svg = d3.select(svgEl)
    svg.selectAll('*').remove()

    // 방향 관계 화살표 마커 (관계별 색)
    const defs = svg.append('defs')
    for (const [rel, st] of Object.entries(RELATION_STYLES)) {
      defs
        .append('marker')
        .attr('id', `arrow-${rel}`)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 9)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', st.color)
    }

    const root = svg.append('g')

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 6])
      .on('zoom', (ev) => root.attr('transform', ev.transform.toString()))
    svg.call(zoom)
    svg.on('click', (ev) => {
      if (ev.target === svgEl) onBackgroundClickRef.current?.()
    })

    // --- 시뮬레이션 데이터 (posCache로 이전 배치 시드) ---
    let seeded = 0
    const simNodes: SimNode[] = nodes.map((n, i) => {
      const cached = posCache.current.get(n.id)
      if (cached) seeded++
      return {
        id: n.id,
        data: n,
        x: cached?.x ?? w / 2 + 60 * Math.cos((i / Math.max(nodes.length, 1)) * 2 * Math.PI),
        y: cached?.y ?? h / 2 + 60 * Math.sin((i / Math.max(nodes.length, 1)) * 2 * Math.PI),
      }
    })
    const nodeById = new Map(simNodes.map((n) => [n.id, n]))
    const simLinks: SimLink[] = edges
      .filter((e) => nodeById.has(e.source) && nodeById.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, edge: e }))
    const adjacency = buildAdjacency(edges)

    const sim = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        d3
          .forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance((l) => RELATION_STYLES[l.edge.relation].dist)
          .strength(0.5),
      )
      .force('charge', d3.forceManyBody().strength(mode === 'embed' ? -320 : -170))
      .force('center', d3.forceCenter(w / 2, h / 2))
      .force('collide', d3.forceCollide<SimNode>((d) => nodeRadius(d.data) + 6))
      .stop()

    // 정적 프리레이아웃 — 초기 요동 없이 배치. 전부 캐시돼 있으면 생략(선택 변경 시 배치 유지).
    if (seeded < simNodes.length) {
      const ticks = Math.min(300, 80 + simNodes.length * 2)
      for (let i = 0; i < ticks; i++) sim.tick()
    }

    // --- DOM 조인 ---
    const linkSel = root
      .append('g')
      .selectAll<SVGLineElement, SimLink>('line')
      .data(simLinks)
      .join('line')
      .attr('stroke', (l) => RELATION_STYLES[l.edge.relation].color)
      .attr('stroke-dasharray', (l) => RELATION_STYLES[l.edge.relation].dash ?? null)
      .attr('stroke-opacity', 0.45)
      .attr('stroke-width', 1.2)
      .attr('marker-end', (l) =>
        l.edge.directed ? `url(#arrow-${l.edge.relation})` : null,
      )

    const isEmphasized = (id: string) => id === selectedNodeId || id === focusNodeId

    const nodeSel = root
      .append('g')
      .selectAll<SVGGElement, SimNode>('g')
      .data(simNodes, (d) => d.id)
      .join('g')
      .attr('cursor', 'pointer')

    nodeSel
      .append('circle')
      .attr('r', (d) => nodeRadius(d.data))
      .attr('fill', (d) => nodeColor(d.data))
      .attr('stroke', (d) => (isEmphasized(d.id) ? t.ring : t.halo))
      .attr('stroke-width', (d) => (isEmphasized(d.id) ? 3 : 1.2))

    const labelVisible = (d: SimNode) =>
      mode === 'embed' || nodeRadius(d.data) >= 9 || isEmphasized(d.id)

    const labelSel = nodeSel
      .append('text')
      .text((d) => nodeLabel(d.data))
      .attr('font-size', 10)
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => -(nodeRadius(d.data) + 5))
      .attr('fill', t.label)
      .attr('paint-order', 'stroke')
      .attr('stroke', t.halo)
      .attr('stroke-width', 3)
      .attr('pointer-events', 'none')
      .attr('opacity', (d) => (labelVisible(d) ? 0.92 : 0))

    const tick = () => {
      linkSel.each(function (l) {
        const s = l.source as SimNode
        const o = l.target as SimNode
        if (s.x == null || o.x == null || s.y == null || o.y == null) return
        const dx = o.x - s.x
        const dy = o.y - s.y
        const len = Math.hypot(dx, dy) || 1
        // 화살표가 노드 원 아래 깔리지 않게 target 반지름만큼 당김
        const rt = nodeRadius(o.data) + 3
        d3.select(this)
          .attr('x1', s.x)
          .attr('y1', s.y)
          .attr('x2', o.x - (dx / len) * rt)
          .attr('y2', o.y - (dy / len) * rt)
      })
      nodeSel.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
      for (const n of simNodes) {
        if (n.x != null && n.y != null) posCache.current.set(n.id, { x: n.x, y: n.y })
      }
    }
    tick()
    sim.on('tick', tick)

    // --- 드래그 (드래그 중에만 시뮬레이션 재가열) ---
    nodeSel.call(
      d3
        .drag<SVGGElement, SimNode>()
        .on('start', (ev, d) => {
          if (!ev.active) sim.alphaTarget(0.2).restart()
          d.fx = d.x
          d.fy = d.y
        })
        .on('drag', (ev, d) => {
          d.fx = ev.x
          d.fy = ev.y
        })
        .on('end', (ev, d) => {
          if (!ev.active) sim.alphaTarget(0)
          d.fx = null
          d.fy = null
        }),
    )

    // --- 클릭/호버 ---
    nodeSel.on('click', (ev, d) => {
      ev.stopPropagation()
      onNodeClickRef.current?.(d.data)
    })
    nodeSel
      .on('mouseenter', (_ev, d) => {
        const nb = adjacency.get(d.id) ?? new Set<string>()
        const near = (id: string) => id === d.id || nb.has(id)
        nodeSel.attr('opacity', (o) => (near(o.id) ? 1 : 0.12))
        labelSel.attr('opacity', (o) => (near(o.id) ? 0.95 : 0))
        linkSel.attr('stroke-opacity', (l) =>
          (l.source as SimNode).id === d.id || (l.target as SimNode).id === d.id
            ? 0.9
            : 0.06,
        )
      })
      .on('mouseleave', () => {
        nodeSel.attr('opacity', 1)
        labelSel.attr('opacity', (o) => (labelVisible(o) ? 0.92 : 0))
        linkSel.attr('stroke-opacity', 0.45)
      })

    // --- focus 노드 중앙 배치 (?focus= 딥링크 / 검색-투-포커스) ---
    if (focusNodeId) {
      const f = nodeById.get(focusNodeId)
      if (f && f.x != null && f.y != null) {
        const k = mode === 'embed' ? 1 : 1.25
        svg.call(
          zoom.transform,
          d3.zoomIdentity.translate(w / 2 - f.x * k, h / 2 - f.y * k).scale(k),
        )
      }
    }

    return () => {
      sim.stop()
    }
  }, [nodes, edges, size, mode, theme, focusNodeId, selectedNodeId])

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ background: THEME[theme].bg }}
    >
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`0 0 ${size.w} ${size.h}`}
        role="img"
        aria-label="슈타인즈 게이트 온톨로지 그래프"
      />
    </div>
  )
}
