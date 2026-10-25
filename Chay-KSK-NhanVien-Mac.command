#!/bin/bash
# Chạy bản KSK Nhân viên trên MacBook (từ mã nguồn). Dùng: ./Chay-KSK-NhanVien-Mac.command [http://IP-may-chu:8090]
# Lần đầu: cần Node.js (https://nodejs.org, bản LTS). Script tự npm install và build bản "user" (không chứa mã quản trị).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then echo "Chưa có Node.js. Cài từ https://nodejs.org rồi chạy lại."; read -r -p "Enter để đóng"; exit 1; fi
[ -d node_modules ] || npm install || { echo "npm install lỗi"; read -r -p "Enter để đóng"; exit 1; }
node app/desktop/build.mjs user || { echo "build lỗi"; read -r -p "Enter để đóng"; exit 1; }
# Địa chỉ máy chủ (tuỳ chọn): ghi vào file để app mở lên là kết nối đúng chỗ; nếu bỏ qua, app tự dò máy chủ trong mạng LAN.
if [ -n "$1" ]; then echo "$1" > app/desktop/server-url.txt; fi
unset ELECTRON_RUN_AS_NODE
exec node app/desktop/run.mjs
