#!/bin/bash
# Сборка таймера для строки меню Mac (нужны только Command Line Tools, полный Xcode не нужен).
# Результат: mac/build/Kooly Menu.app — его можно перетащить в «Программы».
set -euo pipefail
cd "$(dirname "$0")"
APP="build/Kooly Menu.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

swiftc -O -parse-as-library -target arm64-apple-macos14.0 KoolyMenu/main.swift -o "$APP/Contents/MacOS/KoolyMenu"

# Иконка из иконки Kooly
ICONSET=build/AppIcon.iconset
rm -rf "$ICONSET" && mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s ../icons/icon-512.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2)); [ $d -le 512 ] && sips -z $d $d ../icons/icon-512.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
cp ../icons/icon-512.png "$ICONSET/icon_256x256@2x.png"
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
rm -rf "$ICONSET"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Kooly Menu</string>
  <key>CFBundleDisplayName</key><string>Kooly</string>
  <key>CFBundleIdentifier</key><string>ee.kooly.menu</string>
  <key>CFBundleExecutable</key><string>KoolyMenu</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

codesign --force --deep -s - "$APP"
echo "Valmis: $(pwd)/$APP"
