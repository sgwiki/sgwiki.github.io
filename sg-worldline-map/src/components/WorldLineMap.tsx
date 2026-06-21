/**
 * 메인 맵 컴포넌트 — 모든 렌더링 레이어를 SVG에 통합.
 * D3 zoom/pan + GSAP 로딩 애니메이션 + 클릭 상호작용.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import gsap from 'gsap'
import type { SeriesDataset } from '@/types/ontology'
import { MAP_DIMENSIONS, computeScales, parseLocalDateTime } from '@/lib/scales'
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

  // 3구역 piecewise 축이 한 화면에 모두 들어오므로 초기 줌 없이 전체 보기(항등 변환).
  const initialTransform = useMemo(() => ({ k: 1, x: 0, y: 0 }), [])

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
  // gsap.context + revert로 감싸 StrictMode 이중 마운트 시 .from 시작값(scale:0/opacity:0)이
  // 그대로 남아 레이어가 사라지는 문제를 방지 — cleanup에서 자연 상태로 복원된다.
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.timeline({ defaults: { ease: 'power2.out' } })
        .from('.bands-layer', { opacity: 0, duration: 0.5 })
        .from('.worldlines-layer .worldline-group', { scaleX: 0, transformOrigin: 'left', duration: 0.6, stagger: 0.04 }, '-=0.2')
        .from('.transitions-layer .transition-group', { opacity: 0, duration: 0.4, stagger: 0.04 }, '-=0.4')
        .from('.events-layer .event-node-group', { scale: 0, transformOrigin: 'center', duration: 0.3, stagger: 0.015 }, '-=0.3')
    }, svgRef)
    return () => { ctx.revert() }
  }, [dataset])

  const wlYById = useMemo(() => {
    const m = new Map<string, number>()
    for (const w of dataset.worldlines) {
      m.set(w.uri, w.y)
      m.set(w.id, w.y)
    }
    return (id: string) => m.get(id)
  }, [dataset])

  // D메일 ↔ 이동(shift) 양방향 매핑 — 한쪽 클릭 시 짝을 함께 강조.
  // shift.triggeredByEventId = 화살표 꼬리 쪽 D메일.
  const { shiftIdByEventId, eventIdByShiftId } = useMemo(() => {
    const s2e = new Map<string, string>() // shift id/uri → trigger event id
    const e2s = new Map<string, string>() // trigger event id → shift id
    for (const s of dataset.shifts) {
      if (!s.triggeredByEventId) continue
      s2e.set(s.id, s.triggeredByEventId)
      s2e.set(s.uri, s.triggeredByEventId)
      e2s.set(s.triggeredByEventId, s.id)
    }
    return { shiftIdByEventId: e2s, eventIdByShiftId: s2e }
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
              if (externalHighlight) return
              setHighlightedShift(id)
              // 화살표 클릭 → 이 이동을 일으킨 D메일도 함께 강조
              setHighlightedEvent(eventIdByShiftId.get(id) ?? null)
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
              // D메일 클릭 → 이 D메일로 인한 이동 화살표도 함께 강조
              setHighlightedShift(shiftIdByEventId.get(id) ?? null)
              onSelectEvent?.(id)
            }}
          />

          {/* 시간 단절(세로 물결) — 모든 레이어 위에 오버레이 */}
          <TimeBreaks scales={scales} />
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

/** 세로 물결(squiggle) path — y0~y1 구간을 진폭 amp, 주기 period로 흔든다. */
function wavyVerticalPath(x: number, y0: number, y1: number, amp = 4, period = 14): string {
  const half = period / 2
  let d = `M ${x} ${y0}`
  let dir = 1
  for (let y = y0; y < y1; y += half) {
    const yNext = Math.min(y + half, y1)
    const ctrlY = (y + yNext) / 2
    d += ` Q ${x + dir * amp} ${ctrlY} ${x} ${yNext}`
    dir *= -1
  }
  return d
}

/** 구역별 틱 날짜 생성 — A/B는 일 단위, C(단일 시점)는 시작점만. */
function zoneTicks(zone: ReturnType<typeof computeScales>['zones'][number]): Date[] {
  if (zone.id === 'C') return [new Date('2025-08-21')]
  const stepDays = zone.id === 'A' ? 3 : 7
  return d3.timeDay.every(stepDays)?.range(zone.start, zone.end) ?? [zone.start]
}

function TimeAxis({ scales, innerWidth }: { scales: ReturnType<typeof computeScales>; innerWidth: number }) {
  const { zones } = scales

  return (
    <g className="timeline-axis">
      <line x1={0} y1={0} x2={innerWidth} y2={0} stroke="#475569" strokeWidth={1} />

      {/* 구역별 틱 + 라벨 */}
      {zones.map((zone) => {
        const ticks = zoneTicks(zone)
        const fmt = zone.id === 'C' ? d3.timeFormat('%Y-%m-%d') : d3.timeFormat('%m/%d')
        const mid = (zone.xStart + zone.xEnd) / 2
        return (
          <g key={zone.id}>
            {ticks.map((t, i) => (
              <g key={i} transform={`translate(${scales.x(t)}, 0)`}>
                <line y2={-6} stroke="#64748b" />
                <text y={-10} textAnchor="middle" fontSize={10} fill="#94a3b8">
                  {fmt(t)}
                </text>
              </g>
            ))}
            {/* 구역 라벨 */}
            <text x={mid} y={-26} textAnchor="middle" fontSize={11} fill="#cbd5e1" letterSpacing="1">
              {zone.label}
            </text>
          </g>
        )
      })}
    </g>
  )
}

/** 세로 물결 break 오버레이 — 세계선/노드 위에 그려 시간 단절을 시각화. */
function TimeBreaks({ scales }: { scales: ReturnType<typeof computeScales> }) {
  const { yMin, yMax, breaks } = scales
  return (
    <g className="timeline-breaks">
      {breaks.map((b, i) => (
        <g key={`break${i}`}>
          {/* 배경색 얇은 마스크로 양옆을 살짝 가려 끊김 강조 */}
          <rect x={b.x - 7} y={yMin} width={14} height={yMax - yMin} fill="#040810" opacity={0.85} />
          <path
            d={wavyVerticalPath(b.x, yMin, yMax)}
            fill="none"
            stroke="#475569"
            strokeWidth={1.5}
          />
        </g>
      ))}
    </g>
  )
}
