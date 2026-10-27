/**
 * 헤더 — 미래 가젯 연구소 단말 바.
 * 세계선 테마 통일(2026-10-27): 위키 다이버전스 비주얼라이저의 헤더 크롬으로
 * 재구성했다 — 비콘 · FUTURE GADGET LAB · 닉시관 미터(NixieMeter) · SFX 토글.
 * 로직(시리즈/뷰 전환)은 기존 그대로.
 */

import { useState } from 'react'
import { SERIES_ORDER, SERIES_LABELS } from '@/data/loader'
import { sfx } from '@/lib/sfx'
import type { SeriesId } from '@/types/ontology'
import { NixieMeter } from './NixieMeter'

export type ViewId = 'timeline' | 'graph'

interface Props {
  current: SeriesId
  onSwitch: (s: SeriesId) => void
  view: ViewId
  onViewSwitch: (v: ViewId) => void
  /** 헤더 닉시관이 가리킬 다이버전스('1.048596' 형식) — 선택/재생 중인 세계선 */
  focusValue: string | null
}

const VIEW_TABS: { id: ViewId; labelKo: string }[] = [
  { id: 'timeline', labelKo: '타임라인' },
  { id: 'graph', labelKo: '온톨로지 그래프' },
]

export function Header({ current, onSwitch, view, onViewSwitch, focusValue }: Props) {
  const [sfxOn, setSfxOn] = useState(sfx.enabled)

  return (
    <header className="relative z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 bg-viz-panel/95 border-b border-viz-line">
      <div className="flex items-center gap-3 min-w-0">
        <span className="viz-beacon shrink-0" aria-hidden="true" />
        <a
          href="/"
          className="text-viz-dim hover:text-viz-amber text-sm transition-colors"
          title="위키로 돌아가기"
        >
          ← 위키
        </a>
        <span className="text-viz-line" aria-hidden="true">|</span>
        <div className="hidden sm:block leading-tight">
          <h1 className="font-mono-tech text-viz-amber text-sm md:text-base font-semibold tracking-wider flex items-center gap-2">
            FUTURE GADGET LAB
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#451a03] text-viz-amberhi border border-viz-linehi font-normal tracking-normal">
              SYSTEM v2.57
            </span>
          </h1>
          <p className="font-mono-tech text-[10px] text-viz-dim tracking-wide">
            Divergence Monitoring &amp; Attractor Field Simulator
          </p>
        </div>

        {/* 뷰 스위처 (P1-2): 타임라인 | 온톨로지 그래프 */}
        <nav className="flex items-center gap-1 ml-1">
          {VIEW_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                if (view !== t.id) sfx.playBeep(880, 0.05)
                onViewSwitch(t.id)
              }}
              className={`font-mono-tech px-2.5 py-1 rounded text-xs border transition-colors ${
                view === t.id
                  ? 'bg-viz-panel2 text-viz-amber border-viz-amber/60'
                  : 'text-viz-dim border-transparent hover:border-viz-line hover:text-viz-ink'
              }`}
            >
              {t.labelKo}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        {/* 시리즈 선택은 타임라인 전용 (그래프는 TTL 전체 엔티티라 시리즈 무관) */}
        {view === 'timeline' && (
          <nav className="flex items-center gap-2">
            <span className="font-mono-tech text-viz-dim text-xs hidden md:inline">시리즈:</span>
            {SERIES_ORDER.map((s) => (
              <button
                key={s}
                onClick={() => {
                  if (current !== s) sfx.playShift()
                  onSwitch(s)
                }}
                className={`font-mono-tech px-3 py-1 rounded text-xs md:text-sm border transition-colors ${
                  current === s
                    ? 'bg-[#451a03] text-viz-amberhi border-viz-amber/60'
                    : 'text-viz-dim border-viz-line hover:border-viz-linehi hover:text-viz-ink'
                }`}
              >
                {SERIES_LABELS[s] ?? s}
              </button>
            ))}
          </nav>
        )}

        {/* 선택/재생 중 세계선의 다이버전스 — 비주얼라이저 닉시관 */}
        <div className="hidden md:flex items-center gap-2 px-2 py-1 rounded border border-viz-line bg-black/70">
          <span className="font-mono-tech text-[9px] text-viz-dim tracking-[0.2em]">DIVERGENCE</span>
          <NixieMeter value={focusValue} compact />
        </div>

        <button
          onClick={() => {
            sfx.enabled = !sfx.enabled
            setSfxOn(sfx.enabled)
            if (sfx.enabled) sfx.playBeep(1000, 0.08)
          }}
          className={`font-mono-tech px-2.5 py-1 rounded text-xs border transition-colors ${
            sfxOn
              ? 'text-viz-amber border-viz-linehi'
              : 'text-viz-dim border-viz-line'
          }`}
          title="레트로 효과음 켜기/끄기"
        >
          SFX: {sfxOn ? 'ON' : 'OFF'}
        </button>
      </div>
    </header>
  )
}
