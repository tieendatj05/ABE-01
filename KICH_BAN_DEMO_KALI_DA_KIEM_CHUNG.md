# Kịch bản demo Kali – MacBook – server MedABE

Cập nhật: 22/10/2026. Dùng cho mạng lab và các thiết bị của người trình bày.

**Cách dùng:** chuẩn bị theo mục 3–4 trước buổi demo; khi trình bày chạy lần lượt mục 5–10. Mục 8 là bước dừng/khôi phục mạng; mục 11 dùng khi có lỗi.

## 1. Kết quả đã làm được

- Kali đã bắt được lưu lượng thực giữa MacBook `192.168.1.15` và server `192.168.1.39`.
- File đã xem trong Wireshark: `medabe-demo.pcap`.
- Follow TCP Stream đã hiển thị phản hồi **HTTP 200** chứa danh sách hồ sơ với `envelope.v = 3`, `headerId`, `iv`, `ciphertext`.
- Đây là bằng chứng quan sát được bản mã hồ sơ trên đường truyền. Ảnh đã xác nhận **phản hồi tải hồ sơ**; chưa xác nhận riêng request POST lưu hồ sơ mới.
- Avahi Discover đã được sửa lỗi Python/GDBM và mở được giao diện tìm MacBook.

Không dùng riêng ảnh ciphertext để kết luận toàn bộ hệ thống an toàn hoặc cơ chế ABE đã được kiểm chứng đầy đủ. Cần thêm đối chứng giải mã đúng/sai quyền.

## 2. Máy nào làm gì?

| Máy | Vai trò | Thông tin trong lần demo thành công |
|---|---|---|
| Windows | Chạy server và app quản trị `KSK.exe`; cũng là máy chạy VMware | IP `192.168.1.39` |
| MacBook | Chạy app nhân viên, lưu/đọc hồ sơ giả | IP `192.168.1.15`; tên Bonjour “MacBook Air của Nguyễn (3)” |
| Kali trong VMware | Dò thiết bị, ARP spoofing và bắt gói | IP `192.168.1.83`; card `eth0` |

ARP spoofing nhằm chuyển lưu lượng của **cặp MacBook–server** qua Kali. Kali bật chuyển tiếp để app tiếp tục trao đổi với server.

Các IP trên là kết quả của phiên này, **không cố định**. Khi đổi Wi-Fi hoặc khởi động lại, phải kiểm tra lại IP/card mạng, rồi thay trong mọi lệnh tương ứng.

## 3. Có cần cài thêm gì không?

**Hiện tại không cần cài thêm để lặp lại demo đã chạy thành công.** Bộ công cụ đã đủ:

| Công cụ trên Kali | Công dụng |
|---|---|
| `nmap` | Dò thiết bị và tìm máy mở cổng MedABE |
| `arp-scan` | Xem IP/MAC của các thiết bị trong LAN |
| `avahi-browse`, `avahi-discover` | Tìm tên/dịch vụ Bonjour và IP MacBook; bản sau có giao diện |
| `arpspoof` thuộc gói `dsniff` | Chuyển hướng lưu lượng của hai máy demo |
| `tcpdump` | Ghi gói vào file PCAP |
| Wireshark | Xem HTTP stream và ciphertext |
| `python3.13-gdbm` | Thành phần đã bổ sung để Avahi Discover chạy với Python 3.13 hiện tại |

### KALI — kiểm tra trước buổi demo

```bash
command -v nmap arp-scan avahi-browse avahi-discover arpspoof tcpdump wireshark
```

Mỗi công cụ phải hiện một đường dẫn. Kiểm tra thành phần đã sửa:

```bash
python3 -c "import dbm.gnu; import avahi.ServiceTypeDatabase; avahi.ServiceTypeDatabase.ServiceTypeDatabase(); print('AVAHI_OK')"
```

Nếu máy Kali mới thiếu công cụ, cài **trước buổi demo**:

```bash
sudo apt install -y nmap arp-scan avahi-utils avahi-discover dsniff tcpdump wireshark
```

Không cần cài thêm Ettercap/Bettercap để thực hiện kịch bản này.

## 4. Chuẩn bị trước khi lên trình bày

### SERVER WINDOWS — thao tác giao diện

1. Mở `KSK.exe`, giữ ứng dụng chạy.
2. Kiểm tra MacBook đã kết nối được vào server.
3. Chuẩn bị tài khoản đủ quyền và hồ sơ giả để đối chứng.

Không phải chạy lệnh PowerShell trong luồng demo bình thường.

### MACBOOK — thao tác giao diện

1. Mở app nhân viên đã dùng trong lần demo thành công.
2. Kết nối đúng server. Với mạng hiện tại, IP server là `192.168.1.39`.
3. Chọn một hồ sơ **dữ liệu giả**, ghi nhớ mục khám sẽ sửa và giá trị sẽ nhập.
4. Giữ MacBook thức; chưa bấm Lưu.

Không phải chạy lệnh Terminal trên MacBook trong luồng demo này.

### KALI / VMWARE — chuẩn bị mạng

- Máy ảo dùng **Bridged**, nối qua đúng card Wi-Fi/Ethernet của Windows đang dùng cho lab.
- Ba vai trò phải liên lạc được trong cùng LAN; mạng cách ly thiết bị có thể ngăn demo.
- Promiscuous đơn thuần không bảo đảm nhìn thấy lưu lượng giữa hai máy khác; kịch bản này dùng ARP spoofing giới hạn đúng cặp IP.
- Mở hai Terminal trên Kali. Gọi là **Terminal 1: ARP spoofing** và **Terminal 2: bắt gói**.

## 5. Trình diễn từ đầu: dò IP

### KALI — Terminal 1: xem IP và dải mạng

```bash
ip -br addr
```

```bash
ip route
```

Trong phiên đã chạy: card `eth0`, IP `192.168.1.83/24`, dải LAN `192.168.1.0/24`.

### KALI — Terminal 1: liệt kê thiết bị đang phản hồi

```bash
sudo nmap -sn -e eth0 192.168.1.0/24
```

Hoặc xem bảng IP/MAC bằng:

```bash
sudo arp-scan --interface=eth0 --localnet
```

Tên hãng Apple chỉ là dấu hiệu; có thể là MacBook, iPhone hoặc iPad. MAC riêng tư có thể làm hãng hiện Unknown.

### KALI — Terminal 1: tìm server MedABE

```bash
sudo nmap -sT --open -p 8090,8095,9001-9003 192.168.1.0/24
```

Trong phiên đã chạy, máy `192.168.1.39` mở đủ các cổng này:

| Cổng | Dịch vụ của dự án |
|---|---|
| 8090 | Kho hồ sơ Spring Boot; cổng bắt gói chính |
| 8095 | Liên thông Bộ Y tế mô phỏng |
| 9001–9003 | Các nút cấp khóa |

`--open` chỉ hiển thị máy có cổng tương ứng mở. MacBook chạy app nhân viên không cần mở các cổng này nên có thể không xuất hiện trong kết quả này. Tên dịch vụ do Nmap gán theo số cổng không chứng minh ứng dụng thực sự chạy trên cổng đó.

### KALI — Terminal 1: tìm MacBook qua giao diện

```bash
avahi-discover &
```

Mở nhánh **eth0 IPv4 → local**, chọn dịch vụ mang tên MacBook và xem thông tin địa chỉ. Trong lần thành công: “MacBook Air của Nguyễn (3)” có IP **192.168.1.15**. Mạng cũng có các MacBook khác, cần chọn đúng thiết bị demo.

Nếu muốn trình bày bằng dòng lệnh:

```bash
avahi-browse --all --resolve --terminate
```

Bonjour phụ thuộc thiết bị có quảng bá dịch vụ và mạng cho phép khám phá; không phải công cụ xác minh danh tính tuyệt đối.

## 6. Bắt gói và chuyển hướng lưu lượng

Các lệnh dưới dùng cặp IP đã tìm được: **MacBook .15, server .39**, card **eth0**. Chỉ tiếp tục khi IP thực tế khớp, hoặc đã thay đúng địa chỉ trong lệnh.

### KALI — Terminal 2: bắt đầu ghi PCAP trước

```bash
sudo tcpdump -i eth0 -nn -s 0 -U -w /tmp/medabe-demo.pcap 'host 192.168.1.15 and host 192.168.1.39 and tcp port 8090'
```

Thấy `listening on eth0` là chương trình đang chờ gói. **Giữ Terminal này chạy.** Lệnh ghi vào file nên không in từng gói ra màn hình; số gói được báo khi dừng.

Nếu `/tmp/medabe-demo.pcap` đã chứa lần demo cần giữ, hãy đổi sang tên file mới trước khi chạy: lệnh trên có thể ghi đè file cũ. File trong `/tmp` cũng có thể mất sau khi khởi động lại.

Bộ lọc chỉ ghi TCP cổng 8090 giữa hai IP, không bao gồm cổng 8095 hoặc các máy khác.

### KALI — Terminal 1: lưu cấu hình ban đầu

Chạy **một lần trước khi bật chuyển tiếp**. Không chạy lại dòng sao lưu khi ARP spoofing đang diễn ra.

```bash
sysctl net.ipv4.ip_forward net.ipv4.conf.all.send_redirects net.ipv4.conf.eth0.send_redirects > "$HOME/medabe-network-before.conf"
```

### KALI — Terminal 1: bật chuyển tiếp và tắt redirect

```bash
sudo sysctl -w net.ipv4.ip_forward=1 net.ipv4.conf.all.send_redirects=0 net.ipv4.conf.eth0.send_redirects=0
```

Kết quả mong đợi: `ip_forward = 1`; hai giá trị `send_redirects = 0`. Chuyển tiếp giúp chuyển tiếp gói nhận được tới bên đích thay vì làm app mất liên lạc. Các thiết lập này có hiệu lực lúc chạy, không ghi vào cấu hình khởi động.

### KALI — Terminal 1: chạy ARP spoofing cho đúng hai máy

```bash
sudo arpspoof -i eth0 -t 192.168.1.15 -r 192.168.1.39
```

`-t` giới hạn mục tiêu, `-r` thực hiện hai chiều giữa mục tiêu và host. Giữ Terminal chạy. Các dòng `arp reply ... is-at ...` cho thấy công cụ đang gửi ARP giả; **chưa đủ khẳng định đã bắt được hồ sơ**.

Nếu công cụ báo không tìm được MAC, hoặc app mất kết nối, dừng theo mục 8 trước khi chẩn đoán tiếp. Không bỏ `-t` để mở rộng sang cả mạng.

## 7. MACBOOK — tạo lưu lượng hồ sơ thật

Trong lúc cả hai Terminal Kali đang chạy:

1. Mở hồ sơ giả đã chuẩn bị, bấm **Sửa**.
2. Nhập giá trị mới, ví dụ chiều cao/cân nặng.
3. Bấm **Lưu**, chờ app báo thành công.
4. Mở lại/tải lại đúng hồ sơ để tạo thêm lưu lượng đọc hồ sơ và chuẩn bị đối chứng.

Server Windows tiếp tục giữ app chạy. Không cần lệnh trên server hoặc MacBook.

## 8. KALI — kết thúc và khôi phục mạng

Thực hiện cả khi kết thúc bình thường lẫn khi app mất kết nối:

1. **Terminal 1:** nhấn **Ctrl+C** để dừng `arpspoof`. Chờ chương trình gửi ARP phục hồi và trả lại dấu nhắc. Thiết bị nhận phục hồi còn tùy mạng; không dùng `kill -9` trong luồng bình thường.
2. **Terminal 1:** hoàn nguyên các giá trị đã lưu:

   ```bash
   sudo sysctl -p "$HOME/medabe-network-before.conf"
   ```

3. **Terminal 2:** nhấn **Ctrl+C** để đóng file bắt gói.
4. Đọc số `packets captured`. Lớn hơn 0 chỉ xác nhận có gói khớp bộ lọc; còn phải kiểm tra nội dung HTTP để xác nhận hồ sơ.
5. Kiểm tra lại app MacBook còn kết nối server.

Không cần giả định `ip_forward` ban đầu là 0; file sao lưu dùng để phục hồi giá trị thực tế. Nếu mất file sao lưu, kiểm tra cấu hình trước khi tự đặt lại.

## 9. KALI — xem bằng chứng trong Wireshark

Đảm bảo tài khoản Kali hiện tại đọc được file vừa ghi bằng sudo:

```bash
sudo chown "$(id -u):$(id -g)" /tmp/medabe-demo.pcap
```

Sau đó mở Wireshark dưới tài khoản Kali bình thường:

```bash
wireshark /tmp/medabe-demo.pcap
```

### Tìm request lưu hồ sơ

Dán vào ô **Display filter của Wireshark**, không nhập vào Terminal:

```text
http.request.method == "POST" && tcp.port == 8090
```

Chọn request lưu hồ sơ có đường dẫn chứa `/api/records`, rồi **chuột phải → Follow → TCP Stream**. Kiểm tra phần body request, không chỉ header.

Nếu không có POST, chưa thể nói file đã bắt được thao tác Lưu; vẫn có thể kiểm tra phản hồi đọc hồ sơ như dưới đây, hoặc bắt lại khi lưu.

### Tìm phản hồi đọc hồ sơ — phần đã thấy trong lần thành công

```text
http.request.uri contains "/api/records"
```

Chọn request đọc hồ sơ → **Follow → TCP Stream**. Trong cửa sổ stream, tìm phần phản hồi **HTTP 200**, body có danh sách bản ghi, rồi dùng ô **Find** tìm:

```text
ciphertext
```

Không nhầm riêng `GET /api/records/version` với body hồ sơ: phản hồi kiểm tra phiên bản có thể chỉ chứa số lượng/mốc thời gian. Một TCP stream có thể chứa nhiều request và response trên cùng kết nối; cần xem đúng body chứa bản ghi.

Trong lần đã quan sát, body có dạng minh họa rút gọn:

```json
{
  "id": "record-demo",
  "patientIdx": "chi-muc-demo",
  "type": "hanhchinh",
  "khoa": "KSK",
  "envelope": {
    "v": 3,
    "headerId": "header-demo",
    "iv": "...",
    "ciphertext": "..."
  }
}
```

- `ciphertext`: bản mã nội dung hồ sơ.
- `iv`: tham số dùng trong mã hóa, không phải khóa giải mã.
- `headerId`: tham chiếu header chung chứa chính sách/thành phần ABE và khóa nội dung được bọc. Với v3, không bắt buộc thấy trực tiếp `abe`/`wrappedDek` bên trong từng envelope bản ghi.
- `type`, `khoa`, chỉ mục, ID, IP và một số metadata/header vẫn có thể đọc được.

Mã nguồn liên quan: [SharedEnvelope và KeyHeader](security/src/abe/rw15.ts), [lấy header và mở khóa nội dung](security/src/client/medclient.ts).

Trong file đã xem, stream là `3`. **Không dùng cố định `tcp.stream eq 3` cho lần bắt khác**; số stream thay đổi. Khi đổi cách lọc, thay toàn bộ bộ lọc cũ do Follow Stream tạo ra.

### Có TCP nhưng chưa thấy HTTP

Chọn gói cổng `8090` → **Analyze → Decode As… → chọn HTTP** → áp dụng bộ lọc lại. Nếu kết nối thực tế dùng HTTPS, body không hiển thị như HTTP thuần trong demo này.

### Giữ file bằng chứng

Trước khi bắt lần mới hoặc khởi động lại Kali, lưu bản PCAP vào thư mục cá nhân:

```bash
cp /tmp/medabe-demo.pcap "$HOME/medabe-demo-$(date +%Y%m%d-%H%M%S).pcap"
```

## 10. Đối chứng và lời trình bày

### MACBOOK / APP CÓ QUYỀN

Mở đúng hồ sơ trong PCAP bằng tài khoản đủ quyền, đối chiếu ID bản ghi hoặc học sinh/mục khám và giá trị giả đã nhập. Cho thấy nội dung hiển thị được sau giải mã.

Muốn chứng minh phân quyền ABE, chuẩn bị thêm trường hợp cùng hồ sơ nhưng khóa/thuộc tính không thỏa chính sách và kiểm tra giải mã thất bại. Chỉ ẩn nút trên giao diện chưa chứng minh thất bại mật mã. Có thể dùng bộ kiểm thử ABE hiện có làm bằng chứng bổ sung; chạy trước buổi bảo vệ, không cần cài thêm công cụ tấn công trên Kali.

### Câu nói khi trình bày

> “Tôi dò thiết bị trong mạng lab, xác định MacBook và server, rồi dùng Kali chuyển hướng và bắt lưu lượng giữa hai máy. Wireshark cho thấy hồ sơ trong phản hồi của server chứa ciphertext. App có khóa và thuộc tính phù hợp giải mã được nội dung để hiển thị. Phần đối chứng đúng/sai quyền dùng để kiểm tra cơ chế ABE.”

### Giới hạn cần nói đúng

- Demo chứng minh đã quan sát bản mã của hồ sơ trong lưu lượng đã bắt, không chứng minh không có rò rỉ ở mọi endpoint, CSDL hoặc bộ nhớ.
- HTTP thuần đã làm lộ header `Authorization: Bearer ...` trong ảnh trước. Che token khi chia sẻ ảnh/slide; coi PCAP là file chứa thông tin truy cập nhạy cảm. Bảo vệ nội dung bằng ABE không thay thế TLS cho token và metadata.
- Việc bắt gói không đồng nghĩa đã phá được AES/ABE hoặc lấy được khóa.
- Kali VM là vai trò mạng riêng để bắt/chuyển hướng gói; kết quả này không chứng minh an toàn nếu hệ điều hành máy nhân viên bị kiểm soát hoàn toàn.

## 11. Xử lý nhanh các lỗi đã gặp

| Hiện tượng | Cách xử lý |
|---|---|
| `Failed to resolve ""` hoặc tcpdump báo sai bộ lọc khi dùng `$SERVER` | Biến chưa được gán. Kịch bản này dùng IP cụ thể; nếu dùng biến phải gán giá trị trong đúng Terminal trước. |
| `^[[A`, `^[[B` trong cửa sổ tcpdump | Do bấm phím mũi tên khi chương trình đang chạy; không phải thông báo lỗi bắt gói. |
| Avahi Discover báo `db type is dbm.gnu` / thiếu `_gdbm` | Kiểm tra `python3 --version`. Máy hiện dùng 3.13 đã được sửa bằng `sudo apt install -y python3.13-gdbm`. Không áp dụng cứng tên gói này khi máy dùng Python khác. |
| Nmap chỉ hiện server, không thấy MacBook | Lệnh có `--open` và chỉ quét cổng server. Dùng quét host/ARP và Avahi để tìm MacBook. |
| `arpspoof` liên tục in ARP nhưng PCAP không có hồ sơ | Chưa đủ chứng minh chuyển hướng thành công. Dừng và hoàn nguyên; kiểm tra IP/card, endpoint app, bridge, cách ly LAN hoặc chặn ARP spoofing. |
| App MacBook mất kết nối sau khi chạy ARP spoofing | Thực hiện mục 8 ngay. Kiểm tra forwarding, đường mạng và firewall chuyển tiếp; không tự xóa toàn bộ luật firewall. |
| Chỉ thấy GET `/version` | Đó là kiểm tra thay đổi dữ liệu. Tìm body tải hồ sơ hoặc bắt lại lúc Lưu. |
| Python/Avahi đã chạy nhưng Windows không liên lạc được Kali | Đã từng gặp lỗi VMware Bridge; cách xử lý đã thành công ghi ở dưới. |

### SERVER WINDOWS — chỉ khi gặp lại lỗi VMware Bridge

Trong phiên sửa lỗi, Kali có IP và SSH đang lắng nghe nhưng Windows không phân giải được ARP tới Kali. Khởi động lại riêng VMware Bridge đã khôi phục kết nối.

Chỉ dùng khi triệu chứng phù hợp, trên **PowerShell mở bằng Run as administrator**:

```powershell
Restart-Service -Name VMnetBridge
```

Lệnh có thể ngắt mạng các VM dùng bridge trong chốc lát. Đây là bước xử lý sự cố, **không phải bước bắt buộc mỗi lần demo**. Sau đó kiểm tra lại IP và kết nối.

## 12. Kiểm tra trước buổi bảo vệ

- [ ] Server và app nhân viên chạy được, tài khoản đúng quyền.
- [ ] Có dữ liệu giả và đã biết giá trị sẽ nhập để đối chiếu.
- [ ] Dò lại đúng IP MacBook/server; đúng card Kali.
- [ ] Đã chạy thử trên chính mạng sẽ dùng để demo.
- [ ] Hai Terminal được phân biệt rõ; đã lưu sysctl ban đầu.
- [ ] Có file PCAP chứa body hồ sơ với ciphertext và biết cách mở stream tương ứng.
- [ ] Đã thử riêng thao tác Lưu nếu định khẳng định bắt được POST ghi hồ sơ.
- [ ] Có đối chứng giải mã đủ quyền/không đủ quyền nếu trình bày phân quyền ABE.
- [ ] Đã dừng ARP spoofing, khôi phục mạng, lưu PCAP ra khỏi `/tmp`.
- [ ] Ảnh/slide đã che token; giữ PCAP ở nơi phù hợp cho dữ liệu demo.

## Tài liệu công cụ

- [Nmap: host discovery](https://nmap.org/book/man-host-discovery.html)
- [Kali: arp-scan](https://www.kali.org/tools/arp-scan/)
- [Avahi Discover](https://manpages.debian.org/bookworm/avahi-discover/avahi-discover.1.en.html)
- [Kali: dsniff / arpspoof](https://www.kali.org/tools/dsniff/)
- [arpspoof: tùy chọn hai chiều và chuyển tiếp](https://manpages.debian.org/buster/dsniff/arpspoof.8.en.html)
- [Linux: ip_forward và send_redirects](https://docs.kernel.org/networking/ip-sysctl.html)
- [Wireshark: giới hạn bắt gói trong mạng chuyển mạch](https://wiki.wireshark.org/capturesetup/ethernet)
