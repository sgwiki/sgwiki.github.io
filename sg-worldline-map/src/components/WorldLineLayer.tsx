/**
 * 세계선 수평선 레이어.
 * 각 WorldLine을 발산률 라벨과 함께 수평선으로 표시.
 * AF별 색상 적용.
 */

import type { WorldLine } from '@/types/ontology'
import { bandColor } from '@/lib/scales'

interface Props {
  worldlines: WorldLine[]
  xStart: number
  xEnd: number
  /** 강조된 세계선 id (클릭/재생 중). null이면 전부 동일 강도. */
  highlightedId: string | null
  onSelectWorldLine?: (id: string) => void
}

export function WorldLineLayer({
  worldlines,
  xStart,
  xEnd,
  highlightedId,
  onSelectWorldLine,
}: Props) {
  return (
    <g className="worldlines-layer">
      {worldlines.map((wl) => {
        const isHighlighted = highlightedId === wl.uri || highlightedId === wl.id
        const isDimmed = highlightedId !== null && !isHighlighted
        const color = bandColor(wl.attractorField)
        const strokeWidth = isHighlighted ? 4 : 2
        const opacity = isDimmed ? 0.18 : wl.isActive ? 1 : 0.65

        return (
          <g
            key={wl.uri}
            className="worldline-group"
            style={{ cursor: 'pointer' }}
            onClick={() => onSelectWorldLine?.(wl.uri)}
          >
            {/* 클릭 영역 확장 (두꺼운 투명선) */}
            <line
              x1={xStart}
              y1={wl.y}
              x2={xEnd}
              y2={wl.y}
              stroke="transparent"
              strokeWidth={14}
            />
            <line
              className="worldline"
              x1={xStart}
              y1={wl.y}
              x2={xEnd}
              y2={wl.y}
              stroke={color}
              strokeWidth={strokeWidth}
              opacity={opacity}
              strokeLinecap="round"
              style={
                isHighlighted
                  ? { filter: `drop-shadow(0 0 6px ${color})` }
                  : undefined
              }
            />
            {/* 발산률 라벨 (좌측) */}
            <text
              x={xStart - 8}
              y={wl.y + 4}
              textAnchor="end"
              fontSize={11}
              fill={isDimmed ? '#475569' : color}
              fontWeight={wl.isActive || isHighlighted ? 700 : 400}
              opacity={isDimmed ? 0.4 : 1}
            >
              {(wl.divergence > 0 ? '+' : '') + wl.divergence.toFixed(6) + '%'}
            </text>
            {/* 슈타인즈 게이트 별표 */}
            {wl.attractorField === 'AF_SteinsGate' && (
              <text
                x={xEnd + 8}
                y={wl.y + 5}
                fontSize={16}
                fill={color}
                style={{
                  filter: `drop-shadow(0 0 4px ${color})`,
                }}
              >
                ★
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}
