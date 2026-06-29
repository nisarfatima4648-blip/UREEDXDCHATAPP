#!/bin/bash
# Start both services, restart on crash
while true; do
  echo "[$(date)] Starting Next.js..."
  cd /home/z/my-project
  rm -f .next/dev/lock 2>/dev/null
  node node_modules/.bin/next dev -p 3000 --webpack 2>&1
  echo "[$(date)] Next.js exited with code $?. Restarting in 2s..."
  sleep 2
done