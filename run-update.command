#!/bin/bash
# =============================================================================
# run-update.command — Wrapper для запуска обновления двойным кликом на macOS
# =============================================================================
# Этот скрипт предназначен для запуска через Finder (двойной клик).
# Он открывает Terminal, выполняет update.sh и закрывает Terminal после завершения.
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

# Создаём временный скрипт который выполнит update.sh и закроется
TEMP_SCRIPT="/tmp/kontur-update-$$"
cat > "$TEMP_SCRIPT" << 'INNEREOF'
#!/bin/bash
SCRIPT_DIR="$1"
cd "$SCRIPT_DIR" && bash ./update.sh
# Закрываем окно Terminal после завершения
osascript -e 'tell application "Terminal" to quit'
INNEREOF

chmod +x "$TEMP_SCRIPT"

# Открываем Terminal и выполняем скрипт
osascript << EOF
tell application "Terminal"
    activate
    do script "bash '$TEMP_SCRIPT' '$SCRIPT_DIR'"
end tell
EOF
