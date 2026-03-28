#!/usr/bin/env python3
"""Show score payloads stored in MongoDB user table state."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Print all user_table_state rows that contain a score payload."
    )
    parser.add_argument("--user", help="Filter by userId or userIdNormalized.")
    parser.add_argument("--vpsid", help="Filter by vpsId.")
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Maximum number of rows to print. 0 means no limit.",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print each row as JSON.",
    )
    return parser.parse_args()


def load_dotenv_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def build_query(args: argparse.Namespace) -> dict:
    query: dict = {"score": {"$type": "object"}}

    if args.user:
        query["$or"] = [
            {"userId": args.user},
            {"userIdNormalized": args.user.lower()},
        ]

    if args.vpsid:
        query["vpsId"] = args.vpsid

    return query


def format_row(row: dict) -> str:
    score = row.get("score") or {}
    value = score.get("value")
    score_type = score.get("score_type") or "-"
    resolved_rom = score.get("resolved_rom") or score.get("rom") or "-"
    updated_at = row.get("updatedAt") or "-"

    return (
        f"user={row.get('userId', '-')}"
        f" vpsId={row.get('vpsId', '-')}"
        f" score_type={score_type}"
        f" value={value if value is not None else '-'}"
        f" rom={resolved_rom}"
        f" updatedAt={updated_at}"
    )


def main() -> int:
    load_dotenv_file(Path(".env"))
    args = parse_args()
    query = build_query(args)
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    mongo_db_name = os.environ.get("MONGO_DB_NAME", "vpinplay_db")

    try:
        from pymongo import MongoClient
        from pymongo.errors import PyMongoError
    except ModuleNotFoundError:
        print(
            "Missing dependency: pymongo. Run this script where the service dependencies are installed.",
            file=sys.stderr,
        )
        return 1

    try:
        client = MongoClient(mongo_url)
        collection = client[mongo_db_name]["user_table_state"]
        cursor = collection.find(query, {"_id": 0}).sort(
            [("userId", 1), ("vpsId", 1), ("updatedAt", -1)]
        )
        if args.limit > 0:
            cursor = cursor.limit(args.limit)

        rows = list(cursor)
    except PyMongoError as exc:
        print(f"MongoDB query failed: {exc}", file=sys.stderr)
        return 1
    finally:
        try:
            client.close()
        except Exception:
            pass

    if not rows:
        print("No score rows found.")
        return 0

    for row in rows:
        if args.pretty:
            print(json.dumps(row, indent=2, default=str))
        else:
            print(format_row(row))

    print(f"\nFound {len(rows)} score row(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
