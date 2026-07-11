import { SERIES_ORDER, SERIES_LABELS } from '@/data/loader'
import type { SeriesId } from '@/types/ontology'

export type ViewId = 'timeline' | 'graph'

interface Props {
  current: SeriesId
  onSwitch: (s: SeriesId) => void
  view: ViewId
  onViewSwitch: (v: ViewId) => void
}

const VIEW_TABS: { id: ViewId; labelKo: string }[] = [
  { id: 'timeline', labelKo: '타임라인' },
  { id: 'graph', labelKo: '온톨로지 그래프' },
]

export function Header({ current, onSwitch, view, onViewSwitch }: Props) {
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
        <h1 className="text-[#C0D8F0] font-semibold text-sm md:text-base tracking-wide hidden sm:block">
          세계선 인터랙티브 맵
        </h1>
        {/* 뷰 스위처 (P1-2): 타임라인 | 온톨로지 그래프 */}
        <nav className="flex items-center gap-1 ml-1">
          {VIEW_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => onViewSwitch(t.id)}
              className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                view === t.id
                  ? 'bg-[#152240] text-[#C0D8F0] border-[#4A6A8A]/60'
                  : 'text-[#4A6A8A] border-transparent hover:border-[#152240] hover:text-[#C0D8F0]'
              }`}
            >
              {t.labelKo}
            </button>
          ))}
        </nav>
      </div>

      {/* 시리즈 선택은 타임라인 전용 (그래프는 TTL 전체 엔티티라 시리즈 무관) */}
      {view === 'timeline' && (
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
      )}
    </header>
  )
}
