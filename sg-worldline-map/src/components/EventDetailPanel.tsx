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
    <div className="fixed right-0 top-0 h-full w-80 bg-[#0A1525]/98 backdrop-blur border-l border-[#152240] p-5 overflow-y-auto z-20 shadow-2xl">
      <div className="flex justify-between items-start mb-3">
        <h2 className="text-lg font-bold text-[#C0D8F0] flex items-center gap-2">
          <span className="text-xl">{mechanismIcon(event.mechanismType)}</span>
          {event.labelKo}
        </h2>
        <button
          onClick={onClose}
          className="text-[#4A6A8A] hover:text-[#C0D8F0] text-2xl leading-none transition-colors"
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

      <p className="text-sm text-[#A0B8CC] leading-relaxed mb-4 whitespace-pre-line">
        {event.summary}
      </p>

      {/* 세계선 이동 정보 */}
      {shift && fromWl && toWl && (
        <div
          className="rounded p-3 mb-4 text-sm"
          style={{ background: shiftColor(shift.shiftType) + '18', borderLeft: `3px solid ${shiftColor(shift.shiftType)}` }}
        >
          <div className="text-[#4A6A8A] text-xs mb-2">세계선 이동 ({shiftTypeKo(shift.shiftType)})</div>
          <div className="nixie text-sm">
            {(fromWl.divergence > 0 ? '+' : '') + fromWl.divergence.toFixed(6)}%
            <span className="mx-2 text-[#4A6A8A]" style={{ fontFamily: 'inherit', textShadow: 'none', color: '#4A6A8A' }}>→</span>
            {(toWl.divergence > 0 ? '+' : '') + toWl.divergence.toFixed(6)}%
          </div>
        </div>
      )}

      {/* 현재 세계선 */}
      {wl && (
        <div className="rounded p-3 mb-4 text-sm" style={{ background: '#040810' }}>
          <div className="text-[#4A6A8A] text-xs mb-1">현재 세계선</div>
          <div className="text-[#C0D8F0] font-semibold">{wl.labelKo}</div>
          <div className="text-xs mt-1">
            <span className="nixie text-xs">
              {(wl.divergence > 0 ? '+' : '') + wl.divergence.toFixed(6)}%
            </span>
            <span className="text-[#4A6A8A]"> · {wl.attractorField.replace('AF_', '')}</span>
          </div>
        </div>
      )}

      {/* 느슨한 위키 링크 */}
      {wl && (
        <a
          href={worldlineWikiUrl(wl)}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-white py-2 px-4 rounded transition-colors hover:brightness-110"
          style={{ background: '#C25200' }}
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
      <dt className="text-[#4A6A8A] w-16 flex-shrink-0">{label}</dt>
      <dd className="text-[#C0D8F0]">{value}</dd>
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
