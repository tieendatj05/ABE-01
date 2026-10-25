# MedABE — ứng dụng khám sức khoẻ có hồ sơ mã hoá bằng CP-ABE

Ứng dụng **desktop Windows** (Electron) mô phỏng quy trình khám sức khoẻ toàn dân: phiếu khám nhiều mục, import Excel cả trường, danh sách, báo cáo. Mọi dữ liệu được **mã hoá ngay trên máy trạm** trước khi gửi đi; máy chủ chỉ giữ ciphertext. Khoá chỉ được cấp khi ít nhất 2 trên 3 tổ chức đồng thuận và buộc vào phần cứng của máy.

Hệ thống chia làm hai phần **độc lập**:

| Thư mục | Nội dung |
|---|---|
| [`app/`](app/) | **Ứng dụng**: giao diện (React) và khung desktop (Electron). Chỉ dùng phần bảo mật qua một cổng duy nhất `security/src/index.ts`. |
| [`security/`](security/README.md) | **Phần bảo mật** (lấy riêng được): SDK mật mã, 3 nút cấp khoá, kho ciphertext "mù" (Spring Boot + JPA), registry định danh, SIEM, nhận diện phần cứng. Có README và test riêng. |

## Chạy
```
npm install
npm run security:jar        # đóng gói Spring Boot (cần Java 25)      -> security/storage/target
npm run demo                # Spring :8090 + 3 nút cấp khoá :9001-9003 (+ web dev :5173)
npm run desktop             # mở ứng dụng desktop
npm run desktop:pack        # bản ADMIN cho trạm quản trị  -> release/MedABE-Admin-win32-x64/MedABE-Admin.exe
npm run desktop:pack:user   # bản USER cho máy nhân viên (KHÔNG chứa mã quản trị) -> release/MedABE-win32-x64/MedABE.exe
```
Token quản trị được **sinh ngẫu nhiên** lần đầu chạy (`data-demo/admin-secrets.json`) và **không bao giờ in ra màn hình**; không còn token mặc định đoán được. Dữ liệu demo nằm ở `data-demo/` (chỉ có ciphertext; đặt `DATA_DIR` để đổi).

## Phần quản trị bảo mật: chỉ trên TRẠM QUẢN TRỊ, luôn đòi mật khẩu
Cấu hình bảo mật (cấp quyền, thu hồi, giám sát, duyệt điện thoại) **không** nằm trong giao diện chung:
- **Chỉ tồn tại trên máy đã kích hoạt làm trạm quản trị.** Máy khác chạy cùng ứng dụng thì menu "Quản trị bảo mật" **không hiện ra**, và cầu nối quản trị trả "chưa kích hoạt". Bản `user` còn **không chứa mã quản trị** (đã kiểm tra trong file build).
- **Kích hoạt một lần**, bằng gói `data-demo/admin-package.txt`: mở app bằng `npm run desktop -- --admin-setup` → *Quản trị bảo mật → Kích hoạt trạm quản trị* → dán gói + đặt **mật khẩu quản trị** (≥ 10 ký tự, có chữ và số/ký tự đặc biệt). Sau đó xoá `admin-package.txt` và `admin-secrets.json` khỏi máy chủ nếu không cần.
- Token được cất mã hoá bằng mật khẩu (scrypt → AES-GCM) + DPAPI của Windows + **buộc phần cứng**; chép sang máy khác thì vô dụng kể cả khi có mật khẩu.
- **Mỗi lần vào phải nhập mật khẩu**; sai 5 lần thì khoá 15 phút (đợt sau gấp đôi, tối đa 24 giờ, lưu ra đĩa nên tắt/mở app không xoá được); tự khoá sau 5 phút không dùng.
- Giao diện **không bao giờ thấy token**: tiến trình chính gắn token và gọi máy chủ, chỉ tới đích và đường dẫn trong danh sách trắng.
- Máy chủ cũng chống dò token (sai 5 lần/phút thì 429, kể cả đúng token trong lúc bị khoá).

**Lần đầu dùng (nhân viên):** trạm quản trị tạo *gói đăng ký* (Quản trị bảo mật → Quản trị cấp quyền → Cấp nhanh nhân sự: vai trò *Tiếp đón* để nhập danh sách, *Bác sĩ* + chuyên khoa để khám) và gửi cho nhân viên; trên máy họ, dán gói vào màn hình đăng ký thiết bị, đặt passphrase.

## Màn hình (theo phần mềm khám sức khoẻ toàn dân)
- **Khám sức khỏe định kỳ**: thanh *Chọn mẫu / Công ty*, cột THAO TÁC (Mới/Lưu/Sửa/Xóa), NỘI DUNG PHIẾU (Hành chính, Lần khám, Tiền sử, Thể lực, Lâm sàng, Cận lâm sàng, Kết luận), lưới danh sách + *Tải lại danh sách đã lưu*. **Khám lâm sàng** có Kết quả + Phân loại từng mục, họ tên và **chữ ký số** của bác sĩ.
- **Import Excel**: B1 Chọn file → B2 Kiểm tra thông tin (bảng *Danh sách lỗi*: Dòng/Họ tên/Cột/Giá trị/Nội dung lỗi) → B3 Import; chế độ *Thêm mới / Cập nhật / Thêm xét nghiệm* (kết quả khám), kiểm tra lỗi tổng thể theo mẫu tuổi.
- **Quản lý hồ sơ**: danh sách + hai khung *Dữ liệu đã giải mã (trên máy này)* và *Máy chủ thấy gì (ciphertext)*.
- **Báo cáo**: tổng hợp theo đơn vị/ngày/mẫu, **Xuất Excel**.
- **Khoá của tôi** (mọi người dùng): thiết bị & khoá, phá vỡ kính (bác sĩ cấp cứu). **Quản trị bảo mật** (chỉ trạm quản trị, đòi mật khẩu): cấp quyền, thu hồi, giám sát SIEM, app điện thoại (nút 3/3).

## Hiệu năng (đo trên máy dev, app desktop)
Nhập **1.000 học sinh** từ file Excel của một trường: mã hoá + lưu **≈ 2 giây**; mở lại danh sách 1.000 dòng (giải mã trên máy) **≈ 1,1 giây**; máy khác mở **≈ 1,5 giây**. Nhờ **header chung** theo chính sách: cả lô chỉ tốn 1 phép ABE. Quét toàn bộ dữ liệu máy chủ với 300 giá trị lấy từ file Excel: không tìm thấy giá trị nào.

## Kiểm thử
```
npm test                               # 47 test: lõi ABE/ngưỡng/header chung, phần cứng, ánh xạ Excel, đầu-cuối trên Spring + 3 nút thật
cd security/storage && ./mvnw test     # 2 test Spring
node app/test-ui/desktop-check.mjs     # kịch bản desktop thật (Tiếp đón -> bác sĩ Nhi -> bác sĩ Mắt)
node app/test-ui/admin-check.mjs       # trạm quản trị: chỉ đúng máy, đòi mật khẩu, khoá khi dò, token không lọt ra giao diện
node app/test-ui/user-edition-check.mjs # bản user không chứa mã quản trị
node app/test-ui/ui-demo.mjs           # import/ báo cáo với DỮ LIỆU GIẢ + chụp màn hình (app/test-ui/shots)
npm run demo:tancong                   # kịch bản demo ABE: liên thông, Bộ Y tế đọc, kẻ tấn công A/B/C, SIEM, phụ huynh (tự dựng hệ thống riêng)
node app/test-ui/import-school.mjs "<file.xlsx>"   # nhập file Excel thật, chỉ in số lượng/thời gian
```

## Quyền riêng tư dữ liệu thật
Dữ liệu học sinh là dữ liệu của trẻ vị thành niên. Các script thử với file thật **không in** tên/CCCD/số điện thoại và không chụp màn hình có dữ liệu. Ảnh chụp trong `app/test-ui/shots` dùng dữ liệu giả. **Không đưa `data-demo/`, file Excel hay ảnh có dữ liệu thật lên git/đám mây.** Máy chủ chỉ giữ ciphertext, nhưng file Excel gốc và tệp "Xuất Excel" của báo cáo là dữ liệu rõ.

## Liên thông Bộ Y tế (mô phỏng)
```
Máy nhân viên --mã hoá--> Kho mù (Spring :8090)
      |  "Gửi liên thông" (bản mã hoá + header ABE, ký bằng thiết bị)
      v
Cổng Bộ Y tế (:8095) --biên nhận ký Ed25519--> trạng thái "Đã liên thông"
      ^                         ^
      |                         +-- Phụ huynh tra cứu (CCCD + mã tra cứu), cùng đường /api/public/*
      +-- Cán bộ Sở Y tế (Org:SoYTe) tải ciphertext, giải mã trên máy mình
```
- Trạng thái "Đã liên thông" lấy từ **biên nhận có chữ ký** của cổng; sửa hồ sơ sau khi gửi thì tự quay về "Chưa liên thông" cho đến khi gửi lại.
- Cổng chỉ giữ ciphertext; khoá công khai của cổng được máy chủ công bố trong cấu hình có chữ ký registry để máy khách ghim.
- Mã cơ sở khám (CSKCB) đặt trong `<DATA_DIR>/byt/facilities.json` (mặc định `DEMO0001`).
- Menu **Cổng Bộ Y tế** chỉ hiện với thiết bị có thuộc tính `Org:SoYTe`.

## Giới hạn (xem thêm `security/README.md`)
- Quyền **ghi** không được ép bằng mật mã (ABE bảo vệ việc đọc); giao diện chỉ gợi ý theo vai trò.
- Thu hồi chỉ bảo vệ từ lúc dữ liệu được bọc lại; phá-vỡ-kính hết hạn là "cố gắng hết sức" (chắc chắn là cảnh báo + nhật ký). Dữ liệu **nhập lô** (header chung) không có nhánh phá-vỡ-kính theo bệnh nhân.
- Khoá buộc phần cứng bằng CPU/mainboard/BIOS/ổ đĩa + DPAPI của Windows, chịu được thay một linh kiện; không phải TPM/WebAuthn.
- **Cổng liên thông Bộ Y tế là mô phỏng** (dịch vụ riêng, cùng mạng demo, chưa có TLS, chưa kiểm tra quyền ghi của người gửi). Nó nhận bản **đã mã hoá**, ký biên nhận và cho Bộ Y tế/phụ huynh tra cứu, nhưng không kết nối cổng thật nào. Danh mục chuẩn lấy từ file danh mục của một phần mềm KSK đã cài (xem `app/web/src/data/gen/README.md`).
- Cài đặt mật mã **chưa được kiểm toán**; chưa có TLS; đây là bản trình diễn, **không dùng cho dữ liệu bệnh nhân thật**.
