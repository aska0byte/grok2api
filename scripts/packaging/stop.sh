#!/bin/sh
# grok2api stop (pm2 daemon mode)
# usage: ./stop.sh          fully remove (incl. boot list): ./stop.sh delete
set -e
cd "$(dirname "$0")"

command -v pm2 >/dev/null 2>&1 || { echo "pm2 not installed"; exit 1; }

if [ "$1" = "delete" ]; then
  pm2 delete grok2api grok2api-quality-guard 2>/dev/null || true
  pm2 save
  echo "stopped and removed from pm2 list"
else
  pm2 stop grok2api grok2api-quality-guard 2>/dev/null || true
  echo "stopped (restart main service with: pm2 restart grok2api)"
fi
