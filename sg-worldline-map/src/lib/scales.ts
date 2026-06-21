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

/**
 * 시간 구역 정의 — 데이터가 시간상 세 덩어리로 떨어져 있어(2010 여름 / 2011-01 SG0 /
 * 2025 단일 사건) 각 구역을 별도 선형 구간으로 두고 사이를 세로 물결(break)로 끊는다.
 * 큐레이션된 데이터셋이므로 경계는 명명 상수로 고정. 데이터가 구역 밖으로 확장되면
 * (validateDataset 경고 참고) 아래 경계를 갱신할 것.
 */
export interface TimeZone {
  id: string
  label: string
  start: Date
  end: Date
  /** innerWidth에서 이 구역이 차지할 비율 */
  frac: number
}

export const TIME_ZONES: TimeZone[] = [
  { id: 'A', label: '2010년 여름', start: new Date('2010-07-26'), end: new Date('2010-08-22'), frac: 0.62 },
  { id: 'B', label: '2011-01', start: new Date('2010-12-28'), end: new Date('2011-01-28'), frac: 0.20 },
  { id: 'C', label: '2025', start: new Date('2025-08-10'), end: new Date('2025-08-31'), frac: 0.13 },
]

/** 구역 사이 물결 break 1개가 차지할 폭 비율 (구역 frac 합 + GAP_FRAC×breakCount = 1.0) */
const GAP_FRAC = 0.025

export interface ZoneLayout extends TimeZone {
  /** 구역 시작/끝의 content-space x 픽셀 (transform 이전) */
  xStart: number
  xEnd: number
}

export function computeScales(dataset: SeriesDataset) {
  const { marginLeft, marginRight, marginTop, marginBottom, width, height } = MAP_DIMENSIONS
  const innerWidth = width - marginLeft - marginRight

  // 각 구역의 content-space 픽셀 범위 계산 — 구역 사이에 GAP_FRAC 만큼 물결 공간을 둔다.
  const zones: ZoneLayout[] = []
  let cursor = 0
  TIME_ZONES.forEach((z, i) => {
    const xStart = cursor
    const xEnd = cursor + innerWidth * z.frac
    zones.push({ ...z, xStart, xEnd })
    cursor = xEnd
    if (i < TIME_ZONES.length - 1) cursor += innerWidth * GAP_FRAC // 다음 구역 전 물결 간격
  })

  // 폴리리니어 시간 스케일: [A.start, A.end, B.start, B.end, C.start, C.end]
  // gap 구간(A.end~B.start 등)에는 데이터가 없어 보간 왜곡 없음.
  const domain = zones.flatMap((z) => [z.start, z.end])
  const range = zones.flatMap((z) => [z.xStart, z.xEnd])
  const x = d3.scaleTime().domain(domain).range(range)

  // 물결 break 위치 — 인접 구역 사이 gap 중앙
  const breaks = zones.slice(0, -1).map((z, i) => ({
    x: (z.xEnd + zones[i + 1].xStart) / 2,
  }))

  const xDomain: [Date, Date] = [zones[0].start, zones[zones.length - 1].end]

  // Y는 generate-data.py에서 계산됨 — 그대로 사용. 약간의 상하 여백.
  const ys = dataset.worldlines.map((w) => w.y)
  const yMin = Math.min(...ys, ...dataset.bands.map((b) => b.yTop)) - marginTop
  const yMax = Math.max(...ys, ...dataset.bands.map((b) => b.yBottom)) + marginBottom

  return { x, xDomain, width, height, yMin, yMax, zones, breaks }
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

  // 모든 이벤트 시각이 TIME_ZONES 안에 들어오는지 — 벗어나면 piecewise gap에 찍혀 안 보임.
  // (데이터가 새 시기로 확장되면 TIME_ZONES 갱신 필요 — 조기 경고)
  for (const e of dataset.events) {
    const t = parseLocalDateTime(e.localDateTime)
    const inZone = TIME_ZONES.some((z) => t >= z.start && t <= z.end)
    if (!inZone) {
      issues.push({
        level: 'warn',
        entity: `Event:${e.id}`,
        detail: `localDateTime "${e.localDateTime}"가 TIME_ZONES 밖 — 시간축 gap에 가려질 수 있음`,
      })
    }
  }

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
