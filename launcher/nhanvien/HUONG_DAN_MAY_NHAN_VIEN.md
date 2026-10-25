# Hướng dẫn chạy KSK-NhanVien trên máy khác (Windows)

Máy này đóng vai **máy nhân viên** (bác sĩ / tiếp đón). Dữ liệu được mã hoá ngay trên máy này rồi mới gửi về **máy chủ**
(máy đang mở `KSK.exe`). Không cần cài gì, không cần Internet, chỉ cần **cùng Wi-Fi/LAN** với máy chủ.

## Cách nhanh (khuyên dùng)

1. Giải nén **cả thư mục** (đừng chỉ chép file `.exe`).
2. Nhấp đúp **`Chay-KSK-NhanVien.cmd`**.
   - Lần đầu: script hỏi IP máy chủ (bên máy chủ xem bằng `ipconfig`, dòng *IPv4 Address* của Wi-Fi).
   - Script kiểm tra 5 cổng tới máy chủ, ghi sẵn địa chỉ máy chủ, rồi mở app.
   - Các lần sau: script nhớ IP trong `may-chu.txt`, nhấp đúp là chạy.
3. Trong app: thấy **"● Đã kết nối: http://<IP máy chủ>:8090"** là xong. Máy tự đăng ký (tên = tên máy), khoá riêng
   sinh ngay trên máy này và cất trong kho khoá Windows (DPAPI), buộc vào phần cứng.
4. Chọn đúng **Công ty** giống bên máy chủ để thấy cùng danh sách.

## Các lệnh PowerShell (nếu muốn làm tay)

Mở **PowerShell** trong thư mục vừa giải nén (Shift + chuột phải → *Open PowerShell window here*). Thay `192.168.1.39` bằng IP máy chủ.

```powershell
# 1. Xem IP máy này (phải cùng dải với máy chủ, vd cùng 192.168.1.x)
ipconfig | findstr IPv4

# 2. Kiểm tra máy chủ: các cổng phải "TcpTestSucceeded : True"
Test-NetConnection 192.168.1.39 -Port 8090
Test-NetConnection 192.168.1.39 -Port 9001
Test-NetConnection 192.168.1.39 -Port 8095

# 3. Máy chủ có trả lời đúng không (in ra JSON là được)
curl.exe http://192.168.1.39:8090/api/config

# 4. Chạy script kèm IP (bỏ qua câu hỏi)
powershell -ExecutionPolicy Bypass -File .\Chay-KSK-NhanVien.ps1 -MayChu 192.168.1.39

# 5. Hoặc mở thẳng app
Start-Process .\KSK-NhanVien-win32-x64\KSK-NhanVien.exe
```

## Đăng ký lại từ đầu (khi đổi máy chủ, hoặc bị khoá thiết bị muốn làm lại)

```powershell
# Tắt app trước, rồi xoá dữ liệu đăng ký của máy NÀY (không ảnh hưởng dữ liệu trên máy chủ)
Get-Process KSK-NhanVien -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item -Recurse -Force "$env:APPDATA\KSK-NhanVien"
Remove-Item .\may-chu.txt -ErrorAction SilentlyContinue
```

## Gặp lỗi

| Hiện tượng | Cách xử lý |
|---|---|
| Script báo `[LOI]` ở mọi cổng | Khác mạng, sai IP, hoặc máy chủ chưa mở `KSK.exe` / chưa mở tường lửa (`Cau-Hinh-Mang-LAN.cmd` trên máy chủ). Wi-Fi trường/quán cà phê hay chặn các máy nói chuyện với nhau: dùng điểm phát Wi-Fi từ điện thoại |
| Chỉ lỗi cổng **8095** | Vẫn nhập liệu được; chỉ không tự liên thông Bộ Y tế. Bên máy chủ chạy lại `Cau-Hinh-Mang-LAN.cmd` |
| Windows SmartScreen chặn `.exe` | Bấm *More info* → *Run anyway* (app chưa ký số) |
| App mở rồi tắt ngay | Chạy bằng `Chay-KSK-NhanVien.cmd` thay vì từ VS Code (biến môi trường `ELECTRON_RUN_AS_NODE` làm app tự thoát) |
| "Đăng ký đang tắt" | Bên máy chủ: *Quản trị bảo mật → Quản trị cấp quyền → Bật đăng ký tự do* |
| "Đây là máy chủ khác nơi đã đăng ký" | Máy này từng đăng ký với máy chủ khác: làm mục *Đăng ký lại từ đầu* |
| Mục khám hiện 🔒 | **Đúng thiết kế ABE**: máy này thiếu thuộc tính (vai trò/khoa) để giải mã mục đó. Xem *Khoá của tôi → Thiết bị & khoá của tôi* |
| Danh sách trống | Chọn sai *Công ty*, hoặc máy chủ chưa có dữ liệu |
