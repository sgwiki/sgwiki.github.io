#!/usr/bin/env python3
"""Poll suggestions from R2 (or mock) and move them to suggestions/inbox/.

멱등성 보장: suggestions/processed/{id} 파일이 존재하면 건너뜀.

환경변수:
  R2_MOCK=1      data/mock-r2/suggestions/*.json 에서 읽음 (기본값)
  R2_MOCK=0      Cloudflare R2에서 읽음 (아래 변수 필요)
  R2_ENDPOINT    https://<account_id>.r2.cloudflarestorage.com
  R2_ACCESS_KEY  R2 API 토큰 Access Key ID
  R2_SECRET_KEY  R2 API 토큰 Secret Access Key
  WORKSPACE      프로젝트 루트 경로 (기본값: 스크립트 상위 디렉토리)
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

WORKSPACE = Path(os.getenv("WORKSPACE", Path(__file__).parent.parent))
BUCKET = "sg-wiki-suggestions"
MOCK_DIR = WORKSPACE / "data" / "mock-r2" / "suggestions"
INBOX_DIR = WORKSPACE / "suggestions" / "inbox"
PROCESSED_DIR = WORKSPACE / "suggestions" / "processed"
RUNS_DIR = WORKSPACE / ".admin" / "runs"

R2_MOCK = os.getenv("R2_MOCK", "1") == "1"


def _ensure_dirs() -> None:
    for d in (INBOX_DIR, PROCESSED_DIR, RUNS_DIR):
        d.mkdir(parents=True, exist_ok=True)


def _fetch_mock() -> list[dict]:
    results = []
    if MOCK_DIR.exists():
        for f in sorted(MOCK_DIR.glob("*.json")):
            try:
                results.append(json.loads(f.read_text()))
            except Exception as e:
                print(f"[warn] cannot parse {f.name}: {e}")
    return results


def _fetch_r2() -> list[dict]:
    import boto3
    from botocore.config import Config

    endpoint = os.environ.get("R2_ENDPOINT")
    access_key = os.environ.get("R2_ACCESS_KEY")
    secret_key = os.environ.get("R2_SECRET_KEY")

    if not all([endpoint, access_key, secret_key]):
        sys.exit("R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY 환경변수를 설정하세요.")

    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )

    results = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=BUCKET, Prefix="suggestions/"):
        for obj in page.get("Contents", []):
            key: str = obj["Key"]
            relative = key.removeprefix("suggestions/")
            if "/" in relative or not relative.endswith(".json"):
                continue
            sid = relative.removesuffix(".json")
            response = s3.get_object(Bucket=BUCKET, Key=key)
            data = json.loads(response["Body"].read())
            data.setdefault("id", sid)
            results.append(data)
    return results


def main() -> dict:
    _ensure_dirs()

    suggestions = _fetch_mock() if R2_MOCK else _fetch_r2()

    processed = []
    skipped = []
    errors = []

    for sugg in suggestions:
        sid = sugg.get("id")
        if not sid:
            errors.append({"error": "missing id", "data": sugg})
            continue

        sentinel = PROCESSED_DIR / sid
        if sentinel.exists():
            skipped.append(sid)
            continue

        try:
            dest = INBOX_DIR / f"{sid}.json"
            dest.write_text(json.dumps(sugg, ensure_ascii=False, indent=2))
            sentinel.touch()
            processed.append(sid)
            print(f"[poll] processed: {sid}")
        except Exception as e:
            errors.append({"id": sid, "error": str(e)})
            print(f"[poll] error {sid}: {e}")

    result = {
        "timestamp": datetime.now().isoformat(),
        "processed": processed,
        "skipped": skipped,
        "errors": errors,
    }

    ts = datetime.now().strftime("%Y%m%dT%H%M%S")
    (RUNS_DIR / f"{ts}-poll.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(f"[poll] done — processed={len(processed)} skipped={len(skipped)} errors={len(errors)}")
    return result


if __name__ == "__main__":
    main()
