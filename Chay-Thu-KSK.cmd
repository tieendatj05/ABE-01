@echo off
chcp 65001 >nul
title KSK - chay thu (tu nap lai khi sua ma)
cd /d "%~dp0"
echo Mo trinh duyet tai http://localhost:5173  (lan dau: muc "May chu" nhap http://localhost:8090)
echo May chu KSK (ban co dang nhap) phai dang chay. Dong cua so nay de dung.
start "" http://localhost:5173
call "node_modules\.bin\vite.cmd" --config app\web\vite.config.ts --host
