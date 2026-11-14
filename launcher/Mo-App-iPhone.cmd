@echo off
chcp 65001 >nul
cd /d "%~dp0.."
title MedABE - App iPhone
echo Hay mo KSK truoc. Link moi se hien ben duoi.
node launcher\parent-internet.mjs
pause
