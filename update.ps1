# PowerShell-скрипт для автоматического обновления расширения Контур Отель
# Запуск: дважды кликните по update.bat или правой кнопкой на run-update.ps1

param(
    [string]$RepoOwner = "MakarenD",  # GitHub username
    [string]$RepoName = "KonturExpansionChrome",
    [string]$InstallPath = "C:\KonturExpansionChrome",  # Единый путь для всех пользователей
    [switch]$AutoConfirm = $false  # Автоматическое подтверждение без запроса Y/N
)

$ErrorActionPreference = "Continue"  # Продолжать выполнение при ошибках

# Включаем логирование в файл
$logFile = Join-Path $env:TEMP "KonturUpdate-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"

# Устанавливаем кодировку UTF8 для вывода
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "HH:mm:ss"
    $color = switch ($Level) {
        "INFO" { "Cyan" }
        "SUCCESS" { "Green" }
        "WARNING" { "Yellow" }
        "ERROR" { "Red" }
    }
    $logMessage = "[$timestamp] [$Level] $Message"
    Write-Host $logMessage -ForegroundColor $color
    Add-Content -Path $logFile -Value $logMessage
}

function Test-Admin {
    $currentUser = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $currentUser.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-LatestRelease {
    param([string]$Owner, [string]$Repo)

    $url = "https://api.github.com/repos/$Owner/$Repo/releases/latest"
    Write-Log "GitHub API URL: $url"

    try {
        # Добавляем User-Agent (требуется для GitHub API)
        $headers = @{
            'User-Agent' = 'KonturExpansion-Chrome-Update-Script'
            'Accept' = 'application/vnd.github.v3+json'
        }
        
        $response = Invoke-RestMethod -Uri $url -Method Get -Headers $headers -ErrorAction Stop
        
        Write-Log "Получен ответ от GitHub: tag=$($response.tag_name)"
        
        # Проверяем наличие ассетов в релизе
        if (-not $response.assets -or $response.assets.Count -eq 0) {
            Write-Log "В релизе нет прикреплённых файлов (assets)!" "ERROR"
            Write-Log "Убедитесь, что к релизу приложен архив KonturExpansionChrome.zip" "ERROR"
            return $null
        }
        
        # Используем browser_download_url из первого ассета релиза
        # (приложенный .zip, а не исходный код репозитория)
        $assetUrl = $response.assets[0].browser_download_url
        Write-Log "URL ассета релиза: $assetUrl"
        
        return @{
            TagName = $response.tag_name
            Name = $response.name
            ZipUrl = $assetUrl
            Body = $response.body
            PublishedAt = $response.published_at
        }
    }
    catch {
        Write-Log "Ошибка получения релиза: $_" "ERROR"
        Write-Log "Response: $($_.ErrorDetails.Message)" "ERROR"
        return $null
    }
}

function Compare-Versions {
    param([string]$LocalVersion, [string]$RemoteVersion)
    
    # Удаляем префикс 'v' если есть
    $local = $LocalVersion -replace '^v', ''
    $remote = $RemoteVersion -replace '^v', ''
    
    $localParts = $local -split '\.' | ForEach-Object { [int]$_ }
    $remoteParts = $remote -split '\.' | ForEach-Object { [int]$_ }
    
    for ($i = 0; $i -lt [Math]::Max($localParts.Count, $remoteParts.Count); $i++) {
        $l = if ($i -lt $localParts.Count) { $localParts[$i] } else { 0 }
        $r = if ($i -lt $remoteParts.Count) { $remoteParts[$i] } else { 0 }
        
        if ($r -gt $l) { return 1 }      # Новая версия доступна
        if ($r -lt $l) { return -1 }     # Локальная версия новее
    }
    return 0  # Версии равны
}

function Install-Update {
    param(
        [string]$ZipUrl,
        [string]$InstallPath,
        [string]$Version
    )
    
    $tempPath = [System.IO.Path]::GetTempPath()
    $zipFile = Join-Path $tempPath "KonturExpansion-$Version.zip"
    $extractPath = Join-Path $tempPath "KonturExpansion-$Version-Extract"
    
    Write-Log "Скачивание версии $Version из релиза..."
    Write-Log "URL: $ZipUrl"
    
    # Заголовки для корректного скачивания с GitHub (обработка редиректов)
    $headers = @{
        'User-Agent' = 'KonturExpansion-Chrome-Update-Script'
    }
    Invoke-WebRequest -Uri $ZipUrl -OutFile $zipFile -UseBasicParsing -Headers $headers
    
    # Проверяем что файл скачался
    if (-not (Test-Path $zipFile) -or (Get-Item $zipFile).Length -eq 0) {
        throw "Файл не был скачан или пустой: $zipFile"
    }
    Write-Log "Архив скачан: $((Get-Item $zipFile).Length / 1KB) КБ" "SUCCESS"
    
    Write-Log "Распаковка архива..."
    if (Test-Path $extractPath) {
        Remove-Item -Path $extractPath -Recurse -Force
    }
    Expand-Archive -Path $zipFile -DestinationPath $extractPath -Force
    
    # Определяем корневую папку с файлами расширения.
    # Ассет релиза может содержать файлы напрямую (manifest.json в корне)
    # или во вложенной папке (GitHub zipball — Owner-Repo-hash/manifest.json).
    $sourceFolder = $extractPath
    
    if (-not (Test-Path (Join-Path $extractPath "manifest.json"))) {
        # manifest.json не в корне — ищем во вложенных папках
        $subFolders = Get-ChildItem -Path $extractPath -Directory
        $found = $false
        foreach ($folder in $subFolders) {
            if (Test-Path (Join-Path $folder.FullName "manifest.json")) {
                $sourceFolder = $folder.FullName
                $found = $true
                Write-Log "Файлы расширения найдены в: $($folder.Name)"
                break
            }
        }
        if (-not $found) {
            throw "Не найден manifest.json в архиве — архив не содержит расширение Chrome"
        }
    } else {
        Write-Log "Файлы расширения найдены в корне архива"
    }
    
    Write-Log "Копирование файлов в $InstallPath..."
    
    # Создаём директорию если не существует
    if (-not (Test-Path $InstallPath)) {
        New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
        Write-Log "Создана директория: $InstallPath" "SUCCESS"
    }
    
    # Копируем файлы с заменой
    Copy-Item -Path "$sourceFolder\*" -Destination $InstallPath -Recurse -Force
    
    # Проверяем что manifest.json скопировался
    $destManifest = Join-Path $InstallPath "manifest.json"
    if (Test-Path $destManifest) {
        $m = Get-Content $destManifest -Raw | ConvertFrom-Json
        Write-Log "Версия в установленном manifest.json: $($m.version)" "SUCCESS"
    } else {
        Write-Log "ВНИМАНИЕ: manifest.json не найден после копирования!" "ERROR"
    }
    
    # Очищаем временные файлы
    Remove-Item -Path $zipFile -Force
    Remove-Item -Path $extractPath -Recurse -Force
    
    Write-Log "Обновление успешно установлено!" "SUCCESS"
}

# ==================== Основная логика ====================

Write-Log "=== Обновление расширения Контур Отель ==="
Write-Log "Репозиторий: $RepoOwner/$RepoName"
Write-Log "Путь установки: $InstallPath"
Write-Log "Лог файл: $logFile"

# Проверка прав администратора (нужны для записи в C:\)
if (-not (Test-Admin)) {
    Write-Log "ТРЕБУЮТСЯ ПРАВА АДМИНИСТРАТОРА!" "ERROR"
    Write-Log "Запуск PowerShell от имени администратора..." "WARNING"
    
    # Перезапуск от имени администратора
    $scriptPath = $MyInvocation.MyCommand.Path
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -RepoOwner `"$RepoOwner`" -RepoName `"$RepoName`" -InstallPath `"$InstallPath`""
    exit
}

Write-Log "Права администратора: подтверждены" "SUCCESS"

# Получаем информацию о последнем релизе
$release = Get-LatestRelease -Owner $RepoOwner -Repo $RepoName

if (-not $release) {
    Write-Log "Не удалось получить информацию о релизе" "ERROR"
    exit 1
}

Write-Log "Последняя версия: $($release.TagName) (от $($release.PublishedAt))"

# Проверяем локальную версию
$manifestPath = Join-Path $InstallPath "manifest.json"
$localVersion = "0.0.0"

if (Test-Path $manifestPath) {
    try {
        $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
        $localVersion = $manifest.version
        Write-Log "Локальная версия: $localVersion"
    }
    catch {
        Write-Log "Не удалось прочитать локальную версию" "WARNING"
    }
}
else {
    Write-Log "Локальная версия не найдена (первая установка)" "WARNING"
}

# Сравниваем версии
$compareResult = Compare-Versions -LocalVersion $localVersion -RemoteVersion $release.TagName

Write-Log "Сравнение версий: $localVersion vs $($release.TagName) = $compareResult" "INFO"
Write-Log "Результат: 1=новая доступна, 0=равны, -1=локальная новее" "INFO"

if ($compareResult -le 0) {
    Write-Log "У вас актуальная версия. Обновление не требуется." "SUCCESS"
    exit 0
}

Write-Log "Доступна новая версия: $($release.TagName)" "WARNING"

if ($release.Body) {
    Write-Log "`nЧто нового:`n$($release.Body)" "INFO"
}

# Запрашиваем подтверждение (если не автоматический режим)
if ($AutoConfirm) {
    Write-Log "Автоматическое подтверждение - начинаем обновление..." "INFO"
    $confirmation = 'Y'
} else {
    $confirmation = Read-Host "`nInstall update? (Y/N)"
}

if ($confirmation -notmatch '^[Yy]') {
    Write-Log "Update cancelled by user"
    exit 0
}

try {
    Install-Update -ZipUrl $release.ZipUrl -InstallPath $InstallPath -Version $release.TagName

    Write-Log "`n=========================================" "SUCCESS"
    Write-Log "ОБНОВЛЕНИЕ УСТАНОВЛЕНО!" "SUCCESS"
    Write-Log "=========================================" "SUCCESS"
    Write-Log "`nСледующие шаги:"
    Write-Log "1. Откройте chrome://extensions/"
    Write-Log "2. Найдите 'Контур Отель — Счёт и подтверждение'"
    Write-Log "3. Нажмите кнопку обновления (🔄)"
    Write-Log "4. Обновите страницу hotel.kontur.ru"
    Write-Log "`nИли перезапустите Chrome для применения обновлений."
    
    # Пауза чтобы пользователь успел прочитать (только если не автоматический режим)
    if (-not $AutoConfirm) {
        Write-Log "`nНажмите любую клавишу для выхода..."
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    } else {
        Write-Log "`nОкно автоматически закроется через 1 секунду..."
        Start-Sleep -Seconds 1
    }
}
catch {
    Write-Log "`nОшибка при установке: $_" "ERROR"
    if (-not $AutoConfirm) {
        Write-Log "Нажмите любую клавишу для выхода..."
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    } else {
        Start-Sleep -Seconds 1
    }
    exit 1
}
