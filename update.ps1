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
        
        return @{
            TagName = $response.tag_name
            Name = $response.name
            ZipUrl = $response.zipball_url
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
    
    Write-Log "Скачивание версии $Version..."
    Invoke-WebRequest -Uri $ZipUrl -OutFile $zipFile -UseBasicParsing
    
    Write-Log "Распаковка архива..."
    if (Test-Path $extractPath) {
        Remove-Item -Path $extractPath -Recurse -Force
    }
    Expand-Archive -Path $zipFile -DestinationPath $extractPath -Force
    
    # Находим распакованную папку (GitHub добавляет префикс username-repo-commit)
    $extractedFolder = Get-ChildItem -Path $extractPath -Directory | Select-Object -First 1
    
    if (-not $extractedFolder) {
        throw "Не найдена распакованная папка"
    }
    
    Write-Log "Копирование файлов в $InstallPath..."
    
    # Создаём директорию если не существует
    if (-not (Test-Path $InstallPath)) {
        New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
        Write-Log "Создана директория: $InstallPath" "SUCCESS"
    }
    
    # Копируем файлы с заменой
    Copy-Item -Path "$($extractedFolder.FullName)\*" -Destination $InstallPath -Recurse -Force
    
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
