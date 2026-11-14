# Tài khoản nhân viên DEMO (dữ liệu thử, chạy trên máy này)

> File này chứa mật khẩu của **tài khoản mẫu** dùng cho bản demo chạy từ mã nguồn (biểu tượng Desktop **"KSK Demo (ban moi)"**, dữ liệu thử ở `data-research\`).
> **Không phải** tài khoản/dữ liệu thật của KSK.exe. Đừng dùng các mật khẩu này cho hệ thống thật. File đã được thêm vào `.gitignore` để không bị commit nhầm.

Mở app nhân viên: **http://localhost:5180** (hoặc bấm biểu tượng "KSK Demo (ban moi)" trên Desktop — nó tự khởi động máy chủ và mở trình duyệt).
Đăng nhập bằng **tên đăng nhập** ở cột 1 (không cần `@`) và **mật khẩu** ở cột 2.

| Tên đăng nhập | Mật khẩu | Vai trò | Chuyên khoa | Xem được gì |
|---|---|---|---|---|
| `bsnhi01` | `Passw0rd-BN01` | Bác sĩ | Nhi | Hành chính + lâm sàng Nhi + vùng ảnh Nhi |
| `bsmat01` | `Passw0rd-BM01` | Bác sĩ | Mắt | Hành chính + lâm sàng Mắt + vùng ảnh Mắt |
| `bstmh01` | `Passw0rd-BT01` | Bác sĩ | Tai Mũi Họng | Hành chính + lâm sàng TMH + vùng ảnh TMH |
| `bsrhm01` | `Passw0rd-BR01` | Bác sĩ | Răng Hàm Mặt | Hành chính + lâm sàng RHM + vùng ảnh RHM |
| `bsthankinh01` | `Passw0rd-BTK1` | Bác sĩ | Thần kinh | Hành chính + vùng ảnh MRI não do trợ lý gợi ý (khoa Thần kinh). **Mới** — cần máy chủ chạy jar chính sách từ 2.1.0 trở lên |
| `bsnhimat01` | `Passw0rd-BNM1` | Bác sĩ | Nhi + Mắt | Hợp quyền của Nhi và Mắt |
| `bsksk01` | `Passw0rd-BK01` | Bác sĩ | Khám chung (KSK) + Xét nghiệm | Hành chính + thể lực/tiền sử/lần khám/cận lâm sàng (không có chuyên khoa, không có ảnh) |
| `ketluan01` | `Passw0rd-KL01` | Bác sĩ kết luận | KSK | Hành chính + mục khám chung/kết luận (KHÔNG đọc mọi khoa) |
| `nhaplieu01` | `Passw0rd-NL01` | Nhập liệu | — | Mọi thứ **do chính tài khoản này nhập** (kể cả ảnh gốc) |
| `nhaplieu02` | `Passw0rd-NL02` | Nhập liệu | — | Mọi thứ do chính tài khoản này nhập (không thấy của `nhaplieu01`) |
| `tiepdon01` | `Passw0rd-TD01` | Tiếp đón | — | Mục Hành chính |
| `giamsat01` | `Passw0rd-GiamSat01` | **Giám sát** | — | Đọc **TẤT CẢ** dữ liệu **mới** (kể cả ảnh gốc), **không ghi**, **không quản trị**. Phải nhập **lý do** mỗi lần tra cứu (ghi nhật ký). 1 thiết bị, phiên 10 phút, không dùng qua Internet. **Bắt buộc MFA (mã TOTP 6 số, quét QR vào Google/Microsoft Authenticator ở lần đầu)** — MFA là thuộc tính ABE. **Mới** — cần chính sách 2.3.0 |
| `ktv01` | `Passw0rd-KT01` | Kỹ thuật viên xét nghiệm | Xét nghiệm | Ghi cận lâm sàng; đọc lại phần mình nhập |
| `quantri02` | `Passw0rd-QT02` | Quản trị (demo) | — | Quản lý tài khoản, lịch giờ làm việc, nhật ký, máy đã đăng ký. **Không đọc bệnh án/ảnh**. **Bắt buộc xác thực hai lớp (mã 6 số)** — xem dưới |
| `quantri01` | mật khẩu tạm trong `data-research\mat-khau-quan-tri-lan-dau.txt` (nếu đã đổi thì dùng mật khẩu của bạn) | Quản trị gốc | — | Như trên; **lần đăng nhập đầu tự đăng ký xác thực hai lớp bằng điện thoại của bạn** |

## Bệnh nhân giả đã có sẵn để thử (CCCD giả đầu số 999)

| CCCD | Họ tên (giả) | Có gì |
|---|---|---|
| `999000000101` | Nguyen Van An (gia) | Hành chính, lâm sàng Nhi/Mắt/TMH/RHM, 1 ảnh 4 vùng (Mắt/TMH/RHM/Nhi) |
| `999000000102` | Tran Thi Binh (gia) | Như trên, ảnh có 1 vùng thuộc **hai khoa** (Mắt + TMH) |
| `999000000103` | Le Minh Chau (gia) | Như trên, ảnh là bộ **2 lát cắt** |

## Vai trò GIÁM SÁT (đọc tất cả) — xem `NGHIEN_CUU_CPABE/05_VAI_TRO_GIAM_SAT.md`

- Đăng nhập `giamsat01` → **🛡 Giám sát hồ sơ** → nhập lý do (≥ 8 ký tự) → gõ họ tên/CCCD.
- Tạo Giám sát mới: `quantri01` hoặc `quantri02` tạo (mật khẩu ≥ 14 ký tự) → tài khoản **⏳ chờ duyệt** → **quản trị còn lại** bấm **Duyệt** (người tạo không tự duyệt được).
- **Dữ liệu cũ** (nhập trước khi chạy máy chủ 2.2.0) Giám sát chưa mở được; hãy nhập/nạp dữ liệu mới. Lần đầu `giamsat01` phải **đăng ký MFA** (nhập lại mật khẩu → quét mã QR → nhập mã 6 số). Dữ liệu tạo trước 2.3.0 Giám sát chưa mở được. Rủi ro còn lại: xem tài liệu 05 (mục 5 và 8).

## Ảnh MRI não THẬT (UPENN-GBM, đã ẩn danh) — xem `NGHIEN_CUU_CPABE/04_ANH_THAT_UPENN_GBM_VA_TRO_LY_GOI_Y.md`

Nguồn: Bakas S. et al., UPENN-GBM v2, TCIA, DOI 10.7937/TCIA.709X-DN49, giấy phép CC BY 4.0. Dữ liệu người thật đã ẩn danh: không nhận dạng lại, không chia sẻ rộng.

1. Tải mẫu (đã chạy sẵn 5 bệnh nhân vào `E:\TLCN\du-lieu-anh\`): `npx tsx app/test-ui/tai-upenn.ts`
2. Xem kế hoạch (không ghi gì): `npx tsx app/test-ui/anh-upenn-demo.ts --ke-hoach` — in 10 bệnh nhân GIẢ (tên tiếng Việt, CCCD giả đúng cấu trúc 12 số, sinh theo hạt giống nên luôn giống nhau) và số ảnh được gán NGẪU NHIÊN cho mỗi người. Nạp thật vào máy chủ demo: `npx tsx app/test-ui/anh-upenn-demo.ts --demo-tai`
3. Đăng nhập `bsthankinh01` → **Ảnh CT/MRI** → gõ một phần họ tên (vd `pham`, `vu quoc`) hoặc CCCD trong bảng kế hoạch → thấy vùng khoa Thần kinh. `bsmat01` không thấy gì; `bstmh01` chỉ thấy hai khung "tai" **minh hoạ** (khoanh tay, không phải giải phẫu).
4. Tự tải DICOM: `nhaplieu01` → **Tải ảnh mới** → chọn nhiều tệp `.dcm` → khung 🤖 **Gợi ý tự động** → **Lưu cả chuỗi**. Ảnh nguồn lạ: trợ lý **không** đề xuất vùng, ảnh chỉ người nhập xem được.

## Việc cần làm khi demo

1. **Ảnh bị mã hoá thế nào?** Chạy trong thư mục dự án: `npx tsx app/test-ui/anh-ma-hoa.ts 999000000102` — in ra chính sách CP-ABE, bản mã trên máy chủ, và bảng "tài khoản nào giải mã được vùng nào".
   Có thể thay CCCD bằng **họ tên** (một phần, không phân biệt hoa/thường/dấu): `npx tsx app/test-ui/anh-ma-hoa.ts "tran thi binh"`.
2. **Xem trên giao diện:** đăng nhập một bác sĩ → **Ảnh CT/MRI** → gõ **họ tên hoặc CCCD** vào ô tra cứu (gõ "tran thi" sẽ hiện danh sách gợi ý, bấm chọn là tra luôn; gõ đủ 12 số thì bấm "Tra cứu ảnh") → bấm **🔐 Xem bản mã máy chủ lưu**.
   *Lưu ý:* tra theo tên chỉ tìm trong các hồ sơ hành chính mà **tài khoản đang đăng nhập giải mã được** (đơn vị đang chọn ở thanh trên). Tài khoản không đọc được hồ sơ hành chính của ai thì phải gõ đủ CCCD.
3. **Gắn ảnh vào bệnh nhân của bạn:** `npx tsx app/test-ui/anh-demo.ts 079012345678 "nguyen van an"` — mỗi tham số là CCCD 12 số **hoặc** họ tên (tên được tra trong hồ sơ hành chính đã có; tên khớp nhiều người thì gắn cho tất cả và in ra để bạn kiểm tra). Không đưa tham số = dùng 3 bệnh nhân giả ở trên.
4. **Gặp lỗi `DEVICE_LIMIT`** (mỗi tài khoản tối đa 5 thiết bị/trình duyệt): chạy `npx tsx app/test-ui/demo-don-thiet-bi.ts`.

## Ai xem được ẢNH GỐC (toàn bộ ảnh chụp)?

- **Chỉ tài khoản đã tải ảnh lên** (người nhập, ví dụ `nhaplieu01`), trên bất kỳ thiết bị nào của chính họ đã đăng ký hợp lệ.
- **Không ai khác**: không bác sĩ nào (kể cả bác sĩ đúng khoa — họ chỉ thấy các **vùng** thuộc khoa mình), không Quản trị, không Tiếp đón, không người nhập khác.
- Hệ quả cần biết: nếu tài khoản người nhập bị mất/xoá thì **không ai khôi phục được ảnh gốc** (chỉ còn các vùng đã khoanh). Nếu bạn muốn một vai trò "quản lý ảnh" có quyền đọc ảnh gốc, đó là thay đổi chính sách cần quyết định riêng.

## Quản trị bắt buộc xác thực hai lớp (MFA)

- Máy chủ demo chạy với MFA bắt buộc cho **Quản trị** (tắt bằng biến môi trường `RESEARCH_ADMIN_MFA=0` khi khởi động). Mật khẩu **chưa đủ**: mọi việc quản trị bị chặn cho đến khi nhập mã 6 số.
- **Lần đầu:** đăng nhập → màn "Xác thực hai lớp cho Quản trị" → nhập lại mật khẩu → quét mã QR bằng Google/Microsoft Authenticator → nhập mã 6 số. Mã bí mật chỉ hiện một lần; mất điện thoại thì phải đặt lại (xem dưới).
- Mỗi lần đăng nhập mới phải nhập mã; phiên quản trị tự khoá lại sau **480 phút** (8 giờ) kể từ lần nhập mã.
- **Mất điện thoại:** một quản trị **khác** vào Quản trị tài khoản → **Đặt lại MFA** của người đó → cần quản trị **thứ ba** duyệt (người yêu cầu không tự duyệt) → người đó đăng ký lại. Nếu chỉ còn một quản trị, hoặc cần cứu gấp: chạy `Khoi-Phuc-Mat-Khau-Quan-Tri.cmd` **trên máy chủ** (xoá cả mật khẩu cũ lẫn MFA, đặt mật khẩu tạm).
- Tài khoản mẫu **`quantri02`** dùng cho các kịch bản tự động: bí mật MFA của nó được lưu trong tệp `.demo-mfa.json` (git bỏ qua) lần đầu kịch bản chạy. **Không dùng quantri02 làm quản trị thật.**
