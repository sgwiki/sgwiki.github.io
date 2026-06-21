import { SERIES_ORDER, SERIES_LABELS } from '@/data/loader'
import type { SeriesId } from '@/types/ontology'

interface Props {
  current: SeriesId
  onSwitch: (s: SeriesId) => void
}

export function Header({ current, onSwitch }: Props) {
  return (
    <header className="flex items-center justify-between px-4 py-2 bg-[#0A1525] border-b border-[#152240] z-10">
      <div className="flex items-center gap-3">
        <a
          href="/"
          className="text-[#4A6A8A] hover:text-[#C0D8F0] text-sm transition-colors"
          title="위키로 돌아가기"
        >
          ← 위키
        </a>
        <span className="text-[#152240]">|</span>
        <h1 className="text-[#C0D8F0] font-semibold text-sm md:text-base tracking-wide">
          세계선 인터랙티브 맵
        </h1>
      </div>

      <nav className="flex items-center gap-2">
        <span className="text-[#4A6A8A] text-xs hidden md:inline">시리즈:</span>
        {SERIES_ORDER.map((s) => (
          <button
            key={s}
            onClick={() => onSwitch(s)}
            className={`px-3 py-1 rounded text-xs md:text-sm border transition-colors ${
              current === s
                ? 'bg-[#C25200] text-white border-[#FF8C00]/60'
                : 'text-[#4A6A8A] border-[#152240] hover:border-[#4A6A8A] hover:text-[#C0D8F0]'
            }`}
          >
            {SERIES_LABELS[s] ?? s}
          </button>
        ))}
      </nav>
    </header>
  )
}
