#!/bin/sh
# grok2api one-shot upgrade: backup -> stop -> unzip -> start -> health check
# usage: ./upgrade.sh [path/to/grok2api-linux-x86_64.zip]
#        (no arg = pick the newest grok2api-linux-x86_64.zip in the current dir)
#
# Safe by design:
#   - config.yaml / data/ / logs/ / qg/ are never touched by the zip
#   - config.yaml + data/backend.db + old binary are backed up before upgrade
#   - failed health check auto-rolls back the binary and restarts
set -e
cd "$(dirname "$0")"

ZIP=""
if [ -n "$1" ]; then
    ZIP="$1"
else
    # newest matching zip in the deploy dir
    for f in $(ls -1t grok2api-linux-x86_64*.zip 2>/dev/null); do
        ZIP="$f"; break
    done
fi
if [ -z "$ZIP" ] || [ ! -f "$ZIP" ]; then
    echo "[error] zip not found. put the zip next to this script or pass a path:"
    echo "        ./upgrade.sh /tmp/grok2api-linux-x86_64.zip"
    exit 1
fi
echo "[info] upgrade package: $ZIP"

command -v pm2 >/dev/null 2>&1 || { echo "[error] pm2 not installed"; exit 1; }
if [ ! -f data/backend.db ]; then
    echo "[error] data/backend.db not found. run from the deployment dir only."
    exit 1
fi

# ---------- 1. backup (keep last 5) ----------
TS=$(date +%Y%m%d-%H%M%S)
BK="backup/$TS"
mkdir -p "$BK"
[ -f config.yaml ] && cp -p config.yaml "$BK/"
cp -p data/backend.db "$BK/"
for suf in -wal -shm; do
    if [ -f "data/backend.db$suf" ]; then
        cp -p "data/backend.db$suf" "$BK/"
    fi
done
cp -p grok2api "$BK/" 2>/dev/null || echo "[warn] no old binary to back up"
ls -1dt backup/* 2>/dev/null | tail -n +6 | xargs -r rm -rf
echo "[info] backup -> $BK"

# ---------- 2. stop ----------
# chmod first: an older deployment may ship scripts without the exec bit
chmod +x ./stop.sh ./start.sh 2>/dev/null || true
sh ./stop.sh || true

# ---------- 3. extract ----------
# stale frontend assets from older upgrades accumulate forever; clear the
# built frontend first so the browser can only load the bundled hashes
rm -rf frontend/dist
if command -v unzip >/dev/null 2>&1; then
    # rc 1 = warnings only (PowerShell zips use backslash separators);
    # anything higher means a real failure
    set +e
    unzip -o "$ZIP"
    UNZIP_RC=$?
    set -e
    if [ "$UNZIP_RC" -gt 1 ]; then
        echo "[error] unzip failed (rc=$UNZIP_RC)"
        exit 1
    fi
else
    echo "[warn] unzip missing, falling back to python zipfile"
    PYUNZIP=""
    for cand in ./qg-python3 python3 python; do
        if [ -x "$cand" ] || command -v "$cand" >/dev/null 2>&1; then
            PYUNZIP="$cand"; break
        fi
    done
    [ -n "$PYUNZIP" ] || { echo "[error] no unzip and no python available"; exit 1; }
    "$PYUNZIP" -m zipfile -e "$ZIP" .
fi
chmod +x grok2api start.sh stop.sh migrate-probe.sh upgrade.sh 2>/dev/null || true
echo "[info] extracted (config.yaml/data/logs untouched)"

# ---------- 4. start ----------
sh ./start.sh

# ---------- 5. health check (auto rollback on failure) ----------
PORT=$(awk '/^listen:/{print; exit}' config.yaml 2>/dev/null | grep -oE '[0-9]+$')
PORT=${PORT:-8000}
HEALTH_URL="http://127.0.0.1:$PORT/healthz"
http_get() {
    if command -v curl >/dev/null 2>&1; then
        curl -fsS -m 3 "$1" 2>/dev/null
    else
        wget -qO- -T 3 "$1" 2>/dev/null
    fi
}
OK=""
i=0
while [ $i -lt 30 ]; do
    if [ "$(http_get "$HEALTH_URL")" != "" ]; then OK=1; break; fi
    i=$((i+1)); sleep 1
done
if [ -z "$OK" ]; then
    echo "[error] health check failed after 30s: $HEALTH_URL"
    if [ -f "$BK/grok2api" ]; then
        echo "[warn] rolling back binary from $BK"
        cp -p "$BK/grok2api" ./grok2api
        sh ./start.sh || true
        echo "[warn] rolled back. logs: pm2 logs grok2api --lines 100"
    else
        echo "[warn] no backup binary. logs: pm2 logs grok2api --lines 100"
    fi
    exit 1
fi
echo "[info] healthy: $HEALTH_URL"

# ---------- 6. one-time usage-column migration hint ----------
PYCHK=""
for cand in ./qg-python3 python3.13 python3.12 python3.11 python3.10 python3.9 python3.8 python3; do
    if [ -x "$cand" ] || command -v "$cand" >/dev/null 2>&1; then
        if "$cand" -c 'import sqlite3
c = sqlite3.connect("data/backend.db")
c.execute("SELECT usage FROM egress_nodes LIMIT 1")
' >/dev/null 2>&1; then
            PYCHK="$cand"; break
        fi
    fi
done
if [ -n "$PYCHK" ]; then
    if ! "$PYCHK" -c 'import sqlite3
c = sqlite3.connect("data/backend.db")
c.execute("SELECT usage FROM egress_nodes LIMIT 1")
' >/dev/null 2>&1; then
        echo "[warn] egress_nodes.usage column missing (old schema)."
        echo "[hint] one-time migration: ./stop.sh && ./migrate-probe.sh && ./start.sh"
    fi
else
    echo "[warn] could not verify egress_nodes.usage column (no usable python)."
fi

pm2 save >/dev/null 2>&1 || true
echo "[done] upgraded. pm2 status:"
pm2 status
