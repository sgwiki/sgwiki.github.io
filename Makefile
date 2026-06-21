COMPOSE_FILE := docker/holyclaude/docker-compose.yaml
COMPOSE      := docker compose --env-file .env -f $(COMPOSE_FILE)

.PHONY: up down restart logs shell \
        wiki-serve wiki-build wiki-deploy \
        suggestions-poll worker-dev worker-deploy \
        help

# ── sg-wiki-holyclaude 컨테이너 ─────────────────────────────────────────────

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
	$(COMPOSE) restart sg-wiki-holyclaude

logs:
	$(COMPOSE) logs -f sg-wiki-holyclaude

shell:
	$(COMPOSE) exec sg-wiki-holyclaude bash

# ── 위키 빌드 / 로컬 미리보기 ───────────────────────────────────────────────

wiki-serve:
	mkdocs serve

wiki-build:
	mkdocs build --strict

wiki-deploy:
	mkdocs build --strict
	wrangler pages deploy site --project-name=sg-wiki --branch=main

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
	@echo "  wiki-serve           로컬 미리보기 (localhost:8000)"
	@echo "  wiki-build           정적 사이트 빌드 (site/)"
	@echo "  wiki-deploy          빌드 후 Cloudflare Pages 수동 배포"
	@echo ""
	@echo "  suggestions-poll     R2에서 새 제안 다운로드 → suggestions/inbox/"
	@echo ""
	@echo "  worker-dev           Cloudflare Worker 로컬 개발 서버"
	@echo "  worker-deploy        Cloudflare Worker 배포"
	@echo ""
