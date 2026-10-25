# Demo 2 máy: Windows = máy chủ/quản trị, MacBook = máy nhân viên

Cả hai máy phải cùng Wi-Fi/LAN (không dùng Wi-Fi khách hoặc mạng có "AP/client isolation"). Không cần Internet.

## A. Chuẩn bị MÁY CHỦ (Windows, máy của bạn)

1. Mở **KSK.exe** (`release\KSK-win32-x64\KSK.exe`) và giữ nó mở. Đây là máy chủ nhúng: kho mù + 3 nút cấp khóa.
   Dữ liệu của bản này nằm ở `%APPDATA%\KSK\server-data`.
2. Một lần duy nhất: chạy `Cau-Hinh-Mang-LAN.cmd`, đồng ý hộp quyền Administrator (mở cổng 8090, 9001–9003, UDP 43821 chỉ cho LocalSubnet).
   Trên máy bạn 7 quy tắc `KSK-*` đã có sẵn.
3. Ghi lại IP của máy chủ: hiện tại là **192.168.1.39** (Wi-Fi). Đổi Wi-Fi thì IP đổi, kiểm tra bằng `ipconfig`.
4. Trong KSK.exe: **Quản trị bảo mật → Quản trị cấp quyền**, nhập mật khẩu admin.
   Kiểm tra **Đăng ký máy mới = ĐANG BẬT** và đã tick quyền mặc định (BacSi, TiepDon, các khoa...). Nếu đang tắt, bấm *Bật đăng ký tự do*.
5. Có dữ liệu để demo: vào **Import Excel**, chọn đúng *Tên công ty*, nạp file Excel **giả** (cột Họ tên, Ngày sinh, Số CCCD 12 số...), bấm B1, B2, B3.
   Hoặc dùng sẵn các hồ sơ đã import trước đó.

## B. Chuẩn bị MÁY NHÂN VIÊN (MacBook)

Bản Windows `.exe` không chạy trên Mac, nên Mac chạy **từ mã nguồn** (Electron).

1. Cài **Node.js LTS** từ https://nodejs.org (nếu chưa có).
2. Chép `E:\TLCN\KSK-Mac.zip` sang Mac (AirDrop/USB/Zalo), giải nén. Zip này **không** chứa `node_modules`, `data-demo`, token hay khóa.
3. Mở Terminal:
   ```bash
   cd ~/Downloads/medabe          # thư mục vừa giải nén
   chmod +x Chay-KSK-NhanVien-Mac.command
   ./Chay-KSK-NhanVien-Mac.command http://192.168.1.39:8090
   ```
   Lần đầu mất vài phút (npm install tải Electron cho Mac). Các lần sau chạy ngay.
   Bỏ tham số địa chỉ nếu muốn app tự dò máy chủ bằng UDP.
4. macOS có thể hỏi quyền **Keychain** (app cất khóa thiết bị bằng Keychain). Chọn *Always Allow*.
5. Lần đầu mở app: thấy "Đã kết nối" → tự đăng ký (tên = tên máy Mac), khóa riêng sinh ngay trên Mac.
   Chọn đúng **Công ty** giống bên Windows để thấy cùng danh sách.

## C. Kịch bản demo (10–12 phút)

| Bước | Làm gì | Điểm cần nói |
|---|---|---|
| 1 | Windows import Excel giả, bấm *Tải lại danh sách* | Dữ liệu mã hóa tại máy Windows rồi mới gửi lên. 1 phép ABE cho cả lô |
| 2 | Mac: mở **Khám sức khỏe định kỳ**, chọn Công ty | Mac tự tìm máy chủ trong LAN, xin khóa từ ≥ 2/3 nút, rồi giải mã **trên Mac** |
| 3 | Mac: mở một học sinh, nhập khám lâm sàng, bấm Lưu | Mỗi mục là bản ghi riêng, policy tự sinh, có chữ ký số (ô "Họ tên và chữ ký bác sĩ") |
| 4 | Windows: **Quản lý hồ sơ**, chọn học sinh vừa lưu | Khung trái = giải mã tại máy; khung phải = **máy chủ chỉ thấy ciphertext**, HMAC, policy |
| 5 | Windows: *Giám sát an ninh* | Sự kiện đăng ký thiết bị, truy cập bị từ chối... |
| 5b | Windows: **Quản lý hồ sơ → Gửi liên thông các dòng đang lọc** | Gửi bản **đã mã hoá** lên cổng Bộ Y tế, nhận biên nhận ký số; cột *lien_thong* chuyển "Đã gửi". Sửa hồ sơ rồi thì quay về "Chưa gửi" |
| 6 | Tắt Wi-Fi trên Mac vài giây | App khóa màn hình, xóa khóa/DEK trong bộ nhớ. Bật lại: tự tìm lại máy chủ |
| 7 | Windows: *Quản trị cấp quyền → Máy đã đăng ký → khóa máy này* (máy Mac) | Mac mất quyền truy cập ngay |
| 8 | Chạy `npx vitest run security/src/abe/rw15.test.ts --reporter=verbose` | Bằng chứng ABE thật: thiếu quyền, khác GID, đổi nhãn thuộc tính đều bị từ chối |
| 9 | (Tùy chọn) Mac/Windows: chọn học sinh, đọc **Mã tra cứu phụ huynh** (thanh xanh trên phiếu hoặc nút *Xuất mã tra cứu* ở Quản lý hồ sơ). Điện thoại cùng Wi-Fi mở `http://192.168.1.39:5174`, nhập CCCD **và mã** | Kênh phụ huynh hai yếu tố (không dùng ABE, nói rõ giới hạn). Cần bản KSK.exe/app phụ huynh đóng gói lại thì mới có mã |

**Cổng Bộ Y tế (mới):** chạy lại `Cau-Hinh-Mang-LAN.cmd` một lần để mở thêm cổng **8095** (liên thông + phụ huynh tra cứu). Muốn thấy menu **▤ Cổng Bộ Y tế** trên một máy, cấp cho máy đó vai trò *SoYTe* ở *Quản trị cấp quyền → Nâng cao → Cấp nhanh nhân sự*.

Trước khi demo thật: sau bước 7 nhớ **mở khóa lại** máy Mac, hoặc chuẩn bị sẵn một máy Mac thứ hai.
Sau khi nhân viên đã đăng ký xong, **tắt đăng ký tự do** ở bước A4 và nói rõ lý do.

## D. Nếu có lỗi

| Hiện tượng | Cách xử lý |
|---|---|
| Mac không thấy máy chủ | Trên Mac: `curl http://192.168.1.39:8090/api/config`. Không trả JSON thì kiểm tra cùng Wi-Fi, chạy lại `Cau-Hinh-Mang-LAN.cmd`, tắt AP isolation |
| "Đây là máy chủ khác nơi đã đăng ký" | Mac đã đăng ký với kho khác. Xóa `~/Library/Application Support/medabe` rồi chạy lại để đăng ký mới |
| Mac báo `HARDWARE_MISMATCH` | Khóa tạo trên máy khác. Xóa thư mục dữ liệu như dòng trên, đăng ký lại |
| Danh sách trống | Sai *Công ty* hoặc chưa import vào kho đang chạy. Windows và Mac phải cùng máy chủ và cùng Công ty |
| Cổng 8090 bị chiếm khi chạy `npm run demo` | KSK.exe đang giữ cổng. Không chạy hai kho cùng lúc |
| `npm install` lỗi trên Mac | Không chép `node_modules` từ Windows sang. Xóa nếu lỡ chép rồi `npm install` lại |

## E. Việc đã sửa cho bản demo này

- `security/src/hardware.ts`: nhận diện phần cứng **macOS** (UUID + serial máy). Trước đây Mac chỉ có tên CPU nên khóa thiết bị bị từ chối ngay lần mở thứ hai.
- Bỏ token mặc định đoán được (`admin-storage`, `service-demo`, `siem-demo`, `phone-demo`, `admin-<org>`). Nút cấp khóa chạy riêng mà thiếu biến môi trường thì từ chối khởi động; Spring để token rỗng thì chức năng đó bị khóa.
- **Đã cập nhật tại chỗ ngày 18/10/2026** (không cần JDK): KSK.exe, KSK-NhanVien.exe, KSK-PhuHuynh.exe, máy chủ nhúng và jar Spring đều là bản mới (có cổng Bộ Y tế :8095, mã tra cứu, danh mục chuẩn, nút thêm trường). Bản cũ của asar/máy chủ được sao lưu ở `.test-runs/package-*`. Dữ liệu cũ trong `%APPDATA%KSKserver-data` được giữ nguyên, nhưng hồ sơ lưu TRƯỚC bản này dùng khoá tra cứu cũ (chỉ CCCD) nên phụ huynh không tra được cho đến khi lưu/nhập lại.

## F. Demo ABE bằng kịch bản kẻ tấn công (khuyên dùng làm phần chính)

Chạy MỘT lệnh, tự dựng hệ thống riêng (cổng tự chọn, dữ liệu tạm, không đụng KSK.exe), dữ liệu hoàn toàn giả, in ra từng bước bằng tiếng Việt:

```powershell
npm run demo:tancong
```

| Bước | Nội dung | Điều chứng minh |
|---|---|---|
| 1 | Máy nhập liệu lưu hồ sơ (hành chính, thể lực, lâm sàng Nhi) | Mã hoá tại máy; mỗi mục một chính sách ABE riêng |
| 2 | **Liên thông**: gửi bản mã hoá lên cổng Bộ Y tế | Biên nhận có chữ ký; gửi lại không nhân đôi; sửa sau khi gửi thì phải gửi lại; phụ huynh chưa tra được trước khi liên thông |
| 3 | Bộ Y tế (Org:SoYTe) tải từ cổng và giải mã | Đúng thuộc tính + ≥ 2/3 nút cấp khoá thì đọc được, chữ ký số hợp lệ |
| 4 | Kẻ A lấy dữ liệu thô của kho và cổng | Quét 6 chuỗi nhạy cảm (tên, CCCD, cao, cân, chẩn đoán...): không thấy |
| 5 | Kẻ B có thiết bị hợp lệ nhưng sai quyền (Tiếp đón, Bác sĩ Mắt) | Tải được ciphertext nhưng không mở được thể lực/lâm sàng Nhi |
| 6 | Kẻ C hack 1/3 nút (lấy share) | Ghép khoá theo quy tắc: bị chặn; ép k=1: ra khoá rác |
| 7 | SIEM | Mỗi lần thử sai quyền đều có ACCESS_DENIED |
| 8 | App phụ huynh tra qua cổng Bộ Y tế: CCCD + mã tra cứu | Chỉ biết CCCD thì không thấy gì. **Nói thẳng**: kênh này không dùng ABE, ai có cả CCCD lẫn mã đều xem được |

Nối với demo 2 máy: Windows = máy chủ + Bộ Y tế (có Org:SoYTe), Mac = máy nhập liệu. Chạy `npm run demo:tancong` để chứng minh bằng mã, rồi quay lại hai máy thật để cho thấy giao diện: khung phải ở *Quản lý hồ sơ* là thứ máy chủ thấy.
