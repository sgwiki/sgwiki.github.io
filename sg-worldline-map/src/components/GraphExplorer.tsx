/**
 * 온톨로지 그래프 전역 탐색기 (P1-1) — /maps/?view=graph
 * GraphView(global 모드) + 클래스/관계 필터 + 검색-투-포커스 + 범례 + 노드 상세 패널.
 * 기본 프리셋은 핵심 클래스만 켜서 헤어볼을 억제한다 (anti-hairball).
 */

import { useEffect, useMemo, useState } from 'react'
import type { GraphNode, NodeClass } from '@/types/ontology'
import { graphDataset } from '@/data/loader'
import { GraphView } from '@/components/graph/GraphView'
import {
  ALL_CLASSES,
  CLASS_COLOR,
  CLASS_LABEL_KO,
  nodeColor,
  nodeLabel,
} from '@/components/graph/nodeStyles'
import {
  RELATION_GROUP_LABEL_KO,
  RELATION_GROUP_ORDER,
  RELATION_STYLES,
  type RelationGroupId,
} from '@/components/graph/edgeStyles'
import { wikiPageUrl, wikiRefsFor } from '@/lib/ontologyLinks'
import { worldlineWikiUrl } from '@/lib/scales'

/** 기본 ON 클래스 — 서사 코어. 소스·주제·변형은 필터로 켠다. */
const DEFAULT_CLASSES: NodeClass[] = [
  'AttractorField',
  'WorldLine',
  'Event',
  'WorldLineShift',
  'MacroEvent',
  'ConvergencePattern',
]
const DEFAULT_GROUPS: RelationGroupId[] = ['causal', 'membership', 'shift', 'convergence']

interface Props {
  focusNodeId: string | null
  onFocusChange: (id: string | null) => void
  /** Event 노드 상세의 "타임라인에서 보기" (연동 방향 6 역방향) */
  onShowEventInTimeline: (eventUri: string) => void
}

export function GraphExplorer({ focusNodeId, onFocusChange, onShowEventInTimeline }: Props) {
  const { nodes, edges } = graphDataset
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  const [enabledClasses, setEnabledClasses] = useState<Set<NodeClass>>(
    () => new Set(DEFAULT_CLASSES),
  )
  const [enabledGroups, setEnabledGroups] = useState<Set<RelationGroupId>>(
    () => new Set(DEFAULT_GROUPS),
  )
  const [selectedId, setSelectedId] = useState<string | null>(focusNodeId)
  const [search, setSearch] = useState('')

  // 딥링크/외부 포커스: 대상 노드의 클래스가 꺼져 있으면 자동 활성화
  useEffect(() => {
    if (!focusNodeId) return
    const node = nodeById.get(focusNodeId)
    if (!node) return
    setSelectedId(focusNodeId)
    setEnabledClasses((prev) => {
      if (prev.has(node.class)) return prev
      const next = new Set(prev)
      next.add(node.class)
      return next
    })
  }, [focusNodeId, nodeById])

  const visibleNodes = useMemo(
    () => nodes.filter((n) => enabledClasses.has(n.class)),
    [nodes, enabledClasses],
  )
  const visibleEdges = useMemo(() => {
    const ids = new Set(visibleNodes.map((n) => n.id))
    return edges.filter(
      (e) =>
        enabledGroups.has(RELATION_STYLES[e.relation].group) &&
        ids.has(e.source) &&
        ids.has(e.target),
    )
  }, [edges, visibleNodes, enabledGroups])

  const searchMatches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q.length < 2) return []
    return nodes
      .filter(
        (n) =>
          n.id.toLowerCase().includes(q) ||
          (n.labelKo ?? '').toLowerCase().includes(q),
      )
      .slice(0, 8)
  }, [nodes, search])

  const selected = selectedId ? nodeById.get(selectedId) ?? null : null

  const toggleClass = (c: NodeClass) =>
    setEnabledClasses((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })
  const toggleGroup = (g: RelationGroupId) =>
    setEnabledGroups((prev) => {
      const next = new Set(prev)
      if (next.has(g)) next.delete(g)
      else next.add(g)
      return next
    })

  const pickSearchResult = (n: GraphNode) => {
    setSearch('')
    onFocusChange(n.id)
  }

  return (
    <div className="flex h-full min-h-0">
      {/* ─── 필터 사이드바 ─── */}
      <aside className="w-52 md:w-60 flex-shrink-0 overflow-y-auto bg-[#0A1525] border-r border-[#152240] p-3 text-sm">
        {/* 검색 */}
        <div className="relative mb-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="노드 검색 (라벨/ID)"
            className="w-full bg-[#050B15] border border-[#152240] rounded px-2 py-1.5 text-[#C0D8F0] text-xs placeholder-[#4A6A8A] focus:outline-none focus:border-[#4A6A8A]"
          />
          {searchMatches.length > 0 && (
            <ul className="absolute z-30 left-0 right-0 mt-1 bg-[#0A1525] border border-[#152240] rounded shadow-xl max-h-64 overflow-y-auto">
              {searchMatches.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => pickSearchResult(n)}
                    className="w-full text-left px-2 py-1.5 hover:bg-[#152240] transition-colors"
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-1.5"
                      style={{ background: nodeColor(n) }}
                    />
                    <span className="text-[#C0D8F0] text-xs">{nodeLabel(n)}</span>
                    <span className="block text-[#4A6A8A] text-[10px] ml-3.5">
                      {CLASS_LABEL_KO[n.class]} · {n.id}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 클래스 토글 */}
        <div className="text-[#4A6A8A] text-xs mb-1.5">노드 클래스</div>
        <div className="space-y-1 mb-4">
          {ALL_CLASSES.map((c) => (
            <label key={c} className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enabledClasses.has(c)}
                onChange={() => toggleClass(c)}
                className="accent-[#C25200]"
              />
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: CLASS_COLOR[c] }} />
              <span className="text-[#C0D8F0] text-xs">{CLASS_LABEL_KO[c]}</span>
              <span className="text-[#4A6A8A] text-[10px] ml-auto">
                {nodes.filter((n) => n.class === c).length}
              </span>
            </label>
          ))}
        </div>

        {/* 관계 토글 */}
        <div className="text-[#4A6A8A] text-xs mb-1.5">관계</div>
        <div className="space-y-1 mb-4">
          {RELATION_GROUP_ORDER.map((g) => (
            <label key={g} className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enabledGroups.has(g)}
                onChange={() => toggleGroup(g)}
                className="accent-[#C25200]"
              />
              <span className="text-[#C0D8F0] text-xs">{RELATION_GROUP_LABEL_KO[g]}</span>
            </label>
          ))}
        </div>

        {/* 관계 범례 (활성 그룹만) */}
        <div className="text-[#4A6A8A] text-xs mb-1.5">범례</div>
        <div className="space-y-1 mb-3">
          {Object.entries(RELATION_STYLES)
            .filter(([, st]) => enabledGroups.has(st.group))
            .map(([rel, st]) => (
              <div key={rel} className="flex items-center gap-2">
                <svg width="22" height="6">
                  <line
                    x1="0" y1="3" x2="22" y2="3"
                    stroke={st.color}
                    strokeWidth="2"
                    strokeDasharray={st.dash}
                  />
                </svg>
                <span className="text-[#A0B8CC] text-[10px]">{st.labelKo}</span>
              </div>
            ))}
        </div>

        <div className="text-[#4A6A8A] text-[10px] border-t border-[#152240] pt-2">
          노드 {visibleNodes.length} · 엣지 {visibleEdges.length} 표시 중
        </div>
        <button
          onClick={() => {
            setEnabledClasses(new Set(DEFAULT_CLASSES))
            setEnabledGroups(new Set(DEFAULT_GROUPS))
          }}
          className="mt-2 text-[10px] text-[#4A6A8A] hover:text-[#C0D8F0] underline transition-colors"
        >
          기본 필터로 초기화
        </button>
      </aside>

      {/* ─── 그래프 캔버스 ─── */}
      <div className="flex-1 min-w-0 relative">
        <GraphView
          nodes={visibleNodes}
          edges={visibleEdges}
          mode="global"
          focusNodeId={focusNodeId}
          selectedNodeId={selectedId}
          onNodeClick={(n) => setSelectedId(n.id)}
          onBackgroundClick={() => setSelectedId(null)}
        />
      </div>

      {/* ─── 노드 상세 패널 ─── */}
      {selected && (
        <GraphNodeDetail
          node={selected}
          onClose={() => setSelectedId(null)}
          onFocus={() => onFocusChange(selected.id)}
          onShowEventInTimeline={onShowEventInTimeline}
        />
      )}
    </div>
  )
}

// ─── 노드 상세 패널 ────────────────────────────────────────────────────
function GraphNodeDetail({
  node,
  onClose,
  onFocus,
  onShowEventInTimeline,
}: {
  node: GraphNode
  onClose: () => void
  onFocus: () => void
  onShowEventInTimeline: (eventUri: string) => void
}) {
  const refs = wikiRefsFor(node.id)

  return (
    <div
      className={[
        'fixed z-20 shadow-2xl overflow-y-auto',
        'bg-[#0A1525]/98 backdrop-blur border-[#152240]',
        'bottom-0 left-0 right-0 max-h-[60vh] rounded-t-xl border-t p-4',
        'sm:top-0 sm:right-0 sm:bottom-auto sm:left-auto sm:h-full sm:w-80',
        'sm:rounded-none sm:max-h-none sm:border-t-0 sm:border-l sm:p-5',
      ].join(' ')}
    >
      <div className="flex justify-between items-start mb-1">
        <h2 className="text-base sm:text-lg font-bold text-[#C0D8F0] pr-2">
          {nodeLabel(node)}
        </h2>
        <button
          onClick={onClose}
          className="text-[#4A6A8A] hover:text-[#C0D8F0] text-2xl leading-none transition-colors flex-shrink-0"
          aria-label="닫기"
        >
          ×
        </button>
      </div>
      <div className="text-xs text-[#4A6A8A] mb-3">
        <span
          className="inline-block w-2 h-2 rounded-full mr-1"
          style={{ background: nodeColor(node) }}
        />
        {CLASS_LABEL_KO[node.class]} · <span className="font-mono">{node.id}</span>
      </div>

      {node.summary && (
        <p className="text-sm text-[#A0B8CC] leading-relaxed mb-3 whitespace-pre-line">
          {node.summary}
        </p>
      )}

      <dl className="text-xs space-y-1.5 mb-4">
        {node.class === 'WorldLine' && node.divergence != null && (
          <DetailRow label="발산률" value={`${node.divergence > 0 ? '+' : ''}${node.divergence.toFixed(6)}%`} />
        )}
        {node.attractorField && (
          <DetailRow label="필드" value={node.attractorField.replace('AF_', '')} />
        )}
        {node.localDateTime && <DetailRow label="시각" value={node.localDateTime} />}
        {node.eventType && <DetailRow label="사건 유형" value={node.eventType} />}
        {node.mechanismType && node.mechanismType !== 'none' && (
          <DetailRow label="메커니즘" value={node.mechanismType} />
        )}
        {node.actor && <DetailRow label="행위자" value={node.actor.replace('Char_', '')} />}
        {node.target && <DetailRow label="대상" value={node.target.replace('Char_', '')} />}
        {node.shiftType && <DetailRow label="이동 유형" value={node.shiftType} />}
        {node.shiftMoment && <DetailRow label="이동 시점" value={node.shiftMoment} />}
        {node.timeWindow && <DetailRow label="시간 창" value={node.timeWindow} />}
        {node.mediaTitle && (
          <DetailRow label="매체" value={`${node.mediaTitle} ${node.mediaUnit ?? ''}`.trim()} />
        )}
        {node.evidenceTier && <DetailRow label="근거 등급" value={node.evidenceTier} />}
        {node.worldLineId && <DetailRow label="세계선" value={node.worldLineId} />}
        {node.macroEventId && <DetailRow label="거시 사건" value={node.macroEventId} />}
      </dl>

      {/* causal-chain fail-closed: 인과 고립 사유 노출 (결합 규약) */}
      {node.isolationNote && (
        <div className="rounded p-3 mb-4 text-xs leading-relaxed text-[#C0D8F0] bg-[#4a3200]/40 border-l-2 border-[#f59e0b]">
          {node.isolationNote}
        </div>
      )}

      <div className="space-y-2 mb-4">
        <button
          onClick={onFocus}
          className="block w-full text-center text-[#C0D8F0] py-1.5 px-3 rounded border border-[#152240] hover:border-[#4A6A8A] text-xs transition-colors"
        >
          ⊕ 이 노드 중심으로 보기
        </button>
        {node.class === 'Event' && (
          <button
            onClick={() => onShowEventInTimeline(node.id)}
            className="block w-full text-center text-white py-1.5 px-3 rounded text-xs transition-colors hover:brightness-110"
            style={{ background: '#1d4ed8' }}
          >
            🕒 타임라인에서 보기
          </button>
        )}
        {node.class === 'WorldLine' && node.wikiSlug && (
          <a
            href={worldlineWikiUrl({ divergence: node.divergence ?? 0, wikiSlug: node.wikiSlug })}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full text-center text-white py-1.5 px-3 rounded text-xs transition-colors hover:brightness-110"
            style={{ background: '#C25200' }}
          >
            📖 위키에서 자세히 보기 →
          </a>
        )}
      </div>

      {/* 이 개체를 다루는 문서 (node_wiki_refs 랭킹) — 참조 0건이면 섹션 비표시 */}
      {refs.length > 0 && (
        <div>
          <div className="text-[#4A6A8A] text-xs mb-2">이 개체를 다루는 문서</div>
          <ul className="space-y-1">
            {refs.slice(0, 6).map((r) => (
              <li key={r.path}>
                <a
                  href={wikiPageUrl(r.path)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#7FB4E8] hover:text-[#C0D8F0] transition-colors"
                >
                  {r.path.split('/').pop()}
                  <span className="text-[#4A6A8A]"> · {r.count}회</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="text-[#4A6A8A] w-16 flex-shrink-0">{label}</dt>
      <dd className="text-[#C0D8F0] break-all">{value}</dd>
    </div>
  )
}
