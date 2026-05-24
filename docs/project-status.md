# 슈타인즈 게이트 한국어 위키 — 프로젝트 현황

> 최종 갱신: 2026-05-24

---

## 1. 프로젝트 개요

갤러리 유저 질문 1,605건을 기반으로 슈타인즈 게이트 한국어 종합 위키를 구축하는 프로젝트.

- **데이터 소스**: DC 슈타인즈 게이트 마이너 갤러리 질문 게시글 1,605건 (CSV: `data/2025-05-04_질문목록_수동필터링.csv`)
- **reference 자료**: 공식 QA자료집, 인터뷰 3종 + 팬 분석 3종 (`reference/`)
- **파이프라인**: LangChain 기반 SLM 추출 → JSONL 구조화 → 검증 → 위키 문서 그룹핑

---

## 2. 진행 현황

### ✅ 1차: 핵심 설정 해설 (완료)

`wiki/lore/`에 14문서, 1,074줄 완성.

```
wiki/lore/
├── index.md                    ← 인덱스 + 추천 읽기 순서
├── worldline.md                ← 세계선 (가장 상세, 150줄)
├── worldline--parallel_worlds.md  ← [depth] 평행세계 반론
├── attractor-field.md          ← 어트랙터 필드와 수속
├── reading-steiner.md          ← 리딩 슈타이너
├── dmail.md                    ← D메일
├── time-leap.md                ← 타임리프
├── phonewave.md                ← 전화렌지
├── time-machine.md             ← 타임머신
├── sern-rounder.md             ← SERN과 라운더
├── loop-closure.md             ← 루프 폐쇄
├── steins-gate-worldline.md    ← SG 세계선
└── zero-beta.md                ← 제로/베타
```

- 37건 공식 인용 · 19건 팬 분석 인용 · 56건 출처 링크
- QA 1,073건 (67%) 커버

### 🔄 2차: 확장 (계획 완료, 실행 전)

상세 계획서: `.omx/plans/phase2-wiki-expansion.md`

| 범위 | 예상 문서 수 | QA 커버 |
|---|---|---|
| lore/ 신규 (movie-mail, amadeus) | 2 | +7% |
| characters/ (9인) | 9+1 index | +21% |
| faq/ (5항목) | 5+1 index | +18% |
| game/ (공략) | 1 | +0.4% |
| 인덱스/네비게이션 갱신 | 4 | — |
| **총계** | **22** | **→ 99.2%** |

---

## 3. 데이터 파이프라인

### 추출 (완료)

- **최종 run**: `artifacts/qa-wiki/runs/20260523-135619-auto-full`
- **결과**: 1,605건 전량 처리 완료 (실패 0건)
  - reused: 211건, newly completed: 1,394건
  - attempts: 2 (1차 175배치로 1,392건 성공, 2차 1배치로 2건 성공)

### 추출물 분포

| concept_id | 건수 | 비율 |
|---|---|---|
| character_events | 333 | 21% |
| worldline | 277 | 17% |
| viewing_order | 137 | 9% |
| zero_23b | 129 | 8% |
| platform_patch | 118 | 7% |
| attractor_field | 100 | 6% |
| dmail | 97 | 6% |
| reading_steiner | 69 | 4% |
| time_leap | 62 | 4% |
| time_machine | 58 | 4% |
| movie_mail | 51 | 3% |
| sern_rounder | 42 | 3% |
| ost_media | 27 | 2% |
| ibn5100 | 18 | 1% |
| phonewave | 17 | 1% |
| None/기타 | 15 | 1% |

### 답변 신뢰도

| 상태 | 건수 | 비율 |
|---|---|---|
| answered | 1,056 | 66% |
| partial | 387 | 24% |
| conflicting | 90 | 6% |
| unanswered | 72 | 4% |

needs_human_review: true 774건 (48%), false 831건 (52%)

---

## 4. 디렉토리 구조

```
fg-lab-kr/
├── wiki/                        ← 위키 산출물
│   ├── README.md
│   ├── _template/               ← main.md, depth.md
│   └── lore/                    ← 1차 완성
├── data/                        ← 원본 데이터
│   └── 2025-05-04_질문목록_수동필터링.csv
├── reference/                   ← 인용 원본
│   ├── official/                ← 공식 자료 3종
│   └── user/                    ← 팬 분석 3종
├── prompts/                     ← LLM 프롬프트
│   ├── wiki_qa_extraction_*.md  ← 추출용
│   └── wiki_writing_*.md        ← 집필용
├── scripts/                     ← 파이프라인 스크립트
│   ├── qa_wiki_extract_langchain.py
│   └── qa_wiki_pipeline.py
├── artifacts/qa-wiki/           ← 파이프라인 산출물
│   ├── runs/                    ← 15개 run 디렉토리
│   └── wiki/                    ← 통합 wiki (중간 산출물)
├── docs/                        ← 프로젝트 문서
│   ├── plan.md                  ← 파이프라인 수정 계획
│   ├── qa_wiki_pipeline.md      ← 파이프라인 사용법
│   └── project-status.md        ← 이 파일
└── .omx/plans/                  ← 작업 계획서
    └── phase2-wiki-expansion.md ← 2차 확장 계획
```

---

## 5. 보류된 파이프라인 개선 사항

`docs/plan.md`에 정리된 P1~P4 개선안은 1차 완성 후 보류 중:

| 우선순위 | 항목 | 상태 |
|---|---|---|
| P1 | 인터럽트 회복성 (SIGINT 핸들러, flush) | 보류 |
| P2 | 비용 누수 방지 (mode 필터, circuit breaker) | 보류 |
| P3 | 출력 품질 (validation 강화, singleton 병합) | 보류 |
| P4 | 운영 편의 (_auto 필드 분리, RUN_ID 충돌 회피) | 보류 |
