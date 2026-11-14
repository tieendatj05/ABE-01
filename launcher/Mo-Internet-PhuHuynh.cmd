@echo off
chcp 65001 >nul
cd /d "%~dp0.."
title KSK - Mo app phu huynh ra Internet
echo.
echo   Dang mo duong ham HTTPS cho app phu huynh (iPhone + Android)...
echo.
node launcher\public-tunnel.mjs
pause
