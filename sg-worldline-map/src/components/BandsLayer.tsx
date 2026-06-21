/**
 * 어트랙터 필드 밴드 배경 레이어.
 * 각 AF(Alpha/Beta/SteinsGate/Omega) 영역을 음영으로 표시.
 * v1은 4개 고정 밴드 + 음영 + 라벨.
 */

import type { AttractorBand } from '@/types/ontology'

interface Props {
  bands: AttractorBand[]
  xStart: number
  xEnd: number
  opacity?: number
}

export function BandsLayer({ bands, xStart, xEnd, opacity = 0.08 }: Props) {
  return (
    <g className="bands-layer">
      {bands.map((b) => (
        <g key={b.id}>
          <rect
            x={xStart}
            y={b.yTop}
            width={xEnd - xStart}
            height={b.yBottom - b.yTop}
            fill={b.color}
            opacity={opacity}
          />
          <text
            x={xStart + 12}
            y={b.yTop + 22}
            fill={b.color}
            opacity={0.7}
            fontSize={14}
            fontWeight={600}
          >
            {b.labelKo}
          </text>
        </g>
      ))}
    </g>
  )
}
