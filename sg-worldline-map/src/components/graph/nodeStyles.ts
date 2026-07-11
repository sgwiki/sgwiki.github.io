/**
 * 그래프 노드 클래스별 색/반지름/라벨.
 * AF·WorldLine 색은 기존 타임라인의 FIELD_COLOR 재사용(시각 일관성),
 * 나머지 6개 클래스 색은 신규 설계 (계획 P0-4).
 */

import type { GraphNode, NodeClass } from '@/types/ontology'
import { FIELD_COLOR } from '@/lib/scales'

export const ALL_CLASSES: NodeClass[] = [
  'AttractorField',
  'WorldLine',
  'Event',
  'WorldLineShift',
  'MacroEvent',
  'EventVariation',
  'ConvergencePattern',
  'ScienceTopic',
  'MediaSource',
  'EvidenceSource',
]

export const CLASS_LABEL_KO: Record<NodeClass, string> = {
  AttractorField: '어트랙터 필드',
  WorldLine: '세계선',
  Event: '사건',
  WorldLineShift: '세계선 이동',
  MacroEvent: '거시 사건',
  EventVariation: '사건 변형',
  ConvergencePattern: '수속 패턴',
  ScienceTopic: '과학 주제',
  MediaSource: '미디어 소스',
  EvidenceSource: '근거 소스',
}

/** 대표색 — AF/WorldLine은 실제로는 소속 필드 색(FIELD_COLOR)을 쓴다 (nodeColor 참조) */
export const CLASS_COLOR: Record<NodeClass, string> = {
  AttractorField: '#f59e0b',
  WorldLine: '#94a3b8',
  Event: '#60a5fa',
  WorldLineShift: '#fb923c',
  MacroEvent: '#a78bfa',
  EventVariation: '#818cf8',
  ConvergencePattern: '#f43f5e',
  ScienceTopic: '#fbbf24',
  MediaSource: '#34d399',
  EvidenceSource: '#a3e635',
}

/** 클래스 위계 = 크기 (AF > WL > 거시 > 사건 > 소스) */
export const CLASS_RADIUS: Record<NodeClass, number> = {
  AttractorField: 16,
  WorldLine: 10,
  MacroEvent: 9,
  ConvergencePattern: 9,
  ScienceTopic: 7,
  Event: 6.5,
  WorldLineShift: 6,
  EventVariation: 5.5,
  EvidenceSource: 5,
  MediaSource: 4.5,
}

export function nodeColor(n: GraphNode): string {
  if (n.class === 'AttractorField') return FIELD_COLOR[n.id] ?? CLASS_COLOR.AttractorField
  if (n.class === 'WorldLine' && n.attractorField) {
    return FIELD_COLOR[n.attractorField] ?? CLASS_COLOR.WorldLine
  }
  return CLASS_COLOR[n.class]
}

export function nodeRadius(n: GraphNode): number {
  return CLASS_RADIUS[n.class] ?? 6
}

export function nodeLabel(n: GraphNode): string {
  return n.labelKo ?? n.id
}
