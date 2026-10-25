# Chạy nhanh (khuyên dùng)

1. Chạy một lần: `npm run desktop:pack` rồi `npm run launcher:shortcut` - tạo biểu tượng **MedABE** trên Desktop.
2. Từ đó chỉ cần **nhấp đúp biểu tượng MedABE**: hệ thống tự bật máy chủ, mở ứng dụng; đóng ứng dụng thì máy chủ tự tắt.
3. Lần đầu mở: nhập **tên** là dùng được ngay (mọi nhân viên nhập và thao tác dữ liệu bình thường). Mặc định tự mở khoá ở máy này.
4. Phần bảo mật (menu "🔒 Quản trị bảo mật") **chỉ có trên máy quản trị** (bản MedABE-Admin) và luôn hỏi mật khẩu quản trị. Bản MedABE cho máy khác không chứa phần này.
5. Quản trị vào "Quản trị cấp quyền → Đăng ký máy mới" để bật/tắt đăng ký tự do và đặt quyền mặc định. Mục "Cấp nhanh nhân sự" nay chỉ nằm trong "Nâng cao". Chỉ BẬT đăng ký tự do trong mạng nội bộ tin cậy và TẮT khi nhân viên đã đăng ký xong.
6. Lưu ý: tự mở khoá nghĩa là ai dùng được phiên Windows này thì mở được ứng dụng.

---

# Hướng dẫn chạy và vận hành MedABE

Tài liệu cho người vận hành/bảo vệ đồ án. Mọi lệnh chạy trong PowerShell tại thư mục `E:\TLCN\medabe`.

## 0. Hiểu nhanh hệ thống (1 phút)

| Thành phần | Là gì | Chạy ở đâu |
|---|---|---|
| **Máy chủ** | Kho ciphertext "mù" (Spring Boot, cổng 8090) + 3 nút cấp khoá (cổng 9001–9003: Bệnh viện, Sở Y tế, Điện thoại) | 1 máy, chạy bằng `npm run demo` |
| **Ứng dụng nhân viên** | Nhập phiếu khám, import Excel, danh sách, báo cáo. Mã hoá/giải mã ngay trên máy | Mọi máy trạm |
| **Trạm quản trị** | Cùng ứng dụng nhưng đã kích hoạt phần quản trị: cấp quyền, thu hồi, giám sát | **Chỉ máy của người quản trị** |

Ba nguyên tắc cần nhớ: (1) máy chủ **không bao giờ đọc được** nội dung; (2) khoá chỉ cấp khi **≥ 2 trong 3 tổ chức** đồng thuận; (3) phần quản trị **chỉ có trên trạm quản trị và luôn đòi mật khẩu**.

## 1. Bật máy chủ

```powershell
cd E:\TLCN\medabe
npm run demo
```
Đợi vài giây tới khi thấy dòng `MedABE đang chạy`. **Giữ cửa sổ này mở**; tắt bằng `Ctrl+C`.
- Dữ liệu nằm trong `data-demo\` (đã có sẵn **1.000 học sinh THCS Tân Tiến**, chỉ ở dạng ciphertext).
- Token quản trị được sinh ngẫu nhiên, **không in ra màn hình** (nằm trong `data-demo\admin-secrets.json`).
- Lần đầu chạy, gói kích hoạt trạm quản trị được ghi vào `data-demo\admin-package.txt`. Nếu đã xoá: `npm run admin:package`.

Lần sau chỉ cần chạy lại đúng lệnh `npm run demo` (dữ liệu vẫn còn).

## 2. Mở ứng dụng

| Cách | Lệnh / file | Dùng khi |
|---|---|---|
| Bản phát triển (có phần quản trị) | `npm run desktop` | Máy của bạn (trạm quản trị) |
| Bản đóng gói **admin** | `release\MedABE-Admin-win32-x64\MedABE-Admin.exe` | Máy quản trị, không cần cài Node |
| Bản đóng gói **user** | `release\MedABE-win32-x64\MedABE.exe` | Máy nhân viên: **không chứa mã quản trị** |

Đóng gói lại: `npm run desktop:pack` (admin) và `npm run desktop:pack:user` (user).

## 3. Kích hoạt trạm quản trị (làm MỘT lần, trên máy của bạn)

1. Mở file `data-demo\admin-package.txt`, sao chép toàn bộ nội dung (bắt đầu bằng `MEDABE-ADMIN1:`).
2. Mở ứng dụng ở chế độ kích hoạt: `npm run desktop -- --admin-setup` (hoặc `MedABE-Admin.exe --admin-setup`).
3. Menu **🔒 Quản trị bảo mật → Kích hoạt trạm quản trị**.
4. Dán gói vào ô đầu, đặt **mật khẩu quản trị** (≥ 10 ký tự, có chữ và số hoặc ký tự đặc biệt), nhập lại, bấm **Kích hoạt**.
5. Đóng ứng dụng, **xoá `admin-package.txt`**, rồi mở lại **bình thường** (không có `--admin-setup`).

> Mật khẩu quản trị **không thể khôi phục**. Quên mật khẩu: xoá file `admin.bin` trong thư mục dữ liệu ứng dụng (xem mục 12) rồi kích hoạt lại bằng gói mới — việc này cần có quyền truy cập máy.

Từ nay: máy này có menu **Quản trị bảo mật**; **máy khác không thấy menu này**; mỗi lần vào đều hỏi mật khẩu.

## 4. Tạo tài khoản cho nhân viên

Trên trạm quản trị: **Quản trị bảo mật → Quản trị cấp quyền** → nhập mật khẩu quản trị.

Mục **Cấp nhanh nhân sự**:
1. Gõ tên nhân viên.
2. Chọn **vai trò**:

| Vai trò | Ghi được | Đọc được |
|---|---|---|
| **TiepDon** (tiếp đón) | Hành chính, Import danh sách | Hành chính |
| **BacSi** + chọn khoa (Nhi/Mat/TMH/RHM) | Lần khám, Tiền sử, Thể lực, **Lâm sàng của khoa mình** | Hành chính, các mục chung, lâm sàng khoa mình, cận lâm sàng, kết luận |
| **KTV** (kỹ thuật viên xét nghiệm) | Cận lâm sàng | Cận lâm sàng |
| **KetLuan** (bác sĩ kết luận) | Kết luận | **Tất cả** các mục |

3. Bấm **Tạo gói đăng ký** → hiện một dòng dạng `i=...&a=BenhVien:...&a=SoYTe:...&a=DienThoai:...`. **Sao chép** và gửi cho nhân viên (gói dùng một lần).

## 5. Đăng ký thiết bị của nhân viên (lần đầu)

1. Mở ứng dụng trên máy nhân viên → màn hình **Đăng ký thiết bị**.
2. Dán gói vào ô **"Dán gói đăng ký"** (các ô còn lại tự điền).
3. (Máy khác máy chủ) sửa **Địa chỉ máy chủ lưu trữ** thành `http://<IP máy chủ>:8090` (xem mục 11).
4. Đặt **passphrase** (≥ 8 ký tự) → **Đăng ký**. Khoá riêng được tạo trên máy, lưu bằng kho khoá Windows và **buộc vào phần cứng** máy này.
5. Các lần sau: mở app → **Thiết bị đang khoá** → nhập passphrase → **Mở khoá**. Tự khoá sau 5 phút không dùng.

Quên passphrase: bấm **"Quên passphrase? Xoá thiết bị này"** rồi nhờ quản trị cấp gói mới. Thêm quyền sau này: **Khoá của tôi → Thiết bị & khoá → "Mã cấp quyền" → Thêm thuộc tính**.

## 6. Các màn hình nghiệp vụ

Thanh menu: Trang chủ · Khám sức khỏe định kỳ · Import Excel · Danh mục · Quản lý hồ sơ · Báo cáo · Cập nhật · Khoá của tôi · (Quản trị bảo mật) · Thoát.

### 6.1 Trang chủ
Hiện người dùng, thuộc tính được cấp, mã thiết bị, phần cứng, nút cấp khoá đã kết nối, và lối tắt tới các màn hình.

### 6.2 Khám sức khỏe định kỳ (màn hình chính)
- **Chọn mẫu** (trên cùng): mẫu 6–18 tuổi (có người giám hộ và khám Nhi) hoặc mẫu từ 18 tuổi. **Công ty**: chọn đơn vị (mặc định THCS Tân Tiến).
- **Lưới danh sách** (dưới): bấm **⟳ Tải lại danh sách đã lưu**. Các thẻ *Import excel / Chưa liên thông / Đã liên thông / Hồ sơ lỗi / Lỗi dữ liệu* lọc theo trạng thái; ô **Tìm kiếm** lọc theo tên/CCCD/điện thoại/lớp. Dữ liệu được giải mã **trên máy bạn**; hàng hiện 🔒 nghĩa là bạn không có thuộc tính để đọc.
- **Cột THAO TÁC**:
  - **Mới**: phiếu trống. Cần vai trò **TiepDon** để lưu mục Hành chính.
  - **Lưu**: mã hoá và lưu **từng mục đã sửa** (mỗi mục có chính sách riêng). Dòng đỏ báo mục còn thiếu (họ tên, ngày sinh, CCCD 12 số, nguồn chi trả).
  - **Sửa**: chọn một dòng trong lưới rồi bấm để sửa (lưu thành phiên bản mới).
  - **Xóa**: chỉ xoá được các mục do **chính thiết bị này** đã tạo.
- **NỘI DUNG PHIẾU**: Hành chính · Lần khám · Tiền sử bệnh tật · Khám thể lực (BMI tự tính) · **Khám lâm sàng** · Cận lâm sàng (cờ ↑↓ theo giới) · Kết luận (ICD). Dấu ● = mục đã sửa chưa lưu; 🔒 = không đủ quyền đọc.
- **Khám lâm sàng**: mỗi chuyên khoa một khối với **Kết quả** + **Phân loại** từng mục. Nút **Điền giá trị bình thường**, **Xóa**, **Load** (mẫu: Bình thường/Cận thị/Sâu răng). Khung bên phải hiện **họ tên và chữ ký số** của bác sĩ đã khám (✔ hợp lệ). Bạn chỉ sửa được khối của khoa mình.
- **Kiểm tra dữ liệu import** / **Ẩn danh sách**: kiểm tra lỗi toàn đơn vị / ẩn lưới cho rộng chỗ.

### 6.3 Import Excel
Cần vai trò **TiepDon**. Làm theo 3 bước:
1. **B1. Chọn file**: chọn file `.xlsx` (ví dụ `NHẬP THCS TÂN TIẾN B.xlsx`). Chọn đúng **Tên công ty** (đơn vị) ở ô phía trên.
2. **B2. Kiểm tra thông tin**: hệ thống tự nhận cột theo tên tiêu đề; **Danh sách lỗi** liệt kê *Dòng / Họ tên / Cột / Giá trị / Nội dung lỗi*. Bấm một dòng lỗi để xem chi tiết. Tuỳ chọn **Kiểm tra lỗi tổng thể** thêm kiểm tra trùng CCCD và tuổi hợp với **Mẫu 18 / 6 đến 18 / dưới 6**.
3. **B3. Import**: mã hoá từng hồ sơ trên máy rồi lưu. 1.000 hồ sơ mất ≈ 2 giây.

Ba chế độ: **Thêm mới** (bỏ qua CCCD đã có) · **Cập nhật** (ghi phiên bản mới cho CCCD đã có) · **Thêm xét nghiệm** (nhập kết quả khám từ sheet có cột chiều cao, cân nặng, mạch, huyết áp, nhi, mắt, TMH, RHM, phân loại; cho hồ sơ đã có, cần quyền ghi các mục đó).

### 6.4 Danh mục
Xét nghiệm (khoảng bình thường theo giới), mã ICD, dân tộc. Danh mục mẫu tự soạn.

### 6.5 Quản lý hồ sơ
Danh sách hồ sơ của đơn vị với bộ lọc **Tất cả / Đã gửi / Chưa gửi / Lỗi** và **Mẫu**; thống kê tổng; nút **Gửi liên thông các dòng đang lọc** (mô phỏng, không gửi dữ liệu đi đâu). Chọn một dòng để xem hai khung:
- **Dữ liệu đã giải mã (trên máy này)** — tab Data / Header / Signature / Raw JSON: nội dung thật, người lập, chữ ký số.
- **Máy chủ thấy gì (ciphertext)** — chỉ có loại mục, thời điểm, mã thiết bị tạo, chỉ mục mù, kích thước, **chính sách truy cập**. *Đây là màn hình dùng để chứng minh "máy chủ mù" khi bảo vệ.*

### 6.6 Báo cáo
Chọn đơn vị, **Từ ngày / Đến ngày**, mẫu → **Tổng hợp** (giải mã và ghép các mục trên máy bạn) → **Xuất Excel** (tệp CSV mở được bằng Excel; **là dữ liệu rõ**, hãy bảo quản). Báo cáo đầy đủ cần tài khoản **BacSi** hoặc **KetLuan** (TiepDon chỉ đọc được cột hành chính).

### 6.7 Cập nhật
Thông tin phiên bản và chế độ chạy.

## 7. Khoá của tôi (mọi người dùng)

- **Thiết bị & khoá của tôi**: GID, mã thiết bị, băm phần cứng, thuộc tính, số khoá đang giữ, các lần phá-vỡ-kính còn hiệu lực. **Làm mới khoá** (xin lại theo epoch hiện hành), **Thêm thuộc tính** (dán mã cấp quyền của một tổ chức), **Khoá thiết bị**.
- **Phá vỡ kính (cấp cứu)** — chỉ vai trò **BacSi**: khi bệnh nhân nguy kịch mà bác sĩ chủ quản không liên lạc được.
  1. Nhập **số định danh** bệnh nhân và **lý do (≥ 10 ký tự)** → **Kích hoạt**.
  2. Cả 3 tổ chức **đều nhận cảnh báo CRITICAL**, ghi nhật ký, hiệu lực 24 giờ. Quản trị có thể đóng sớm.
  3. Mở lại phiếu khám của bệnh nhân: các mục lâm sàng đọc được.
  > Áp dụng cho các mục **lưu từng cái từ màn Khám sức khỏe định kỳ**. Dữ liệu **nhập lô** bằng Excel không có nhánh phá-vỡ-kính theo bệnh nhân (đã nêu ở mục giới hạn).

## 8. Quản trị bảo mật (chỉ trạm quản trị)

Vào bất kỳ mục nào đều hiện **ô nhập mật khẩu quản trị**. Sai 5 lần → khoá 15 phút (đợt sau 30 phút, 1 giờ… tối đa 24 giờ, tắt/mở app không xoá được). Tự khoá sau 5 phút không dùng; có mục **Khoá phần quản trị ngay** trong menu.

### 8.1 Quản trị cấp quyền
- **Cấp nhanh nhân sự**: xem mục 4.
- **Thu hồi quyền** (khi nhân viên nghỉ việc, mất máy):
  1. Chọn một nút (BenhVien) → **Người giữ quyền tại nút này** → bấm **thu hồi** cạnh thuộc tính cần gỡ. **Lặp lại ở nút SoYTe** (cần gỡ ở đủ số nút có thể cấp khoá).
  2. Ô **Tăng epoch thuộc tính**: nhập thuộc tính (ví dụ `MED:Khoa:Nhi`) → **Tăng epoch**. Từ đây khoá cũ không mở được dữ liệu đã được bọc lại; người còn quyền chỉ cần mở hồ sơ là hệ thống **tự bọc lại khoá**, rồi bấm *Khoá của tôi → Làm mới khoá* nếu cần.
  > Dữ liệu mà người bị thu hồi **đã tải/giải mã trước đó** thì không thu hồi được (giới hạn cố hữu của mật mã).
- **Đóng phá-vỡ-kính**: dán **chỉ mục mù** của bệnh nhân (cột `subject` trong Giám sát) → **Đóng phá-vỡ-kính**.
- **Nhật ký quản trị (chuỗi băm)**: chọn Registry hoặc từng nút; hiện "TOÀN VẸN" hoặc "BỊ SỬA tại #n" nếu có người sửa nhật ký.
- **Trạm quản trị này**: **Khoá ngay**, **Đổi mật khẩu**, **Gỡ kích hoạt** (nhập mật khẩu hiện tại ở ô trên).

### 8.2 Giám sát an ninh
Dòng sự kiện tự làm mới: phá vỡ kính (CRITICAL), giải mã thất bại, khoá thiết bị tự động (≥ 5 lần giải mã thất bại/10 phút), thu hồi, đổi epoch… Cùng nguồn với file `data-demo\siem\events.jsonl` (cho Wazuh) và `/api/siem/events?format=cef`.

### 8.3 App điện thoại (nút 3/3)
Mô phỏng ứng dụng xác thực trên điện thoại: khi nút Bệnh viện hoặc Sở Y tế không phục vụ được, yêu cầu xin khoá chuyển sang nút Điện thoại và **chờ người duyệt** ở màn này → bấm **Cho phép**. (Kịch bản 2-trên-3 có kiểm thử tự động; demo thủ công cần tắt một nút.)

## 9. Máy khác và bản user

- Máy nhân viên dùng **bản user** (`MedABE.exe`): không có mã quản trị, menu quản trị không tồn tại.
- Chạy bản admin trên máy khác chưa kích hoạt: menu quản trị **không hiện ra**. Chép cả thư mục dữ liệu sang máy khác cũng vô dụng (buộc phần cứng).

## 10. Chạy trên nhiều máy (mạng LAN)

Trên máy chủ, đặt IP máy chủ rồi chạy:
```powershell
$env:PUBLIC_HOST = '192.168.1.10'   # IP của máy chủ
npm run demo
```
Mở tường lửa Windows cho các cổng **8090, 9001, 9002, 9003** (mạng nội bộ). Trên máy nhân viên, ô **Địa chỉ máy chủ lưu trữ** nhập `http://192.168.1.10:8090`. (Chưa có TLS: chỉ dùng trong mạng tin cậy.)

## 11. Kịch bản demo bảo vệ (10 bước, ≈ 10 phút)

1. `npm run demo`; mở app với tài khoản **TiepDon** → *Khám sức khỏe định kỳ* → **1.000 học sinh** hiện ra ngay.
2. *Import Excel*: chọn file → B2 (cho thấy bảng lỗi) → B3: nhập 1.000 hồ sơ trong ~2 giây.
3. *Quản lý hồ sơ* → chọn một học sinh → so hai khung: **trái** nội dung thật, **phải** máy chủ chỉ thấy ciphertext + chính sách.
4. Mở thư mục `data-demo\db` / dùng công cụ tìm chuỗi: **không tìm thấy** tên/CCCD nào.
5. Tài khoản **Bác sĩ Nhi** khám lâm sàng, lưu → khung chữ ký ✔.
6. Tài khoản **Bác sĩ Mắt** mở cùng bệnh nhân: khối Nhi bị 🔒 — chính sách mật mã, không phải kiểm tra quyền ở máy chủ.
7. **Phá vỡ kính** bằng bác sĩ khoa khác (lý do ≥ 10 ký tự) → mở được; chuyển sang *Giám sát* ở trạm quản trị: thấy 3 cảnh báo CRITICAL.
8. **Thu hồi + tăng epoch** một thuộc tính → người bị thu hồi không mở được hồ sơ đã được bọc lại.
9. Mở app trên **máy khác**: không có menu quản trị. Trên máy bạn: nhập sai mật khẩu quản trị 5 lần → **khoá**.
10. *Báo cáo* → Tổng hợp → Xuất Excel (nêu rõ tệp xuất ra là dữ liệu rõ).

## 12. Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| App báo không kết nối được | Máy chủ chưa chạy: `npm run demo`; kiểm tra địa chỉ máy chủ trong ô đăng ký |
| `Cổng 8090 đang bị chiếm` | Tắt chương trình đang dùng cổng 8090, hoặc đặt `$env:PORT='8091'` |
| Danh sách trống | Chọn đúng **Công ty**; bấm **Tải lại danh sách**; tài khoản phải có quyền đọc mục Hành chính (TiepDon/BacSi/KetLuan) |
| "Sai passphrase" | Nhập lại; không khôi phục được → *Xoá thiết bị này* rồi xin gói mới |
| `HARDWARE_MISMATCH` | Khoá được tạo trên máy khác hoặc đã đổi ≥ 2 linh kiện: đăng ký lại thiết bị |
| Quản trị: "Đã khoá do nhập sai nhiều lần" | Chờ hết thời gian khoá (đếm ngược trên màn hình) |
| Máy chủ trả 429 cho quản trị | Có người dò token: chờ 60 giây (đúng token cũng bị từ chối trong lúc khoá) |
| Muốn kích hoạt lại trạm quản trị | Xoá `admin.bin` trong thư mục dữ liệu ứng dụng, rồi làm lại mục 3 (`npm run admin:package` nếu đã xoá gói) |

Thư mục dữ liệu ứng dụng (khoá thiết bị, kho khoá, cấu hình): bản `npm run desktop` → `%APPDATA%\medabe`; bản đóng gói → `%APPDATA%\MedABE-Admin` hoặc `%APPDATA%\MedABE`. Thư mục dữ liệu máy chủ: `data-demo\`.

## 13. Kiểm thử

```powershell
npm test                                    # 47 test đơn vị + đầu-cuối (Spring + 3 nút thật)
node app/test-ui/desktop-check.mjs          # kịch bản nhân viên trên app desktop thật
node app/test-ui/admin-check.mjs            # trạm quản trị: đúng máy, mật khẩu, khoá dò
node app/test-ui/user-edition-check.mjs     # bản user không chứa mã quản trị
node app/test-ui/ui-demo.mjs                # chụp màn hình với DỮ LIỆU GIẢ (app/test-ui/shots)
```
> `admin-check` cố ý dò token sai nên máy chủ khoá địa chỉ 60 giây; đợi hết khoá rồi chạy kịch bản khác.

## 14. Giới hạn — hãy nói thật khi bảo vệ

- Đây là **bản trình diễn**, mật mã **chưa được kiểm toán**, chưa có TLS; **không dùng cho dữ liệu bệnh nhân thật**.
- Quyền **ghi** không do mật mã quyết định (ABE bảo vệ việc **đọc**); giao diện chỉ gợi ý theo vai trò.
- Thu hồi chỉ bảo vệ dữ liệu **từ lúc được bọc lại**; phá-vỡ-kính hết hạn là "cố gắng hết sức" (chắc chắn là cảnh báo + nhật ký).
- Dữ liệu **nhập lô** dùng header chung theo chính sách: ai đọc được một bản ghi trong lô thì đọc được cả lô (đúng với chính sách chung), và không có nhánh phá-vỡ-kính theo bệnh nhân.
- Khoá buộc phần cứng bằng CPU/mainboard/BIOS/ổ đĩa + DPAPI của Windows (chịu được thay một linh kiện), không phải TPM.
- "Liên thông BYT" là **mô phỏng**; danh mục xét nghiệm/ICD là dữ liệu mẫu.
- Máy trạm nhiễm mã độc khi đang mở khoá vẫn lấy được dữ liệu; cặp ghép không kháng lượng tử.
- File Excel gốc và tệp "Xuất Excel" là dữ liệu rõ của trẻ vị thành niên: không đưa lên git/đám mây.
