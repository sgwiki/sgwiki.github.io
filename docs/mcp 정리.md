


docker ps를 통해 확인해. dataforge-mcp-server에서 qaset_with_rag filter를 걸면 semantic search 가능해. 그리고 위키 작성팀에서 위키 작성할 때 위키 작성에 관련된 근거들도 csv나 다른 형태로든 관리해. 특히 나무위키 MCP는 주기적으로 업데이트 되기
  때문에, wiki 최근 수정 날짜도 적어야해.


각 MCP는 holyclaude 컨테이너 내부의 claude 에 mcp로 등록되어야함. mcp 등록 코드는 이 sg-wiki 프로젝트 디렉토리에 작성.


# 공식

## 공식 인터뷰
- rg으로 파일 탐색.
 - dir: /mnt/f/github/sg-wiki/data/공식 자료집

# 비공식
## 스크립트 MCP
- dataforge mcp server 에서 source filter 걸기
    - sg_game_sge : 슈타인즈 게이트 엘리트 한글 스크립트
    - sg_game_sg0_en : 슈타인즈 게이트 제로 영어 스크립트
    - sg_anime : 추가 예정. (현재 사용 불가)

## sg 관련 논문
- dataforge mcp server 에서 source filter 걸기
    - sg_paper : 슈타인즈 게이트 논문(물리학 박사 팬이 작성)
## 슈타인즈 게이트 온톨로지
- ~/amadeus 의 Makefle 참고.  


## 나무위키 MCP
- /mnt/f/agent-hub/agents/WebScraper$ 
<설명>
 read /mnt/f/agent-hub/agents/WebScraper/mcp_config.json                                                                                                                                                                                   
                                                                                                                                                                                                                                           

                                                                                                                                                                                                                                           
 read /mnt/f/agent-hub/agents/WebScraper/mcp_config.docker.json                                                                                                                                                                            
                                                                                                                                                                                                                                           

 이제 충분한 정보를 파악했습니다. MCP 서버의 기능을 정리해서 설명하겠습니다.                                                                                                                                                               
                                                                                                                                                                                                                                           
 핵심:                                                                                                                                                                                                                                     
 - FastMCP 3.x 기반                                                                                                                                                                                                                        
 - 4개 도구 (search_namu_wiki, get_related_docs, get_namu_wiki_markdown, health_check)                                                                                                                                                     
 - 3개 HTTP 라우트 (/health, /playground, /)                                                                                                                                                                                               
 - 트랜스포트: stdio, http, sse                                                                                                                                                                                                            
 - 캐시 레이어 (markdown 변환 결과)                                                                                                                                                                                                        
 - 섹션 기반 페이지네이션                                                                                                                                                                                                                  
                                                                                                                                                                                                                                           
 이걸 한국어로 깔끔하게 정리하겠습니다.                                                                                                                                                                                                    

 namuwiki_mcp_server.py(FastMCP 3.x, v2.0.0)를 분석했습니다. 이 MCP 서버는 나무위키 문서를 AI 에이전트(Claude 등)가 검색·탐색·변환할 수 있도록 노출하는 서버입니다.                                                                        
                                                                                                                                                                                                                                           
 🛠️ MCP 도구 (4개)                                                                                                                                                                                                                         
                                                                                                                                                                                                                                           
 모든 도구는 readOnlyHint + openWorldHint 어노테이션을 가진 읽기 전용 도구입니다.                                                                                                                                                          
                                                                                                                                                                                                                                           
 ┌───────────────────────────────────────────────┬──────────────────────────────┬────────────────────────────────────────────────────────────────────────────────────────────────────┐                                                     
 │ 도구                                          │ 기능                         │ 특징                                                                                               │                                                     
 ├───────────────────────────────────────────────┼──────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────┤                                                     
 │ search_namu_wiki(keyword, page, page_size)    │ 키워드로 나무위키 검색       │ 제목·링크·요약 리스트 반환, 페이지네이션(최대 50/page)                                             │                                                     
 ├───────────────────────────────────────────────┼──────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────┤                                                     
 │ get_related_docs(doc_link, page, page_size)   │ 문서 내 연관(내부) 링크 추출 │ URL/상대경로/문서명 자동 정규화(/w/... 형태), 최대 100/page                                        │                                                     
 ├───────────────────────────────────────────────┼──────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────┤                                                     
 │ get_namu_wiki_markdown(link, page, page_size) │ HTML→마크다운 변환           │ 캐시 레이어(tmp의 namuwiki_cache/) + 섹션 기반 분할(헤더 # 기준으로 구조 보존), 최대 50,000자/page │                                                     
 ├───────────────────────────────────────────────┼──────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────────────────────┤                                                     
 │ health_check()                                │ 서버 상태 진단               │ 캐시 디렉토리 쓰기 가능 여부 + namu.wiki 도달성 체크                                               │                                                     
 └───────────────────────────────────────────────┴──────────────────────────────┴────────────────────────────────────────────────────────────────────────────────────────────────────┘                                                     
                                                                                                                                                                                                                                           
 ### 핵심 설계 포인트                                                                                                                                                                                                                      
                                                                                                                                                                                                                                           
 - 정규화 헬퍼 _normalize_url(): Steins;Gate, /w/Steins%3BGate, https://namu.wiki/... 어떤 형태든 https://namu.wiki/w/...로 통일                                                                                                           
 - _paginate() 헬퍼: 모든 리스트 도구에 일관된 페이지네이션(총 개수, 현재/전체 페이지, ◀▶ 네비게이션 힌트)                                                                                                                                 
 - 마크다운 페이지네이션: 단순 문자열 자르기가 아니라 #{1,6} 헤더 경계를 존중해 섹션 단위로 분할 → 페이지가 끊어질 때 문서 구조가 깨지지 않음                                                                                              
 - 캐싱: md5(URL) 기반 파일 캐시로 동일 문서 재변환 방지                                                                                                                                                                                   
                                                                                                                                                                                                                                           
 🌐 HTTP 엔드포인트 (@mcp.custom_route)                                                                                                                                                                                                    
                                                                                                                                                                                                                                           
 ┌─────────────┬────────┬─────────────────────────────────────────────────┐                                                                                                                                                                
 │ 경로        │ 메서드 │ 용도                                            │                                                                                                                                                                
 ├─────────────┼────────┼─────────────────────────────────────────────────┤                                                                                                                                                                
 │ /           │ GET    │ 서버 정보(JSON: name, version, endpoints)       │                                                                                                                                                                
 ├─────────────┼────────┼─────────────────────────────────────────────────┤                                                                                                                                                                
 │ /health     │ GET    │ 구조화된 헬스체크(JSON) — 로드밸런서/모니터링용 │                                                                                                                                                                
 ├─────────────┼────────┼─────────────────────────────────────────────────┤                                                                                                                                                                
 │ /playground │ GET    │ static/playground.html 인터랙티브 웹 UI         │                                                                                                                                                                
 └─────────────┴────────┴─────────────────────────────────────────────────┘                                                                                                                                                                
                                                                                                                                                                                                                                           
 │ 실제 MCP 통신은 POST /mcp/ (FastMCP 기본 라우트)에서 처리됩니다.                                                                                                                                                                        
                                                                                                                                                                                                                                           
 🚚 트랜스포트 모드 (CLI 플래그)                                                                                                                                                                                                           
                                                                                                                                                                                                                                           
 ```bash                                                                                                                                                                                                                                   
   python namuwiki_mcp_server.py                          # stdio (기본, Claude Desktop용)                                                                                                                                                 
   python namuwiki_mcp_server.py --transport http -p 8091 # HTTP (원격/Docker용)                                                                                                                                                           
   python namuwiki_mcp_server.py --transport sse          # SSE                                                                                                                                                                            
 ```                                                                                                                                                                                                                                       
                                                                                                                                                                                                                                           
 🔌 MCP 클라이언트 연동                                                                                                                                                                                                                    
                                                                                                                                                                                                                                           
 mcp_config.json 4가지 프로파일을 제공합니다:                                                                                                                                                                                              
 - namuwiki / namuwiki-local — 로컬 Python stdio                                                                                                                                                                                           
 - namuwiki-local-http — 로컬 HTTP (http://localhost:8091/mcp/)                                                                                                                                                                            
 - namuwiki-docker-stdio — Docker 컨테이너 stdio                                                                                                                                                                                           
 - namuwiki-docker-http — Docker compose HTTP                                                                                                                                                                                              
                                                                                                                                                                                                                                           
 📋 권장 사용 흐름                                                                                                                                                                                                                         
                                                                                                                                                                                                                                           
 서버 instructions에 명시된 워크플로우:                                                                                                                                                                                                    
                                                                                                                                                                                                                                           
 ```                                                                                                                                                                                                                                       
   search_namu_wiki (키워드 검색)                                                                                                                                                                                                          
      → get_related_docs (연관 문서 탐색)                                                                                                                                                                                                  
      → get_namu_wiki_markdown (본문 읽기)                                                                                                                                                                                                 
 ```                                                                                                                                                                                                                                       
                                                                                                                                                                                                                                           
 🧱 아키텍처 계층                                                                                                                                                                                                                          
                                                                                                                                                                                                                                           
 ```                                                                                                                                                                                                                                       
   namuwiki_mcp_server.py  ← MCP 도구/라우트 정의 (얇은 레이어)                                                                                                                                                                            
           ↓ 위임                                                                                                                                                                                                                          
   src/namuwiki_tools.py   ← 실제 로직 (스크래핑, 변환, 메타데이터 추출)                                                                                                                                                                   
           ↓                                                                                                                                                                                                                               
   BeautifulSoup + requests + html-to-markdown[lxml]                                                                                                                                                                                       
 ```                                                                                                                                                                                                                                       
                                                                                                                                                                                                                                           
 MCP 서버 파일은 도구 등록·페이지네이션·캐싱·HTTP 라우트만 담당하고, 실제 나무위키 스크래핑/변환 로직은 src/namuwiki_tools.py(_search_namu_wiki, _get_related_docs, _get_namu_wiki_markdown)에 캡슐화되어 있습니다.  
</설명>


