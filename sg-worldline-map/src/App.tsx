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
import type { PlaybackStep, SeriesDataset, SeriesId } from '@/types/ontology'

/**
 * 재생 단계에서 강조할 이벤트 id 결정.
 * 단계에 eventId가 명시되면 그대로, 아니면 shift의 triggeredByEventId(화살표 꼬리 D메일)를 사용.
 */
function resolvePlaybackEventId(step: PlaybackStep, dataset: SeriesDataset): string | null {
  if (step.eventId) return step.eventId
  if (step.shiftId) {
    const sh = dataset.shifts.find((s) => s.id === step.shiftId || s.uri === step.shiftId)
    return sh?.triggeredByEventId ?? null
  }
  return null
}

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

  // 재생 중에는 현재 단계에서 활성화된 D메일 이벤트를 기존 상세 패널에 그대로 표시.
  const playbackEventId = playbackStep ? resolvePlaybackEventId(playbackStep, dataset) : null
  const playbackEvent = playbackEventId
    ? dataset.events.find((e) => e.uri === playbackEventId || e.id === playbackEventId) ?? null
    : null
  const panelEvent = playbackStep ? playbackEvent : selectedEvent

  const availableSeries = Object.keys(datasets)
  const isPlayable = !!dataset.playbackScript

  return (
    <div className="flex flex-col h-screen">
      <Header current={series} onSwitch={(s) => { setSeries(s); setSelectedEventId(null); setPlaybackStep(null) }} />

      {/* 사용 가능한 시리즈가 1개면 안내 (S;G0 데이터 추가 시 자동 활성화) */}
      {availableSeries.length === 1 && (
        <div className="bg-[#0A1525]/60 text-[#4A6A8A] text-xs px-4 py-1 text-center border-b border-[#152240]">
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
                  // 이동(화살표) 단계면 그 이동을 일으킨 D메일(꼬리 쪽 메일)도 함께 강조
                  eventId: resolvePlaybackEventId(playbackStep, dataset),
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
        event={panelEvent}
        dataset={dataset}
        onClose={() => setSelectedEventId(null)}
      />
    </div>
  )
}
