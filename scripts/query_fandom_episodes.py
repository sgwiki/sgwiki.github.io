#!/usr/bin/env python3
"""dataforge MCP fandom_episodes 커버리지 호출 헬퍼 (에피소드 가이드 파이프라인용).

사용:
  python3 scripts/query_fandom_episodes.py "<query>" [--series "Steins;Gate"] [--top-k 8]

dataforge HTTP MCP(http://localhost:8081/mcp) 에 search_with_filters(source_names=["fandom_episodes"])
를 호출한다. 커버리지는 "호출 시도만으로 pass(결과 무관)"이므로, 이 스크립트는 호출 성공 여부와
요약을 표준출력으로 남긴다(본문 콘텐츠는 소스 .md 파일이 1차 캐논).
"""
import argparse
import json
import sys
import urllib.request

BASE = "http://localhost:8081/mcp"
_session = {"id": None}
_id = [1]


def rpc(method, params=None, *, notification=False):
    body = {"jsonrpc": "2.0", "method": method}
    if not notification:
        body["id"] = _id[0]
        _id[0] += 1
    if params is not None:
        body["params"] = params
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if _session["id"]:
        headers["Mcp-Session-Id"] = _session["id"]
    req = urllib.request.Request(
        BASE, data=json.dumps(body).encode(), headers=headers, method="POST"
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        sid = resp.headers.get("Mcp-Session-Id")
        if sid:
            _session["id"] = sid
        raw = resp.read().decode()
    last = None
    for line in raw.splitlines():
        if line.startswith("data: "):
            last = line[6:]
    return json.loads(last) if last else raw


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("query")
    ap.add_argument("--series", default=None)
    ap.add_argument("--top-k", type=int, default=8)
    args = ap.parse_args()

    rpc("initialize", {
        "protocolVersion": "2025-06-18",
        "capabilities": {},
        "clientInfo": {"name": "fandom-coverage", "version": "1"},
    })
    rpc("notifications/initialized", {}, notification=True)

    mf = {"series": args.series} if args.series else None
    call_args = {
        "query": args.query,
        "top_k": args.top_k,
        "source_names": ["fandom_episodes"],
    }
    if mf:
        call_args["metadata_filters"] = mf

    r = rpc("tools/call", {"name": "search_with_filters", "arguments": call_args})
    if "error" in r:
        print("dataforge ERROR:", json.dumps(r["error"], ensure_ascii=False))
        sys.exit(1)
    d = json.loads(r["result"]["content"][0]["text"])
    total = d.get("total_results")
    results = d.get("results", [])
    print(f"fandom_episodes coverage: total={total} returned={len(results)} "
          f"series_filter={args.series or '-'}")
    for doc in results[:5]:
        md = doc.get("metadata") or {}
        print(f"  - series={md.get('series')!r} ep={md.get('ep')!r}")
    print("coverage=pass (호출 시도 완료, 결과 무관)")


if __name__ == "__main__":
    main()
