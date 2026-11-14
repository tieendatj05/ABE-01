@echo off
chcp 65001 >nul
title MedABE - May chu nghien cuu CP-ABE
cd /d "%~dp0"
if not exist "node_modules\.bin\tsx.cmd" (
  echo Chua cai thu vien. Dang chay npm install...
  call npm install
)
call "node_modules\.bin\tsx.cmd" security\src\deploy\research-server.ts
echo.
echo May chu da dung. Bam phim bat ky de dong cua so.
pause >nul
