/**
 * App 루트 — 시리즈 상태 + 재생 모드 외부 강조 + 뷰 스위처(타임라인|온톨로지 그래프) 관리.
 *
 * URL 규약 (두 스킴 공존 — P1-2):
 *   - 경로 = 시리즈 라우팅: /maps/, /maps/anime/, /maps/sg0/
 *   - 쿼리 = 뷰 라우팅:    ?view=graph&focus=<id> (그래프 딥링크)
 *                          ?view=graph&focus=<id>&embed=1&theme=<light|dark> (위키 임베드)
 *   시리즈 replaceState가 쿼리를 덮어쓰지 않도록 URL 동기화는 한 곳(syncUrl 이펙트)에서만 한다.
 */

import { useEffect, useState } from 'react'
import { Header, type ViewId } from '@/components/Header'
import { WorldLineMap } from '@/components/WorldLineMap'
import { EventDetailPanel } from '@/components/EventDetailPanel'
import { PlaybackBar } from '@/components/PlaybackBar'
import { GraphExplorer } from '@/components/GraphExplorer'
import { EmbedGraph } from '@/components/graph/EmbedGraph'
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

/** 마운트 시점의 쿼리 파라미터 — 이후 replaceState가 URL을 바꾸므로 최초 1회만 캡처 */
function captureInitialParams() {
  const params = new URLSearchParams(window.location.search)
  return {
    view: (params.get('view') === 'graph' ? 'graph' : 'timeline') as ViewId,
    focus: params.get('focus'),
    embed: params.get('embed') === '1',
    theme: (params.get('theme') === 'light' ? 'light' : 'dark') as 'light' | 'dark',
  }
}

export function App() {
  const [initial] = useState(captureInitialParams)

  // URL에서 시리즈 결정: /maps/anime/ → anime, /maps/sg0/ → sg0
  const pathSegments = window.location.pathname.replace(/^\/maps\/?/, '').split('/').filter(Boolean)
  const initialSeries = resolveSeries(pathSegments[0] ?? null)
  const [series, setSeries] = useState<SeriesId>(initialSeries)
  const [view, setView] = useState<ViewId>(initial.view)
  const [graphFocus, setGraphFocus] = useState<string | null>(initial.focus)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [playbackStep, setPlaybackStep] = useState<PlaybackStep | null>(null)

  const dataset = getDataset(series)

  // 시리즈(경로)·뷰(쿼리) 변경 시 URL 동기화 — 쿼리스트링 보존 (느슨한 라우팅)
  useEffect(() => {
    if (initial.embed) return // 임베드 iframe의 URL은 부모(위키) 소유 — 건드리지 않음
    const params = new URLSearchParams(window.location.search)
    if (view === 'graph') params.set('view', 'graph')
    else params.delete('view')
    if (view === 'graph' && graphFocus) params.set('focus', graphFocus)
    else params.delete('focus')
    const qs = params.toString()
    const newUrl = `/maps/${series}/${qs ? `?${qs}` : ''}`
    if (window.location.pathname + window.location.search !== newUrl) {
      window.history.replaceState(null, '', newUrl)
    }
  }, [series, view, graphFocus, initial.embed])

  // 렌더링 전 데이터 무결성 경고 (개발 모드 콘솔)
  useEffect(() => {
    const issues = validateDataset(dataset)
    if (issues.length > 0) {
      console.warn(`[데이터 검증] ${issues.length}개 이슈 (series=${series}):`, issues)
    }
  }, [dataset, series])

  // ─── 임베드 모드 (P2-2): 크롬 없이 1홉 이웃 그래프만 ───
  if (initial.embed) {
    return <EmbedGraph initialFocus={initial.focus} theme={initial.theme} />
  }

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
      <Header
        current={series}
        onSwitch={(s) => { setSeries(s); setSelectedEventId(null); setPlaybackStep(null) }}
        view={view}
        onViewSwitch={(v) => { setView(v); if (v !== 'timeline') setPlaybackStep(null) }}
      />

      {/* 사용 가능한 시리즈가 1개면 안내 (S;G0 데이터 추가 시 자동 활성화) */}
      {view === 'timeline' && availableSeries.length === 1 && (
        <div className="bg-[#0A1525]/60 text-[#4A6A8A] text-xs px-4 py-1 text-center border-b border-[#152240]">
          📌 현재 애니메이션 시리즈만 제공됩니다. 추가 시리즈(S;G0 게임 등)는 데이터 저작 후 순차 공개됩니다.
        </div>
      )}

      {view === 'graph' ? (
        <div className="flex-1 min-h-0">
          <GraphExplorer
            focusNodeId={graphFocus}
            onFocusChange={setGraphFocus}
            onShowEventInTimeline={(eventUri) => {
              setView('timeline')
              setSelectedEventId(eventUri)
            }}
          />
        </div>
      ) : (
        <>
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
            onShowInGraph={(eventUri) => {
              setView('graph')
              setGraphFocus(eventUri)
              setSelectedEventId(null)
              setPlaybackStep(null)
            }}
          />
        </>
      )}
    </div>
  )
}
