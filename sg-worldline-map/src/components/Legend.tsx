/**
 * 기호/색상 범례 — 접이식 오버레이.
 * 이벤트 5종(모양+색) + 어트랙터 필드 4색 + 전환 유형 3색.
 */

import { useState } from 'react'
import { FIELD_COLOR, SHIFT_COLOR } from '@/lib/scales'

const EVENT_ITEMS: { label: string; color: string; shape: 'circle' | 'cross' | 'star' | 'envelope' | 'arrow' }[] = [
  { label: '실제 사건', color: '#e2e8f0', shape: 'circle' },
  { label: '사망', color: '#dc2626', shape: 'cross' },
  { label: '개입', color: '#f59e0b', shape: 'star' },
  { label: '통신(D메일)', color: '#3b82f6', shape: 'envelope' },
  { label: '시간 이동', color: '#a855f7', shape: 'arrow' },
]

const AF_ITEMS = [
  { label: 'α 알파 (SERN 디스토피아)', color: FIELD_COLOR.AF_Alpha },
  { label: 'β 베타 (WW3)', color: FIELD_COLOR.AF_Beta },
  { label: 'Steins;Gate', color: FIELD_COLOR.AF_SteinsGate },
  { label: 'Ω 오메가', color: FIELD_COLOR.AF_Omega },
]

const SHIFT_ITEMS = [
  { label: 'D메일', color: SHIFT_COLOR.dmail },
  { label: '현재 행위', color: SHIFT_COLOR.presentAction },
  { label: '물리이동+영상D메일', color: SHIFT_COLOR['physicaltravel+videodmail'] },
]

export function Legend() {
  const [open, setOpen] = useState(false)

  return (
    <div className="absolute bottom-12 right-3 z-10 text-xs">
      <button
        onClick={() => setOpen((o) => !o)}
        className="block ml-auto bg-slate-800/90 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded border border-slate-700"
      >
        {open ? '▲ 범례 닫기' : '▼ 범례'}
      </button>

      {open && (
        <div className="mt-1 bg-slate-800/95 backdrop-blur border border-slate-700 rounded p-3 w-52 space-y-3">
          <section>
            <div className="text-slate-400 font-semibold mb-1">이벤트 유형</div>
            {EVENT_ITEMS.map(({ label, color, shape }) => (
              <div key={label} className="flex items-center gap-2 py-0.5">
                <ShapeIcon shape={shape} color={color} />
                <span className="text-slate-300">{label}</span>
              </div>
            ))}
          </section>

          <section>
            <div className="text-slate-400 font-semibold mb-1">어트랙터 필드</div>
            {AF_ITEMS.map(({ label, color }) => (
              <div key={label} className="flex items-center gap-2 py-0.5">
                <span className="inline-block w-4 h-0.5 rounded" style={{ background: color }} />
                <span className="text-slate-300">{label}</span>
              </div>
            ))}
          </section>

          <section>
            <div className="text-slate-400 font-semibold mb-1">세계선 전환</div>
            {SHIFT_ITEMS.map(({ label, color }) => (
              <div key={label} className="flex items-center gap-2 py-0.5">
                <span className="inline-block w-4 h-0.5 rounded" style={{ background: color }} />
                <span className="text-slate-300">{label}</span>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  )
}

function ShapeIcon({ shape, color }: { shape: string; color: string }) {
  const s = 8
  return (
    <svg width={s * 2} height={s * 2} viewBox={`${-s} ${-s} ${s * 2} ${s * 2}`} style={{ flexShrink: 0 }}>
      {shape === 'circle' && <circle r={s * 0.6} fill={color} />}
      {shape === 'cross' && (
        <g stroke={color} strokeWidth={1.5}>
          <line x1={-s * 0.6} y1={-s * 0.6} x2={s * 0.6} y2={s * 0.6} />
          <line x1={s * 0.6} y1={-s * 0.6} x2={-s * 0.6} y2={s * 0.6} />
        </g>
      )}
      {shape === 'star' && <Star size={s * 0.65} fill={color} />}
      {shape === 'envelope' && (
        <rect x={-s * 0.7} y={-s * 0.5} width={s * 1.4} height={s} rx={1} fill={color} />
      )}
      {shape === 'arrow' && (
        <path
          d={`M ${-s * 0.7},${-s * 0.35} L ${s * 0.28},${-s * 0.35} L ${s * 0.28},${-s * 0.7} L ${s * 0.7},0 L ${s * 0.28},${s * 0.7} L ${s * 0.28},${s * 0.35} L ${-s * 0.7},${s * 0.35} Z`}
          fill={color}
        />
      )}
    </svg>
  )
}

function Star({ size, fill }: { size: number; fill: string }) {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? size : size * 0.45
    const a = (Math.PI / 5) * i - Math.PI / 2
    pts.push(`${r * Math.cos(a)},${r * Math.sin(a)}`)
  }
  return <polygon points={pts.join(' ')} fill={fill} />
}
