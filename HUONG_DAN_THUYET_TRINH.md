# Demo MedABE: chứng minh ABE có thật và bảo vệ điều gì

Dùng dữ liệu GIẢ. Thời lượng 12–15 phút. Kết quả test phải lấy từ lần chạy thực tế.

## 1. Giải thích ngắn gọn

Dữ liệu khám được mã hóa ở máy nhân viên trước khi gửi lên Spring Boot.
AES-256-GCM mã hóa nội dung; CP-ABE bảo vệ khóa nội dung (DEK) theo chính sách thuộc tính.
Code thực hiện LSSS và phép ghép cặp BLS12-381, không chỉ kiểm tra vai trò rồi ẩn giao diện.
Một cơ quan logic MED chia bí mật Shamir cho ba nút Bệnh viện, Sở Y tế, Điện thoại; cần 2/3 nút cấp khóa.
Đây không phải ba master key độc lập của ba authority khác nhau.

Câu nói: “Hai thiết bị tải cùng ciphertext. Chỉ thiết bị có khóa thỏa chính sách mới giải mã qua đường ABE.”

## 2. Chạy đúng hệ thống, đúng kho dữ liệu

Bản `KSK.exe` là trạm quản trị có máy chủ nhúng. Bản `KSK-NhanVien.exe` cần kết nối tới máy chủ đó.
Bật KSK trước, rồi mở Nhân viên. Trên bản nhân viên kiểm tra thanh **Đã kết nối** và **Công ty**.
Nếu đổi Wi-Fi/IP, dùng **Đổi máy chủ → http://IP-máy-quản-trị:8090 → Kết nối và tải lại**.
Máy mới đăng ký không tự sinh học sinh. Hai máy chỉ thấy cùng hồ sơ khi cùng server và Công ty.

Kho nhúng của KSK và kho `data-demo/` khi chạy source là hai kho riêng; không tự trộn/copy DB hay khóa.
Muốn chạy đúng dữ liệu source trên máy này: dùng `Chay-KSK-NhanVien.cmd` tại thư mục gốc dự án.

Để demo ABE tách khỏi dữ liệu hiện có, dùng terminal PowerShell:

```powershell
cd E:\TLCN\medabe
npm.cmd run security:jar
npm.cmd run desktop:build
npm.cmd run parent:build
$env:DATA_DIR = "$PWD\demo-abe-proof"
npm.cmd run demo
```

Các cổng 8090, 9001–9003, 5173–5174 phải trống. Không xóa DB cũ nếu cổng bị chiếm.
Đây là môi trường demo mới, ban đầu không có học sinh. Giữ terminal máy chủ chạy.
Mở terminal khác để chạy trạm quản trị riêng:

```powershell
cd E:\TLCN\medabe
$env:DATA_DIR = "$PWD\demo-abe-proof"
$env:MEDABE_USER_DATA = "$PWD\demo-abe-proof\clients\admin"
npm.cmd run desktop
```

Kích hoạt trạm bằng gói của môi trường này. Vào **Quản trị bảo mật → Quản trị cấp quyền**.
Tắt đăng ký tự do ở registry và các nút trước khi tạo tài khoản phân vai.
Đăng ký demo mặc định có nhiều vai trò, gồm KetLuan; không dùng bộ quyền đó để chứng minh người thiếu quyền bị chặn.

## 3. Chuẩn bị các thiết bị riêng

Trong **Nâng cao → Cấp nhanh nhân sự**, tạo gói theo bảng:

| Thiết bị | Quyền | Dùng để |
|---|---|---|
| Tiếp đón demo | TiepDon | Import hành chính |
| Bác sĩ Nhi A | BacSi + Nhi | Tạo mục khám Nhi |
| Bác sĩ Nhi B | BacSi + Nhi | Đọc và thử thu hồi; không phải tác giả |
| Bác sĩ Mắt | BacSi + Mat | Chứng minh thiếu quyền khoa Nhi |
| Cán bộ Sở | SoYTe | Đọc qua nhánh Org:SoYTe |

Không cấp KetLuan, Nhi hoặc Org:SoYTe cho Bác sĩ Mắt.
Mỗi thiết bị dùng `MEDABE_USER_DATA` khác nhau. Ví dụ:

```powershell
$env:MEDABE_USER_DATA = "$PWD\demo-abe-proof\clients\bs-mat"
npm.cmd run desktop
```

Tại màn đăng ký, mở **Nâng cao**, dán gói và đặt passphrase.
Lặp lại cho các thiết bị khác; xem **Khoá của tôi** để xác nhận đúng thuộc tính.
Đây là nhiều danh tính mô phỏng trên một máy. Khi triển khai cần máy/nút độc lập.
Tác giả luôn có nhánh MED:Device; đổi vai trò trên cùng thiết bị không chứng minh quyền khoa.

## 4. Chuẩn bị học sinh giả

Dùng file nhỏ với tên HỌC SINH DEMO A, thông tin giả và số định danh giả đủ 12 chữ số.
Chọn cùng đơn vị mẫu ở mọi thiết bị.
Tiếp đón chạy **B1 Chọn file → B2 Kiểm tra thông tin → B3 Import**; kiểm tra số hồ sơ đã lưu.
Bác sĩ Nhi A mở học sinh, nhập “KẾT QUẢ NHI DEMO” ở lâm sàng Nhi rồi Lưu.
Dùng mục khám lưu riêng này cho demo cấp cứu; mục nhập lô có giới hạn nhánh cấp cứu theo bệnh nhân.

Có thể chạy kiểm tra giao diện tự động, tự tạo 5 học sinh giả và server riêng:

```powershell
node --import tsx app/test-ui/employee-recovery-check.mjs
```

Script dùng bản source đang build; build user bằng `npm.cmd run desktop:build:user` trước.
Kết quả và ảnh chỉ chứa dữ liệu giả trong `.test-runs/employee-*`.

## 5. Demo chính trong 5 phút

1. Mở **Quản lý hồ sơ**: khung trái là dữ liệu giải mã tại máy, khung phải là ciphertext/metadata/header.
   Với nhập lô, ABE nằm ở header chung được tham chiếu. Không tìm thấy tên trong ciphertext chứng minh có mã hóa nội dung.
2. Bác sĩ Nhi B mở mục Nhi: đọc được, chữ ký hợp lệ. Bác sĩ Mắt mở cùng học sinh: đọc hành chính, không mở được mục Nhi.
   Cán bộ Sở mở được qua Org:SoYTe. Server vẫn trả ciphertext; máy khách không đủ khóa thì không lấy được DEK.
3. Chạy kiểm thử thư viện độc lập UI và máy chủ:

```powershell
.\node_modules\.bin\vitest.cmd run security/src/abe/rw15.test.ts --reporter=verbose
```

Chỉ vào ca đúng quyền, thiếu quyền, ghép khóa khác GID, đổi nhãn thuộc tính, ép k=1.
Các ca tấn công phải bị từ chối. Đây là bằng chứng mạnh hơn biểu tượng ổ khóa trên giao diện.
Mở `security/src/abe/rw15.ts`, chỉ `encapsulate`, `decapsulate`, `bls.pairingBatch` và AES-GCM mở DEK.
Chữ ký ECDSA xác thực tác giả/toàn vẹn, là cơ chế bổ sung; không phải phép quyết định quyền ABE.

## 6. Chứng minh 2/3, thu hồi và cấp cứu

```powershell
.\node_modules\.bin\vitest.cmd run security/src/e2e.test.ts --reporter=verbose
```

Bộ này chạy Spring, ba nút, DB trong bộ nhớ và cổng riêng. Cần JAR/Java; kiểm tra không có bài bị bỏ qua.
Nêu các ca: một nút ngừng vẫn cấp khóa với điện thoại duyệt; một nút đơn lẻ không đủ; sai khoa bị từ chối.
Không tắt cả `npm run demo` để mô phỏng một nút: tiến trình đó chứa toàn bộ các nút demo.

Thu hồi thủ công: dùng Nhi B (người đọc, không phải tác giả), thu hồi ở đủ nút, tăng epoch,
cho người còn quyền mở để bọc lại header, rồi Nhi B tải bản mới và thử mở trong phiên mới.
Không thể thu lại plaintext/DEK/bản cũ mà người đó đã lưu. Thu hồi không có hiệu lực hồi tố tuyệt đối.

Cấp cứu: Bác sĩ Mắt → **Phá vỡ kính**, nhập đúng bệnh nhân giả và lý do đủ dài.
Mở lại Nhi và xem cảnh báo CRITICAL. Đóng cấp cứu đổi epoch; hết hạn không xóa được dữ liệu từng tải.

## 7. Nói chính xác giới hạn bảo vệ

- **Phụ huynh không dùng ABE.** Mỗi bản ghi có thêm parentWrap; khóa suy từ **CCCD + mã tra cứu** (scrypt/AES-GCM).
  Mã tra cứu 10 ký tự (~49 bit) là HMAC(khóa chỉ mục, CCCD), chỉ nhân viên tính được, nhà trường phát qua phiếu hoặc SMS.
  Biết CCCD một mình không đủ; có cả CCCD lẫn mã (hoặc là nhân viên) thì đọc được, không phân quyền theo vai trò như ABE.
  Không dùng OTP SMS vì OTP chỉ chặn việc tải dữ liệu, còn khóa giải mã suy từ CCCD thì kẻ có kho dữ liệu vẫn dò ngoại tuyến được.
  Dữ liệu lưu TRƯỚC khi nâng cấp dùng khóa CCCD-only cũ nên phụ huynh không tra được nữa, cần lưu lại hoặc nhập lại.
- **Lộ DB ciphertext khác với chiếm cả máy demo.** Demo đang giữ ba share trên cùng máy; lấy đủ share phá giả định độc lập 2/3.
  Muốn phân tán thật cần tách nút, quyền quản trị, kho khóa, TLS và sao lưu.
- ABE bảo vệ quyền đọc; quyền ghi phải kiểm soát riêng. Policy, khoa, loại mục, thời gian, kích thước còn công khai.
- Hash-chain phát hiện chuỗi không nhất quán; chưa có neo ngoài để chống viết lại toàn chuỗi/xóa đuôi.
- Mật mã tự cài chưa được kiểm toán độc lập. Không tuyên bố an toàn production.

## 8. Trả lời ngắn khi bảo vệ

**ABE của em nằm đâu?** rw15.ts: LSSS + pairing để bọc/mở DEK; test khóa giả và khác GID thất bại ngoài UI.

**Vì sao dùng ABE?** Người mã hóa đặt điều kiện thuộc tính, không cần biết trước danh sách người đọc.

**Chỉ ẩn nút thôi đúng không?** Không: cùng ciphertext, thư viện giải mã trực tiếp vẫn thất bại khi khóa không thỏa policy.

**Máy chủ mù tuyệt đối?** Kho lưu trữ không có plaintext trong payload, nhưng cần tính cả đường CCCD và nơi lưu các share.
