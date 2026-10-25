# Kịch bản demo: Kali bắt gói tin lúc nhân viên nhập liệu, chứng minh dữ liệu đã mã hoá ABE

Mục đích: cho giáo viên thấy **gói tin thật, bắt được 100% trên dây**, nhưng không đọc được nội dung — vì dữ liệu đã được mã hoá
bằng AES-256-GCM ngay trên máy nhân viên, và khoá AES đó lại được bọc bằng CP-ABE. Đây là demo giáo dục/bảo vệ đồ án, chạy trên
mạng của chính bạn — không nhắm vào máy/mạng của người khác.

## Sơ đồ

```
Máy Windows (bạn) ── KSK.exe (máy chủ) + KSK-NhanVien.exe (máy nhân viên), hoặc MacBook đóng vai nhân viên
Máy ảo Kali       ── cùng mạng Bridged, Promiscuous Mode = Allow All
```

## Hai cách dựng — chọn một

**Cách A — 3 vai, 2 (hoặc 3) máy riêng** (phần còn lại của tài liệu này mô tả cách A):
máy chủ, máy nhân viên, và Kali là ba máy/VM khác nhau. Kali phải dò IP máy nhân viên rồi bắt gói.

**Cách B — máy nhập liệu CŨNG là máy tấn công** (chỉ cần 2 máy): xem mục **"Biến thể 2 máy"** ở cuối tài liệu.
Kẻ tấn công kiểm soát luôn máy nhập liệu mà vẫn chỉ thấy ciphertext — mối đe doạ nặng hơn, lập luận càng chắc.

## Chuẩn bị (làm trước, không làm live)

1. **Bật Promiscuous Mode cho Kali** (nếu chưa làm): tắt máy ảo → Settings → Network → Adapter 1 → Bridged → Advanced →
   **Promiscuous Mode: Allow All**. Bật lại Kali. Đây là tính năng có sẵn của phần mềm ảo hoá, không phải kỹ thuật tấn công —
   dùng để Kali "nghe" được gói tin đến đúng card mạng vật lý mà nó đang bám vào.
2. Trên máy nhân viên, mở `KSK-NhanVien.exe`, kết nối vào đúng máy chủ (xem thanh "● Đã kết nối: http://..."). **Chưa nhập gì vội.**
3. Chuẩn bị sẵn một học sinh demo (dữ liệu giả) để lát nữa sửa/lưu.

## Bước 1 — Dò địa chỉ IP máy nhân viên bằng Kali

Mở Terminal trên Kali, xem IP của chính Kali và dải mạng:
```bash
ip a
```
Quét toàn bộ thiết bị đang sống trong mạng (chỉ gửi ping, không khai thác gì):
```bash
sudo nmap -sn 192.168.1.0/24          # đổi đúng dải mạng của bạn
```
Hoặc:
```bash
sudo arp-scan --localnet
```
So khớp với IP hiện trên thanh kết nối của app để xác định đúng máy nhân viên.

**Xác định đúng cổng cần bắt** (app nói chuyện với máy chủ ở các cổng sau):
```bash
sudo nmap -p 8090,8095,9001-9003 <IP-máy-chủ>
```
| Cổng | Dùng cho |
|---|---|
| 8090 | Kho dữ liệu (Spring) — lưu/đọc hồ sơ |
| 8095 | Cổng liên thông Bộ Y tế (mô phỏng) |
| 9001–9003 | 3 nút cấp khoá (Bệnh viện / Sở Y tế / Điện thoại) |

## Bước 2 — Bắt đầu bắt gói tin

Mở Wireshark trên Kali:
```bash
sudo wireshark
```
Chọn đúng card mạng (Bridged), lọc theo IP máy nhân viên cho đỡ nhiễu:
```
ip.addr == <IP-máy-nhân-viên> and tcp.port == 8090
```
Bấm **Start capture** (nút cá mập xanh).

## Bước 3 — Trên máy nhân viên: nhập liệu thật

Trong lúc Wireshark đang chạy:
1. Chọn một học sinh trong danh sách, bấm **✎ Sửa**.
2. Nhập Chiều cao, Cân nặng (mục Khám thể lực), hoặc bất kỳ mục nào khác.
3. Bấm **💾 Lưu**.

Gói tin `POST /api/records` (và `POST /byt/submit` nếu có tự động liên thông) sẽ đi qua dây đúng lúc này.

## Bước 4 — Dừng bắt, xem nội dung đã mã hoá

Trong Wireshark: **Stop capture**.

1. Lọc tiếp: `http`
2. Click vào dòng `POST /api/records`.
3. Chuột phải → **Follow → HTTP Stream**.

Nội dung JSON gửi lên sẽ có dạng:
```json
{
  "id": "e0165c02-6739-41bf-a7f8-57d4518f5b2d",
  "patientIdx": "55ca0ba58c66fb8f66342037ff79b327",
  "type": "thecuc",
  "envelope": {
    "v": 2,
    "abe": { "policy": "MED:Role:BacSi#2026W42.0 OR MED:Role:KetLuan#2026W42.0 OR ...", "rows": [ "..." ] },
    "wrapIv": "8f3a1c...",
    "wrappedDek": "c91ef0a3...",
    "iv": "0d7b44...",
    "ciphertext": "4a2f8e9c7d1b6a3f..."
  }
}
```
**Không có tên học sinh, không có số đo chiều cao/cân nặng, không có CCCD** — `patientIdx` chỉ là HMAC (chỉ mục mù), còn
`ciphertext` toàn chuỗi hex ngẫu nhiên.

**Chứng minh thêm (rất thuyết phục):** Edit → Find Packet, gõ tên học sinh vừa nhập hoặc số CCCD → Wireshark báo
**"No packet contains that string"** trên toàn bộ dữ liệu đã bắt được.

## Bước 5 — Đối chứng: cùng dữ liệu đó, máy có đủ quyền đọc được

Mở màn **Quản lý hồ sơ** (hoặc **Cổng Bộ Y tế** nếu đã liên thông) trên máy nhân viên/máy có vai trò phù hợp — chọn đúng học
sinh vừa nhập, khung bên trái hiện đầy đủ thông tin **đã giải mã trên máy đó**.

## Câu nói khi trình bày

> "Gói tin thật, bắt được 100% trên dây bằng Wireshark. Không đọc được vì nội dung đã mã hoá bằng AES-256-GCM ngay trên máy
> nhân viên trước khi gửi đi, và khoá AES đó lại được bọc tiếp bằng CP-ABE — chỉ máy có đúng thuộc tính (vai trò/khoa) và được
> ít nhất 2 trên 3 nút cấp khoá đồng thuận mới mở được. Đây không phải chỉ ẩn trên giao diện — thư viện giải mã trực tiếp cũng
> thất bại nếu thiếu khoá, có bộ test tự động chứng minh điều này (`npx vitest run security/src/abe/rw15.test.ts`)."

## Câu hỏi thường gặp khi bảo vệ

**"HTTPS đâu?"** — Hệ thống chạy HTTP thuần trong LAN demo, nên Wireshark bắt được *request* dễ dàng; nhưng *nội dung bên
trong* vẫn an toàn vì được mã hoá ở **tầng ứng dụng** (ABE), độc lập với tầng vận chuyển (TLS). TLS chỉ chống nghe lén đường
truyền (và không chống được chính máy chủ đọc dữ liệu); ABE chống cả việc máy chủ tự đọc được nội dung. Thêm TLS là hướng phát
triển tiếp theo, không phải lỗ hổng của thiết kế ABE.

**"Dò IP bằng nmap có phải hack không?"** — Không, đây là trinh sát mạng (network reconnaissance) cơ bản, hợp lệ trong phạm vi
mạng của chính mình để phục vụ demo/kiểm thử bảo mật — không dùng để tấn công hệ thống của người khác.

**"Vậy máy chủ có thấy gì không?"** — Máy chủ (Spring) cũng chỉ thấy đúng những gì Kali vừa thấy: ciphertext + chỉ mục băm,
không có khoá nào để giải mã. Có thể mở `security/storage` để chỉ cho giáo viên thấy máy chủ không hề lưu plaintext ở đâu cả.

---

# Biến thể 2 máy: máy nhập liệu CŨNG là máy tấn công

Dùng khi bạn chỉ có 2 máy: **Máy 1 = máy chủ/quản trị** (KSK.exe), **Máy 2 = Windows chạy app nhân viên + Kali trong máy ảo**.

```
Máy 1 (Windows)      ── KSK.exe = máy chủ + quản trị (cổng 8090/8095/9001-9003)
Máy 2 (Windows)      ── KSK-NhanVien.exe = người nhập liệu
   └─ Kali (VMware)  ── Bridged + Promiscuous = kẻ nghe lén, NẰM NGAY TRONG máy nhập liệu
```

**Luận điểm (mạnh hơn kịch bản 3 máy):** kẻ tấn công kiểm soát luôn chính máy tạo ra dữ liệu và bắt được 100% gói tin do nó
gửi đi, nhưng nội dung vẫn là ciphertext — vì đã mã hoá AES-256-GCM + CP-ABE **trước khi** rời khỏi tầng ứng dụng.

## Khác gì so với kịch bản 3 máy ở trên

| Bước gốc | Biến thể 2 máy |
|---|---|
| Bước 1 — nmap/arp-scan dò IP máy nhân viên | **Bỏ hẳn.** Kali bắt gói của chính máy mình, không cần dò ai. Chỉ cần biết IP **Máy 1** (xem thanh "● Đã kết nối" trên app) |
| Bước 2 — lọc theo IP máy nhân viên | Lọc theo **IP Máy 1**: `ip.addr == <IP-Máy-1> and tcp.port == 8090` |
| Câu chốt "bắt được trên dây" | "Kẻ tấn công **kiểm soát luôn máy nhập liệu** mà vẫn chỉ thấy ciphertext" |

Các bước còn lại GIỮ NGUYÊN: Promiscuous/Bridged cho Kali → nhập Chiều cao/Cân nặng rồi Lưu → Follow HTTP Stream thấy
`ciphertext`/`policy`/`patientIdx` → Find Packet gõ tên học sinh ra "No packet contains that string" → đối chứng máy có quyền
đọc được.

## ⚠ Kiểm tra TRƯỚC khi demo (quan trọng)

Windows của Máy 2 và Kali-VM dùng chung một card mạng vật lý. Tuỳ driver card mạng, Promiscuous Mode của VMware đôi khi
**không bắt được** traffic do chính host Windows sinh ra. Hãy thử trước ở nhà: nhập 1 hồ sơ, xem Wireshark trên Kali có thấy
gói `POST /api/records` không.

Nếu KHÔNG thấy gói nào, chọn một trong hai cách chắc ăn:

1. **Bắt gói ngay trên Windows Máy 2** (đơn giản nhất, không dính giới hạn VM):
   - Cài **Wireshark bản Windows**, chọn card Wi-Fi/Ethernet, lọc `ip.addr == <IP-Máy-1> and tcp.port == 8090`. Luận điểm
     "attacker ở ngay máy nhập liệu" vẫn đúng y nguyên — chỉ là công cụ chạy trên Windows thay vì Kali.
   - Hoặc không cài gì: dùng `pktmon` có sẵn trong Windows:
     ```powershell
     pktmon filter remove
     pktmon filter add -p 8090
     pktmon start --capture --pkt-size 0 -f capture.etl
     # ... nhập liệu rồi Lưu trên app ...
     pktmon stop
     pktmon etl2pcap capture.etl -o capture.pcap    # mở capture.pcap bằng Wireshark
     ```
2. **Dùng Máy 3 chạy Kali riêng** nếu muốn giữ đúng hình ảnh "Kali là máy tấn công độc lập" — khi đó quay lại kịch bản 3 máy
   ở đầu tài liệu (có nmap dò IP).

## Nếu muốn kịch bản "kẻ thứ ba đứng giữa" (MITM / ARP spoofing)

Kỹ thuật ARP spoofing (`ettercap`, `arpspoof`) chỉ có ý nghĩa khi kẻ tấn công là **máy khác** chen vào giữa máy nhân viên và
máy chủ. Khi Kali trùng với máy nhập liệu thì không dựng được (nạn nhân và kẻ tấn công là một). Muốn demo kiểu này cần **Máy 3**
riêng. Dù vậy, kết quả cũng không khác: ABE vẫn khiến nội dung chen giữa đọc được là ciphertext.
