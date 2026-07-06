/**
 * 수속(ConvergencePattern) 음영 + 밴드 라벨 레이어.
 * onTimeline=true → 타임라인 상 음영 (Mayuri 8/13, Kurisu 7/28)
 * onTimeline=false → 밴드 우측 끝 라벨 (미래 수속: 2025/2034/2036)
 * (findings.md 편차#2 기준)
 */

import type { ConvergencePattern } from '@/types/ontology'
import { parseLocalDateTime, bandColor } from '@/lib/scales'

interface Props {
  patterns: ConvergencePattern[]
  x: (dt: Date) => number
  bandYRange: (af: string) => { yTop: number; yBottom: number } | null
}

export function ConvergenceLayer({ patterns, x, bandYRange }: Props) {
  const onTimeline = patterns.filter((p) => p.onTimeline)
  const future = patterns.filter((p) => !p.onTimeline)

  return (
    <g className="convergence-layer">
      {/* 타임라인 상 음영 */}
      {onTimeline.map((p) => {
        const dayStr = p.timeWindow.split(' ')[0]
        const dt = parseLocalDateTime(dayStr)
        const cx = x(dt)
        const af = p.attractorField
        const range = af ? bandYRange(af) : null
        if (!range) return null
        const color = p.id.includes('Mayuri') ? '#dc2626' : p.id.includes('Kurisu') ? '#a855f7' : '#94a3b8'
        return (
          <g key={p.id}>
            <rect
              x={cx - 18}
              y={range.yTop}
              width={36}
              height={range.yBottom - range.yTop}
              fill={color}
              opacity={0.12}
            />
            <text
              x={cx}
              y={range.yTop - 6}
              textAnchor="middle"
              fontSize={10}
              fill={color}
              opacity={0.85}
            >
              ⚠ {p.appliesToCharacter ?? p.labelKo.slice(0, 8)}
            </text>
          </g>
        )
      })}

      {/* 미래 수속 — 밴드 우측 끝 라벨 */}
      {future.map((p) => {
        const af = p.attractorField
        if (!af) return null
        const range = bandYRange(af)
        if (!range) return null
        const color = bandColor(af as never)
        return (
          <g key={p.id}>
            <rect
              x={-9999}  // 영역 외 — 라벨만
              y={range.yTop}
              width={0}
              height={0}
              fill="none"
            />
            <text
              x={1320}  // 맵 우측 고정 위치 (MAP_DIMENSIONS 기반)
              y={(range.yTop + range.yBottom) / 2}
              fontSize={11}
              fill={color}
              opacity={0.7}
            >
              ⟶ {p.labelKo} ({p.timeWindow})
            </text>
          </g>
        )
      })}
    </g>
  )
}
