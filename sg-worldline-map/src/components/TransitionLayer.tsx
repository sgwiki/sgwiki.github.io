/**
 * 세계선 전환 곡선 레이어.
 * 각 WorldLineShift를 3차 베지어 곡선으로 표현.
 * shiftType별 색상 (findings.md 편차#1 기준).
 */

import type { WorldLineShift } from '@/types/ontology'
import { shiftColor } from '@/lib/scales'

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
        // 베지어: 출발 X(도착 X와 동일 시각)에서 fromY → toY로 부드럽게 연결.
        // t=1 접선은 항상 +x(수평)이라, 끝점에 동쪽을 향한 삼각형을 직접 붙여 머리·선 분리 방지.
        const d = `M ${cx},${s.fromY} C ${cx - 30},${s.fromY} ${cx - 30},${s.toY} ${cx},${s.toY}`
        const color = shiftColor(s.shiftType)
        const isHighlighted = highlightedShiftId === s.id || highlightedShiftId === s.uri
        const opacity = highlightedShiftId && !isHighlighted ? 0.15 : 0.9
        const aw = isHighlighted ? 9 : 7 // 화살표 크기
        // 선 끝(cx,toY)에 딱 붙는 채워진 삼각형 (tip=끝점, base는 진행 반대쪽)
        const arrow = `${cx + 1},${s.toY} ${cx - aw},${s.toY - aw * 0.62} ${cx - aw},${s.toY + aw * 0.62}`
        const glow = isHighlighted ? { filter: `drop-shadow(0 0 4px ${color})` } : undefined
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
              style={glow}
            />
            <polygon
              className="transition-arrowhead"
              points={arrow}
              fill={color}
              opacity={opacity}
              style={glow}
            />
          </g>
        )
      })}
    </g>
  )
}
