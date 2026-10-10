#!/bin/bash
# Остановка Kooly: двойной клик по файлу (или ./stop.command в терминале).
cd "$(dirname "$0")"
PORT=8000
PID_FILE=".server.pid"

if [ -f "$PID_FILE" ] && kill "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Сервер остановлен"
else
  # PID-файла нет — ищем сервер по порту
  PID=$(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null)
  if [ -n "$PID" ]; then
    kill $PID && echo "Сервер остановлен"
  else
    echo "Сервер не был запущен"
  fi
fi
rm -f "$PID_FILE"
