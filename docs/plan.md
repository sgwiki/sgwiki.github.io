  최종 검토안

  1. Architect 리뷰 검증 결과

  ✅ 확인된 발견 (실측 데이터와 일치)

  ┌──────────────────────────┬────────────────────────────────────────────────────────┬────────────────────────────────────────────────────────────────────────┐
  │           항목           │                     Architect 주장                     │                               실측 결과                                │
  ├──────────────────────────┼────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────┤
  │ Q1 재사용 로직           │ gall_num 기준 prior run에서 211개 reuse                │ summary.json reused_record_count: 211 ✅                               │
  ├──────────────────────────┼────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────┤
  │ Q2 carry-over            │ 중단된 run의 attempts/parsed에서 복구                  │ 첫 record가 _auto_reused_from_run: "20260523-123551-auto-full" 마킹 ✅ │
  ├──────────────────────────┼────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────┤
  │ primary 개수 미강제      │ prompt는 "정확히 1개" 지시하지만 validate가 강제 안 함 │ 1605건 중 21건 위반 (primary=0이 15건, primary=2가 6건) ✅             │
  ├──────────────────────────┼────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────┤
  │ 클러스터링 fragmentation │ catalog 외 concept_id가 임의 slug 생성                 │ 66 그룹 중 50개가 single-record 그룹 ✅                                │
  ├──────────────────────────┼────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────┤
  │ _auto_* 필드 jsonl 누출  │ 내부 마커가 record와 함께 jsonl에 기록                 │ extractions.jsonl에 _auto_reused, _auto_reused_from_run 그대로 노출 ✅ │
  └──────────────────────────┴────────────────────────────────────────────────────────┴────────────────────────────────────────────────────────────────────────┘

  ⚠️  평가 재조정 필요

  ┌───────────────────────────┬────────────────┬─────────────┬──────────────────────────────────────────────────────────────────────────────────────────┐
  │           항목            │ Architect 분류 │   재평가    │                                           근거                                           │
  ├───────────────────────────┼────────────────┼─────────────┼──────────────────────────────────────────────────────────────────────────────────────────┤
  │ 위키 산출물 0개 (BLOCKER) │ BLOCKER        │ HIGH로 강등 │ 정상 완주 시(50분) wiki/index.md, 66개 md 정상 생성. BLOCKER 아닌 "인터럽트 회복성 부족" │
  ├───────────────────────────┼────────────────┼─────────────┼──────────────────────────────────────────────────────────────────────────────────────────┤
  │ set -e 우회 (BLOCKER)     │ BLOCKER        │ MEDIUM      │ 완주 시 issue 없음. signal handler가 있으면 더 안전한 정도                               │
  └───────────────────────────┴────────────────┴─────────────┴──────────────────────────────────────────────────────────────────────────────────────────┘

  🆕 실측 데이터로 발견된 추가 사항

  - 답변 신뢰도 분포: answered 1056 (66%), partial 387 (24%), conflicting 90 (6%), unanswered 72 (4%)
  - needs_human_review = 774건 (48%) — 절반 가까이 사람 검토 필요. 댓글 데이터 특성상 정상이나, 위키 발행 전 검수 부담 큼
  - top 16 그룹이 98% (1573건) 차지 — 카탈로그 hit는 매우 효과적
  - 하위 50개 그룹은 평균 0.6건/그룹 — fragmentation 심각 (예: 갤러리.md/게임.md 같은 너무 일반적인 한글 슬러그, amadeus.md vs amadeus_system.md 같은 의미 중복)

  ---
  2. 우선순위별 최종 권장 수정안

  🟥 P1 — 인터럽트 회복성 (다음 50분짜리 run을 보호)

  P1-1. run_makewiki.sh에서 set -e 영향 완화 (정상 완주는 OK지만 만약을 위한 안전망)
  - 위치: run_makewiki.sh:1, 19-28
  - 패치: set -uo pipefail로 변경, 단계별로 [ -s "$RUN_DIR/jsonl/extractions.jsonl" ] 가드 추가

  P1-2. SIGINT 핸들러로 jsonl 즉시 flush
  - 위치: scripts/qa_wiki_extract_langchain.py:776-790 (auto-full 진입점)
  - 패치: signal.signal(SIGINT, lambda *_: write_auto_outputs(...); sys.exit(130))

  P1-3. reused records 즉시 flush
  - 위치: scripts/qa_wiki_extract_langchain.py:823-829
  - 패치: 첫 attempt 시작 전에 write_auto_outputs(records=successes.values()) 호출

  🟧 P2 — 비용 누수 방지

  P2-1. mode 필터 완화 (full/sample run의 24건 reuse 가능)
  - 위치: scripts/qa_wiki_extract_langchain.py:909
  - 패치: if config.get("mode") not in {"auto-full", "full", "sample"}: continue 또는 필터 자체 제거 (read_success_jsonl이 이미 validate 통과만 받음)

  P2-2. 429/credit-error circuit breaker
  - 위치: scripts/qa_wiki_extract_langchain.py:1215-1234
  - 패치: connect 단계 또는 batch loop 안에서 RateLimit/AuthenticationError 3회 연속 catch 시 attempt abort

  🟨 P3 — 출력 품질 개선

  P3-1. validation 강화 (21건의 primary 위반을 catch)
  - 위치: scripts/qa_wiki_pipeline.py:501-558 validate_extraction
  - 추가 검증:
    - sum(c.relation == "primary" for c in concept_candidates) == 1
    - all(0 <= idx < total_comments for idx in evidence_comment_indexes) (records.jsonl과 cross-check 필요)
    - set(entities.keys()) <= {"characters", "organizations", "media"}

  P3-2. Singleton 그룹 병합 (현재 50개 → 목표 ≤20개)
  - 위치: scripts/qa_wiki_pipeline.py:849-867 group_records
  - 옵션 A (낮은 비용): catalog 매핑 실패한 concept_id를 별도 wiki/_misc/로 격리
  - 옵션 B (중간 비용): record_count=1 그룹들을 prompt에서 정의한 15개 catalog로 LLM에 재매핑 요청 (1회만)
  - 옵션 C (높은 비용): secondary candidate를 활용해 cross-reference 인덱스 추가

  P3-3. 의미 중복 그룹 catalog 화이트리스트 강화
  - amadeus.md ↔ amadeus_system.md, merchandise.md ↔ merch_info.md ↔ merchandise_buying.md, media.md ↔ novel_media.md ↔ media_supplementary.md 등
  - 위치: scripts/qa_wiki_pipeline.py:CONCEPT_CATALOG 정의부
  - 패치: alias 매핑 dict 추가 — {"amadeus_system": "amadeus", "merch_info": "merchandise", ...}

  🟦 P4 — 운영 편의

  P4-1. 내부 마커 분리
  - 위치: scripts/qa_wiki_extract_langchain.py:1351-1357 write_auto_outputs
  - 패치: jsonl에는 _ 접두사 키 strip한 사본 기록. provenance는 provenance.jsonl로 분리

  P4-2. RUN_ID 충돌 회피
  - 위치: run_makewiki.sh:4
  - 패치: RUN_ID="$(date +%Y%m%d-%H%M%S)-$$-auto-full"

  P4-3. wrapper 자동 비활성화 옵션
  - 위치: scripts/qa_wiki_extract_langchain.py:184-188 (Z.AI 원격 API 사용 시 gemma <start_of_turn> 토큰 낭비)
  - 패치: --wrapper-prompt=none 또는 환경변수로 wrapper bypass

  ---
  3. 즉시 실행 가능한 후속 작업

  ┌──────┬──────────────────────────────────┬────────────────────────────────────┬────────────────────────┐
  │ 순위 │               작업               │             예상 영향              │       소요 시간        │
  ├──────┼──────────────────────────────────┼────────────────────────────────────┼────────────────────────┤
  │ 1    │ P1-1, P1-2, P1-3 묶어서 패치     │ 다음 50분 run의 안전성 확보        │ 30분                   │
  ├──────┼──────────────────────────────────┼────────────────────────────────────┼────────────────────────┤
  │ 2    │ P2-1, P2-2 묶어서 패치           │ LLM 비용 절감 (24건 + 429 cascade) │ 20분                   │
  ├──────┼──────────────────────────────────┼────────────────────────────────────┼────────────────────────┤
  │ 3    │ P3-1 validation 강화             │ 21건의 primary 위반 catch          │ 15분                   │
  ├──────┼──────────────────────────────────┼────────────────────────────────────┼────────────────────────┤
  │ 4    │ P3-3 catalog alias 매핑          │ 50→25 그룹 예상                    │ 1시간 (catalog 재설계) │
  ├──────┼──────────────────────────────────┼────────────────────────────────────┼────────────────────────┤
  │ 5    │ needs_review 774건 검수 워크플로 │ 위키 발행 가능                     │ 별도 작업              │
  └──────┴──────────────────────────────────┴────────────────────────────────────┴────────────────────────┘
