#!/bin/bash
# =============================================================================
# run-update.sh — Wrapper для запуска обновления двойным кликом на macOS
# =============================================================================
# Этот скрипт предназначен для запуска через Finder (двойной клик).
# Он открывает Terminal и выполняет update.sh с правами администратора.
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPDATE_SCRIPT="$SCRIPT_DIR/update.sh"

# Проверяем что update.sh существует
if [ ! -f "$UPDATE_SCRIPT" ]; then
    osascript -e "display dialog \"Файл update.sh не найден в папке:
$SCRIPT_DIR

Убедитесь что вы скачали все файлы расширения.\" with title \"Ошибка\" buttons {\"OK\"} with icon stop"
    exit 1
fi

# Делаем update.sh исполняемым
chmod +x "$UPDATE_SCRIPT"

# Открываем Terminal и выполняем update.sh
# Используем osascript для запуска Terminal
osascript << EOF
tell application "Terminal"
    activate
    do script "cd '$SCRIPT_DIR' && bash ./update.sh"
end tell
EOF

# Альтернативно можно использовать AppleScript напрямую:
# osascript -e "tell application \"Terminal\" to do script \"cd '$SCRIPT_DIR' && bash ./update.sh\""
# osascript -e "tell application \"Terminal\" to activate"
