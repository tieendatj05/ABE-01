# MedABE (KSK) — hồ sơ khám sức khoẻ mã hoá bằng CP-ABE

> **Đồ án nghiên cứu / demo.** Mọi dữ liệu trong repo và trong test là **dữ liệu giả**. Đây không phải hệ thống y tế để dùng thật.

## Dự án làm gì

Hồ sơ khám sức khoẻ (hành chính, lâm sàng theo khoa, ảnh nhiều vùng) được **mã hoá ở máy người dùng**. Máy chủ và CSDL chỉ giữ **bản mã**.
Ai mở được hồ sơ do **thuộc tính của tài khoản** quyết định (vai trò, khoa, "là tác giả", "vừa xác thực MFA"), chứ không chỉ do một câu lệnh `if` ở máy chủ.

- Mã hoá thuộc tính **CP-ABE** (Rouselakis–Waters 2015, BLS12-381), khoá cấp bởi **3 nút, cần 2 nút đồng thuận**.
- ABE chỉ **bọc khoá dữ liệu**; nội dung mã bằng **AES-256-GCM**.
- Ví dụ policy cho một bản ghi lâm sàng khoa Mắt:
  `Author:<người nhập> OR (Role:BacSi AND Khoa:Mat) OR (Role:GiamSat AND Auth:MFA)`
- Một ảnh y khoa được **cắt theo vùng, mỗi vùng thuộc một khoa**: bác sĩ khoa nào chỉ ghép được vùng của khoa mình.

## Nên đọc theo thứ tự này

1. [`BAO_CAO_THUC_NGHIEM_ABE.md`](BAO_CAO_THUC_NGHIEM_ABE.md) — báo cáo đầy đủ: ABE giải thích bằng hồ sơ mẫu, luồng trước/sau ABE, so sánh với hệ thống thông thường, thuộc tính, policy động, các kịch bản, điểm yếu đã tìm và đã vá, kết quả đo.
2. [`KICH_BAN_ABE_TIEU_BIEU.md`](KICH_BAN_ABE_TIEU_BIEU.md) — các kịch bản tiêu biểu.
3. `security/src/abe/rw15.ts` — phần đầu file mô tả lược đồ và khoá sinh ngưỡng.

## Cấu trúc thư mục

| Thư mục | Nội dung |
|---|---|
| `security/src/abe/` | Lõi mật mã: CP-ABE, LSSS, policy |
| `security/src/client/` | `MedClient` (đăng nhập, xin khoá, mã hoá/giải mã, bọc lại khoá), ảnh theo vùng, chính sách phía client |
| `security/src/authority/`, `deploy/` | Nút cấp khoá, dựng máy chủ demo/thử nghiệm |
| `security/src/byt/` | Cổng liên thông Bộ Y tế (mô phỏng) |
| `security/storage/` | Máy chủ **Spring Boot (Java 25)**: kho bản mã, tài khoản, kiểm quyền, epoch, nhật ký |
| `app/web/` | App nhân viên (React + Vite) |
| `app/parent/`, `app/research/`, `app/desktop/`, `app/mobile/` | App tra cứu, giao diện đối chiếu A/B, đóng gói desktop/mobile |
| `app/test-ui/` | Kịch bản demo và kiểm tra giao diện (puppeteer) |
| `launcher/`, `*.cmd` | Script khởi động trên Windows |

## Chạy thử

Cần **Node 24**, **JDK 25** (Windows là môi trường đã kiểm; một số script là `.cmd`/`.ps1`).

```bash
npm install
cd security/storage && ./mvnw -DskipTests package && cd ../..   # lần đầu cần mạng
npm run web:build
```

Mỗi test tự dựng **máy chủ tạm** (Spring HTTPS + 3 nút), không cần cấu hình thêm. Nên chạy **từng file**:

```bash
npx vitest run security/src/client/abe-chinh-sach-dong.e2e.test.ts   # hạn chế tài khoản, thu hồi, khoá cũ
npx vitest run security/src/client/abe-doi-chung-anh.e2e.test.ts     # ảnh chia theo khoa, so với đối chứng
npx vitest run security/src/client/abe-truyen-tai.e2e.test.ts        # HTTP/HTTPS từng chặng
npx vitest run security/src/client/abe-pha-hoai-header.e2e.test.ts   # thử phá hoại header khoá chung
```

Máy chủ demo bấm-là-chạy (Windows): `Chay-Demo-KSK-Moi.cmd`, rồi mở `http://localhost:5180`. Mật khẩu quản trị lần đầu được sinh vào `data-research/` (thư mục này không đưa lên git).

> Chạy toàn bộ `vitest` song song trên máy yếu có thể làm vài test hết giờ; chạy từng file hoặc thêm `--no-file-parallelism`.

## Không nằm trong repo

Dữ liệu chạy (`data-research/`), bản đóng gói (`release/`), ảnh y khoa tải từ TCIA, tài khoản mẫu kèm mật khẩu, bí mật MFA, và **ảnh chữ ký tay bác sĩ** (`app/web/src/data/chuky/*.png`, có thể là chữ ký người thật). Thiếu ảnh chữ ký thì app vẫn chạy bình thường, chỉ không hiện ảnh chữ ký minh hoạ trong phiếu; chữ ký số ECDSA không phụ thuộc vào ảnh này. Mật khẩu của tài khoản mẫu dùng trong test nằm trong mã (`security/src/deploy/research-stack.ts`) — **chỉ để chạy thử**, đừng dùng cho hệ thống thật.

## Giới hạn đã biết

Khoá/bản mã đã sao chép vẫn mở được dữ liệu cũ (đặc tính của ABE); app web phục vụ qua HTTP không có SRI; 3 nút cấp khoá chạy chung một máy trong demo. Chi tiết và cách tái hiện: mục 9 và 13.4 của báo cáo.
