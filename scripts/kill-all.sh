#!/usr/bin/env bash
# Kill all Claude Air dev servers by port (SMS:7331, WAS:7333, Vite:5173)
# Uses /T to kill the entire process tree (tsx watch → node child)
for port in 7331 7333 5173; do
  pid=$(netstat -ano 2>/dev/null | tr -d '\r' | grep ":${port} " | grep LISTENING | awk '{print $5}' | head -1)
  if [ -n "$pid" ]; then
    taskkill //F //T //PID "$pid" 2>/dev/null && echo "Killed PID $pid tree on port $port" || echo "Failed to kill PID $pid on port $port"
  else
    echo "No process on port $port"
  fi
done
