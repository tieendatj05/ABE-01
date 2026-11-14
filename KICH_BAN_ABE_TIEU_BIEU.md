# Kịch bản ABE tiêu biểu (7 kịch bản, trình diễn trong ~15 phút)

Ý chính cả bộ: **cùng một hồ sơ, mỗi người mở ra một phần khác nhau — không phải do giao diện che, mà do máy của họ không có khoá để giải mã phần kia.** Quyền nằm trong chính bản mã (CP-ABE: chính sách dạng *tác giả HOẶC (bác sĩ VÀ đúng khoa)*), máy chủ không thể "lỡ tay" cho xem.

## Chuẩn bị

- Bật máy chủ (biểu tượng **KSK Demo (ban moi)** hoặc `Khoi-Dong-Lai-Demo.cmd`), mở **http://localhost:5180**.
- Tài khoản và mật khẩu: xem `TAI_KHOAN_NHAN_VIEN_DEMO.md`. Ô **Công ty** ở thanh xanh chọn đơn vị như từng kịch bản.
- Dữ liệu dùng để trình diễn:

| Đơn vị | Có gì |
|---|---|
| **10 - CÔNG TY CNM LONGWELL** | 858 người; 853 người có kết quả khám; **102 người có ảnh mặt + X-quang răng**. Danh sách mã (CCCD tạm) của 102 người này: `E:\TLCN\du-lieu-anh\_ANH_MAT_THAT\da-gan-CNM-LONGWELL.csv`. Ví dụ: `770021115731` |
| **03 - CÔNG TY TNHH MẪU C** | 50 người, CCCD `999000100001` … `999000100050`, mỗi người có ảnh mặt + X-quang |

- **Lưu ý khi chiếu cho người khác:** hai đơn vị trên chứa **tên thật** của nhân viên. Hãy tra bằng **số CCCD**, đừng mở cả danh sách trên màn chiếu. Ảnh mặt và X-quang là của **người lạ** (nguồn công khai, gán ngẫu nhiên) — chỉ để minh hoạ, ghi nguồn: London Face Lab (DeBruine & Jones 2017, CC BY 4.0) và Panoramic radiography database (Román et al. 2021, CC BY 4.0).

---

## K1. Một ảnh mặt, năm vùng, mỗi khoa thấy một phần  ★ kịch bản chính

**Làm:** vào **Ảnh CT/MRI** → đơn vị **CNM LONGWELL** → gõ một CCCD ở trên → **Tra cứu ảnh**. Lặp lại với từng tài khoản:

| Đăng nhập | Thấy gì |
|---|---|
| `nhaplieu01` (người nhập) | Ảnh khuôn mặt **nguyên vẹn** và phim X-quang, nhãn "✔ Ảnh gốc đầy đủ (bạn là người nhập)" |
| `bsmat01` (Mắt) | Chỉ **dải mắt + lông mày** trên nền caro |
| `bstmh01` (Tai Mũi Họng) | Chỉ **mũi và hai tai** |
| `bsrhm01` (Răng Hàm Mặt) | Chỉ **miệng + hàm** của ảnh mặt, và **toàn bộ phim X-quang răng** |
| `bsnhi01`, `tiepdon01` | "Không có ảnh nào thuộc quyền của tài khoản này" |

**Chứng minh:** mỗi vùng ảnh là một bản mã riêng, khoá riêng. Phần ngoài quyền **không hề tồn tại trên máy bác sĩ** (chỉ vài phần trăm điểm ảnh được giải mã) — không có chuyện "mở F12 là thấy".

## K2. Bác sĩ chỉ thấy phiếu khám của khoa mình

**Làm:** **Khám sức khỏe định kỳ** → đơn vị **CNM LONGWELL** → tab **Đã liên thông** → bấm một người. Đăng nhập lần lượt `bsmat01`, `bstmh01`, `bsrhm01` (dữ liệu LONGWELL có khối Mắt, Tai Mũi Họng, Răng Hàm Mặt).

**Thấy:** mỗi bác sĩ xem đầy đủ khối khám **khoa mình**; khối khoa khác hiện 🔒 *"Không hiển thị với tài khoản của bạn… Không suy ra là bình thường"*.

**Chứng minh:** *khoa* là một thuộc tính ABE; bác sĩ nhiều khoa nhận hợp quyền (xem S2 ở phần chạy tự động). Ô khoá ghi rõ "không thấy" ≠ "bình thường" (an toàn chẩn đoán).

## K3. Người nhập cách ly: cùng vai trò vẫn không thấy của nhau

**Làm:** đăng nhập `nhaplieu01` → đơn vị **CNM LONGWELL**: thấy toàn bộ danh sách (người này đã nhập). Đăng xuất, đăng nhập `nhaplieu02` (cùng vai trò **Nhập liệu**) → cùng đơn vị: **"Chưa có hồ sơ"**. Rồi đăng nhập `nhaplieu01` ở **trình duyệt/máy khác**: vẫn thấy đủ. `tiepdon01` thì thấy mục Hành chính của cả đơn vị (vai trò Tiếp đón).

**Chứng minh:** quyền đọc theo **tác giả** (thuộc tính `Author:<tài khoản>`) chứ không theo *vai trò chung* hay *máy*; đổi máy không mất quyền vì khoá cấp theo **tài khoản**.

## K4. Máy chủ chỉ giữ bản mã — "mù"

**Làm** (cửa sổ lệnh trong thư mục dự án):

```
npx tsx app/test-ui/ten-ma-hoa.ts 999000100001
```

**Thấy:** máy chủ lưu cho hồ sơ hành chính chỉ là **chuỗi hex bản mã** + chính sách ABE, và công cụ kiểm tra bản lưu **không chứa họ tên/CCCD dạng rõ**; mỗi tài khoản mẫu đăng nhập thật rồi báo thấy tên hay chỉ thấy ổ khoá.

**Chứng minh:** mã hoá ngay trên máy nhân viên; lộ cả tệp CSDL vẫn không đọc được nội dung. Muốn tra theo CCCD, máy chủ chỉ có *chỉ mục mù* (HMAC), không suy ngược ra CCCD.

## K5. Quản trị rất mạnh nhưng không đọc được bệnh án

**Làm:** đăng nhập `quantri02` → **màn xác thực hai lớp** hiện ra trước (nhập mã 6 số; lần đầu quét mã QR bằng ứng dụng xác thực). Vào xong: tạo tài khoản, đặt lịch giờ làm việc, xem nhật ký, thu hồi máy — nhưng **không có mục nào để xem bệnh nhân**, và nếu cố đọc hồ sơ qua tài khoản này thì bị từ chối.

**Chứng minh:** quyền *quản trị hệ thống* và quyền *đọc dữ liệu* là hai thứ tách rời (quản trị không có thuộc tính ABE nào). Chiếm được tài khoản quản trị cũng không đọc được dữ liệu; và nay muốn **dùng** quyền quản trị còn phải có điện thoại của người đó.

## K6. Giám sát: đọc tất cả nhưng phải có MFA và nêu lý do

**Làm:** đăng nhập `giamsat01` (cần **ứng dụng xác thực trên điện thoại bạn** để đăng ký lần đầu). Chưa nhập mã: ô tra cứu bị khoá. Nhập mã 6 số → nhập **lý do** (≥ 8 ký tự) → tra cứu một CCCD → thấy **cả ảnh gốc** và mọi mục. Mỗi lần tra cứu được ghi vào nhật ký kèm lý do; sau 10 phút MFA hết hạn, phải nhập lại.

**Chứng minh:** MFA là **một thuộc tính ABE** (`Auth:MFA`): chính sách của Giám sát là *Role:GiamSat **VÀ** Auth:MFA*; thiếu thuộc tính thì **có khoá Giám sát cũng không giải mã được**.

## K7. Thu hồi quyền có hiệu lực ngay; đổi mật khẩu không mất dữ liệu

**Làm:** (a) `quantri02` → **Quản trị tài khoản** → gỡ chuyên khoa của một bác sĩ (hoặc **Khoá**) → bác sĩ đó bị đăng xuất, đăng nhập lại **không còn** thấy phần khoa đã gỡ. (b) Ở màn đăng nhập bấm **Quên mật khẩu?** với một nhân viên → quản trị thấy yêu cầu, xác minh, bấm **Cấp mật khẩu tạm** → nhân viên đăng nhập, bị buộc đặt mật khẩu mới → **vẫn đọc lại được hồ sơ đã nhập trước đó**.

**Chứng minh:** quyền gắn với *thuộc tính* và được cấp theo thời điểm nên thu hồi có tác dụng ngay; còn khoá giải mã **cấp theo tài khoản**, mật khẩu chỉ để xác thực — nên đổi mật khẩu không làm mất dữ liệu.

---

## Chạy tự động toàn bộ (12 kịch bản chứng minh, có ✓/✗)

```
npx tsx app/test-ui/demo-chung-minh-abe.ts                 (tất cả)
npx tsx app/test-ui/demo-chung-minh-abe.ts --chi=S2,S5     (chỉ vài kịch bản)
npx tsx app/test-ui/demo-chung-minh-abe.ts --bo-qua-gio    (bỏ S8: đóng cửa tạm 2 giây)
```

Dùng bệnh nhân giả riêng (CCCD `048212604711`), chạy lại an toàn. Tác dụng phụ (nói trước): tạo vài tài khoản tạm rồi khoá chúng; S7 gỡ khoa Xét nghiệm của một tài khoản tạm; S8 đóng cửa ~2 giây rồi trả lịch cũ. Quản trị mẫu `quantri02` được script tự vượt MFA bằng bí mật lưu trong `.demo-mfa.json`.

| Muốn chứng minh | Kịch bản tay | Tự động |
|---|---|---|
| Quyền theo vùng ảnh | K1 | S5 |
| Quyền theo khoa (lâm sàng) | K2 | S2 |
| Cách ly người nhập | K3 | S9 |
| Máy chủ mù / có bản mã cũng vô dụng | K4 | S1, S3, S11 |
| Quản trị không đọc dữ liệu | K5 | S4 |
| Giám sát + MFA | K6 | S10, S12 |
| Thu hồi quyền / chống giả mạo | K7 | S7, S6 |
