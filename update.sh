#!/bin/bash
# =============================================================================
# update.sh — Скрипт автоматического обновления расширения Контур Отель для macOS
# =============================================================================
# Запуск: bash ./update.sh или дважды кликните по run-update.command
# Требования: macOS 10.12+, curl, unzip
# =============================================================================

set -e  # Выход при ошибке

# ─── Конфигурация ─────────────────────────────────────────────────────────────
REPO_OWNER="MakarenD"
REPO_NAME="KonturExpansionChrome"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="/tmp/KonturUpdate-$(date +%Y%m%d-%H%M%S).log"

# ─── Функции логирования ──────────────────────────────────────────────────────
log() {
    local level="${2:-INFO}"
    local timestamp=$(date +"%H:%M:%S")
    local message="[$timestamp] [$level] $1"
    echo "$message" >> "$LOG_FILE"

    # Цвета для вывода
    case $level in
        "INFO")     echo -e "\033[0;36m$message\033[0m" ;;
        "SUCCESS")  echo -e "\033[0;32m$message\033[0m" ;;
        "WARNING")  echo -e "\033[0;33m$message\033[0m" ;;
        "ERROR")    echo -e "\033[0;31m$message\033[0m" ;;
    esac
}

# ─── GUI уведомления через osascript ──────────────────────────────────────────
show_notification() {
    local title="$1"
    local message="$2"
    osascript -e "display notification \"$message\" with title \"$title\""
}

show_alert() {
    local title="$1"
    local message="$2"
    local buttons="${3:-"OK"}"
    osascript -e "display dialog \"$message\" with title \"$title\" buttons {$buttons} default button \"$buttons\""
}

# ─── Проверка прав администратора ─────────────────────────────────────────────
check_sudo() {
    if [ "$EUID" -ne 0 ]; then
        log "Требуются права администратора для обновления" "WARNING"
        return 1
    fi
    return 0
}

request_sudo() {
    if ! check_sudo; then
        log "Запрос прав администратора..." "INFO"
        echo "Для обновления расширения требуются права администратора."
        echo "Введите пароль пользователя:"
        sudo -v || {
            log "Не удалось получить права администратора" "ERROR"
            show_alert "Ошибка" "Не удалось получить права администратора. Обновление отменено." "OK"
            exit 1
        }
        # Обновляем timestamp sudo чтобы не спрашивал пароль повторно
        while true; do sudo -n true; sleep 60; kill -0 "$$" 2>/dev/null & done 2>/dev/null &
    fi
}

# ─── Получение информации о последнем релизе ──────────────────────────────────
get_latest_release() {
    log "Получение информации о последнем релизе..." "INFO"

    local response=$(curl -s -w "\n%{http_code}" \
        -H "User-Agent: KonturExpansion-Chrome-Update-Script" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/releases/latest")

    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | sed '$d')

    if [ "$http_code" != "200" ]; then
        log "Не удалось получить информацию о релизе (HTTP $http_code)" "ERROR"
        show_alert "Ошибка" "Не удалось получить информацию о релизе с GitHub. Проверьте подключение к интернету." "OK"
        exit 1
    fi

    echo "$body"
}

parse_release_info() {
    local release_json="$1"

    # Парсим JSON с помощью grep/sed (без jq для универсальности)
    LATEST_VERSION=$(echo "$release_json" | grep -o '"tag_name": *"[^"]*"' | cut -d'"' -f4)
    LATEST_ASSET_URL=$(echo "$release_json" | grep -o '"browser_download_url": *"[^"]*\.zip"' | cut -d'"' -f4)
    LATEST_ASSET_NAME=$(echo "$release_json" | grep -o '"name": *"[^"]*\.zip"' | cut -d'"' -f4)
    RELEASE_NOTES=$(echo "$release_json" | grep -o '"body": *"[^"]*"' | cut -d'"' -f4 | sed 's/\\n/\n/g' | head -c 500)

    if [ -z "$LATEST_VERSION" ] || [ -z "$LATEST_ASSET_URL" ]; then
        log "Не удалось разобрать информацию о релизе" "ERROR"
        show_alert "Ошибка" "Не удалось разобрать информацию о релизе. Попробуйте позже." "OK"
        exit 1
    fi

    log "Последняя версия: $LATEST_VERSION" "INFO"
    log "URL загрузки: $LATEST_ASSET_URL" "INFO"
}

# ─── Проверка текущей версии ──────────────────────────────────────────────────
get_current_version() {
    local manifest_file="$SCRIPT_DIR/manifest.json"
    CURRENT_VERSION=""

    if [ -f "$manifest_file" ]; then
        CURRENT_VERSION=$(grep -o '"version": *"[^"]*"' "$manifest_file" 2>/dev/null | cut -d'"' -f4) || true
        if [ -n "$CURRENT_VERSION" ]; then
            log "Текущая версия: $CURRENT_VERSION" "INFO"
        else
            log "Не удалось прочитать версию из manifest.json" "WARNING"
        fi
    else
        log "manifest.json не найден. Расширение не установлено или установлено в другую папку." "WARNING"
    fi
}

compare_versions() {
    local current="$1"
    local latest="$2"

    # Удаляем префикс 'v' если есть
    current="${current#v}"
    latest="${latest#v}"

    if [ -z "$current" ]; then
        # Версия не определена — предлагаем установить
        return 2  # Установка
    fi

    if [ "$current" = "$latest" ]; then
        return 0  # Актуально
    fi

    # Сравниваем версии покомпонентно
    local IFS='.'
    local curr_parts=($current)
    local latest_parts=($latest)

    for i in 0 1 2; do
        local curr_num=${curr_parts[$i]:-0}
        local latest_num=${latest_parts[$i]:-0}

        if [ "$latest_num" -gt "$curr_num" ]; then
            return 1  # Нужно обновление
        elif [ "$latest_num" -lt "$curr_num" ]; then
            return 0  # Текущая новее
        fi
    done

    return 0  # Версии равны
}

# ─── Скачивание и установка ───────────────────────────────────────────────────
download_release() {
    local temp_dir="/tmp/KonturExpansionChrome-Update-$$"
    mkdir -p "$temp_dir"

    log "Скачивание обновления из $LATEST_ASSET_URL" "INFO"

    # Скачиваем файл
    local download_file="$temp_dir/$LATEST_ASSET_NAME"

    curl -L -o "$download_file" "$LATEST_ASSET_URL" || {
        log "Не удалось скачать файл" "ERROR"
        show_alert "Ошибка" "Не удалось скачать файл обновления. Проверьте подключение к интернету." "OK"
        rm -rf "$temp_dir"
        exit 1
    }

    # Проверяем что скачался ZIP
    if ! unzip -t "$download_file" > /dev/null 2>&1; then
        log "Скачанный файл не является ZIP-архивом" "ERROR"
        show_alert "Ошибка" "Скачанный файл повреждён. Попробуйте позже." "OK"
        rm -rf "$temp_dir"
        exit 1
    fi

    log "Файл скачан: $download_file ($(du -h "$download_file" | cut -f1))" "SUCCESS"

    DOWNLOAD_DIR="$temp_dir"
    DOWNLOAD_FILE="$download_file"
}

extract_release() {
    local extract_dir="$DOWNLOAD_DIR/extracted"
    mkdir -p "$extract_dir"

    log "Распаковка архива..." "INFO"

    unzip -q "$DOWNLOAD_FILE" -d "$extract_dir" || {
        log "Не удалось распаковать архив" "ERROR"
        show_alert "Ошибка" "Не удалось распаковать архив. Попробуйте позже." "OK"
        rm -rf "$DOWNLOAD_DIR"
        exit 1
    }

    # Если внутри есть папка с расширением — используем её
    if [ -d "$extract_dir/KonturExpansionChrome" ]; then
        EXTRACT_DIR="$extract_dir/KonturExpansionChrome"
    else
        EXTRACT_DIR="$extract_dir"
    fi

    log "Архив распакован: $EXTRACT_DIR" "SUCCESS"
}

install_update() {
    log "Копирование файлов в $SCRIPT_DIR" "INFO"

    # Копируем файлы с заменой
    # Исключаем update.sh и run-update.sh/run-update.command чтобы не затереть сами скрипты
    rsync -av --exclude='update.sh' --exclude='run-update.sh' --exclude='run-update.command' "$EXTRACT_DIR/" "$SCRIPT_DIR/" || {
        log "Не удалось скопировать файлы" "ERROR"
        show_alert "Ошибка" "Не удалось скопировать файлы обновления." "OK"
        exit 1
    }

    log "Файлы обновлены" "SUCCESS"
}

cleanup() {
    if [ -n "$DOWNLOAD_DIR" ] && [ -d "$DOWNLOAD_DIR" ]; then
        rm -rf "$DOWNLOAD_DIR"
        log "Временные файлы удалены" "INFO"
    fi
}

# ─── Основная логика ──────────────────────────────────────────────────────────
main() {
    log "Запуск скрипта обновления" "INFO"
    log "Лог файл: $LOG_FILE" "INFO"

    # Получаем информацию о релизе
    local release_json=$(get_latest_release)
    parse_release_info "$release_json"

    # Проверяем текущую версию
    get_current_version

    # Сравниваем версии (используем || true чтобы set -e не завершал скрипт)
    local compare_result=0
    compare_versions "$CURRENT_VERSION" "$LATEST_VERSION" || compare_result=$?

    if [ $compare_result -eq 0 ]; then
        log "Установлена актуальная версия ($CURRENT_VERSION)" "SUCCESS"
        show_notification "Контур Отель" "Установлена актуальная версия: $CURRENT_VERSION"
        show_alert "Обновление не требуется" "У вас установлена последняя версия: $LATEST_VERSION" "OK"
        exit 0
    elif [ $compare_result -eq 2 ]; then
        log "manifest.json не найден — предлагаю установку расширения" "INFO"
        INSTALL_MODE="install"
    else
        log "Доступно обновление: $CURRENT_VERSION → $LATEST_VERSION" "INFO"
        INSTALL_MODE="update"
    fi

    # Показываем заголовок
    echo ""
    if [ "$INSTALL_MODE" = "install" ]; then
        echo "╔═══════════════════════════════════════════════════════════╗"
        echo "║   Контур Отель — Установка расширения (macOS)             ║"
    else
        echo "╔═══════════════════════════════════════════════════════════╗"
        echo "║   Контур Отель — Обновление расширения для macOS          ║"
    fi
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo ""

    # Показываем информацию о релизе
    if [ "$INSTALL_MODE" = "install" ]; then
        echo "Доступна версия для установки: $LATEST_VERSION"
        echo ""
        echo "Расширение будет установлено в папку:"
        echo "  $SCRIPT_DIR"
    else
        echo "Доступна новая версия: $LATEST_VERSION"
        if [ -n "$CURRENT_VERSION" ]; then
            echo "Текущая версия: $CURRENT_VERSION"
        fi
    fi
    echo ""

    if [ -n "$RELEASE_NOTES" ]; then
        echo "Что нового:"
        echo "$RELEASE_NOTES" | head -c 300
        echo ""
    fi

    # Запрашиваем sudo если нужно
    request_sudo

    # Скачиваем и устанавливаем
    download_release
    extract_release
    install_update
    cleanup

    # Успех!
    echo ""
    if [ "$INSTALL_MODE" = "install" ]; then
        log "Расширение успешно установлено!" "SUCCESS"
    else
        log "Обновление успешно завершено!" "SUCCESS"
    fi
    echo ""

    show_notification "Контур Отель" "Установка версии $LATEST_VERSION завершена!"

    if [ "$INSTALL_MODE" = "install" ]; then
        echo "╔═══════════════════════════════════════════════════════════╗"
        echo "║   Установка завершена!                                    ║"
        echo "║                                                           ║"
        echo "║   Далее:                                                  ║"
        echo "║   1. Откройте chrome://extensions/                        ║"
        echo "║   2. Включите «Режим разработчика»                        ║"
        echo "║   3. Нажмите «Загрузить распакованное»                    ║"
        echo "║   4. Выберите папку: $SCRIPT_DIR"
        echo "║   5. Готово! Расширение установлено                       ║"
        echo "╚═══════════════════════════════════════════════════════════╝"
    else
        echo "╔═══════════════════════════════════════════════════════════╗"
        echo "║   Обновление завершено!                                   ║"
        echo "║                                                           ║"
        echo "║   Далее:                                                  ║"
        echo "║   1. Откройте chrome://extensions/                        ║"
        echo "║   2. Найдите «Контур Отель — Счёт и подтверждение»        ║"
        echo "║   3. Нажмите кнопку обновления (🔄)                        ║"
        echo "║   4. Обновите страницу hotel.kontur.ru                    ║"
        echo "╚═══════════════════════════════════════════════════════════╝"
    fi
    echo ""

    # Автоматически открываем chrome://extensions/ через Google Chrome
    if [ "$INSTALL_MODE" = "install" ]; then
        echo "Открываем Chrome для настройки расширения..."
    else
        echo "Открываем Chrome для применения обновлений..."
    fi
    
    # Используем osascript для открытия Chrome с нужной страницей в существующем окне
    osascript << EOF
tell application "Google Chrome"
    activate
    -- Проверяем есть ли уже окна
    if count of windows is 0 then
        -- Если нет окон, создаём новое окно
        make new window
        set URL of active tab of first window to "chrome://extensions/"
    else
        -- Если есть окна, создаём новый таб в первом окне
        make new tab at end of tabs of first window
        set URL of last tab of first window to "chrome://extensions/"
        set active tab index of first window to (count of tabs of first window)
    end if
end tell
EOF
    
    if [ $? -ne 0 ]; then
        log "Не удалось открыть Chrome через AppleScript, пробуем через open" "WARNING"
        open -a "Google Chrome" "chrome://extensions/" || log "Не удалось открыть chrome://extensions/" "ERROR"
    fi

    echo ""
    echo "Готово!"
    
    exit 0
}

# ─── Обработка ошибок ─────────────────────────────────────────────────────────
trap 'log "Произошла ошибка на строке $LINENO" "ERROR"; exit 1' ERR

# Запуск
main "$@"
