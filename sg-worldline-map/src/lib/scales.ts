/**
 * 맵 렌더링 공통 유틸리티 — D3 scale, 색상 매핑, 시간 파싱.
 */

import * as d3 from 'd3'
import type {
  AttractorFieldId,
  EventType,
  SeriesDataset,
} from '@/types/ontology'

// ─── 시간 파싱 ──────────────────────────────────────────────────────
const DT_FORMAT = '%Y-%m-%d %H:%M'
const DT_PARSER = d3.timeParse(DT_FORMAT)

export function parseLocalDateTime(s: string): Date {
  const d = DT_PARSER(s)
  if (!d) {
    // fallback: 시간 없는 형태 대비
    const day = d3.timeParse('%Y-%m-%d')(s)
    if (day) return day
    // 최후의 보루 — 잘못된 데이터가 빌드를 깨지 않게
    return new Date(s)
  }
  return d
}

export function formatLocalDateTime(d: Date): string {
  return d3.timeFormat(DT_FORMAT)(d)
}

// ─── X 스케일 ────────────────────────────────────────────────────────
export const MAP_DIMENSIONS = {
  width: 1400,
  height: 960,
  marginLeft: 80,
  marginRight: 120,
  marginTop: 40,
  marginBottom: 60,
}

export function computeScales(dataset: SeriesDataset) {
  const { marginLeft, marginRight, marginTop, marginBottom, width, height } = MAP_DIMENSIONS
  const innerWidth = width - marginLeft - marginRight

  // X 도메인: 모든 시간 정보(이벤트 localDateTime + shift shiftMoment)의 범위
  const times: Date[] = []
  for (const e of dataset.events) times.push(parseLocalDateTime(e.localDateTime))
  for (const s of dataset.shifts) times.push(parseLocalDateTime(s.shiftMoment))
  // convergence의 onTimeline 항목 timeWindow는 "YYYY-MM-DD ..." 형태라 별도 파싱
  for (const c of dataset.convergence) {
    if (c.onTimeline && /^\d{4}-\d{2}-\d{2}/.test(c.timeWindow)) {
      times.push(parseLocalDateTime(c.timeWindow.split(' ')[0]))
    }
  }
  const minTime = d3.min(times) ?? new Date('2010-07-28')
  const maxTime = d3.max(times) ?? new Date('2010-08-21')
  // 양끝 패딩
  const padMs = (maxTime.getTime() - minTime.getTime()) * 0.03
  const xDomain: [Date, Date] = [
    new Date(minTime.getTime() - padMs),
    new Date(maxTime.getTime() + padMs),
  ]

  const x = d3.scaleTime().domain(xDomain).range([0, innerWidth])

  // Y는 generate-data.py에서 계산됨 — 그대로 사용. 약간의 상하 여백.
  const ys = dataset.worldlines.map((w) => w.y)
  const yMin = Math.min(...ys, ...dataset.bands.map((b) => b.yTop)) - marginTop
  const yMax = Math.max(...ys, ...dataset.bands.map((b) => b.yBottom)) + marginBottom

  return { x, xDomain, width, height, yMin, yMax }
}

// ─── 색상 매핑 ───────────────────────────────────────────────────────
export const FIELD_COLOR: Record<AttractorFieldId, string> = {
  AF_Alpha: '#ef4444',
  AF_Beta: '#6366f1',
  AF_SteinsGate: '#f59e0b',
  AF_Omega: '#6b7280',
}

export const SHIFT_COLOR: Record<string, string> = {
  dmail: '#3b82f6',           // 파랑
  presentAction: '#f97316',   // 주황 — 에셜론 삭제 등
  'physicaltravel+videodmail': '#f59e0b', // 금 — 스쿨드/SG 도달
}

export function shiftColor(shiftType: string): string {
  return SHIFT_COLOR[shiftType] ?? '#94a3b8' // 알 수 없는 타입은 회색
}

export function bandColor(af: AttractorFieldId): string {
  return FIELD_COLOR[af] ?? '#94a3b8'
}

// eventType별 노드 아이콘 매핑 (SVG 심볼 id)
export const EVENT_ICON: Record<EventType, string> = {
  death: '#icon-skull',
  communication: '#icon-mail',
  intervention: '#icon-star',
  travel: '#icon-arrow',
  actual: '#icon-dot',
}

// ─── 위키 링크 빌더 ──────────────────────────────────────────────────
/**
 * 세계선 → 위키 문서 URL.
 * wikiSlug가 있으면 정확한 문서로, 없으면 검색 폴백.
 */
export function worldlineWikiUrl(wl: { divergence: number; wikiSlug?: string | null }): string {
  if (wl.wikiSlug) {
    return `/세계선/${wl.wikiSlug}/`
  }
  // slug 미등록 → 검색 페이지 폴백
  return `/search/?q=${encodeURIComponent(wl.divergence.toFixed(6))}`
}

// ─── 데이터 검증 (런타임 안전망) ─────────────────────────────────────
export interface DataIssue {
  level: 'warn' | 'error'
  entity: string
  detail: string
}

/**
 * 데이터셋 내 참조 무결성 검사.
 * shift.fromWorldLineId가 worldlines에 없거나, event.worldLineId가 비어있으면 경고.
 */
export function validateDataset(dataset: SeriesDataset): DataIssue[] {
  const issues: DataIssue[] = []
  const wlIds = new Set(dataset.worldlines.map((w) => w.uri))
  const eventIds = new Set(dataset.events.map((e) => e.uri))
  const shiftIds = new Set(dataset.shifts.map((s) => s.uri))

  for (const s of dataset.shifts) {
    if (!wlIds.has(s.fromWorldLineId)) {
      issues.push({
        level: 'error',
        entity: `Shift:${s.id}`,
        detail: `fromWorldLineId "${s.fromWorldLineId}"를 worldlines에서 찾을 수 없음`,
      })
    }
    if (!wlIds.has(s.toWorldLineId)) {
      issues.push({
        level: 'error',
        entity: `Shift:${s.id}`,
        detail: `toWorldLineId "${s.toWorldLineId}"를 worldlines에서 찾을 수 없음`,
      })
    }
    if (s.triggeredByEventId && !eventIds.has(s.triggeredByEventId)) {
      issues.push({
        level: 'warn',
        entity: `Shift:${s.id}`,
        detail: `triggeredByEventId "${s.triggeredByEventId}" 미발견`,
      })
    }
    if (s.fromY == null || s.toY == null) {
      issues.push({
        level: 'error',
        entity: `Shift:${s.id}`,
        detail: `fromY/toY 누락`,
      })
    }
  }

  // playback script의 worldLineId/shiftId가 데이터에 존재하는지
  if (dataset.playbackScript) {
    for (const ch of dataset.playbackScript.channels) {
      for (const step of ch.steps) {
        if (step.worldLineId && !wlIds.has(step.worldLineId)) {
          issues.push({
            level: 'warn',
            entity: `Playback:${ch.id}`,
            detail: `worldLineId "${step.worldLineId}" 미발견`,
          })
        }
        if (step.shiftId && !shiftIds.has(step.shiftId)) {
          issues.push({
            level: 'warn',
            entity: `Playback:${ch.id}`,
            detail: `shiftId "${step.shiftId}" 미발견`,
          })
        }
      }
    }
  }

  return issues
}
