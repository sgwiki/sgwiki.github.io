/**
 * 그래프 엣지 관계별 색/점선/한국어 라벨 + 필터용 관계 그룹.
 * generate-data.py CANONICAL_RELATIONS(정준 방향)와 1:1.
 */

import type { RelationType } from '@/types/ontology'

export type RelationGroupId =
  | 'causal'
  | 'membership'
  | 'shift'
  | 'appearance'
  | 'convergence'
  | 'science'

export const RELATION_GROUP_LABEL_KO: Record<RelationGroupId, string> = {
  causal: '인과 (유발·전제·차단)',
  membership: '멤버십 (소속·구성)',
  shift: '세계선 이동',
  convergence: '수속',
  appearance: '미디어 등장',
  science: '과학 해설',
}

export const RELATION_GROUP_ORDER: RelationGroupId[] = [
  'causal',
  'membership',
  'shift',
  'convergence',
  'appearance',
  'science',
]

export interface RelationStyle {
  color: string
  /** stroke-dasharray. 없으면 실선 */
  dash?: string
  labelKo: string
  group: RelationGroupId
  /** force layout 링크 목표 거리 */
  dist: number
}

export const RELATION_STYLES: Record<RelationType, RelationStyle> = {
  causes: { color: '#ef4444', labelKo: '유발', group: 'causal', dist: 95 },
  enables: { color: '#22c55e', labelKo: '전제(enables)', group: 'causal', dist: 95 },
  prevents: { color: '#eab308', dash: '6 3', labelKo: '차단', group: 'causal', dist: 95 },
  belongsToAttractorField: { color: '#475569', labelKo: 'AF 소속', group: 'membership', dist: 75 },
  belongsToWorldLine: { color: '#475569', labelKo: '세계선 소속', group: 'membership', dist: 55 },
  partOfMacroEvent: { color: '#64748b', dash: '2 3', labelKo: '거시 사건 구성', group: 'membership', dist: 55 },
  partOfVariation: { color: '#475569', labelKo: '변형 구성', group: 'membership', dist: 45 },
  participatesInShift: { color: '#fb923c', dash: '4 3', labelKo: '이동 참여', group: 'shift', dist: 70 },
  triggeredByEvent: { color: '#fb923c', labelKo: '이동 트리거', group: 'shift', dist: 70 },
  fromWorldLine: { color: '#fdba74', dash: '4 3', labelKo: '출발 세계선', group: 'shift', dist: 85 },
  toWorldLine: { color: '#fdba74', labelKo: '도착 세계선', group: 'shift', dist: 85 },
  hasConvergencePattern: { color: '#f43f5e', labelKo: '수속 패턴', group: 'convergence', dist: 80 },
  hasVariantVariation: { color: '#f43f5e', dash: '4 3', labelKo: '수속 변형', group: 'convergence', dist: 80 },
  appearsIn: { color: '#34d399', dash: '2 3', labelKo: '등장', group: 'appearance', dist: 60 },
  explainsEntity: { color: '#fbbf24', dash: '2 3', labelKo: '해설 대상', group: 'science', dist: 75 },
  supportedByEvidence: { color: '#a3e635', dash: '2 3', labelKo: '근거', group: 'science', dist: 60 },
  relatedTopic: { color: '#fbbf24', dash: '6 3', labelKo: '연관 주제', group: 'science', dist: 90 },
}

export function relationsOfGroup(group: RelationGroupId): RelationType[] {
  return (Object.keys(RELATION_STYLES) as RelationType[]).filter(
    (r) => RELATION_STYLES[r].group === group,
  )
}
