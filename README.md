# 슈타인즈 게이트 위키 (SG Wiki)

> 슈타인즈 게이트 공식·팬 분석 자료를 바탕으로 한 **한국어 설정 해설 위키**

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-blue?style=flat-square&logo=github)](https://sgwiki.github.io/)
[![License](https://img.shields.io/badge/License-CC%20BY--SA%204.0-green?style=flat-square)](LICENSE)

## 🎯 프로젝트 소개

이 저장소는 **슈타인즈 게이트** 시리즈의 복잡한 설정과 세계선 구조를 체계적으로 정리한 한국어 위키입니다.

- 📖 **마크다운 기반** - 모든 콘텐츠를 Markdown으로 관리
- 🗺️ **인터랙티브 맵** - 세계선 분기와 사건 흐름을 탐색 가능한 React SPA
- 📋 **스포일러 관리** - 각 문서마다 스포일러 수준 명시
- 🔗 **근거 체계** - 모든 정보의 출처 명확화 (공식/팬 분석)

## 🏗️ 구조

```
├── wiki/                 # 위키
│   ├── 캐릭터/           # 캐릭터 설명
│   ├── lore/             # 핵심 설정·사건 해설  
│   ├── setting/          # 세계관·배경 설정
│   ├── 커뮤니티-큐레이션/ # 커뮤니티 질문·논의
│   ├── 세계선/           # 세계선 관련 정보
│   └── 근거자료/         # 인용 출처 및 참고 자료
│
├── sg-worldline-map/      # 세계선 인터랙티브 맵 (React/Vite SPA)
│   └── src/
│       └── data/          # 맵 데이터 (JSON)
│
├── worker/                # Cloudflare Worker
│   └── suggest.ts        # 제안 폼 API
│
├── mkdocs.yml           
└── .gitignore            
```


> 🔗 **라이브 사이트**: https://sgwiki.github.io/

## 📝 위키 작성 규칙

### 스포일러 수준
각 문서 상단에 표시:
- `none` - 스포일러 없음
- `early_story` - 초반 내용  
- `main_story` - 주요 스토리 포함
- `zero_story` - Zero 관련 내용
- `endgame` - 엔딩 관련

### 근거 표시
- `[공식]` - 공식 자료 (게임, 애니, 영화, 설정집 등)
- `[팬 분석]` - 팬덤 통찰 및 추론

자세한 위키 작성 규칙은 [`wiki/README.md`](wiki/README.md)를 참고하세요.


## 📄 라이선스

이 프로젝트는 **CC BY-SA 4.0** 라이선스를 따릅니다.

- **위키 콘텐츠**: CC BY-SA 4.0
- **소스 코드**: MIT License

## 🤝 기여

이 위키는 슈타인즈 게이트 한국 유저들을 위해 운영됩니다. 
오류 발견 시 [제안 폼](https://sgwiki.github.io/suggest/)을 통해 제출해주세요.
