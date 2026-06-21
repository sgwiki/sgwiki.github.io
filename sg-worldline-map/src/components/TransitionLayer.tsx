/**
 * 세계선 전환 곡선 레이어.
 * 각 WorldLineShift를 3차 베지어 곡선으로 표현.
 * shiftType별 색상 (findings.md 편차#1 기준).
 */

import type { WorldLineShift } from '@/types/ontology'
import { shiftColor, SHIFT_COLOR } from '@/lib/scales'

interface Props {
  shifts: WorldLineShift[]
  x: (s: string) => number  // shiftMoment "YYYY-MM-DD HH:MM" → X
  highlightedShiftId?: string | null
  onSelectShift?: (id: string) => void
}

export function TransitionLayer({ shifts, x, highlightedShiftId, onSelectShift }: Props) {
  return (
    <g className="transitions-layer">
      {shifts.map((s) => {
        const cx = x(s.shiftMoment)
        // 베지어: 출발 X(도착 X와 동일 시각)에서 fromY → toY로 부드럽게 연결
        const d = `M ${cx},${s.fromY} C ${cx - 30},${s.fromY} ${cx - 30},${s.toY} ${cx},${s.toY}`
        const color = shiftColor(s.shiftType)
        const isHighlighted = highlightedShiftId === s.id || highlightedShiftId === s.uri
        const opacity = highlightedShiftId && !isHighlighted ? 0.15 : 0.85
        return (
          <g
            key={s.id}
            className="transition-group"
            style={{ cursor: 'pointer' }}
            onClick={() => onSelectShift?.(s.id)}
          >
            {/* 클릭 영역 */}
            <path d={d} stroke="transparent" strokeWidth={10} fill="none" />
            <path
              className="transition-path"
              d={d}
              stroke={color}
              strokeWidth={isHighlighted ? 4 : 2.5}
              fill="none"
              opacity={opacity}
              color={color}
              markerEnd={`url(#arrowhead-${s.shiftType in SHIFT_COLOR ? s.shiftType.replace(/\+/g, '-') : 'default'})`}
              style={
                isHighlighted
                  ? { filter: `drop-shadow(0 0 4px ${color})` }
                  : undefined
              }
            />
          </g>
        )
      })}
      {/* 화살표 마커 — shiftType별 색상 */}
      <defs>
        {Object.entries(SHIFT_COLOR).map(([type, c]) => (
          <marker
            key={type}
            id={`arrowhead-${type.replace(/\+/g, '-')}`}
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="4"
            orient="auto"
          >
            <path d="M 0,0 L 8,4 L 0,8 z" fill={c} />
          </marker>
        ))}
        <marker
          id="arrowhead-default"
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="4"
          orient="auto"
        >
          <path d="M 0,0 L 8,4 L 0,8 z" fill="#94a3b8" />
        </marker>
      </defs>
    </g>
  )
}
