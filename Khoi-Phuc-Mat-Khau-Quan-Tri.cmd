@echo off
chcp 65001 >nul
title KSK - Khoi phuc mat khau quan tri (tai may chu)
cd /d "%~dp0"
echo ============================================================
echo  KHOI PHUC MAT KHAU TAI KHOAN QUAN TRI  (chi lam tren MAY CHU)
echo ============================================================
echo Dung khi KHONG CON quan tri nao dang nhap duoc (quen mat khau cua quan tri
echo duy nhat). Neu van con mot quan tri khac dang nhap duoc, hay nho nguoi do
echo cap lai mat khau trong trang "Quan tri tai khoan" - khong can lam buoc nay.
echo.
echo Cach lam viec: may chu duoc khoi dong lai, tai khoan quan tri duoc dat MAT KHAU
echo TAM (bat buoc doi ngay o lan dang nhap dau), moi phien dang nhap cu bi thu hoi.
echo Mat khau tam ghi trong data-research\mat-khau-khoi-phuc-quan-tri.txt - ai co
echo quyen tren may chu moi doc duoc tep nay. XOA tep sau khi dung. Du lieu giu nguyen.
echo.
set "RESEARCH_RECOVER_ADMIN="
set /p RESEARCH_RECOVER_ADMIN=Ten dang nhap quan tri can khoi phuc (vi du quantri01, de trong de HUY):
if "%RESEARCH_RECOVER_ADMIN%"=="" (
  echo Da huy.
  pause
  exit /b 0
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\restart-demo.ps1" -Yes
echo.
echo Doi khoang 20 giay roi mo tep: %~dp0data-research\mat-khau-khoi-phuc-quan-tri.txt
echo Dang nhap bang mat khau tam trong tep do, he thong se bat dat mat khau moi.
echo.
pause
