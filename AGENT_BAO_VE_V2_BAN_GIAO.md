# Agent bảo vệ MedABE — Giai đoạn 2: cảm biến mạng ARP + phân tích Gemini

Written for: chính bạn (chủ đồ án). Tài liệu ghi những gì đã triển khai, cách bật Gemini, kịch bản demo, và giới hạn còn lại.

## 1. Đã triển khai (có test chạy được)

### a) Cảm biến mạng phát hiện ARP spoofing / MITM (dựa trên LUẬT, không cần AI)
- **Thu thập** bảng ARP của **card có default route** (LAN thật, vd Wi-Fi; bỏ qua card ảo VMware) bằng `Get-NetNeighbor`,
  chạy ở **tiến trình chính Electron** (không chạy ở React). File: [app/desktop/adminipc.ts](app/desktop/adminipc.ts) (`net:scan`).
- **Gửi lên máy chủ** qua kênh admin đã xác thực (`X-Admin-Token`) — thiết bị thường không giả mạo được sự kiện cảm biến.
- **Phát hiện** ở máy chủ: [NetSensorService.java](security/storage/src/main/java/com/medabe/storage/service/NetSensorService.java)
  - Mapping IP↔MAC **đã duyệt** đổi sang MAC khác → `NET_ARP_SUSPECT` (CRITICAL).
  - Nhiều IP quan trọng cùng trỏ về **một MAC** không khớp baseline → `NET_MITM_SUSPECT` (CRITICAL).
  - **Baseline phải được admin DUYỆT** (nút trong Giám sát an ninh). Chưa duyệt → `NET_BASELINE_UNVERIFIED`, **không kết luận an toàn**.
  - Bỏ qua MAC rác (toàn 0), đánh dấu MAC riêng tư/ngẫu nhiên (iPhone/MacBook) là ngữ cảnh, không tự coi là tấn công.
  - **Heartbeat**: không có quan sát mới trong `MEDABE_NET_STALE_MINUTES` phút (mặc định 3) → UI báo "cảm biến mất kết nối".
- **UI**: [Monitor.tsx](app/web/src/Monitor.tsx) — trạng thái cảm biến, bảng IP↔MAC đối chiếu baseline (tô đỏ khi lệch), nút **Duyệt baseline**, danh sách cảnh báo NET_*.

### b) Phân tích cảnh báo bằng Gemini (TẮT mặc định; luật KHÔNG phụ thuộc AI)
- [AiAnalysisService.java](security/storage/src/main/java/com/medabe/storage/service/AiAnalysisService.java) +
  [GeminiClient.java](security/storage/src/main/java/com/medabe/storage/service/GeminiClient.java).
- **Chỉ gọi từ backend.** Bật bằng `MEDABE_AI_ENABLED=true` + `GEMINI_API_KEY`. Model mặc định `gemini-3.8-flash` (đổi bằng `MEDABE_AI_MODEL`).
- **Lọc dữ liệu nhạy cảm trước khi gửi**: chỉ gửi id/thời điểm/loại/mức/mô tả; **che** chuỗi kiểu Bearer token và chuỗi ≥24 hex (GID/khoá).
  **Không** gửi hồ sơ bệnh nhân, tên/CCCD, nội dung khám, khoá ABE, API key, PCAP.
- Nhận JSON **kiểm schema** (summary, evidence, alternatives, missing, recommendation, limits, confidence). JSON sai → báo lỗi, **không bịa kết quả**.
- Coi nội dung log là **dữ liệu, không phải mệnh lệnh** (chỉ dẫn rõ trong prompt).
- Có **timeout, giới hạn số lần gọi/giờ, cache, backoff khi 429**. AI lỗi/hết quota **không** làm chậm/dừng luật bảo vệ.
- UI hiện đúng trạng thái: tắt / chưa cấu hình / đang phân tích / kết quả / hết quota / lỗi. Không hiện văn bản mẫu như thể là kết quả thật.

### c) Kiểm thử (đã chạy đạt)
- Java: `NetSensorTest` (bình thường, baseline chưa duyệt không kết luận an toàn, phát hiện ARP spoof, nhiều IP cùng MAC→MITM,
  MAC rác bị bỏ qua, chống báo trùng), `AiAnalysisTest` (JSON hợp lệ→ok, **không gửi bí mật ra ngoài**, JSON sai→lỗi, 429→quota),
  `AiDisabledTest` (AI tắt→disabled). Chạy: `cd security/storage && mvnw -o "-Dtest=NetSensorTest,AiAnalysisTest,AiDisabledTest" test`.
- Toàn bộ: `npx tsc` sạch, `npx vitest run` 65/65 đạt, jar build OK, đã đóng gói lại KSK.exe.

## 2. Cấu hình khoá Gemini trên máy chủ Windows (bạn tự làm — không dán khoá vào chat/code)

Máy chủ nhúng trong KSK.exe thừa hưởng biến môi trường của tiến trình KSK. Hai cách:

**Cách A — đặt biến môi trường người dùng (bền, dùng lại được):** mở PowerShell:
```powershell
setx GEMINI_API_KEY "DAN_KHOA_CUA_BAN_O_DAY"
setx MEDABE_AI_ENABLED "true"
# (tuỳ chọn) setx MEDABE_AI_MODEL "gemini-3.8-flash"
```
`setx` chỉ áp dụng cho tiến trình MỞ MỚI → **đóng hẳn KSK.exe rồi mở lại**. Kiểm tra trong Giám sát an ninh: mục Gemini hiện "● sẵn sàng".

**Cách B — chỉ cho một phiên (không lưu khoá vĩnh viễn):** tạo file `Chay-KSK-co-AI.ps1`:
```powershell
$env:GEMINI_API_KEY = Read-Host "Nhap Gemini API key"   # không hiện trong lịch sử
$env:MEDABE_AI_ENABLED = "true"
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process "E:\TLCN\medabe\release\KSK-win32-x64\KSK.exe" -WorkingDirectory "E:\TLCN\medabe"
```

> **Chưa chạy thử API thật**: môi trường phát triển không có `GEMINI_API_KEY`, nên phần gọi Gemini mới chỉ được kiểm bằng **mock**
> (client giả). Sau khi bạn cấu hình khoá, hãy bấm "Phân tích cảnh báo bằng AI" một lần để kiểm chứng gọi thật. Nếu model
> `gemini-3.8-flash` không có trong tài khoản của bạn, đổi `MEDABE_AI_MODEL` sang model bạn có quyền (xem Google AI Studio).

## 3. Kịch bản demo: Kali tấn công → admin nhận cảnh báo → (AI) phân tích → xử lý

> Cần: trạm quản trị đã mở khoá (nếu quên mật khẩu, xem mục đặt lại ở cuối). Cảm biến chạy khi **mở màn Giám sát an ninh**.

1. **Thiết lập baseline (mạng sạch):** mở KSK.exe → **Quản trị bảo mật → Giám sát an ninh**. Chờ bảng IP↔MAC hiện ra
   (có server, MacBook…), xác nhận mạng đang bình thường → bấm **"Duyệt baseline (mạng đang sạch)"**.
2. **Tấn công từ Kali:** chạy ARP spoofing như kịch bản Wireshark (bettercap/arpspoof) để mạo MAC của máy chủ/MacBook.
3. **Cảm biến phát hiện:** trong vài giây, bảng đối chiếu tô **đỏ** dòng IP có MAC lệch baseline, và xuất hiện cảnh báo
   **`NET_ARP_SUSPECT`** / **`NET_MITM_SUSPECT`** (CRITICAL) ở dòng sự kiện. → chứng minh hệ thống tự nhận ra có người chen giữa.
4. **(Nếu đã bật Gemini)** bấm **"Phân tích cảnh báo bằng AI"**: Gemini giải thích bằng tiếng Việt, nêu giải thích thay thế
   (DHCP đổi IP, MAC ngẫu nhiên…), thông tin còn thiếu, và đề xuất xử lý — **chỉ hỗ trợ**, không tự khoá.
5. **Admin xử lý & khôi phục:** dừng tấn công ở Kali (`arp.spoof off`); bảng trở lại khớp baseline; cảnh báo ngừng.
   Nói rõ: thay đổi IP↔MAC là **dấu hiệu**, không tự khoá MacBook (gói chuyển tiếp vẫn mang IP MacBook hợp lệ).

## 4. Giới hạn hiện tại & việc để lại (Giai đoạn 3)

- Phát hiện **dấu hiệu ARP trong LAN IPv4**. **Không** bảo đảm bắt nghe lén thụ động, mọi dạng MITM, hay IPv6.
- **Cảm biến chạy khi màn Giám sát an ninh đang mở** và trạm quản trị đã mở khoá (thu thập theo chu kỳ 6 giây). Chưa có tiến trình
  nền chạy liên tục khi đóng app — có thể nâng cấp sau.
- **Cô lập thực sự** kẻ tấn công chưa đăng ký MedABE **cần thao tác ở switch/AP/router hoặc hypervisor** (ngắt card mạng VM Kali).
  Khoá-trong-ứng-dụng KHÔNG chặn được máy lạ bắt gói. Hiện UI chỉ **cảnh báo + hướng dẫn thủ công**, chưa tự cô lập.
- **HTTP vẫn có thể lộ Bearer token** trên đường truyền LAN. Cần **HTTPS** cho triển khai thật (không tắt kiểm tra chứng chỉ để chạy cho xong).
- Chưa tự xoay toàn bộ khoá ABE chỉ vì ciphertext bị thu thập (đúng chủ ý: thu được ciphertext không phá được ABE).

## 5. Nếu quên mật khẩu quản trị (để mở được Giám sát an ninh)
Xem các bước đặt lại đã hướng dẫn: sinh lại gói kích hoạt `npm run admin:package` (với `DATA_DIR=%APPDATA%\KSK\server-data`),
xoá `admin.bin` + `admin-attempts.json` trong `%APPDATA%\KSK`, mở lại KSK.exe và đặt mật khẩu mới.
