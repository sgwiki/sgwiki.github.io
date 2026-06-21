/**
 * 메인 맵 컴포넌트 — 모든 렌더링 레이어를 SVG에 통합.
 * D3 zoom/pan + GSAP 로딩 애니메이션 + 클릭 상호작용.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import gsap from 'gsap'
import type { SeriesDataset } from '@/types/ontology'
import { MAP_DIMENSIONS, computeScales, computeInitialZoom, CLUSTER_END_DATE, parseLocalDateTime } from '@/lib/scales'
import { useD3Zoom } from '@/hooks/useD3Zoom'
import { BandsLayer } from './BandsLayer'
import { WorldLineLayer } from './WorldLineLayer'
import { TransitionLayer } from './TransitionLayer'
import { EventLayer } from './EventLayer'
import { ConvergenceLayer } from './ConvergenceLayer'
import { Legend } from './Legend'

interface Props {
  dataset: SeriesDataset
  onSelectEvent?: (eventId: string) => void
  externalHighlight?: {
    worldLineId?: string | null
    eventId?: string | null
    shiftId?: string | null
  } | null
}

export function WorldLineMap({ dataset, onSelectEvent, externalHighlight }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const scales = useMemo(() => computeScales(dataset), [dataset])
  const { width, height, marginLeft, marginTop } = MAP_DIMENSIONS
  const innerWidth = width - marginLeft - 120

  // scaleExtent를 안정된 참조로 유지 — 매 렌더마다 새 배열이 생기면 D3 zoom이 재초기화됨
  const scaleExtent = useMemo<[number, number]>(() => [0.05, 300], [])

  // 마운트 시 2010-07~08 구간에 포커스 — 이후 사용자가 자유 줌/패닝 가능
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialTransform = useMemo(() => computeInitialZoom(scales, width, marginLeft), [])

  const { transform, reset } = useD3Zoom(svgRef, { scaleExtent, initialTransform })

  const [highlightedWl, setHighlightedWl] = useState<string | null>(null)
  const [highlightedEvent, setHighlightedEvent] = useState<string | null>(null)
  const [highlightedShift, setHighlightedShift] = useState<string | null>(null)

  // 외부 강조(재생 모드) 반영
  useEffect(() => {
    if (externalHighlight) {
      setHighlightedWl(externalHighlight.worldLineId ?? null)
      setHighlightedEvent(externalHighlight.eventId ?? null)
      setHighlightedShift(externalHighlight.shiftId ?? null)
    }
  }, [externalHighlight])

  // GSAP 초기 로딩 시퀀스 (AC: 축→밴드→선→전환→노드 순차 등장)
  useEffect(() => {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } })
    tl.from('.bands-layer', { opacity: 0, duration: 0.5 })
      .from('.worldlines-layer .worldline-group', { scaleX: 0, transformOrigin: 'left', duration: 0.6, stagger: 0.04 }, '-=0.2')
      .from('.transitions-layer .transition-group', { opacity: 0, duration: 0.4, stagger: 0.04 }, '-=0.4')
      .from('.events-layer .event-node-group', { scale: 0, transformOrigin: 'center', duration: 0.3, stagger: 0.015 }, '-=0.3')
    return () => { tl.kill() }
  }, [dataset])

  const wlYById = useMemo(() => {
    const m = new Map<string, number>()
    for (const w of dataset.worldlines) {
      m.set(w.uri, w.y)
      m.set(w.id, w.y)
    }
    return (id: string) => m.get(id)
  }, [dataset])

  const bandYRange = (af: string) => {
    const band = dataset.bands.find((b) => b.id === af)
    if (!band) return null
    return { yTop: band.yTop, yBottom: band.yBottom }
  }

  return (
    <div className="map-container relative w-full h-full overflow-hidden bg-[#040810]">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-full"
        style={{ cursor: 'grab' }}
        onClick={(e) => {
          // 배경 클릭 → 강조 해제
          if (e.target === e.currentTarget || (e.target as Element).tagName === 'rect') {
            if (!externalHighlight) {
              setHighlightedWl(null)
              setHighlightedEvent(null)
              setHighlightedShift(null)
            }
          }
        }}
      >
        <g transform={`translate(${marginLeft}, ${marginTop}) scale(${transform.k}) translate(${transform.x / transform.k}, ${transform.y / transform.k})`}>
          {/* X축 (시간) */}
          <TimeAxis scales={scales} innerWidth={innerWidth} />

          {/* 레이어 순서: 밴드 배경 → 수속 음영 → 세계선 → 전환 곡선 → 이벤트 노드 */}
          <BandsLayer bands={dataset.bands} xStart={0} xEnd={innerWidth} />
          <ConvergenceLayer patterns={dataset.convergence} x={(d) => scales.x(d)} bandYRange={bandYRange} />
          <WorldLineLayer
            worldlines={dataset.worldlines}
            xStart={0}
            xEnd={innerWidth}
            highlightedId={highlightedWl}
            onSelectWorldLine={(id) => {
              if (!externalHighlight) setHighlightedWl(id)
            }}
          />
          <TransitionLayer
            shifts={dataset.shifts}
            x={(s) => scales.x(parseLocalDateTime(s))}
            highlightedShiftId={highlightedShift}
            onSelectShift={(id) => {
              if (!externalHighlight) setHighlightedShift(id)
            }}
          />
          <EventLayer
            events={dataset.events}
            x={scales.x}
            worldLineY={wlYById}
            highlightedEventId={highlightedEvent}
            highlightedWorldLineId={highlightedWl}
            onSelectEvent={(id) => {
              if (externalHighlight) return
              setHighlightedEvent(id)
              onSelectEvent?.(id)
            }}
          />
        </g>
      </svg>

      {/* 줌 리셋 버튼 — 전체 보기로 복귀 */}
      <button
        onClick={() => reset()}
        className="absolute top-3 right-3 z-10 bg-[#0A1525]/90 hover:bg-[#152240] text-[#4A6A8A] hover:text-[#C0D8F0] px-3 py-1.5 rounded text-sm border border-[#152240] transition-colors"
      >
        ⟲ 전체 보기
      </button>

      {/* 범례 */}
      <Legend />

      {/* 현재 줌 표시 */}
      <div className="absolute bottom-3 left-3 text-xs text-[#4A6A8A] bg-[#040810]/80 px-2 py-1 rounded">
        줌 {transform.k.toFixed(2)}× · 드래그=이동 · 휠=확대
      </div>
    </div>
  )
}

function TimeAxis({ scales, innerWidth }: { scales: ReturnType<typeof computeScales>; innerWidth: number }) {
  // 주요 구간(2010~2011)과 미래 압축 구간을 분리하여 틱 생성
  const mainEnd = scales.isPiecewise ? CLUSTER_END_DATE : scales.xDomain[1]
  const mainTicks = d3.timeDay.every(3)?.range(scales.xDomain[0], mainEnd) ?? []

  // 미래 구간: 해당 연도만 표시
  const futureTicks: Date[] = scales.isPiecewise
    ? [new Date(`${scales.xDomain[1].getFullYear()}-01-01`)]
    : []

  const breakX = scales.isPiecewise ? scales.x(CLUSTER_END_DATE) : null

  return (
    <g className="timeline-axis">
      <line x1={0} y1={0} x2={innerWidth} y2={0} stroke="#475569" strokeWidth={1} />
      {mainTicks.map((t, i) => (
        <g key={i} transform={`translate(${scales.x(t)}, 0)`}>
          <line y2={-6} stroke="#64748b" />
          <text y={-10} textAnchor="middle" fontSize={10} fill="#94a3b8">
            {d3.timeFormat('%m/%d')(t)}
          </text>
        </g>
      ))}
      {futureTicks.map((t, i) => (
        <g key={`f${i}`} transform={`translate(${scales.x(t)}, 0)`}>
          <line y2={-6} stroke="#334155" />
          <text y={-10} textAnchor="middle" fontSize={10} fill="#64748b">
            {d3.timeFormat('%Y')(t)}
          </text>
        </g>
      ))}
      {/* 시간 압축 구간 경계 표시 */}
      {breakX !== null && (
        <g transform={`translate(${breakX}, 0)`}>
          <line y1={4} y2={-16} stroke="#334155" strokeWidth={1} strokeDasharray="3,2" />
          <text y={-20} textAnchor="middle" fontSize={8} fill="#475569" letterSpacing="2">
            ···
          </text>
        </g>
      )}
      <text x={innerWidth / 2} y={-30} textAnchor="middle" fontSize={12} fill="#cbd5e1">
        타임라인
      </text>
    </g>
  )
}
