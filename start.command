#!/bin/bash
# Запуск Kooly: двойной клик по файлу (или ./start.command в терминале).
cd "$(dirname "$0")"
PORT=8000
PID_FILE=".server.pid"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Сервер уже работает: http://localhost:$PORT"
else
  nohup python3 server.py "$PORT" > .server.log 2>&1 &
  echo $! > "$PID_FILE"
  sleep 1
  if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Не удалось запустить сервер. Возможно, порт $PORT занят. Подробности в .server.log"
    rm -f "$PID_FILE"
    exit 1
  fi
  echo "Сервер запущен: http://localhost:$PORT"
fi

IP=$(ipconfig getifaddr en0 2>/dev/null)
[ -n "$IP" ] && echo "С телефона в той же Wi-Fi сети: http://$IP:$PORT"
open "http://localhost:$PORT"
echo "Чтобы выключить — запусти stop.command"
