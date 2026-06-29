#!/bin/bash
# Start chat service, restart on crash
while true; do
  echo "[$(date)] Starting chat-service..."
  cd /home/z/my-project/mini-services/chat-service
  bun run dev 2>&1
  echo "[$(date)] chat-service exited with code $?. Restarting in 2s..."
  sleep 2
done