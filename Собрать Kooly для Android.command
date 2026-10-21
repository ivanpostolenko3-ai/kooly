#!/bin/bash
# Собирает Kooly.apk для Android и кладёт его на Рабочий стол — этот файл можно отправить кому угодно.
# Ключ подписи: ~/.android/kooly-release.jks (+ .properties). Не теряй его: без него обновление не встанет поверх старой версии.
set -euo pipefail
cd "$(dirname "$0")/android"
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
[ -f local.properties ] || echo "sdk.dir=/opt/homebrew/share/android-commandlinetools" > local.properties
if [ ! -f ~/.android/kooly-release.properties ]; then
  echo "❌ Нет ключа подписи ~/.android/kooly-release.properties"; exit 1
fi
echo "Собираю Kooly для Android…"
./gradlew -q assembleRelease
cp app/build/outputs/apk/release/app-release.apk ~/Desktop/Kooly.apk
echo "✅ Готово: Рабочий стол → Kooly.apk"
open -R ~/Desktop/Kooly.apk
