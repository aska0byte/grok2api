#!/bin/sh
# One-time migration: mark every existing egress node as temporary (probe)
# and release account-to-node bindings.
#
# Requirements:
#   1. run from the deployment dir (or via ./migrate-probe.sh)
#   2. main service stopped:  ./stop.sh
#   3. new version started once BEFORE this script, so AutoMigrate has
#      created the egress_nodes.usage column (start -> healthz -> stop)
#
# The system python3 may bundle an ancient SQLite (e.g. CentOS 7 ships
# 3.7.17) that cannot parse the schema written by the Go app (partial and
# expression indexes). The picker below therefore verifies a candidate can
# actually parse such schema before using it, preferring the quality-guard
# sidecar's python (miniforge bundles a modern SQLite).
set -e
cd "$(dirname "$0")"

DB="data/backend.db"
if [ ! -f "$DB" ]; then
    echo "[error] $DB not found. Run from the deployment dir."
    exit 1
fi

PY=""
for cand in ./qg-python3 ./python/bin/python3 ./python3/bin/python3 /opt/python3/bin/python3 \
            /opt/rh/rh-python38/root/usr/bin/python3.8 \
            python3.13 python3.12 python3.11 python3.10 python3.9 python3.8 python3; do
    if [ -x "$cand" ] || command -v "$cand" >/dev/null 2>&1; then
        if "$cand" -c 'import sqlite3
c = sqlite3.connect(":memory:")
c.execute("CREATE TABLE t(x INTEGER)")
c.execute("CREATE INDEX i ON t(x) WHERE x > 0")
c.execute("CREATE INDEX j ON t(abs(x))")
' >/dev/null 2>&1; then
            PY="$cand"
            break
        fi
    fi
done
if [ -z "$PY" ]; then
    echo "[error] no python with a modern SQLite found (need >= 3.9)"
    echo "[hint] install miniforge the same way the quality-guard sidecar does, or start the sidecar once so ./qg-python3 exists, then retry"
    exit 1
fi
echo "[info] using python: $PY (sqlite $(env $PY -c 'import sqlite3; print(sqlite3.sqlite_version)' 2>/dev/null || $PY -c 'import sqlite3; print(sqlite3.sqlite_version)'))"

"$PY" <<'PYEOF'
import sqlite3, sys

c = sqlite3.connect("data/backend.db")
try:
    c.execute("UPDATE egress_nodes SET usage='probe'")
except sqlite3.OperationalError as exc:
    print("[error] %s" % exc)
    print("[hint] start the NEW version once first (AutoMigrate adds the usage column), then stop and retry")
    sys.exit(1)
unbound = c.execute(
    "UPDATE provider_accounts SET egress_node_id=NULL, egress_assignment_mode=''"
    " WHERE egress_node_id IS NOT NULL"
).rowcount
c.commit()
print("migrated. nodes by usage:", c.execute(
    "SELECT usage, COUNT(*) FROM egress_nodes GROUP BY usage").fetchall())
print("released account bindings:", unbound)
c.close()
PYEOF

echo "done. now run ./start.sh"
