# Bàn giao ngữ cảnh — dán vào đầu cuộc trò chuyện mới

Bạn đang tiếp tục làm việc trên dự án **MedABE** tại `E:\TLCN\medabe` — ứng dụng desktop Windows (Electron) mô phỏng hệ thống
khám sức khỏe toàn dân, hồ sơ mã hóa bằng **CP-ABE** (Rouselakis–Waters 2015, BLS12-381). Đây là đồ án tốt nghiệp, chủ đề chính
là chứng minh ABE bảo vệ dữ liệu thật sự (không chỉ ẩn trên giao diện). Người dùng không rành kỹ thuật, muốn bạn **tự tay chạy
lệnh** (PowerShell/Bash) thay vì chỉ hướng dẫn suông.

## Kiến trúc (đọc kỹ trước khi sửa gì)

- `app/web/src` — giao diện React, dùng chung cho 2 bản build qua biến `__EDITION__` ('admin'/'user').
- `app/desktop` — tiến trình chính Electron (main.ts, preload.ts). `update-packaged.mjs` là script hay dùng nhất: build lại +
  vá thẳng vào `release/KSK-win32-x64` và `release/KSK-NhanVien-win32-x64` **không cần JDK**.
- `security/src` — SDK mật mã (TypeScript), cổng duy nhất `security/src/index.ts`.
- `security/storage` — máy chủ Spring Boot (Java 25, Maven) — kho ciphertext "mù", registry, SIEM, agent bảo vệ.
- `security/src/byt` + `security/storage/.../AppUpdateController.java` — 2 tính năng tự viết thêm (xem bên dưới).

## Môi trường đang chạy

- `release/KSK-win32-x64/KSK.exe` = bản ADMIN (có máy chủ nhúng Spring, cổng 8090/8095/9001-9003/5173/5174).
- `release/KSK-NhanVien-win32-x64/KSK-NhanVien.exe` = bản NHÂN VIÊN.
- Dữ liệu ở `%APPDATA%\KSK\server-data`. Đơn vị demo chính: `THCS-TAN-TIEN` (1000 học sinh, chỉ ~6 em có mục khám thật).
- **Lưu ý môi trường quan trọng:** mở app packaged bằng lệnh phải `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction
  SilentlyContinue` NGAY TRONG CÙNG lệnh `Start-Process`, nếu không app tự thoát im lặng (exit code 0, không lỗi) — đây là do
  biến môi trường của VS Code, không phải lỗi code.
- Cách mở lại máy chủ + app chuẩn (đã dùng lặp lại suốt phiên):
  ```powershell
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like 'E:\TLCN\medabe\release\*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep 2
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  Start-Process -FilePath 'E:\TLCN\medabe\release\KSK-win32-x64\KSK.exe' -WorkingDirectory 'E:\TLCN\medabe'
  ```
- Sau khi sửa code: `npx tsc` → `npx vitest run` → `node app/desktop/update-packaged.mjs` (build + vá + xuất bản bản tự cập
  nhật) → tắt/mở lại app để kiểm chứng. Test `security/src/network/lan.test.ts` hay lỗi do KSK.exe đang giữ cổng UDP 43821 —
  **không phải lỗi thật**, bỏ qua được.

## Những việc đã làm trong phiên trước (đều đã kiểm thử, đang chạy)

1. **Sửa macOS hardware detection**, bỏ token mặc định đoán được, thêm nút "Thêm trường" (đơn vị tự thêm), nới điều kiện nhận
   diện cột Excel kết quả khám.
2. **Nạp danh mục chuẩn** (60 dân tộc, 34 tỉnh + 3300 xã, 12239 mã ICD-10, 391 chỉ số xét nghiệm, nghề nghiệp) từ
   `tools/import-danhmuc.mjs`, có tra cứu ICD-10 nạp lười.
3. **Cổng liên thông Bộ Y tế (mô phỏng)** — dịch vụ riêng cổng **8095**, tự viết bằng Express
   (`security/src/byt/gateway.ts`, khởi động qua `security/src/deploy/byt.ts`, KHÔNG phải Spring). Nhận bản **đã mã hóa**, ký biên nhận Ed25519, cho Bộ Y tế
   (`Org:SoYTe`) đọc và phụ huynh tra cứu qua `/api/public/*`. UI: `app/web/src/ByTPage.tsx`, nút "Gửi liên thông" ở
   `ListPage.tsx`, và **tự động liên thông ngay khi Lưu** mục khám không phải hành chính trong `Exam.tsx` (xem `byt.ts`:
   `submitPatient`, `backfillLienThong`).
4. **Agent bảo vệ hệ thống** (`SecurityAgentService.java`) — luật tự động (không gọi AI ngoài), 5 luật: giải mã thất bại liên
   tiếp, dò quyền liên tục, đăng ký hàng loạt cùng phần cứng, lạm dụng phá-vỡ-kính, nhật ký bị sửa — tự khóa thiết bị/tắt đăng
   ký khi vượt ngưỡng. Hiện ở Giám sát an ninh (`Monitor.tsx`).
5. **Tự cập nhật ứng dụng** — so hash `app.asar` đang chạy với bản máy chủ giữ (`/api/app/version`,
   `/api/app/download` — `AppUpdateController.java`), tải + hoán đổi file + tự khởi động lại
   (`main.ts`: `update:localHash`/`update:apply`, UI: `UpdateBanner.tsx`). `update-packaged.mjs`/`pack.mjs` tự xuất bản sau
   mỗi lần đóng gói (`publish-update.mjs`).
6. **Sửa lỗi nút "✎ Sửa" không bao giờ sáng** — `select()` trong `Exam.tsx` trước đây tự nhảy vào mode 'edit' luôn, nay về
   'view' trước, bấm Sửa mới mở khóa — đúng ý người dùng.
7. **Icon + logo riêng cho bản admin** (ảnh ADMIN người dùng cung cấp, nền đã tách trong suốt) — `launcher/ksk-admin.ico`,
   `app/web/public/ksk-logo-admin.png`, script `launcher/art/make-admin-icon.ps1`. Tạo shortcut Desktop `KSK.lnk`.
8. **Tắt chặn chụp màn hình THEO MẶC ĐỊNH** (để demo/báo lỗi bằng ảnh chụp) — đảo ngược logic trong `main.ts`/`parent-main.ts`,
   bật lại bằng `MEDABE_BLOCK_CAPTURE=1` khi thật sự cần demo tính năng đó.
9. **Script demo ABE**: `npm run demo:tancong` (`security/src/deploy/demo-tan-cong.ts`) — tự dựng hệ thống riêng, kịch bản 8
   bước: liên thông, Bộ Y tế đọc, 3 kiểu kẻ tấn công, SIEM, phụ huynh tra cứu.
10. **Hướng dẫn demo Wireshark/Kali** — `HUONG_DAN_DEMO_WIRESHARK_KALI.md` (dò IP bằng nmap/arp-scan, bắt gói tin lúc nhân
    viên nhập liệu, xem ciphertext trong Wireshark, đối chứng giải mã).
11. **Hướng dẫn chạy trên MacBook** (`Chay-KSK-NhanVien-Mac.command`, cần tự cài Node.js) và trên máy Windows khác
    (`release/KSK-NhanVien-win32-x64`, chạy thẳng không cần cài gì).

## Agent bảo vệ v2 (phiên 22/10/2026) — cảm biến mạng ARP + Gemini

Chi tiết đầy đủ: **AGENT_BAO_VE_V2_BAN_GIAO.md**. Tóm tắt:
- Cảm biến mạng: `net:scan` trong `app/desktop/adminipc.ts` (Get-NetNeighbor card default-route) → `NetSensorService.java` phát hiện ARP spoofing/MITM so với baseline đã duyệt. UI ở `Monitor.tsx` (nút Duyệt baseline, bảng IP↔MAC, cảnh báo NET_*).
- Gemini (TẮT mặc định): `AiAnalysisService.java` + `GeminiClient.java`. Bật bằng env `MEDABE_AI_ENABLED=true` + `GEMINI_API_KEY`. Lọc bí mật, kiểm schema, fallback. Luật KHÔNG phụ thuộc AI.
- Test: `NetSensorTest`, `AiAnalysisTest`, `AiDisabledTest` (Java) đạt; tsc sạch; vitest 65/65; đã đóng gói lại KSK.exe.
- CHƯA chạy thử API Gemini thật (chưa có key trong môi trường) — chỉ test bằng mock. Để lại: cô lập VM qua hypervisor, HTTPS, cảm biến nền liên tục.

## Đã xong (phiên 21/10/2026): phụ huynh tra cứu bằng CCCD + NGÀY SINH (bỏ mã tra cứu)

- `security/src/client/parent.ts`: bỏ `lookupCode`/`normCode`, thêm `normDob` (nhận yyyy-mm-dd, dd/mm/yyyy...), khoá = scrypt(CCCD|ngày sinh), salt `medabe/parent/v3-dob`.
- `medclient.ts`: tự nhớ ngày sinh từ mục Hành chính (lúc lưu hoặc giải mã), nếu chưa biết thì tự mở mục Hành chính mới nhất; `saveRecord`/`saveMany` nhận thêm `dob?`.
  Thêm `refreshParentAccess(unit)` bọc lại khoá cho hồ sơ CŨ (dữ liệu mã hoá giữ nguyên).
- Máy chủ Spring: `PUT /api/records/parent-wraps` (đã build lại jar). Cổng 8095: gửi lại bản ghi đã có thì cập nhật luôn parentIdx/parentWrap.
- UI: app phụ huynh có ô ngày sinh (`type=date`); Quản lý hồ sơ thay nút "Xuất mã tra cứu" bằng **"Cập nhật tra cứu phụ huynh"**; Exam hiện "Phụ huynh tra cứu bằng CCCD + ngày sinh".
- **Dữ liệu cũ (THCS-TAN-TIEN) phải bấm "Cập nhật tra cứu phụ huynh" một lần** trong Quản lý hồ sơ thì phụ huynh mới tra được (máy chủ không tự làm được vì không có khoá).
- Đánh đổi bảo mật đã nói với người dùng: CCCD chứa sẵn năm sinh nên biết CCCD thì chỉ cần thử ~366 ngày; còn lại giới hạn 20 lần/phút + nhật ký.

## Gói gửi máy nhân viên (21/10/2026)

- `release/Goi-KSK-NhanVien.zip` (152 MB) = app + `Chay-KSK-NhanVien.cmd/.ps1` (kiểm tra 5 cổng, ghi sẵn IP máy chủ vào settings.json lần đầu, mở app) + `HUONG_DAN_MAY_NHAN_VIEN.md`. Nguồn script ở `launcher/nhanvien/`.
- Máy chủ đã mở tường lửa đủ 5174/8090/8095/9001-9003 + UDP 43821. IP Wi-Fi lúc đó: 192.168.11.54.

## Việc đã thử nhưng KHÔNG làm được (đừng thử lại trừ khi có cách mới)

- **Gói 1 file .exe duy nhất cho Windows** (SFX 7-Zip, IExpress) — cả hai đều cần người **bấm tay** qua hộp thoại xác nhận,
  môi trường chạy lệnh này không có công cụ bấm chuột. Giải pháp thay thế đã dùng: gửi cả thư mục/zip, double-click file .exe
  bên trong vẫn chạy ngay không cần cài gì.
- **Build bản macOS .app thật từ Windows** — về mặt kỹ thuật khả thi (electron/packager tải sẵn bản Electron darwin), nhưng
  bị chặn vì **Windows Developer Mode chưa bật** trên máy người dùng (cần quyền tạo symlink). Nếu người dùng đã bật
  (Settings → Privacy & security → For developers → Developer Mode), có thể thử lại ngay.

## Phong cách làm việc cần giữ

- Luôn tự chạy lệnh (PowerShell/Bash) thay vì chỉ hướng dẫn — người dùng mong bạn làm hộ.
- Sau mỗi thay đổi code: `tsc` sạch → test đạt → đóng gói lại → mở app thật để xác nhận, không chỉ báo "đã xong" suông.
- Giải thích ngắn gọn, tiếng Việt, không thuật ngữ thừa; nói thật giới hạn/đánh đổi thay vì tô hồng.
