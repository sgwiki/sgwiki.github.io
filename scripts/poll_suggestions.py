#!/usr/bin/env python3
"""R2에서 새 제안을 폴링하여 suggestions/inbox/에 저장한다.

멱등성 보장: suggestions/processed/{id} 파일이 존재하면 건너뜀.

환경변수:
  R2_ENDPOINT    https://<account_id>.r2.cloudflarestorage.com
  R2_ACCESS_KEY  R2 API 토큰 Access Key ID
  R2_SECRET_KEY  R2 API 토큰 Secret Access Key
"""

import json
import os
import sys
from pathlib import Path

import boto3
from botocore.config import Config

BUCKET = "sg-wiki-suggestions"
INBOX_DIR = Path("suggestions/inbox")
PROCESSED_DIR = Path("suggestions/processed")


def build_client() -> "boto3.client":
    endpoint = os.environ.get("R2_ENDPOINT")
    access_key = os.environ.get("R2_ACCESS_KEY")
    secret_key = os.environ.get("R2_SECRET_KEY")

    if not all([endpoint, access_key, secret_key]):
        sys.exit("R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY 환경변수를 설정하세요.")

    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def main() -> None:
    INBOX_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    s3 = build_client()
    paginator = s3.get_paginator("list_objects_v2")
    new_count = 0

    for page in paginator.paginate(Bucket=BUCKET, Prefix="suggestions/"):
        for obj in page.get("Contents", []):
            key: str = obj["Key"]

            # suggestions/{id}.json 형식만 처리 (decisions/, processed/ 제외)
            relative = key.removeprefix("suggestions/")
            if "/" in relative or not relative.endswith(".json"):
                continue

            suggestion_id = relative.removesuffix(".json")

            # 멱등성: 이미 처리된 제안은 건너뜀
            if (PROCESSED_DIR / suggestion_id).exists():
                continue

            response = s3.get_object(Bucket=BUCKET, Key=key)
            data = json.loads(response["Body"].read())

            out_path = INBOX_DIR / f"{suggestion_id}.json"
            out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            new_count += 1
            print(f"[downloaded] {suggestion_id}")

    print(f"poll 완료 — 신규 {new_count}건")


if __name__ == "__main__":
    main()
