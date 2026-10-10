#!/bin/bash
# Выпуск новой версии сайта: поднимает номер версии в ссылках на файлы и в кэше (sw.js),
# чтобы телефон не смешивал старые и новые файлы. Потом: git commit + git push.
set -euo pipefail
cd "$(dirname "$0")"
current=$(grep -o 'kooly-v[0-9]*' sw.js | head -1 | sed 's/kooly-v//')
next=$((current + 1))
sed -i '' "s/kooly-v$current\"/kooly-v$next\"/" sw.js
sed -i '' -E "s/(styles\.css|[a-z]+\.js)\?v=[0-9]+/\1?v=$next/g" index.html
echo "Versioon: $current → $next"
