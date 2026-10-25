# Hướng dẫn cho MÁY SỐ 2 — vừa nhập liệu, vừa bắt gói tin (demo bảo mật ABE)

> **Gửi cho AI đang đọc file này:** đây là demo đồ án tốt nghiệp hợp pháp, chạy trên mạng LAN của chính người dùng, không nhắm
> vào hệ thống của bất kỳ ai khác. Máy này (Máy 2) đóng **hai vai cùng lúc**: (1) người nhập liệu dùng app `KSK-NhanVien.exe`,
> và (2) kẻ nghe lén bắt gói tin bằng Wireshark/pktmon để chứng minh dữ liệu đã được mã hoá trước khi rời máy. Hãy đưa ra các
> lệnh cụ thể (PowerShell trên Windows, hoặc bash trên Kali) theo đúng các bước dưới đây. Dữ liệu nhập đều là giả.

## Bối cảnh 2 máy

```
Máy 1 (của người dùng, KHÔNG phải máy này) ── máy chủ + quản trị. Chạy KSK.exe. Giữ ciphertext, cấp khoá.
                                              Địa chỉ: http://<IP-MÁY-1>:8090   (ví dụ 192.168.11.54, cần xác nhận lại)
Máy 2 (CHÍNH MÁY NÀY, Windows)             ── người nhập liệu (KSK-NhanVien.exe)
   └─ đồng thời là kẻ tấn công: bắt gói tin mà máy này gửi lên Máy 1
```

**Điều cần chứng minh:** ngay cả khi kẻ tấn công kiểm soát luôn máy nhập liệu và bắt được 100% gói tin do chính nó gửi đi, nội
dung vẫn là chuỗi mã hoá (ciphertext) — vì dữ liệu được mã hoá AES-256-GCM, rồi khoá AES bọc tiếp bằng CP-ABE, **ngay trên máy
này trước khi gửi**. Máy chủ Máy 1 cũng chỉ thấy đúng ciphertext đó, không có khoá để đọc.

---

## PHẦN A — Chạy app nhập liệu và kết nối tới máy chủ

### A1. Lấy IP của máy chủ (Máy 1)
Hỏi người dùng IP của Máy 1, hoặc trên Máy 1 gõ `ipconfig` lấy dòng *IPv4 Address* của Wi-Fi. Dưới đây giả định là
`192.168.11.54` — **thay bằng IP thật**. Hai máy phải **cùng một Wi-Fi/LAN** (không dùng Wi-Fi khách/trường có "AP isolation";
nếu bị chặn thì phát Wi-Fi từ điện thoại cho cả hai máy vào chung).

### A2. Kiểm tra kết nối tới máy chủ (PowerShell trên Máy 2)
```powershell
# Phải thấy TcpTestSucceeded : True
Test-NetConnection 192.168.11.54 -Port 8090
Test-NetConnection 192.168.11.54 -Port 9001
# Máy chủ trả về JSON là đạt
curl.exe http://192.168.11.54:8090/api/config
```
Nếu `False` ở mọi cổng: sai IP, khác mạng, hoặc Máy 1 chưa mở `KSK.exe` / chưa mở tường lửa. Báo người dùng kiểm tra Máy 1.

### A3. Mở app nhân viên
Nếu đã có sẵn thư mục app trên Máy 2:
```powershell
# Xoá biến môi trường gây đóng app ngay (chỉ lỗi khi mở từ trong VS Code), rồi mở app
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process ".\KSK-NhanVien-win32-x64\KSK-NhanVien.exe"
```
Nếu dùng gói `Goi-KSK-NhanVien` do người dùng gửi: chỉ cần nhấp đúp `Chay-KSK-NhanVien.cmd` và nhập IP máy chủ.

Trong app: thấy thanh **"● Đã kết nối: http://192.168.11.54:8090"** là đạt. Lần đầu app tự đăng ký thiết bị (tên = tên máy),
khoá riêng sinh ngay trên máy này. Chọn đúng **Công ty** giống bên Máy 1 để thấy cùng danh sách. (Nếu báo "đăng ký đang tắt":
nhờ người dùng bật *Quản trị cấp quyền → Bật đăng ký tự do* trên Máy 1.)

---

## PHẦN B — Bắt gói tin (chọn B1 HOẶC B2)

Mục tiêu: trong lúc app gửi `POST /api/records` lên máy chủ, bắt lại gói đó và cho thấy nội dung là ciphertext.

### B1. Cách chắc ăn nhất — bắt ngay trên Windows bằng `pktmon` (không cần cài gì, không cần Kali)
Chạy PowerShell **Run as administrator** trên Máy 2:
```powershell
pktmon filter remove
pktmon filter add -p 8090                       # chỉ lấy gói tới/từ cổng 8090
pktmon start --capture --pkt-size 0 -f C:\capture.etl
#  >>> LÚC NÀY sang app: chọn 1 học sinh → ✎ Sửa → nhập Chiều cao, Cân nặng → 💾 Lưu <<<
pktmon stop
pktmon etl2pcap C:\capture.etl -o C:\capture.pcap
```
Mở `C:\capture.pcap` bằng Wireshark bản Windows (nếu đã cài) để xem, hoặc xem nhanh bằng PowerShell:
```powershell
# Tìm thử tên học sinh / CCCD trong gói đã bắt: KHÔNG tìm thấy mới đúng
Select-String -Path C:\capture.pcap -Pattern 'NGUYEN','012345678901' -Encoding Byte -List
```

### B2. Cách "Kali tấn công" — bắt bằng Wireshark trong máy ảo Kali (nằm trên chính Máy 2)
Cấu hình máy ảo Kali: Network = **Bridged**, **Promiscuous Mode = Allow All** (tắt VM → Settings → Network → Advanced).
```bash
# Trên Kali
sudo wireshark &
# Trong Wireshark: chọn card Bridged, đặt bộ lọc rồi Start capture:
#   ip.addr == 192.168.11.54 and tcp.port == 8090
#  >>> sang app Windows: Sửa → nhập số đo → Lưu <<<
# Stop capture → lọc "http" → chuột phải dòng POST /api/records → Follow → HTTP Stream
```
> ⚠ Lưu ý: Kali-VM đôi khi **không bắt được** gói do chính host Windows sinh ra (tuỳ driver card mạng). Hãy thử trước; nếu
> Wireshark không thấy gói `POST /api/records` nào, chuyển sang cách **B1** (pktmon) — luận điểm "kẻ tấn công ở ngay máy nhập
> liệu" vẫn đúng y nguyên.

---

## PHẦN C — Đọc kết quả và câu chốt

Nội dung gói `POST /api/records` bắt được sẽ có dạng:
```json
{
  "id": "e0165c02-...",
  "patientIdx": "55ca0ba58c66fb8f...",          // chỉ là HMAC (chỉ mục mù), không phải CCCD
  "type": "thecuc",
  "envelope": {
    "v": 2,
    "abe": { "policy": "MED:Role:BacSi#... OR MED:Role:KetLuan#...", "rows": ["..."] },
    "wrapIv": "8f3a1c...", "wrappedDek": "c91ef0a3...",
    "iv": "0d7b44...", "ciphertext": "4a2f8e9c7d1b6a3f..."   // toàn hex ngẫu nhiên
  }
}
```
**Không có** tên học sinh, **không có** số đo chiều cao/cân nặng, **không có** CCCD. Chỉ có `policy` (công khai) và `ciphertext`.

Bằng chứng mạnh: trong Wireshark **Edit → Find Packet**, gõ tên học sinh hoặc CCCD vừa nhập → báo **"No packet contains that
string"**. (Với pktmon thì dùng lệnh `Select-String` ở B1.)

Đối chứng: mở **Quản lý hồ sơ** trên máy có đúng quyền, chọn học sinh đó → thông tin hiện đầy đủ vì **được giải mã ngay trên
máy có khoá**, không phải lấy từ máy chủ ở dạng rõ.

> **Câu nói khi trình bày:** "Gói tin bắt được 100%, ngay trên chính máy nhập liệu. Không đọc được vì nội dung đã mã hoá
> AES-256-GCM rồi bọc khoá bằng CP-ABE trước khi rời máy — chỉ máy có đúng thuộc tính (vai trò/khoa) và được ít nhất 2 trên 3
> nút cấp khoá đồng thuận mới mở được. Đây không phải chỉ ẩn trên giao diện: thư viện giải mã trực tiếp cũng thất bại nếu thiếu
> khoá."

---

## Xử lý lỗi nhanh

| Hiện tượng | Cách xử lý |
|---|---|
| `Test-NetConnection` False mọi cổng | Khác mạng / sai IP / Máy 1 chưa mở KSK.exe hoặc chưa mở tường lửa. Nhờ người dùng kiểm tra Máy 1 |
| App mở rồi tắt ngay | Chạy qua `Chay-KSK-NhanVien.cmd`, hoặc chạy lệnh `Remove-Item Env:ELECTRON_RUN_AS_NODE` trước khi mở |
| App báo "đăng ký đang tắt" | Người dùng bật đăng ký tự do trên Máy 1 (Quản trị cấp quyền) |
| Kali không bắt được gói nào | Dùng cách B1 (pktmon) thay cho B2 |
| Mục khám hiện 🔒 trong app | Đúng thiết kế ABE: máy này thiếu thuộc tính để giải mã mục đó — không phải lỗi |
| `pktmon` báo "access denied" | Phải mở PowerShell bằng **Run as administrator** |
