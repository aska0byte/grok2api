#!/bin/sh
# grok2api start (pm2 daemon mode)
# main service always starts; quality-guard sidecar starts if python3.7+ exists
# usage: ./start.sh
set -e
cd "$(dirname "$0")"

command -v pm2 >/dev/null 2>&1 || { echo "[error] pm2 not installed. run: npm install -g pm2"; exit 1; }

mkdir -p qg data logs
chmod +x ./grok2api

pm2 start ecosystem.config.js

# --- python >= 3.7 detection (no auto-install) ---
GUARD_PYTHON=""

# 1) try local miniforge
for p in ./python/bin/python3 ./python3/bin/python3 /opt/python3/bin/python3; do
  if [ -x "$p" ] && "$p" -c "import sys; sys.exit(0 if sys.version_info>=(3,7)else 1)" 2>/dev/null; then
    GUARD_PYTHON="$PWD/$p"; break
  fi
done

# 2) try SCL
if [ -z "$GUARD_PYTHON" ] && [ -x /opt/rh/rh-python38/root/usr/bin/python3.8 ]; then
  GUARD_PYTHON="/opt/rh/rh-python38/root/usr/bin/python3.8"
fi

# 3) try system python
for cmd in python3.13 python3.12 python3.11 python3.10 python3.9 python3.8 python3 python; do
  if [ -z "$GUARD_PYTHON" ] && command -v "$cmd" >/dev/null 2>&1; then
    if "$cmd" -c "import sys; sys.exit(0 if sys.version_info>=(3,7)else 1)" 2>/dev/null; then
      GUARD_PYTHON="$(command -v "$cmd")"
    fi
  fi
done

if [ -n "$GUARD_PYTHON" ]; then
  PY_VER=$("$GUARD_PYTHON" -c "import sys; print('.'.join(map(str, sys.version_info[:3])))" 2>/dev/null)
  echo "[info] guard python: $GUARD_PYTHON ($PY_VER)"
  # wrapper bakes in env vars (pm2 ecosystem env is unreliable for non-config filenames)
  cat > ./qg-python3 <<EOFWRAPPER
#!/bin/sh
export GROK2API_QUALITY_GUARD_DIR="$PWD/qg"
export GROK2API_BASE_URL="http://127.0.0.1:8000"
exec $GUARD_PYTHON "\$@"
EOFWRAPPER
  chmod +x ./qg-python3
  # NOTE: use CLI with explicit flags; pm2 does NOT parse arbitrary *.js as config files
  pm2 delete grok2api-quality-guard 2>/dev/null || true
  pm2 start "$PWD/egress-quality-guard/quality_guard.py" \
    --name grok2api-quality-guard \
    --interpreter "$PWD/qg-python3" \
    --cwd "$PWD" \
    --merge-logs --time \
    || echo "[warn] quality-guard failed, check: pm2 logs grok2api-quality-guard"
else
  echo "[warn] no python3.7+ found, quality-guard skipped"
  echo "[hint] install: wget https://mirrors.tuna.tsinghua.edu.cn/github-release/conda-forge/miniforge/LatestRelease/Miniforge3-Linux-x86_64.sh -O /tmp/miniforge.sh && bash /tmp/miniforge.sh -b -p /opt/python3"
fi

pm2 save
echo "started (pm2 status)"
