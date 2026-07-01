COMPOSE_FILE := docker/holyclaude/docker-compose.yaml
COMPOSE      := docker compose --env-file .env -f $(COMPOSE_FILE)
MKDOCS       := uv run mkdocs

.PHONY: up down restart logs shell build \
        wiki-serve wiki-build wiki-deploy wiki-lint \
        suggestions-poll worker-dev worker-deploy \
        test help

# ── holyclaude 서비스 ───────────────────────────────────────────────────────

up:
	$(COMPOSE) up -d --build
	@echo ""
	@echo "  HolyClaude UI  →  http://localhost:3001"
	@echo "  Admin          →  http://localhost:3002"
	@echo "  Ontology MCP   →  http://localhost:8093/mcp"
	@echo ""

down:
	$(COMPOSE) down

restart:
	$(COMPOSE) restart holyclaude

logs:
	$(COMPOSE) logs -f holyclaude

shell:
	$(COMPOSE) exec holyclaude bash

# ── Docker 빌드 / 관리 ────────────────────────────────────────────────────────

build:
	$(COMPOSE) build

# ── 위키 빌드 / 로컬 미리보기 ───────────────────────────────────────────────

wiki-serve:
	$(MKDOCS) serve

wiki-build:
	$(MKDOCS) build --strict

wiki-deploy:
	$(MKDOCS) build
	wrangler pages deploy site --project-name=sg-wiki --branch=main

wiki-lint:
	-python3 scripts/wiki_link_lint.py --scan

# ── 테스트 ───────────────────────────────────────────────────────────────────

test:
	python3 scripts/test_wiki_link_lint.py
	python3 scripts/test_humanize_fact_guard.py

# ── 제안 관리 ────────────────────────────────────────────────────────────────

suggestions-poll:
	python3 scripts/poll_suggestions.py

# ── Cloudflare Worker ────────────────────────────────────────────────────────

worker-dev:
	cd worker && wrangler dev suggest.ts

worker-deploy:
	cd worker && wrangler deploy suggest.ts

# ── 도움말 ───────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "  up        컨테이너 빌드 & 시작 (포트 3001)"
	@echo "  down      컨테이너 중지"
	@echo "  restart   컨테이너 재시작 (재빌드 없음)"
	@echo "  logs      컨테이너 로그 스트리밍"
	@echo "  shell     컨테이너 bash 접속"
	@echo ""
	@echo "  build     Docker 이미지만 빌드 (컨테이너 시작 안 함)"
	@echo ""
	@echo "  wiki-serve           로컬 미리보기 (localhost:8000)"
	@echo "  wiki-build           정적 사이트 빌드 (site/, strict 검사)"
	@echo "  wiki-deploy          빌드 후 Cloudflare Pages 수동 배포"
	@echo "  wiki-lint            내부 링크 결정적 검사 (scripts/wiki_link_lint.py)"
	@echo ""
	@echo "  test                 스크립트 단위 테스트"
	@echo ""
	@echo "  suggestions-poll     R2에서 새 제안 다운로드 → suggestions/inbox/"
	@echo ""
	@echo "  worker-dev           Cloudflare Worker 로컬 개발 서버"
	@echo "  worker-deploy        Cloudflare Worker 배포"
	@echo ""
