#!/bin/bash
# Переустановка Kooly на iPhone (нужна раз в 7 дней с бесплатным Apple ID).
# Подключи iPhone кабелем, разблокируй его и дважды щёлкни по этому файлу.
cd "$(dirname "$0")/ios" || exit 1
BUILD="$HOME/Library/Developer/Kooly-build"

echo "🔎 Ищу подключённый iPhone…"
UDID=$(xcrun devicectl list devices 2>/dev/null | awk '/physical/ && (/connected/ || /available/) {for (i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) print $i}' | head -1)
if [ -z "$UDID" ]; then
  echo "❌ iPhone не найден. Подключи его кабелем, разблокируй и нажми «Доверять», потом запусти снова."
  read -n 1 -s -r -p "Нажми любую клавишу, чтобы закрыть…"; exit 1
fi
echo "📱 iPhone: $UDID"

echo "🛠  Собираю Kooly (1–2 минуты)…"
if ! xcodebuild -project Kooly.xcodeproj -scheme Kooly -configuration Release \
     -destination "generic/platform=iOS" -derivedDataPath "$BUILD" -allowProvisioningUpdates build -quiet; then
  echo "❌ Сборка не удалась. Открой Xcode → Settings → Accounts и проверь, что Apple ID на месте."
  read -n 1 -s -r -p "Нажми любую клавишу, чтобы закрыть…"; exit 1
fi

echo "📲 Устанавливаю на iPhone…"
if ! xcrun devicectl device install app --device "$UDID" "$BUILD/Build/Products/Release-iphoneos/Kooly.app" >/dev/null; then
  echo "❌ Установка не удалась. Разблокируй iPhone и попробуй ещё раз."
  read -n 1 -s -r -p "Нажми любую клавишу, чтобы закрыть…"; exit 1
fi

xcrun devicectl device process launch --device "$UDID" ee.kooly.ivan.app >/dev/null 2>&1
echo "✅ Готово! Kooly снова работает ещё 7 дней. Окно можно закрыть."
read -n 1 -s -r -p "Нажми любую клавишу, чтобы закрыть…"
