#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  show_scores.sh [--user USER_ID] [--vpsid VPS_ID] [--limit N] [--container NAME] [--db NAME] [--pretty]

Options:
  --user USER_ID      Filter by userId or userIdNormalized (case-insensitive)
  --vpsid VPS_ID      Filter by vpsId
  --limit N           Maximum number of rows to print (default: 0 = no limit)
  --container NAME    Mongo container name (default: vpinplay_mongo)
  --db NAME           Mongo database name (default: vpinplay_db)
  --pretty            Pretty-print full matching documents
  -h, --help          Show this help

Examples:
  ./scripts/show_scores.sh
  ./scripts/show_scores.sh --user cabinet_1
  ./scripts/show_scores.sh --user cabinet_1 --pretty --limit 20
  ./scripts/show_scores.sh --vpsid lkSumsrF
EOF
}

MONGO_CONTAINER="vpinplay_mongo"
DB_NAME="vpinplay_db"
USER_ID=""
VPS_ID=""
LIMIT="0"
PRETTY="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user)
      USER_ID="${2:-}"
      shift 2
      ;;
    --vpsid)
      VPS_ID="${2:-}"
      shift 2
      ;;
    --limit)
      LIMIT="${2:-}"
      shift 2
      ;;
    --container)
      MONGO_CONTAINER="${2:-}"
      shift 2
      ;;
    --db)
      DB_NAME="${2:-}"
      shift 2
      ;;
    --pretty)
      PRETTY="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if ! [[ "$LIMIT" =~ ^[0-9]+$ ]]; then
  echo "--limit must be a non-negative integer." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but not found in PATH." >&2
  exit 1
fi

USER_ID_ESCAPED="${USER_ID//\\/\\\\}"
USER_ID_ESCAPED="${USER_ID_ESCAPED//\'/\\\'}"
VPS_ID_ESCAPED="${VPS_ID//\\/\\\\}"
VPS_ID_ESCAPED="${VPS_ID_ESCAPED//\'/\\\'}"

JS="
const userId = '$USER_ID_ESCAPED';
const vpsId = '$VPS_ID_ESCAPED';
const limit = Number('$LIMIT');
const pretty = '$PRETTY' === 'true';

const escapeRegex = (value) => String(value).replace(/[.*+?^\\\\\${}()|[\\]\\\\]/g, '\\\\$&');
const query = { score: { \$type: 'object' } };

if (userId) {
  query.\$or = [
    { userIdNormalized: userId.toLowerCase() },
    { userId: { \$regex: '^' + escapeRegex(userId) + '\$', \$options: 'i' } },
  ];
}

if (vpsId) {
  query.vpsId = vpsId;
}

let cursor = db.user_table_state.find(query, { _id: 0 }).sort({ userId: 1, vpsId: 1, updatedAt: -1 });
if (limit > 0) {
  cursor = cursor.limit(limit);
}

const rows = cursor.toArray();
if (!rows.length) {
  print('No score rows found.');
} else if (pretty) {
  rows.forEach((row) => printjson(row));
} else {
  rows.forEach((row) => {
    const score = row.score || {};
    const value = score.value === undefined || score.value === null || score.value === '' ? '-' : score.value;
    const scoreType = score.score_type || '-';
    const rom = score.resolved_rom || score.rom || '-';
    print(
      'user=' + (row.userId || '-') +
      ' vpsId=' + (row.vpsId || '-') +
      ' score_type=' + scoreType +
      ' value=' + value +
      ' rom=' + rom +
      ' updatedAt=' + (row.updatedAt || '-')
    );
  });
}

print('');
print('Found ' + rows.length + ' score row(s).');
"

docker exec -i "$MONGO_CONTAINER" mongosh "$DB_NAME" --quiet --eval "$JS"
