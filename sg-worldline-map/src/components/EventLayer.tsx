/**
 * 이벤트 노드 레이어.
 * 각 Event를 eventType별 모양의 노드로 표시.
 * 같은 시각에 여러 이벤트 겹침 방지를 위해 미세 Y 오프셋.
 */

import type { SGEvent } from '@/types/ontology'
import { parseLocalDateTime } from '@/lib/scales'

interface Props {
  events: SGEvent[]
  x: (dt: Date) => number
  worldLineY: (wlId: string) => number | undefined
  highlightedEventId?: string | null
  highlightedWorldLineId?: string | null
  onSelectEvent?: (id: string) => void
}

export function EventLayer({
  events,
  x,
  worldLineY,
  highlightedEventId,
  highlightedWorldLineId,
  onSelectEvent,
}: Props) {
  // 같은 시각 + 같은 세계선에 여러 이벤트가 몰리면 Y 오프셋 분산
  const grouped = new Map<string, SGEvent[]>()
  for (const e of events) {
    const key = `${e.localDateTime}|${e.worldLineId}`
    const arr = grouped.get(key) ?? []
    arr.push(e)
    grouped.set(key, arr)
  }

  const nodes: Array<{
    event: SGEvent
    x: number
    y: number
    color: string
    size: number
  }> = []

  for (const [, arr] of grouped) {
    arr.forEach((e, idx) => {
      const wlY = worldLineY(e.worldLineId)
      if (wlY == null) return
      const yOffset = arr.length > 1 ? (idx - (arr.length - 1) / 2) * 18 : 0
      const color = colorByEventType(e.eventType)
      nodes.push({
        event: e,
        x: x(parseLocalDateTime(e.localDateTime)),
        y: wlY + yOffset,
        color,
        size: sizeByEventType(e.eventType),
      })
    })
  }

  return (
    <g className="events-layer">
      {nodes.map(({ event, x: nx, y: ny, color, size }) => {
        const isHl = highlightedEventId === event.id || highlightedEventId === event.uri
        const wlHl = highlightedWorldLineId && event.worldLineId === highlightedWorldLineId
        const dimmed =
          (highlightedEventId && !isHl) ||
          (highlightedWorldLineId && !wlHl && !isHl)
        return (
          <g
            key={event.uri}
            className="event-node-group"
            transform={`translate(${nx}, ${ny})`}
            style={{ cursor: 'pointer' }}
            opacity={dimmed ? 0.2 : 1}
            onClick={() => onSelectEvent?.(event.uri)}
          >
            {renderShape(event.eventType, color, size, isHl)}
            {/* 호버 라벨 (title) */}
            <title>{`${event.labelKo}\n${event.localDateTime}\n${event.summary.slice(0, 80)}`}</title>
          </g>
        )
      })}
    </g>
  )
}

function colorByEventType(t: string): string {
  switch (t) {
    case 'death': return '#dc2626'
    case 'communication': return '#3b82f6'
    case 'intervention': return '#f59e0b'
    case 'travel': return '#a855f7'
    case 'actual': return '#e2e8f0'
    default: return '#94a3b8'
  }
}

function sizeByEventType(t: string): number {
  switch (t) {
    case 'death': return 7
    case 'intervention': return 6.5
    case 'travel': return 6
    case 'communication': return 5.5
    default: return 5
  }
}

function renderShape(eventType: string, color: string, size: number, highlighted: boolean) {
  const stroke = highlighted ? '#fff' : 'rgba(15,23,42,0.9)'
  const strokeWidth = highlighted ? 2.5 : 1.5
  const filter = highlighted ? `drop-shadow(0 0 8px ${color})` : undefined
  const common = { fill: color, stroke, strokeWidth, style: { filter } as React.CSSProperties }

  switch (eventType) {
    case 'death':
      // ✕ 모양 — 두 선
      return (
        <g>
          <circle r={size + 1} fill="rgba(220,38,38,0.2)" stroke={color} strokeWidth={1} />
          <line x1={-size} y1={-size} x2={size} y2={size} stroke={color} strokeWidth={strokeWidth + 0.5} />
          <line x1={size} y1={-size} x2={-size} y2={size} stroke={color} strokeWidth={strokeWidth + 0.5} />
        </g>
      )
    case 'intervention':
      // ★
      return <Star size={size} {...common} />
    case 'communication':
      // 편지 아이콘 단순화 — 사각형 + 삼각
      return (
        <g>
          <rect x={-size} y={-size * 0.75} width={size * 2} height={size * 1.5} rx={1} {...common} />
          <path d={`M ${-size},${-size * 0.75} L 0,0 L ${size},${-size * 0.75}`} fill="none" stroke="rgba(15,23,42,0.6)" strokeWidth={1} />
        </g>
      )
    case 'travel':
      // 화살표 (시간 이동)
      return (
        <path
          d={`M ${-size},${-size * 0.5} L ${size * 0.4},${-size * 0.5} L ${size * 0.4},${-size} L ${size},${0} L ${size * 0.4},${size} L ${size * 0.4},${size * 0.5} L ${-size},${size * 0.5} Z`}
          {...common}
        />
      )
    default:
      return <circle r={size} {...common} />
  }
}

function Star({ size, ...rest }: { size: number } & React.SVGProps<SVGPolygonElement>) {
  // 5각 별 좌표
  const points: string[] = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? size : size * 0.45
    const a = (Math.PI / 5) * i - Math.PI / 2
    points.push(`${r * Math.cos(a)},${r * Math.sin(a)}`)
  }
  return <polygon points={points.join(' ')} {...rest} />
}
