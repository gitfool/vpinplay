#!/usr/bin/env python3
"""
Seed local MongoDB with data pulled from the production VPinPlay API.

This script is READ-ONLY against production and only writes to your local
database. All upserts are idempotent, so it is safe to re-run at any time to
refresh local data.

Skipped collections (rebuilt automatically when the API container starts):
  - vpsdb_aux          : synced from the VPS GitHub repo on startup
  - tables_plus_cache  : rebuilt from tables + ratings on startup

Not available via the public API (historical analytics only):
  - user_table_state_deltas
  - user_table_rating_deltas

Usage
-----
  # Use defaults (prod API -> local Mongo)
  python scripts/seed_from_prod.py

    # Include full tables backfill + reconcile (slow)
    python scripts/seed_from_prod.py --with-table-backfill

    # Run only table backfill + reconcile
    python scripts/seed_from_prod.py --tables-only

  # Custom source / destination
  python scripts/seed_from_prod.py \\
      --prod-api  https://api.vpinplay.com:8888 \\
      --mongo-url mongodb://localhost:27017 \\
      --db-name   vpinplay_db

  # Dry-run: fetch from prod but do NOT write to local Mongo
  python scripts/seed_from_prod.py --dry-run
"""

import argparse
import json
import sys
import time
from datetime import datetime, timezone

try:
    import requests as _requests
except ImportError:
    sys.exit("requests is not installed. Run: pip install requests")

try:
    from pymongo import DeleteOne, MongoClient, UpdateOne
except ImportError:
    sys.exit("pymongo is not installed. Run: pip install pymongo")

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
DEFAULT_PROD_API   = "https://api.vpinplay.com:8888"
DEFAULT_MONGO_URL  = "mongodb://localhost:27017"
DEFAULT_DB_NAME    = "vpinplay_db"
PAGE_SIZE          = 100          # max the API allows
REQUEST_DELAY      = 0.05         # seconds between requests (be polite)
BULK_BATCH_SIZE    = 500          # upsert ops per bulk_write call


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def _session(prod_api: str) -> _requests.Session:
    s = _requests.Session()
    s.headers.update({"Accept": "application/json"})
    return s


def get_json(session: _requests.Session, url: str, retries: int = 3):
    for attempt in range(retries):
        try:
            resp = session.get(url, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except _requests.exceptions.RequestException as exc:
            if attempt < retries - 1:
                time.sleep(1.0)
                continue
            print(f"  [WARN] Failed to fetch {url}: {exc}")
            return None


def fetch_paginated_list(session, base_url: str, items_key="items") -> list:
    """Fetch all pages from an endpoint that returns a paginated object."""
    results = []
    offset = 0
    while True:
        sep = "&" if "?" in base_url else "?"
        url = f"{base_url}{sep}limit={PAGE_SIZE}&offset={offset}"
        data = get_json(session, url)
        if data is None:
            break
        if isinstance(data, list):
            results.extend(data)
            if len(data) < PAGE_SIZE:
                break
        else:
            items = data.get(items_key) or data.get("items") or []
            results.extend(items)
            pg = data.get("pagination") or {}
            if not pg.get("hasNext", False):
                break
        offset += PAGE_SIZE
        time.sleep(REQUEST_DELAY)
    return results


def fetch_plain_list(session, base_url: str) -> list:
    """Fetch all pages from an endpoint that returns a bare list."""
    results = []
    offset = 0
    while True:
        sep = "&" if "?" in base_url else "?"
        url = f"{base_url}{sep}limit={PAGE_SIZE}&offset={offset}"
        data = get_json(session, url)
        if not data:
            break
        if isinstance(data, list):
            results.extend(data)
            if len(data) < PAGE_SIZE:
                break
            offset += PAGE_SIZE
        else:
            # Treat as paginated object fallback
            items = data.get("items") or []
            results.extend(items)
            pg = data.get("pagination") or {}
            if not pg.get("hasNext", False):
                break
            offset += PAGE_SIZE
        time.sleep(REQUEST_DELAY)
    return results


# ---------------------------------------------------------------------------
# Bulk-write helper
# ---------------------------------------------------------------------------

def bulk_upsert(collection, ops: list, dry_run: bool, label: str):
    if not ops:
        print(f"  {label}: nothing to write")
        return
    if dry_run or collection is None:
        print(f"  {label}: [dry-run] would write {len(ops)} ops")
        return
    inserted = updated = 0
    for i in range(0, len(ops), BULK_BATCH_SIZE):
        batch = ops[i:i + BULK_BATCH_SIZE]
        r = collection.bulk_write(batch, ordered=False)
        inserted += r.upserted_count
        updated  += r.modified_count
    print(f"  {label}: {inserted} inserted, {updated} updated ({len(ops)} total)")


def table_variation_key(vps_id: str, vpx_file: dict, row: dict | None = None) -> str | None:
    """Create a stable key for a table variation to avoid duplicate upserts."""
    row = row or {}
    filehash = (vpx_file.get("filehash") or row.get("filehash") or "").strip().lower()
    if filehash:
        return f"{vps_id}:{filehash}"
    filename = (vpx_file.get("filename") or row.get("filename") or "").strip().lower()
    if filename:
        return f"{vps_id}:filename:{filename}"
    return None


def normalize_vpx_file(vpx_file: dict, row: dict | None = None) -> dict:
    """Ensure minimal and full rows share the same core VPX identity fields."""
    row = row or {}
    normalized = dict(vpx_file or {})
    if not normalized.get("filehash") and row.get("filehash"):
        normalized["filehash"] = row.get("filehash")
    if not normalized.get("filename") and row.get("filename"):
        normalized["filename"] = row.get("filename")
    return normalized


def reconcile_tables_collection(db, dry_run: bool):
    """
    Reconcile existing tables data:
      1) backfill missing variationKey for legacy docs
      2) remove duplicate docs per variationKey, preferring richer metadata rows
    """
    print("\n[reconcile] Normalizing and de-duplicating tables…")
    tables = db["tables"] if db is not None else None

    if dry_run or tables is None:
        print("  tables reconcile: [dry-run] skipped write operations")
        return

    # 1) Backfill missing variationKey for older rows.
    key_ops = []
    legacy_rows = tables.find(
        {"variationKey": {"$exists": False}},
        {"_id": 1, "vpsId": 1, "vpxFile": 1, "filehash": 1, "filename": 1},
    )
    for row in legacy_rows:
        vps_id = row.get("vpsId")
        if not vps_id:
            continue
        normalized_vpx = normalize_vpx_file(row.get("vpxFile") or {}, row)
        variation_key = table_variation_key(vps_id, normalized_vpx, row)
        if not variation_key:
            continue
        key_ops.append(UpdateOne(
            {"_id": row["_id"]},
            {"$set": {"variationKey": variation_key, "vpxFile": normalized_vpx}},
        ))

    if key_ops:
        updated = 0
        for i in range(0, len(key_ops), BULK_BATCH_SIZE):
            r = tables.bulk_write(key_ops[i:i + BULK_BATCH_SIZE], ordered=False)
            updated += r.modified_count
        print(f"  tables reconcile: backfilled variationKey on {updated} rows")
    else:
        print("  tables reconcile: no legacy rows missing variationKey")

    # 2) Delete duplicates for same variationKey; keep the richest + newest row.
    def is_better(candidate: dict, current: dict) -> bool:
        cand_has_vbs = 1 if ((candidate.get("vpxFile") or {}).get("vbsHash")) else 0
        curr_has_vbs = 1 if ((current.get("vpxFile") or {}).get("vbsHash")) else 0
        if cand_has_vbs != curr_has_vbs:
            return cand_has_vbs > curr_has_vbs
        cand_time = candidate.get("updatedAt") or candidate.get("backfilledAt") or candidate.get("importedAt")
        curr_time = current.get("updatedAt") or current.get("backfilledAt") or current.get("importedAt")
        if cand_time != curr_time:
            return (cand_time or datetime.min.replace(tzinfo=timezone.utc)) > (
                curr_time or datetime.min.replace(tzinfo=timezone.utc)
            )
        return False

    best_by_key = {}
    delete_ids = []
    cursor = tables.find(
        {"variationKey": {"$exists": True}},
        {
            "_id": 1,
            "variationKey": 1,
            "vpxFile": 1,
            "updatedAt": 1,
            "backfilledAt": 1,
            "importedAt": 1,
        },
    )
    for row in cursor:
        k = row.get("variationKey")
        if not k:
            continue
        current = best_by_key.get(k)
        if current is None:
            best_by_key[k] = row
            continue
        if is_better(row, current):
            delete_ids.append(current["_id"])
            best_by_key[k] = row
        else:
            delete_ids.append(row["_id"])

    if delete_ids:
        delete_ops = [DeleteOne({"_id": _id}) for _id in delete_ids]
        deleted = 0
        for i in range(0, len(delete_ops), BULK_BATCH_SIZE):
            r = tables.bulk_write(delete_ops[i:i + BULK_BATCH_SIZE], ordered=False)
            deleted += r.deleted_count
        print(f"  tables reconcile: removed {deleted} duplicate rows")
    else:
        print("  tables reconcile: no duplicate rows found")

    # 3) Try to enforce uniqueness for future runs.
    try:
        tables.create_index(
            [("variationKey", 1)],
            name="uniq_variation_key",
            unique=True,
            partialFilterExpression={"variationKey": {"$exists": True}},
        )
        print("  tables reconcile: ensured unique index on variationKey")
    except Exception as exc:
        print(f"  [WARN] Could not create unique variationKey index: {exc}")


# ---------------------------------------------------------------------------
# Seeding steps
# ---------------------------------------------------------------------------

def seed_client_registry(session, prod_api, db, dry_run, now):
    print("\n[1/3] Seeding client_registry (users)…")
    raw_users = fetch_paginated_list(session, f"{prod_api}/api/v1/users")
    # The endpoint returns {"items": ["userid1", ...]} or a plain list of strings
    user_ids = []
    for item in raw_users:
        uid = item if isinstance(item, str) else item.get("userId") if isinstance(item, dict) else None
        if uid:
            user_ids.append(uid)

    print(f"  Found {len(user_ids)} users")

    ops = []
    for uid in user_ids:
        initials  = ""
        last_sync = None
        table_count = 0

        data = get_json(session, f"{prod_api}/api/v1/users/{uid}/initials")
        if data:
            initials = data.get("initials") or ""
        time.sleep(REQUEST_DELAY)

        data = get_json(session, f"{prod_api}/api/v1/users/{uid}/last-sync")
        if data:
            last_sync = data.get("lastSyncAt")
        time.sleep(REQUEST_DELAY)

        data = get_json(session, f"{prod_api}/api/v1/users/{uid}/tables/count")
        if data:
            table_count = data.get("tableCount") or 0
        time.sleep(REQUEST_DELAY)

        print(f"    {uid}  initials={initials!r}  tables={table_count}")

        ops.append(UpdateOne(
            {"userId": uid},
            {
                "$set": {
                    "userId":                uid,
                    "userIdNormalized":      uid,
                    "initials":              initials,
                    "lastSyncAt":            last_sync,
                    "lastSyncTableCount":    table_count,
                    "importedAt":            now,
                    # machineId is not exposed by the API; placeholder ensures
                    # the document is valid while preventing accidental sync
                    # submissions from overwriting data on behalf of real users.
                    "machineId":             "imported-read-only",
                },
                "$setOnInsert": {"registeredAt": now},
            },
            upsert=True,
        ))

    bulk_upsert(db["client_registry"] if db is not None else None, ops, dry_run, "client_registry")
    return user_ids


def seed_user_table_state(session, prod_api, db, dry_run, now, user_ids):
    print("\n[2/3] Seeding user_table_state + user_table_ratings…")
    state_ops   = []
    rating_ops  = []

    for uid in user_ids:
        rows = fetch_plain_list(session, f"{prod_api}/api/v1/users/{uid}/tables")
        print(f"    {uid}: {len(rows)} table rows")

        for row in rows:
            vps_id = row.get("vpsId")
            if not vps_id:
                continue

            state_doc = {
                "userId":            uid,
                "userIdNormalized":  uid,
                "vpsId":             vps_id,
                "rating":            row.get("rating"),
                "lastRun":           row.get("lastRun"),
                "startCount":        row.get("startCount") or 0,
                "runTime":           row.get("runTime") or 0,
                "score":             row.get("score"),
                "alttitle":          row.get("alttitle"),
                "altvpsid":          row.get("altvpsid"),
                "createdAt":         row.get("createdAt"),
                "updatedAt":         row.get("updatedAt"),
                "lastSeenAt":        row.get("lastSeenAt"),
                "importedAt":        now,
            }
            state_ops.append(UpdateOne(
                {"userIdNormalized": uid, "vpsId": vps_id},
                {"$set": state_doc},
                upsert=True,
            ))

            rating = row.get("rating")
            if rating and 1 <= int(rating) <= 5:
                # vpxFile is not returned by UserTableStateResponse, so we
                # key ratings by (user, vpsId) only — sufficient for UI display.
                rating_ops.append(UpdateOne(
                    {"userIdNormalized": uid, "vpsId": vps_id, "vpxFileSignature": "__imported__"},
                    {
                        "$set": {
                            "userId":            uid,
                            "userIdNormalized":  uid,
                            "vpsId":             vps_id,
                            "vpxFileSignature":  "__imported__",
                            "rating":            int(rating),
                            "importedAt":        now,
                        }
                    },
                    upsert=True,
                ))

    bulk_upsert(db["user_table_state"]   if db is not None else None, state_ops,  dry_run, "user_table_state")
    bulk_upsert(db["user_table_ratings"] if db is not None else None, rating_ops, dry_run, "user_table_ratings")


def seed_tables(session, prod_api, db, dry_run, now):
    print("\n[3/3] Seeding tables (variation rows)…")
    rows = fetch_paginated_list(session, f"{prod_api}/api/v1/tables")
    print(f"  Found {len(rows)} variation rows")

    ops = []
    for row in rows:
        vps_id = row.get("vpsId")
        vpx_file = normalize_vpx_file(row.get("vpxFile") or {}, row)
        variation_key = table_variation_key(vps_id, vpx_file, row) if vps_id else None
        if not vps_id or not variation_key:
            continue
        ops.append(UpdateOne(
            {"variationKey": variation_key},
            {
                "$set": {
                    "variationKey": variation_key,
                    "vpsId":       vps_id,
                    "vpxFile":     vpx_file,
                    "createdAt":   row.get("createdAt"),
                    "updatedAt":   row.get("updatedAt"),
                    "lastSeenAt":  row.get("lastSeenAt"),
                    "importedAt":  now,
                },
                "$setOnInsert": {"importSource": "api-seed"},
            },
            upsert=True,
        ))

    bulk_upsert(db["tables"] if db is not None else None, ops, dry_run, "tables")


def seed_tables_full(session, prod_api, db, dry_run, now, vps_ids=None):
    """
    Backfill full vpxFile data by calling /tables/{vpsId} for each unique vpsId.

    The paginated /tables list only returns vpxFile.filehash + filename.
    This step fetches the complete vpxFile object (vbsHash, rom, version, etc.)
    needed for the Metadata and Derivative Differences panels.
    """
    print("\n[backfill] Fetching full vpxFile data per vpsId…")

    if vps_ids is None:
        # Collect unique vpsIds from the paginated list endpoint.
        print("  Discovering unique vpsIds from prod…")
        rows = fetch_paginated_list(session, f"{prod_api}/api/v1/tables")
        vps_ids = list({r.get("vpsId") for r in rows if r.get("vpsId")})

    print(f"  {len(vps_ids)} unique vpsIds to fetch")

    ops = []
    for i, vps_id in enumerate(sorted(vps_ids), 1):
        if i % 100 == 0 or i == len(vps_ids):
            print(f"  … {i}/{len(vps_ids)}")
        variations = get_json(session, f"{prod_api}/api/v1/tables/{vps_id}")
        time.sleep(REQUEST_DELAY)
        if not variations or not isinstance(variations, list):
            continue
        for row in variations:
            vpx_file = normalize_vpx_file(row.get("vpxFile") or {}, row)
            variation_key = table_variation_key(vps_id, vpx_file, row)
            if not variation_key:
                continue
            ops.append(UpdateOne(
                {"variationKey": variation_key},
                {
                    "$set": {
                        "variationKey":                   variation_key,
                        "vpsId":                          vps_id,
                        "vpxFile":                        vpx_file,
                        "rom":                            row.get("rom"),
                        "submittedByUserIdsNormalized":   row.get("submittedByUserIdsNormalized") or [],
                        "firstSeenByUserIdNormalized":    row.get("firstSeenByUserIdNormalized"),
                        "createdAt":                      row.get("createdAt"),
                        "updatedAt":                      row.get("updatedAt"),
                        "lastSeenAt":                     row.get("lastSeenAt"),
                        "backfilledAt":                   now,
                    },
                    "$setOnInsert": {"importSource": "api-seed"},
                },
                upsert=True,
            ))

    bulk_upsert(db["tables"] if db is not None else None, ops, dry_run, "tables (full vpxFile backfill)")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--prod-api",        default=DEFAULT_PROD_API,  help=f"Production API base URL (default: {DEFAULT_PROD_API})")
    p.add_argument("--mongo-url",       default=DEFAULT_MONGO_URL, help=f"Local MongoDB URL (default: {DEFAULT_MONGO_URL})")
    p.add_argument("--db-name",         default=DEFAULT_DB_NAME,   help=f"Local database name (default: {DEFAULT_DB_NAME})")
    p.add_argument("--dry-run",         action="store_true",       help="Fetch from prod but skip all local writes")
    p.add_argument("--with-table-backfill", action="store_true",   help="After default sync, backfill full vpxFile data and reconcile tables (slow)")
    p.add_argument("--tables-only", action="store_true",            help="Run only full vpxFile backfill + reconcile for tables")
    p.add_argument("--backfill-tables", action="store_true",        help=argparse.SUPPRESS)
    return p.parse_args()


def main():
    args = parse_args()
    now  = datetime.now(timezone.utc)

    # Backward-compatible alias for older command usage.
    if args.backfill_tables:
        args.tables_only = True

    print(f"Source  : {args.prod_api}")
    print(f"Target  : {args.mongo_url} / {args.db_name}")
    if args.tables_only and args.dry_run:
        print("Mode    : DRY RUN + TABLES ONLY — full vpxFile backfill + reconcile")
    elif args.tables_only:
        print("Mode    : TABLES ONLY — full vpxFile backfill + reconcile")
    elif args.with_table_backfill and args.dry_run:
        print("Mode    : DRY RUN + TABLE BACKFILL — includes slow full vpxFile backfill")
    elif args.with_table_backfill:
        print("Mode    : LIVE + TABLE BACKFILL — includes slow full vpxFile backfill")
    elif args.dry_run:
        print("Mode    : DRY RUN — no writes will be made")
    else:
        print("Mode    : LIVE — core sync only (fast path)")

    session = _session(args.prod_api)

    if not args.dry_run:
        mongo_client = MongoClient(args.mongo_url)
        db = mongo_client[args.db_name]
    else:
        db = None

    if args.tables_only:
        seed_tables_full(session, args.prod_api, db, args.dry_run, now)
        reconcile_tables_collection(db, args.dry_run)
    else:
        user_ids = seed_client_registry(session, args.prod_api, db, args.dry_run, now)
        seed_user_table_state(session, args.prod_api, db, args.dry_run, now, user_ids)
        seed_tables(session, args.prod_api, db, args.dry_run, now)
        if args.with_table_backfill:
            seed_tables_full(session, args.prod_api, db, args.dry_run, now)
            reconcile_tables_collection(db, args.dry_run)

    print("\nDone.")
    if not args.dry_run:
        print("\nRestart the API container to rebuild derived caches:")
        print("  docker compose -f docker-compose-local-mac.yml restart api")
        print("\nNote: weekly-activity analytics (state_deltas / rating_deltas) are")
        print("not available via the public API — those collections will be empty.")


if __name__ == "__main__":
    main()
