/**
 * 이벤트 클릭 시 상세 패널 (우측).
 * AC5/AC7: mechanismType 아이콘, from/to 발산률, 위키 링크.
 */

import type { SeriesDataset, SGEvent } from '@/types/ontology'
import { worldlineWikiUrl, shiftColor } from '@/lib/scales'

interface Props {
  event: SGEvent | null
  dataset: SeriesDataset
  onClose: () => void
}

export function EventDetailPanel({ event, dataset, onClose }: Props) {
  if (!event) return null

  const wl = dataset.worldlines.find((w) => w.uri === event.worldLineId || w.id === event.worldLineId)
  const shift = dataset.shifts.find((s) => s.triggeredByEventId === event.uri || s.triggeredByEventId === event.id)
  const fromWl = shift ? dataset.worldlines.find((w) => w.uri === shift.fromWorldLineId) : null
  const toWl = shift ? dataset.worldlines.find((w) => w.uri === shift.toWorldLineId) : null

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-slate-800/95 backdrop-blur border-l border-slate-700 p-5 overflow-y-auto z-20 shadow-2xl">
      <div className="flex justify-between items-start mb-3">
        <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
          <span className="text-xl">{mechanismIcon(event.mechanismType)}</span>
          {event.labelKo}
        </h2>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-100 text-2xl leading-none"
          aria-label="닫기"
        >
          ×
        </button>
      </div>

      <dl className="text-sm space-y-2 mb-4">
        <Row label="시각" value={`${event.localDateTime} (${precisionKo(event.timePrecision)})`} />
        {event.place && <Row label="장소" value={event.place} />}
        {event.actor && <Row label="행위자" value={charKo(event.actor)} />}
        {event.target && <Row label="대상" value={charKo(event.target)} />}
        <Row label="사건 유형" value={eventTypeKo(event.eventType)} />
        <Row label="메커니즘" value={mechanismKo(event.mechanismType)} />
      </dl>

      <p className="text-sm text-slate-300 leading-relaxed mb-4 whitespace-pre-line">
        {event.summary}
      </p>

      {/* 세계선 이동 정보 */}
      {shift && fromWl && toWl && (
        <div
          className="rounded p-3 mb-4 text-sm"
          style={{ background: shiftColor(shift.shiftType) + '20', borderLeft: `3px solid ${shiftColor(shift.shiftType)}` }}
        >
          <div className="text-slate-400 text-xs mb-1">세계선 이동 ({shiftTypeKo(shift.shiftType)})</div>
          <div className="font-mono text-slate-100">
            {(fromWl.divergence > 0 ? '+' : '') + fromWl.divergence.toFixed(6)}%
            <span className="mx-2">→</span>
            {(toWl.divergence > 0 ? '+' : '') + toWl.divergence.toFixed(6)}%
          </div>
        </div>
      )}

      {/* 현재 세계선 */}
      {wl && (
        <div className="rounded bg-slate-900/50 p-3 mb-4 text-sm">
          <div className="text-slate-400 text-xs mb-1">현재 세계선</div>
          <div className="text-slate-100 font-semibold">{wl.labelKo}</div>
          <div className="text-xs text-slate-400 mt-1">
            {(wl.divergence > 0 ? '+' : '') + wl.divergence.toFixed(6)}% · {wl.attractorField.replace('AF_', '')}
          </div>
        </div>
      )}

      {/* 느슨한 위키 링크 */}
      {wl && (
        <a
          href={worldlineWikiUrl(wl.divergence)}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center bg-deep-orange-600 hover:bg-orange-600 text-white py-2 px-4 rounded transition-colors"
          style={{ background: '#ea580c' }}
        >
          📖 위키에서 자세히 보기 →
        </a>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="text-slate-400 w-16 flex-shrink-0">{label}</dt>
      <dd className="text-slate-200">{value}</dd>
    </div>
  )
}

function charKo(charId: string): string {
  return charId.replace('Char_', '')
}

function eventTypeKo(t: string): string {
  const map: Record<string, string> = {
    actual: '실제 사건',
    intervention: '개입',
    communication: '통신 (D메일 등)',
    travel: '시간 이동',
    death: '사망',
  }
  return map[t] ?? t
}

function mechanismKo(t: string): string {
  const map: Record<string, string> = {
    dmail: 'D메일',
    timeleap: '타임리프',
    physicaltravel: '물리적 시간 이동',
    videodmail: '영상 D메일',
    none: '해당 없음',
  }
  return map[t] ?? t
}

function shiftTypeKo(t: string): string {
  const map: Record<string, string> = {
    dmail: 'D메일',
    presentAction: '현재 행위 (에셜론 삭제 등)',
    'physicaltravel+videodmail': '물리 이동 + 영상 D메일 (스쿨드 작전)',
  }
  return map[t] ?? t
}

function precisionKo(p: string): string {
  const map: Record<string, string> = {
    exact: '정확',
    approximate: '대략',
    day: '날짜',
    unknown: '불명',
  }
  return map[p] ?? p
}

function mechanismIcon(t: string): string {
  const map: Record<string, string> = {
    dmail: '✉',
    timeleap: '↺',
    physicaltravel: '⏱',
    videodmail: '🎥',
    none: '·',
  }
  return map[t] ?? '·'
}
