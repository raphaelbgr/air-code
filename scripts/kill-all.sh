#!/usr/bin/env bash
# Kill all Claude Air dev servers by port (SMS:7331, WAS:7333, Vite:5173)
for port in 7331 7333 5173; do
  pid=$(netstat -ano 2>/dev/null | awk -v p=":$port" '$1=="TCP" && $2~p"$" && $4=="LISTENING" {print $5; exit}')
  if [ -n "$pid" ]; then
    taskkill //F //PID "$pid" 2>/dev/null && echo "Killed PID $pid on port $port" || echo "Failed to kill PID $pid on port $port"
  else
    echo "No process on port $port"
  fi
done
