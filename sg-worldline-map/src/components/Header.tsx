/**
 * 상단 헤더 — 시리즈 전환 + 위키로 돌아가기 링크.
 */

import { SERIES_ORDER, SERIES_LABELS } from '@/data/loader'
import type { SeriesId } from '@/types/ontology'

interface Props {
  current: SeriesId
  onSwitch: (s: SeriesId) => void
}

export function Header({ current, onSwitch }: Props) {
  return (
    <header className="flex items-center justify-between px-4 py-2 bg-slate-800/90 backdrop-blur border-b border-slate-700 z-10">
      <div className="flex items-center gap-3">
        <a
          href="/"
          className="text-slate-400 hover:text-slate-100 text-sm"
          title="위키로 돌아가기"
        >
          ← 위키
        </a>
        <span className="text-slate-600">|</span>
        <h1 className="text-slate-100 font-semibold text-sm md:text-base">
          세계선 인터랙티브 맵
        </h1>
      </div>

      <nav className="flex items-center gap-2">
        <span className="text-slate-500 text-xs hidden md:inline">시리즈:</span>
        {SERIES_ORDER.map((s) => (
          <button
            key={s}
            onClick={() => onSwitch(s)}
            className={`px-3 py-1 rounded text-xs md:text-sm border transition-colors ${
              current === s
                ? 'bg-orange-600 text-white border-orange-500'
                : 'bg-slate-700/60 text-slate-300 border-slate-600 hover:bg-slate-700'
            }`}
          >
            {SERIES_LABELS[s] ?? s}
          </button>
        ))}
      </nav>
    </header>
  )
}
