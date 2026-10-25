# Bản nhân viên không hiện học sinh: kiểm tra kết nối trước

- Nếu dùng KSK.exe: bật máy quản trị trước, rồi mở KSK-NhanVien.exe; trên nhân viên chọn đúng địa chỉ máy chủ và Công ty.
- Nếu muốn xem kho source `data-demo/` của dự án trên máy này: nhấp `Chay-KSK-NhanVien.cmd` ở thư mục gốc. Máy chủ chạy nền; lỗi có trong `data-demo/local-server-error.log`.
- KSK nhúng và source data-demo là các kho riêng. Máy mới không tự có 1.000 học sinh; không copy DB/khóa giữa hai kho để chữa danh sách trống.
- Bản nhân viên đã đăng ký vẫn đổi được địa chỉ bằng thanh **Đổi máy chủ → Kết nối và tải lại**; không cần xóa khóa khi chỉ đổi IP cùng máy chủ.
- Nếu báo máy chủ khác nơi đăng ký: chọn lại đúng kho. Chuyển sang hệ thống có registry khác cần đăng ký riêng; không tự mang token sang đó.
- Nếu chưa có hồ sơ: chọn đúng Công ty, bỏ tìm kiếm/bộ lọc, Import Excel → B2 kiểm tra → B3. Số điện thoại dạng số Excel đã được sửa khôi phục về 10 chữ số.
- Kịch bản chứng minh ABE và giới hạn kênh phụ huynh: xem [HUONG_DAN_THUYET_TRINH.md](HUONG_DAN_THUYET_TRINH.md).

---

# Chạy bằng file .exe (khuyên dùng)

| Ứng dụng | File | Dùng cho |
|---|---|---|
| **KSK** | `release\KSK-win32-x64\KSK.exe` (biểu tượng **KSK** trên Desktop) | Máy quản trị/nhập liệu. **Đã gồm máy chủ nhúng**, nhấp đúp là chạy, không cần chạy lệnh nào. Chỉ bản này có phần 🔒 Quản trị bảo mật. |
| **KSK Phụ huynh** | `release\KSK-PhuHuynh-win32-x64\KSK-PhuHuynh.exe` (biểu tượng **KSK Phu huynh**) | Tra cứu trên máy tính bằng số CCCD. Địa chỉ máy chủ đặt ở biểu tượng ⚙ ở màn hình đầu (mặc định `localhost`). |
| **Điện thoại** | trình duyệt vào `http://<IP máy chạy KSK>:5174` rồi chọn "Thêm vào màn hình chính" | Tra cứu trên điện thoại cùng wifi. Lần đầu chạy `npm run parent:firewall` (PowerShell quyền Administrator) để mở cổng 5174 và 8090. |
| KSK-NhanVien | `release\KSK-NhanVien-win32-x64\KSK-NhanVien.exe` | Máy nhân viên khác, không có phần quản trị. Cần trỏ tới máy chủ của máy KSK (xem giới hạn bên dưới). |

- Dữ liệu của KSK.exe nằm ở `%APPDATA%\KSK\server-data`.
- Cập nhật gần **thời gian thực**: bác sĩ lưu thông tin khám xong, ứng dụng tra cứu tự cập nhật trong vài giây (đã đo khoảng 3,5 giây).
- **Chặn chụp màn hình** trên máy tính: bật ở mọi bản đã đóng gói. Chạy thử từ mã nguồn (`npm run desktop`) vẫn chụp được để báo lỗi. Lưu ý: không chặn được camera điện thoại chụp màn hình, nên có **hình mờ truy vết** (tên/CCCD che bớt + giờ) phủ trên màn hình.
- Giới hạn: máy nhân viên khác ngoài máy KSK chưa cấu hình sẵn được địa chỉ các nút cấp khoá (đang là 127.0.0.1); điện thoại/máy tính tra cứu thì dùng được qua mạng nội bộ.
- Đóng gói lại: `npm run desktop:pack`, `npm run desktop:pack:user`, `npm run parent:pack` (cần JDK 25 và `JAVA_HOME`). Nếu exe tự thoát ngay khi mở từ terminal của VS Code, đó là do biến `ELECTRON_RUN_AS_NODE` của VS Code; mở từ biểu tượng Desktop thì không bị.

---

# MedABE - Cách chạy và các bước của người Admin

## 1. Cách chạy (chạy thử từ mã nguồn)

Cần: Node.js, JDK 25. Mở 2 cửa sổ terminal tại thư mục dự án:

| Bước | Lệnh | Việc làm |
|---|---|---|
| 1 | `npm run demo` | Bật máy chủ: kho mù (Spring, cổng 8090) + 3 nút cấp khoá (9001-9003). Để cửa sổ này chạy. |
| 2 | `npm run desktop` | Dựng và mở ứng dụng. |

Dừng: đóng ứng dụng, rồi Ctrl+C ở cửa sổ `npm run demo`.

Lần đầu mở: ứng dụng **tự đăng ký** máy này (không hỏi tên), tạo khoá riêng gắn với phần cứng và cất bằng kho khoá Windows. Mở ra là làm việc được ngay.

Muốn chụp màn hình để báo lỗi: ứng dụng mặc định chặn chụp màn hình. Mở bằng `set MEDABE_ALLOW_CAPTURE=1` (PowerShell: `$env:MEDABE_ALLOW_CAPTURE='1'`) trước lệnh `npm run desktop`.

## 2. Người dùng thường làm gì

1. **Import Excel**: nạp danh sách học sinh/bệnh nhân (dữ liệu mã hoá ngay trên máy rồi mới gửi lên).
2. **Khám sức khỏe định kỳ**: chọn một người trong danh sách phía dưới; phiếu là **một trang cuộn liên tục** từ Thông tin hành chính đến Kết luận. Menu bên trái chỉ để nhảy tới từng mục.
3. **Quản lý hồ sơ**: bên trái là nội dung đã giải mã trên máy bạn, bên phải là thứ máy chủ thấy (chỉ dữ liệu mã hoá).
4. **Báo cáo**: thống kê theo đơn vị.
5. **Khoá của tôi**: xem thiết bị/khoá của mình; **Phá vỡ kính (cấp cứu)** để bác sĩ mở hồ sơ ngoài quyền thường (có ghi lại và cảnh báo).

## 3. Admin làm từng bước

Phần bảo mật **chỉ có ở máy admin** (bản `MedABE-Admin`/chạy từ mã nguồn), nằm ở menu **🔒 Quản trị bảo mật**, luôn hỏi mật khẩu admin. Máy nhân viên (bản `MedABE`) không chứa phần này.

### Bước 1 - Kích hoạt trạm quản trị (một lần)
1. Mở app, menu **🔒 Quản trị bảo mật → Kích hoạt trạm quản trị**.
2. Gói kích hoạt đã được điền sẵn (lấy từ `data-demo/admin-package.txt` trên chính máy này). Đặt **mật khẩu admin** (≥ 10 ký tự, có chữ và số/ký tự đặc biệt), nhập lại, bấm **Kích hoạt**.
3. Từ giờ các token quản trị được mã hoá bằng mật khẩu này và **buộc vào phần cứng máy này**. Chép sang máy khác không dùng được. File gói đã được xoá sau khi kích hoạt. Mật khẩu **không khôi phục được**.

### Bước 2 - Mở phần quản trị mỗi lần dùng
- Vào **🔒 Quản trị bảo mật → Quản trị cấp quyền**, nhập mật khẩu admin. Sai 5 lần thì khoá (thời gian tăng dần). Không thao tác 5 phút thì tự khoá.

### Bước 3 - Cho nhân viên vào làm việc
1. Mục **Đăng ký máy mới**: bấm **Bật đăng ký tự do**. Nhân viên chỉ cần mở app là dùng được.
2. Chọn **quyền mặc định** (vai trò Tiếp đón/Bác sĩ/KTV/Kết luận, khoa) rồi **Lưu quyền mặc định**. Muốn phân quyền chặt thì bỏ bớt quyền ở đây.
3. Khi nhân viên đã đăng ký xong, bấm **Tắt đăng ký tự do** (để không máy lạ nào trong mạng tự vào được).
4. Cần cấp quyền riêng cho một người: mục "Nâng cao" → cấp theo vai trò.

### Bước 4 - Quản lý máy
- Mục **Máy đã đăng ký → Tải danh sách**. Máy mất hoặc nhân viên nghỉ việc: bấm **khoá máy này**.

### Bước 5 - Thu hồi quyền
- Thu hồi thuộc tính của người cần cắt quyền, rồi **tăng epoch**. Dữ liệu mới không mở được bằng khoá cũ; hồ sơ cũ được mã hoá lại khi có người mở.

### Bước 6 - Giám sát
- **Giám sát an ninh**: xem sự kiện (giải mã thất bại, máy trùng phần cứng, phá vỡ kính...). Từ 5 lần giải mã thất bại trong 10 phút thì hệ thống tự khoá. Log SIEM nằm ở `data-demo/siem/events.jsonl`.
- Các lần **phá vỡ kính**: xem lại lý do, đóng khi xong.

### Bước 7 - Duyệt bằng điện thoại
- **App điện thoại (nút 3/3)**: duyệt yêu cầu cần xác nhận. Khoá chỉ cấp khi có đồng thuận ít nhất 2 trong 3 nút (Bệnh viện, Sở Y tế, Điện thoại).

## 4. Lưu ý an toàn

- Tự mở khoá nghĩa là ai dùng được phiên Windows của máy đó thì mở được app (giống phần mềm nghiệp vụ thông thường).
- Chỉ bật đăng ký tự do trong mạng nội bộ tin cậy và tắt sau khi dùng.
- Quên mật khẩu admin: phải kích hoạt lại bằng gói mới (`npm run admin:package`).
