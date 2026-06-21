/**
 * App 루트 — 시리즈 상태 + 재생 모드 외부 강조 관리.
 * URL 경로(/maps/, /maps/anime/, /maps/sg0/)로 시리즈 결정.
 */

import { useEffect, useState } from 'react'
import { Header } from '@/components/Header'
import { WorldLineMap } from '@/components/WorldLineMap'
import { EventDetailPanel } from '@/components/EventDetailPanel'
import { PlaybackBar } from '@/components/PlaybackBar'
import { datasets, resolveSeries, getDataset } from '@/data/loader'
import { validateDataset } from '@/lib/scales'
import type { PlaybackStep, SeriesId } from '@/types/ontology'

export function App() {
  // URL에서 시리즈 결정: /maps/anime/ → anime, /maps/sg0/ → sg0
  const pathSegments = window.location.pathname.replace(/^\/maps\/?/, '').split('/').filter(Boolean)
  const initialSeries = resolveSeries(pathSegments[0] ?? null)
  const [series, setSeries] = useState<SeriesId>(initialSeries)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [playbackStep, setPlaybackStep] = useState<PlaybackStep | null>(null)

  const dataset = getDataset(series)

  // 시리즈 변경 시 URL 업데이트 (느슨한 라우팅)
  useEffect(() => {
    const newPath = `/maps/${series}/`
    if (window.location.pathname !== newPath) {
      window.history.replaceState(null, '', newPath)
    }
  }, [series])

  // 렌더링 전 데이터 무결성 경고 (개발 모드 콘솔)
  useEffect(() => {
    const issues = validateDataset(dataset)
    if (issues.length > 0) {
      console.warn(`[데이터 검증] ${issues.length}개 이슈 (series=${series}):`, issues)
    }
  }, [dataset, series])

  const selectedEvent = selectedEventId
    ? dataset.events.find((e) => e.uri === selectedEventId || e.id === selectedEventId) ?? null
    : null

  const availableSeries = Object.keys(datasets)
  const isPlayable = !!dataset.playbackScript

  return (
    <div className="flex flex-col h-screen">
      <Header current={series} onSwitch={(s) => { setSeries(s); setSelectedEventId(null); setPlaybackStep(null) }} />

      {/* 사용 가능한 시리즈가 1개면 안내 (S;G0 데이터 추가 시 자동 활성화) */}
      {availableSeries.length === 1 && (
        <div className="bg-slate-800/50 text-slate-400 text-xs px-4 py-1 text-center border-b border-slate-800">
          📌 현재 애니메이션 시리즈만 제공됩니다. 추가 시리즈(S;G0 게임 등)는 데이터 저작 후 순차 공개됩니다.
        </div>
      )}

      <div className="flex-1 relative">
        <WorldLineMap
          dataset={dataset}
          onSelectEvent={setSelectedEventId}
          externalHighlight={
            playbackStep
              ? {
                  worldLineId: playbackStep.worldLineId ?? null,
                  eventId: playbackStep.eventId ?? null,
                  shiftId: playbackStep.shiftId ?? null,
                }
              : null
          }
        />

        {isPlayable && (
          <PlaybackBar dataset={dataset} onStepChange={setPlaybackStep} />
        )}
      </div>

      <EventDetailPanel
        event={selectedEvent}
        dataset={dataset}
        onClose={() => setSelectedEventId(null)}
      />
    </div>
  )
}
