
@echo off
chcp 65001 >nul
title KSK - Khoi dong lai may chu demo
cd /d "%~dp0"
rem Dung may chu demo cu (CHI cua thu muc nay) va chay lai ban moi. Du lieu data-research\ giu nguyen.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\restart-demo.ps1"
echo.
pause
