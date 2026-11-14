@echo off
chcp 65001 >nul
title KSK - Demo ban moi (chay tu ma nguon, du lieu thu rieng)
cd /d "%~dp0"
rem Du lieu thu nam o data-research\ (KHONG phai du lieu that cua KSK.exe). Tu tao cac tai khoan mau theo tung khoa.
set RESEARCH_DEMO_USERS=1
call "%~dp0Chay-MayChu-NghienCuu.cmd"
