@echo off
title Kontur Expansion - Auto Update

echo.
echo ================================================================================
echo                           KONTUR EXPANSION UPDATE
echo ================================================================================
echo.
echo Starting automatic update...
echo.

REM Run PowerShell script with -AutoConfirm flag (no Y/N prompt)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0update.ps1\" -AutoConfirm' -Verb RunAs -Wait"

echo.
echo ================================================================================
echo                              UPDATE COMPLETED!
echo ================================================================================
echo.
timeout /t 1 /nobreak >nul
