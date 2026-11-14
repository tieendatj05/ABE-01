# Báo cáo kiểm tra & thực nghiệm ABE — MedABE/KSK

> Ngày chạy: 13/11/2026. Mọi thử nghiệm dùng **hồ sơ giả** (`security/src/research/fake-data.ts`, `fake-image.ts`) trên **máy chủ tạm** do chính test dựng (Spring HTTPS + 3 nút cấp khoá, cổng ngẫu nhiên, dữ liệu trong thư mục tạm) — **không đụng dữ liệu demo `data-research\`**.
> Quy ước trạng thái: **Đã có** (có mã + test chạy qua) · **Có một phần** · **Chưa có** · **Chưa xác minh** (không chạy được/không có điều kiện trong phiên này).
> Mỗi nhận định ghi rõ là **đã tái hiện** (có test chạy ra kết quả) hay **giả thuyết/suy ra từ thiết kế**.

---

## 0. Tóm tắt một trang

| Câu hỏi của thầy | Kết luận ngắn | Mục |
|---|---|---|
| App có dùng ABE thật không, loại nào? | **CP-ABE** (Rouselakis–Waters 2015, BLS12-381), khoá sinh ngưỡng 2-trên-3 nút. ABE chỉ **bọc khoá dữ liệu (DEK)**; nội dung mã bằng AES-256-GCM. | 3 |
| ABE khác hệ thống thông thường ở đâu? | Thông thường: **máy chủ** giải mã sau khi kiểm quyền. ABE: **máy khách** giải mã; máy chủ/CSDL không có khoá nào mở được bản mã. | 4, 5 |
| ABE có hơn mọi phương án thông thường không? | **Không.** So với *mã hoá-khi-lưu bằng khoá máy chủ* thì hơn rõ khi máy chủ/khoá bị lộ (A2: 6/6 → 0/6). So với *khoá nhóm theo khoa do KMS riêng giữ* (B1) thì **quyền đọc giống hệt**; khác ở chỗ phải tin ai (A4) và không phải phát/quản khoá nhóm; **đổi lại chậm hơn ~2–3 bậc** (phần mật mã) và header lớn hơn ~20–35 lần. | 5, 8A |
| Policy "động" đến đâu? | Quyền được **kiểm lại mỗi yêu cầu** ở máy chủ: yêu cầu kế tiếp sau khi lệnh hạn chế hoàn tất đã bị từ chối (đo: mỗi thao tác ~10–30 ms trên loopback). Khả năng **giải mã** chỉ đổi cho bản mã **mới / đã bọc lại**; **khoá và bản sao bản mã đã có thì vẫn mở được dữ liệu cũ** (giới hạn cố hữu của ABE). | 7, 8B |
| Đã sửa gì lần này? | (1) Quản lý thuộc tính theo tài khoản + bảng epoch; (2) trạng thái **Hạn chế/Khôi phục** + ghi tín hiệu rủi ro; (3) **vá lỗ hổng mới tìm ra** ở header khoá chung (người đọc hợp lệ đẩy cả lô sang chính sách khác); (4) **giảm thiểu** việc ghi đè header bằng khoá bọc rác: lịch sử 5 phiên bản, truy ra tài khoản, quản trị khôi phục có lý do; (5) cổng liên thông Bộ Y tế chạy **HTTPS** (HTTP làm lộ siêu dữ liệu). | 9, 13 |

---

## 1. Bảng trạng thái từng yêu cầu của thầy

| # | Yêu cầu | Trạng thái | Bằng chứng (file / hàm / test) |
|---|---|---|---|
| 1.1 | Đọc mã, cấu hình, test; nói rõ app đang chạy khác bản đóng gói thế nào | **Đã có** | Mục 2. |
| 1.2 | Giải thích ABE bằng hồ sơ mẫu; CP vs KP; đoạn nào là ABE, đoạn nào chỉ kiểm quyền API/UI | **Đã có** | Mục 3. `security/src/abe/rw15.ts` (`encapsulate`, `decapsulate`, `rewrap`, `newKeyHeader`, `openKeyHeader`), `rw15.test.ts`. |
| 1.3 | Luồng tạo/lưu/mở trước & sau ABE; ai cấp khoá, thuộc tính/policy ở đâu, máy nào giải mã | **Đã có** | Mục 4. Chế độ "trước ABE" **có sẵn trong app**: `BaselineVault.java` + `/api/v2/baseline/records` (`research.e2e.test.ts`). |
| 1.4 | So sánh công bằng với HTTPS + mã hoá lưu trữ + quản lý khoá + RBAC/ABAC | **Có một phần** | Mục 5. Đo thật cho **kịch bản ảnh theo khoa** (B0/B1 mô phỏng cùng ảnh, cùng ma trận quyền). **Chưa** lặp lại đối chứng cho mọi loại hồ sơ. |
| 2.1 | Bảng người dùng–thuộc tính; phân biệt họ tên/CCCD với thuộc tính; màn hình quản trị xem/quản thuộc tính | **Đã có** | Mục 6. `app/web/src/Accounts.tsx` (cột *Thuộc tính ABE*, bảng epoch), `ResearchAdminController.userView`, `PolicyService.attributesOf`. Kiểm giao diện: `app/test-ui/accounts-ui-check.ts` (kết quả mục 12). |
| 2.2 | Mức "động" của policy (kiểm mỗi lần, hồ sơ mới/cũ, thu hồi khoá đã cấp, phiên đang mở, khoá cũ) | **Đã có** (đo) | Mục 7. `abe-chinh-sach-dong.e2e.test.ts` → `.test-runs/abe-thuc-nghiem/chinh-sach-dong.json`. |
| 3.1 | Kịch bản 1: ảnh/kết quả qua nơi lưu/trung gian lấy được bản mã; có đối chứng quản khoá riêng | **Đã có** | Mục 8A. `abe-doi-chung-anh.e2e.test.ts` → `anh-doi-chung.json`. |
| 3.2 | Kịch bản 2: nghi tài khoản bị chiếm → giảm quyền → xử lý phiên → nhật ký → khôi phục | **Đã có** | Mục 8B. `IdentityService.restrict/restore/riskSignal`, `PolicyService.attributesOf` (RESTRICTED). Tín hiệu rủi ro là **giả lập, ghi rõ** `nguon=GIA_LAP`. |
| 3.3 | (tuỳ chọn) kịch bản 3 | **Có một phần** | Mục 8C: MFA làm thuộc tính ABE (Giám sát) — đã có test `giamsat.e2e.test.ts:209`; không làm sâu thêm. |
| 4.1 | Điểm yếu: tái hiện, nguyên nhân, dữ liệu ảnh hưởng, trước/sau, riêng-app hay chung; dẫn nguồn | **Đã có** | Mục 9 (3 lỗi đã tái hiện: 2 vá hẳn, 1 giảm thiểu; 1 chưa vá; các giới hạn cố hữu có dẫn nguồn). |
| 4.2 | HTTP/HTTPS từng chặng, thấy gì trên dây/URL/log | **Đã có** (loopback) / **Chưa xác minh** (tunnel, LAN thật) | Mục 10. `abe-truyen-tai.e2e.test.ts` (proxy TCP nghe lén). |
| 4.3 | Đúng/sai quyền, sửa bản mã, khoá/phiên cũ sau giảm quyền; tách "đã tái hiện" / "giả thuyết" | **Đã có** | Mục 11. |
| 5.1 | Chạy bằng hồ sơ giả, cùng bộ hồ sơ/quyền khi so sánh, ghi cấu hình + số lần | **Đã có** | Mục 12. |
| 5.2 | Bàn giao: bảng, đường dẫn, lệnh, kết quả, bước demo | **Đã có** | Mục 13. |
| 5.3 | Đoạn ngắn nói với thầy | **Đã có** | Mục 15. |

---

## 2. Phiên bản nào tôi sẽ thấy khi mở app

| Cách mở | Chạy mã gì | Có các thay đổi lần này? |
|---|---|---|
| Biểu tượng Desktop **"KSK Demo (ban moi)"** / `Chay-Demo-KSK-Moi.cmd` / `launcher\restart-demo.ps1` | `security/src/deploy/research-server.ts` + jar `security/storage/target/medabe-storage-0.1.0.jar` (build 13/11/2026) + `app/web/dist` | **Có** (đây là bản để demo). |
| `release\KSK-*` , `release\KSK-NhanVien-*` (đóng gói) | Bản build ngày **05/11/2026** | **Không.** Chưa đóng gói lại (theo yêu cầu: chỉ đóng gói khi bạn nói). Không có Hạn chế/Khôi phục, cột thuộc tính, MFA quản trị mới, cổng HTTPS. |
| `security/src/deploy/demo.ts` (bản cũ, nhúng trong KSK.exe) | Cổng liên thông Bộ Y tế vẫn **HTTP** | **Chưa đổi** (chỉ đổi `research-server.ts`). |
| Tài liệu | Đã xoá toàn bộ `.md` cũ, chỉ còn `TAI_KHOAN_NHAN_VIEN_DEMO.md`, `KICH_BAN_ABE_TIEU_BIEU.md` và file này | Không còn tài liệu cũ nói khác mã nguồn. |

---

## 3. ABE trong dự án — giải thích bằng một hồ sơ mẫu

### 3.1 Hồ sơ mẫu (dữ liệu giả)

Bệnh nhân giả *Nguyễn Văn An*, CCCD `0790xxxxxxxx`. Một đợt khám tạo các mục:

| Mục | Người nhập | Nội dung (giả) | Policy (rút gọn, bỏ nhãn epoch `#2026W46.0`) |
|---|---|---|---|
| `hanhchinh` | Tiếp đón `tiepdon01` | họ tên, CCCD, ngày sinh | `Author:<td> OR Role:TiepDon OR Role:BacSi OR (Role:GiamSat AND Auth:MFA)` |
| `lamsang` khoa Mắt | `bsmat02` | thị lực 7/10, nhãn áp… | `Author:<bsmat02> OR (Role:BacSi AND Khoa:Mat) OR (Role:GiamSat AND Auth:MFA)` |
| `lamsang` khoa Nhi | `bsnhi01` | cân nặng, hô hấp… | `Author:<bsnhi01> OR (Role:BacSi AND Khoa:Nhi) OR (Role:GiamSat AND Auth:MFA)` |
| `anh` (ảnh gốc) | `nhaplieu01` | ảnh nhiều vùng | `Author:<nl01> OR (Role:GiamSat AND Auth:MFA)` |
| `vung` (vùng ảnh khoa X) | `nhaplieu01` | vùng cắt của ảnh | `Author:<nl01> OR (Role:BacSi AND Khoa:X) OR (Role:GiamSat AND Auth:MFA)` |

Nguồn của các policy chuẩn: `security/storage/src/main/resources/research-policy.json` (mục `app.types`, phiên bản chính sách 2.3.0). Máy khách sinh chuỗi policy bằng `security/src/client/app-policy.ts` (`appPolicyString`); **máy chủ tự dựng lại policy chuẩn và so khớp** khi ghi (`LegacyBridge.checkPolicyString`, mã `POLICY_MISMATCH`).

### 3.2 Hai người, cùng một bản mã, hai kết quả

Bản ghi **lâm sàng Mắt** của An. Cả hai bác sĩ đều **có bản mã** (ví dụ cùng tải từ CSDL):

| Người | Thuộc tính trong khoá (cấp theo tài khoản) | Thoả nhánh nào của policy? | Kết quả |
|---|---|---|---|
| BS Mắt `bsmat01` | `Role:BacSi`, `Khoa:Mat`, `Author:<id mình>` | `(Role:BacSi AND Khoa:Mat)` ✔ | giải mã được |
| BS Nhi `bsnhi01` | `Role:BacSi`, `Khoa:Nhi`, `Author:<id mình>` | `Role:BacSi` ✔ nhưng `Khoa:Mat` ✘; `Author` khác ✘ | **không** giải mã được (`decapsulate` trả `null`) |

Đây là điểm cốt lõi: **quyết định "ai mở được" nằm trong phép toán giải mã, không chỉ ở một câu lệnh `if` của máy chủ.** Test: `authorship.e2e.test.ts:126` ("bác sĩ Mắt mở được Mắt, KHÔNG mở được Nhi/TMH dù có bản mã trong tay; Quản trị cũng không").

### 3.3 CP-ABE hay KP-ABE?

| | KP-ABE (Goyal–Pandey–Sahai–Waters 2006) | CP-ABE (Bethencourt–Sahai–Waters 2007) |
|---|---|---|
| Gắn với **khoá người dùng** | policy | tập thuộc tính |
| Gắn với **bản mã** | tập thuộc tính | policy |

**Dự án dùng CP-ABE**: `encapsulate(pks, policy)` nhận *policy* khi mã hoá; mỗi khoá người dùng là khoá của *một thuộc tính* (`F(attr)` trong `rw15.ts`, đầu file). Policy nằm trong **header của bản mã** (`envelope.abe.policy` + các hàng LSSS), thuộc tính nằm trong **khoá**.

### 3.4 Đoạn nào là ABE, đoạn nào chỉ kiểm quyền

| Bước | Cơ chế | Là ABE? |
|---|---|---|
| Đăng nhập (mật khẩu PBKDF2, TOTP) | `IdentityService`, `Totp.java` | Không |
| Phiên (token), thiết bị đã đăng ký + chữ ký sở hữu (PoP), giờ làm việc | `ResearchGateFilter`, `ScheduleService` | Không |
| Liệt kê/tải bản ghi: chỉ trả bản ghi tài khoản được đọc | `PolicyService.canReadApp`, `LegacyBridge.canRead` | Không (kiểm quyền API — *lớp phòng thủ chiều sâu*) |
| Xin **vé** cấp khoá (PDP đánh giá thuộc tính được hưởng) | `ResearchKeyController` | Không (quyết định *cấp khoá*, chưa phải mật mã ABE) |
| 3 nút tính phần khoá, ghép 2-trên-3, ràng buộc GID | `authority/node.ts`, `rw15.ts` `partialKey/combineKey` | **Có** (sinh khoá ABE) |
| Bọc DEK dưới policy | `encapsulate`, `newKeyHeader` | **Có** |
| Mở DEK bằng thuộc tính | `decapsulate`, `openKeyHeader` | **Có** |
| Bọc lại sau đổi epoch | `rewrap`, `rewrapKeyHeader` | **Có** |
| Mã/giải mã nội dung | AES-256-GCM, AAD = `patientIdx|loại|id` | Không (mật mã đối xứng) |
| Chữ ký tác giả/ nhãn khoa (phát hiện sửa) | Ed25519 trong phần đã ký | Không |
| Ẩn/hiện nút, tab theo vai trò | `app/web/src/*.tsx` | Không (chỉ giao diện, **không** là bảo mật) |

---

## 4. Luồng tạo – lưu – mở một hồ sơ: trước và sau ABE

| Bước | **Trước ABE** (chế độ baseline của app) | **Sau ABE** (chế độ tài khoản hiện hành) |
|---|---|---|
| Tạo | Máy khách gửi nội dung (TLS). Máy chủ kiểm quyền rồi tự sinh DEK, mã AES-256-GCM | **Máy khách** sinh DEK, mã AES-256-GCM (AAD gắn bệnh nhân/loại/id), ABE bọc DEK theo policy bằng **khoá công khai** |
| Máy chủ nhận | Nội dung rõ (rồi tự mã hoá) | **Chỉ bản mã + header** (không có DEK, không có khoá) |
| Lưu | `ct` + `wrappedDek = AES-GCM(KEK, DEK)`; **KEK của máy chủ** (biến môi trường/tệp) — `BaselineVault.java` | `iv`, `ciphertext`, `abe.policy`, hàng LSSS, `wrappedDek` bọc bằng khoá suy ra từ ABE |
| Ai cấp khoá | Máy chủ giữ KEK, tự dùng | Người dùng xin **vé** (PDP), 3 nút cấp phần khoá, máy khách ghép (2/3) |
| Thuộc tính ở đâu | Không có (chỉ vai trò trong CSDL) | CSDL (`role`,`khoa`,`status`) → tính lại mỗi lần xin vé → nằm trong **khoá giải mã trong RAM** máy khách |
| Policy ở đâu | Trong mã nguồn kiểm quyền ở máy chủ | Trong **chính bản mã** (+ bản chuẩn `research-policy.json` để máy chủ kiểm khi ghi) |
| Mở | Máy chủ kiểm quyền → **máy chủ giải mã** → trả bản rõ qua TLS | Máy chủ trả **bản mã** (nếu qua kiểm quyền) → **máy khách giải mã** |
| Ai tin | Máy chủ + người giữ KEK thấy được tất cả | Máy chủ/CSDL **không** thấy; cần ≥ 2/3 nút cấp khoá cùng bị chiếm mới tạo được khoá bất kỳ |

Vì sao hai người nhận kết quả khác nhau: xem 3.2 — cùng bản mã, khác tập thuộc tính trong khoá.

---

## 5. So sánh công bằng với hệ thống thông thường

### 5.1 Phương án đối chứng (vì không còn "bản app trước ABE" nguyên vẹn)
- **B0 — "thông thường"**: HTTPS + mã hoá khi lưu bằng khoá máy chủ (KEK) + kiểm quyền theo khoa ở API (máy chủ giải mã hộ). Là đúng chế độ `baseline` của app, mô phỏng lại trong tiến trình cho thực nghiệm ảnh.
- **B1 — "thông thường mạnh"**: mã hoá phong bì, **mỗi khoa một khoá nhóm** do một KMS riêng phát cho đúng bác sĩ khoa đó; DEK của từng vùng được bọc bằng khoá nhóm các khoa được phép (+ khoá người nhập).
- **Giữ điều kiện tương đương**: cùng ảnh phantom 96×64 (5 vùng + ảnh gốc), cùng danh sách khoa được phép cho từng vùng, cùng bác sĩ–khoa, cùng AES-256-GCM. B0/B1 mô phỏng trong tiến trình → **không gồm độ trễ mạng/KMS thật**.

### 5.2 Kết quả theo mô hình kẻ tấn công (số vùng mở được trong 6 bản mã)

| Kẻ tấn công có | ABE | B0 | B1 |
|---|---|---|---|
| A1. Chỉ CSDL | 0 | 0 | 0 |
| A2. CSDL + khoá phía máy chủ (KEK) | **0** | **6** | 0 |
| A3. CSDL + tài khoản bác sĩ **sai khoa** | đúng vùng của khoa mình | đúng vùng của khoa mình* | đúng vùng của khoa mình |
| A4. CSDL + chiếm KMS/khoá nhóm | 1 nút: **0** (2 nút: mở được — ngưỡng 2/3) | — | **6** |

\* B0 ở A3 chỉ đúng khi kiểm quyền API đúng; nếu lỗi phân quyền API/đường khác: **6/6** (cột `B0_khiLoiPhanQuyenApi` trong `anh-doi-chung.json`).

### 5.3 ABE thay đổi bước nào, lợi ích khi nào

- **Thay đổi bước "ai giải mã" và "ai phải được tin"**: từ *máy chủ* (+KEK) sang *máy khách* của người đủ thuộc tính; khoá không nằm ở một chỗ duy nhất.
- **Lợi ích xuất hiện khi**: (a) lo ngại bản mã/CSDL/khoá máy chủ bị lấy (sao lưu, quản trị DB, mã độc trên máy chủ, trung gian như cổng Bộ Y tế); (b) nhiều bên cần quyền khác nhau trên cùng bản mã mà không muốn một KMS biết/giữ hết khoá; (c) muốn điều kiện hợp (AND/OR) và điều kiện phiên như MFA đi cùng bản mã.
- **Cách thông thường đã đủ khi**: một tổ chức, quản trị máy chủ/KMS được tin hoàn toàn, ít nhóm quyền, không có trung gian giữ bản mã, cần hiệu năng cao. Khi đó B1 (hoặc thậm chí B0 + kiểm quyền chặt + sao lưu mã hoá) cho **cùng kết quả "ai đọc được"** với chi phí thấp hơn nhiều (bảng 12.2).
- **Điều ABE không làm được** (cũng không làm được ở B1): chặn người đã được đọc chép bản rõ; rút lại khoá đã cấp cho dữ liệu cũ (mục 7, 9).

---

## 6. Người dùng và thuộc tính

| Loại | Đăng nhập / tra cứu bằng | Xem hồ sơ nào | Thuộc tính (nguồn: `research-policy.json` roles) | Ai cấp/sửa | Thuộc tính nằm ở |
|---|---|---|---|---|---|
| Tiếp đón (`TIEP_DON`) | tên đăng nhập + mật khẩu, thiết bị đã đăng ký, giờ làm việc | Hành chính + mục mình nhập | `Role:TiepDon`, `Author:<id>` | Quản trị | CSDL → vé → khoá trong RAM |
| Bác sĩ (`BAC_SI`) | như trên | Hành chính + lâm sàng/vùng ảnh **đúng khoa** + mục mình nhập | `Role:BacSi`, `Khoa:<k>`… , `Author:<id>` | Quản trị (chọn khoa từ danh mục) | như trên |
| Bác sĩ kết luận (`KET_LUAN`) | như trên | Hành chính + mục khám chung/kết luận | `Role:KetLuan`, `Role:BacSi`, `Khoa:KSK` | Quản trị | như trên |
| Kỹ thuật viên (`KTV`) | như trên | Ghi cận lâm sàng; đọc lại phần mình nhập | `Role:KTV`, `Khoa:XetNghiem`, `Author` | Quản trị | như trên |
| Nhập liệu (`NHAP_LIEU`) | như trên | **Mọi thứ do chính tài khoản này nhập** (kể cả ảnh gốc) | `Role:NhapLieu`, `Author:<id>` | Quản trị | như trên |
| Giám sát (`GIAM_SAT`) | như trên **+ TOTP**, 1 thiết bị, tài khoản do quản trị **khác** duyệt | Đọc **tất cả dữ liệu mới**, không ghi; mỗi lần đọc phải nêu **lý do** (ghi nhật ký) | `Role:GiamSat` + `Auth:MFA` (chỉ khi phiên vừa nhập đúng TOTP) | Quản trị | như trên |
| Quản trị (`QUAN_TRI`) | + TOTP bắt buộc cho thao tác quản trị | **Không đọc hồ sơ nào** | **không có thuộc tính nào** | (tài khoản gốc) | — |
| Phụ huynh (không tài khoản) | CCCD + họ tên đã chuẩn hoá qua cổng công khai | Mục đã liên thông, bọc riêng cho phụ huynh (`client/parent.ts`) | không dùng thuộc tính ABE | — | — |

**Họ tên / CCCD là dữ liệu, không phải thuộc tính quyền.** Biết CCCD của bệnh nhân không làm tăng quyền (test `authorship.e2e.test.ts:114`); CCCD chỉ dùng tạo chỉ mục mù (`patientIdx`) để tra cứu.
**Không tự cấp thuộc tính**: xin vé cho `Author` của người khác hoặc vai trò khác bị từ chối (`authorship.e2e.test.ts:221`).

### Màn hình quản trị (đã cải tiến) — `app/web/src/Accounts.tsx`
- Cột **Thuộc tính ABE** theo từng tài khoản (lấy từ máy chủ — cùng nguồn với cấp khoá), di chuột thấy phiên bản `#tuần.bộ đếm`; quản trị hiển thị "không có (không giải mã được gì)".
- Nút **Hạn chế** (nhập lý do ≥ 8 ký tự), **Báo rủi ro** (chỉ ghi nhật ký, không đổi quyền), **Khôi phục** (nhập lý do).
- Bảng **phiên bản thuộc tính (epoch)**: bộ đếm của từng thuộc tính; tăng khi gỡ khoa hoặc hạn chế.

---

## 7. Policy "động" đến mức nào — kết quả đo

Test: `security/src/client/abe-chinh-sach-dong.e2e.test.ts` (kết quả `.test-runs/abe-thuc-nghiem/chinh-sach-dong.json`).

| Câu hỏi | Kết quả | Ai làm việc đó |
|---|---|---|
| Quyền được kiểm lại mỗi lần truy cập? | **Có.** Phiên đang mở bị đánh giá lại ngay yêu cầu kế tiếp: không còn liệt kê hồ sơ của người khác, không ghi, không quản trị, `me.attributes` chỉ còn `Author` (E1) | **Máy chủ** |
| Sửa policy cho hồ sơ **mới**? | **Có.** Hồ sơ nhập sau khi hạn chế dùng nhãn epoch mới → khoá cũ **không** mở được (E3 = `false`) | ABE (epoch) |
| Đổi quyền cho hồ sơ **cũ**? | **Có một phần.** Header được bọc lại **khi một người hợp lệ mở hồ sơ** (lazy rewrap, `MedClient.openRecord`). Trước đó (cửa sổ): khoá cũ vẫn mở được (E4 `cuaSoTruocKhiBocLai_khoaCuMoDuoc = true`); sau đó **không** (`false`). Máy chủ không tự bọc lại được vì **không có DEK** | ABE + máy khách hợp lệ |
| Thu hồi khả năng giải mã của **khoá đã cấp**? | **Không với bản mã đã sao chép trước đó**: bản mã đã tải + khoá cũ vẫn mở được ngoại tuyến (E2 = `true`). **Có** với bản mã mới/đã bọc lại | giới hạn cố hữu của ABE |
| Máy chủ có ngừng cấp khoá vai trò/khoa cho tài khoản bị hạn chế? | **Có.** Phiên đang mở xin vé cho `Role:BacSi`, `Khoa:Mat` → `DENY_NO_ENTITLED_ATTRIBUTES` (đã kiểm trong E1) | Máy chủ (PDP) |

Ghi nhận: tăng epoch là **toàn cục theo thuộc tính** (`EpochService.bump`): khi hạn chế một bác sĩ Mắt, bộ đếm `Role:BacSi` và `Khoa:Mat` tăng, nên **mọi** bác sĩ Mắt khác phải xin khoá mới (đã đo: `bsmat02` vẫn mở được hồ sơ cũ sau khi lấy lại khoá).

---

## 8. Ba kịch bản

### 8A. Kịch bản 1 — Ảnh y khoa nhiều vùng chia theo khoa (trọng tâm)

**Nghiệp vụ trong app**: người nhập tải ảnh (X-quang/MRI/ảnh), trợ lý gợi ý vùng thuộc khoa nào (`client/advisor.ts`), `saveImage` (`client/imaging.ts`) cắt thành **vùng**, mỗi vùng là một bản mã với policy của khoa đó; ảnh gốc chỉ tác giả (+ Giám sát có MFA). Bác sĩ khoa nào chỉ ghép được **vùng khoa mình**, phần còn lại là nền trống.
**Ai gặp vấn đề / khi nào / lộ gì**: bản mã đi qua CSDL, sao lưu, cổng liên thông Bộ Y tế; kẻ lấy được bản mã (hoặc khoá máy chủ) có thể xem **toàn bộ ảnh** nếu ảnh chỉ được bảo vệ bằng khoá máy chủ.
**Biện pháp thông thường xử lý đến đâu**: B0 chặn tốt khi API đúng; **không** chặn khi khoá máy chủ/API bị vượt (A2: 6/6). B1 xử lý tốt nhưng đặt niềm tin vào KMS (A4: 6/6).

Kết quả (`anh-doi-chung.json`, cấu hình & số lần ở mục 12):

| Bác sĩ | ABE mở được | B1 | B0 nếu lỗi phân quyền API |
|---|---|---|---|
| `bsmat01` (Mắt) | `mat` | `mat` | cả 6 |
| `bstmh01` (TMH) | `tmhA, tmhB, tmhC` | như ABE | cả 6 |
| `bsrhm01` (RHM) | `rhm` | `rhm` | cả 6 |
| `bsnhi01` (Nhi) | *(không gì)* | *(không gì)* | cả 6 |

Kiểm tra bổ sung trên app thật (`authorship.e2e.test.ts:246–330`): điểm ảnh ngoài vùng là nền trống; người nhập mở **ảnh gốc nguyên vẹn từng byte**; người nhập khác không thấy gì; sửa/tráo vùng/ghép vùng ảnh khác bị phát hiện.

**Kết luận trung thực**: ABE **không** cho thêm quyền đọc đúng so với B1 trong cùng ma trận khoa; lợi ích đo được là (1) **không có điểm tập trung** giữ khoá của mọi khoa (A4), (2) không phải phát/quản khoá nhóm cho từng bác sĩ — thêm bác sĩ khoa Mắt chỉ cần thuộc tính `Khoa:Mat`, (3) policy đi cùng bản mã khi qua trung gian. **Giá phải trả**: thời gian mở & kích thước header (bảng 12.2).

### 8B. Kịch bản 2 — Nghi tài khoản nhân viên bị chiếm

**Nghiệp vụ**: BS Mắt `bsmat01` bỗng đọc rất nhiều hồ sơ từ máy lạ (**tín hiệu rủi ro giả lập**, ghi rõ `nguon=GIA_LAP`). Một lần nhập sai mật khẩu **không** đủ để hạn chế (E7: vài lần sai không đổi trạng thái).

Trình tự đã chạy (E1–E5):
1. Quản trị ghi tín hiệu rủi ro → **quyền chưa đổi** (quyết định là của người).
2. Quản trị **Hạn chế** (lý do bắt buộc): tài khoản chỉ còn `Author:<id>`; mất vai trò/khoa/MFA/ghi/quản trị; epoch của `Role:BacSi`, `Khoa:Mat` tăng; có thể thu hồi phiên.
3. **Phiên đang mở** bị chặn ngay (máy chủ): không liệt kê hồ sơ người khác; hồ sơ **do chính tài khoản này nhập** vẫn đọc được ("giảm đúng quyền", không khoá trắng).
4. Nhật ký: `v2.risk.signal`, `v2.account.restrict`, `v2.account.restore` kèm lý do & người thực hiện.
5. **Khôi phục** sau xác minh: thuộc tính trả lại; hồ sơ lại đọc được.

Phân tách "việc nào do ai":

| Tình huống | Kết quả đo | Do |
|---|---|---|
| Phiên đang mở, yêu cầu kế tiếp | bị từ chối ngay | **Máy chủ chặn** |
| Hồ sơ **mới** sau hạn chế | khoá cũ **không** mở được | **Thay đổi khả năng giải mã** (epoch) |
| Hồ sơ **cũ**, chưa ai mở lại | khoá cũ **vẫn mở được** (cửa sổ) | giới hạn: chưa bọc lại |
| Hồ sơ cũ, sau khi người hợp lệ mở (bọc lại) | khoá cũ **không** mở được | **Thay đổi khả năng giải mã** |
| **Bản mã đã tải trước + khoá cũ** | **vẫn mở được** | **Không ai chặn được** (ABE không rút khoá) |
| Dữ liệu **đã giải mã** nằm trên máy kẻ tấn công | vẫn đọc được | ngoài phạm vi mật mã |

Số đo (`chinh-sach-dong.json`, lần chạy cuối; E6 = 10 lần liên tiếp): lệnh hạn chế mất **13 ms** (trung vị; p95 15 ms); **yêu cầu đọc kế tiếp của phiên đang mở bị từ chối ngay, yêu cầu đó mất 13 ms** (p95 15 ms); khôi phục 13 ms. Một lần chạy đơn (E1) từ lúc ghi tín hiệu rủi ro đến khi bị từ chối đọc đầu tiên ≈ 0,16 s (gồm một lần đọc kiểm chứng ở giữa). Mở + bọc lại một hồ sơ cũ ≈ 0,7 s (E4). Giữa các lần chạy khác nhau số đo dao động (ví dụ hạn chế 12–18 ms, bọc lại 0,7–1,2 s) tuỳ tải máy. *Chỉ đo trên loopback, không gồm độ trễ mạng; thời gian "từ lúc đánh dấu rủi ro đến lúc quyền bị giảm" ở đây là thời gian **xử lý của máy chủ**, còn việc phát hiện rủi ro là giả lập do quản trị ghi.*

### 8C. Kịch bản 3 (tuỳ chọn) — MFA làm thuộc tính ABE cho vai trò Giám sát
Bản mã của Giám sát đòi `Role:GiamSat AND Auth:MFA`; nút **chỉ cấp khoá `Auth:MFA` khi phiên vừa xác thực TOTP**. Bỏ thuộc tính MFA khỏi phiên thì **không giải mã được dù đã có khoá `Role:GiamSat`** (`giamsat.e2e.test.ts:209`). Đây là chỗ kiểm quyền "đi cùng bản mã", không chỉ ở API. Không làm sâu thêm.

---

## 9. Điểm yếu đã chứng minh

Phân loại: **[Tái hiện + vá]**, **[Tái hiện, chưa vá]**, **[Cố hữu]**, **[Giả thuyết]**.

| # | Điểm yếu | Loại | Tái hiện / điều kiện | Nguyên nhân (code) | Dữ liệu ảnh hưởng | Trước → sau | Riêng app / cấu hình / chung? |
|---|---|---|---|---|---|---|---|
| W1 | Người đọc hợp lệ **bọc lại header khoá chung sang chính sách của mục khác** làm cả lô mất khả năng giải mã với người hợp lệ khác | **Tái hiện + vá** | `abe-pha-hoai-header.e2e.test.ts` W1: BS Mắt PUT `/api/headers/{id}` của lô *Hành chính* với policy chuẩn "lâm sàng Mắt" (đúng epoch, bọc đúng DEK) | `HeaderController.rewrap` → `LegacyBridge.validateHeaderPolicy` chỉ kiểm "là policy chuẩn của **một** mục nào đó", không kiểm có đúng mục của các bản ghi đang dùng header | Mọi bản ghi dùng header chung (lô nhập hàng loạt, Hành chính). **Không lộ nội dung**; mất khả năng giải mã / đổi nhóm giải mã | **Trước**: máy chủ `OK`; BS Nhi mở hồ sơ → "Không có header khoá `<id>`". **Sau** (`LegacyBridge.validateHeaderRewrap`): `403 POLICY_MISMATCH`, BS Nhi vẫn mở được; đường bình thường (epoch đổi → bọc lại) vẫn chạy (`rewrapped=true`) | **Lỗi riêng của app** (thiếu ràng buộc ở đường cập nhật). Không phải lỗi mật mã của ABE |
| W2 | Cổng liên thông Bộ Y tế chạy **HTTP**: kẻ nghe lén thấy **siêu dữ liệu** | **Tái hiện + vá** (ở `research-server.ts`) | `abe-truyen-tai.e2e.test.ts` chặng 2: proxy TCP trên đường tới cổng thấy `POST /byt/submit`, chuỗi policy `MED:Role:BacSi#2026W46.0`, loại mục, chỉ mục mù, mã thiết bị, chứng chỉ thiết bị. **Không** thấy họ tên/CCCD/canary/token | `startGateway` mặc định `createHttp`; `MEDABE_BYT_URL=http://…` | Siêu dữ liệu, không phải nội dung | **Trước**: thấy cả 5 loại siêu dữ liệu (chính sách, loại mục, chỉ mục mù, mã thiết bị, chứng chỉ thiết bị). **Sau** (HTTPS cùng chứng chỉ máy chủ): không thấy loại nào trong số đã kiểm (chính sách, loại mục, chỉ mục mù, chứng chỉ thiết bị, đường dẫn yêu cầu); HTTP thường bị từ chối; máy khách không ghim CA không kết nối được | **Cấu hình/triển khai**; hệ thống nào dùng HTTP cũng vậy (TLS 1.3: RFC 8446). `demo.ts`/KSK.exe cũ **chưa đổi** |
| W3 | App web phục vụ qua **HTTP, không SRI**: kẻ ở giữa có thể **sửa mã JS** chạy trong trình duyệt (nơi giải mã) | **Tái hiện (cấu hình), chưa vá** | `abe-truyen-tai.e2e.test.ts` chặng 3: `index.html` HTTP, `coSRI:false`, có CSP | `serveStatic` HTTP trong `research-server.ts` | Toàn bộ dữ liệu người dùng đó giải mã được | — | **Chung** cho mọi ứng dụng mã hoá phía máy khách phân phối qua web; SRI không bảo vệ chính trang HTML; cần HTTPS (W3C SRI; MDN: WebCrypto chỉ ở ngữ cảnh an toàn) |
| W4 | **Thu hồi không rút được khoá đã cấp / bản mã đã sao chép** | **Cố hữu, đã tái hiện** | `chinh-sach-dong` E2 (`true`) | Bản chất ABE: khoá giải mã dùng được với mọi bản mã cùng thuộc tính–epoch | Dữ liệu cũ mà kẻ chiếm đã có bản mã + khoá | Giảm: epoch + rewrap cho dữ liệu mới/đã bọc lại (E3, E4); còn cửa sổ E4 | **Chung** cho ABE (Sahai–Seyalioglu–Waters 2012; Pirretti et al. 2006) và cho mọi hệ mã hoá |
| W5 | **2/3 nút cấp khoá bị chiếm** ⇒ tạo được khoá cho bất kỳ GID/thuộc tính | **Giả thuyết suy ra từ thiết kế** (không chạy tấn công) | `rw15.test.ts:17` (bất kỳ 2/3 nút tạo khoá dùng được), `:26` (1 nút không đủ) | Ngưỡng t=2, n=3 | Toàn bộ bản mã | — | Đặc tính của khoá ngưỡng, chung |
| W6 | Người **được đọc** có thể chép bản rõ / chia sẻ DEK | **Cố hữu** | hiển nhiên về mô hình | ABE không có truy vết người rò | Mọi thứ họ đọc được | Giảm bằng: Giám sát cần lý do + MFA, cảnh báo đọc dồn dập (`giamsat.e2e.test.ts:141`) | Chung |
| W7 | Máy chủ thấy **siêu dữ liệu** (loại mục, khoa, chỉ mục mù, thời gian) | **Cố hữu theo thiết kế** | nằm trong `RecordRow` | Cần để lọc phía máy chủ | Siêu dữ liệu | — | Chung cho hệ cho phép máy chủ lọc/tra cứu |
| W8 | Người đọc hợp lệ **ghi đè header chung (hoặc phong bì một bản ghi) bằng khoá bọc RÁC** → người đọc khác không mở được cả lô; trước đây khó truy ra người làm và không khôi phục được | **Tái hiện + giảm thiểu** (chưa ngăn được lúc ghi) | `abe-pha-hoai-header.e2e.test.ts` W4a: BS Mắt PUT `/api/headers/{id}` giữ nguyên policy + epoch hiện hành nhưng `wrappedDek` rác → máy chủ `OK`; BS Nhi: "Giải mã thất bại: khoá lỗi thời hoặc bản ghi bị can thiệp" | Máy chủ **không có DEK** nên không kiểm được khoá bọc đúng hay sai. Trước đây chỉ giữ **một** bản trước, không có API khôi phục, nhật ký ghi theo **tên thiết bị** và nằm ngoài nhật ký quản trị (`/api/v2/admin/audit` chỉ lọc `v2.*`) | Mọi bản ghi dùng chung header; với v2: một bản ghi. **Không lộ nội dung**; mất khả năng đọc | **Trước**: ghi đè thành công; không khôi phục qua API; khó truy người làm. **Sau**: giữ 5 phiên bản (`KeyHeaderHistory`); `GET /api/v2/admin/headers/{id}/history` cho thấy **tài khoản** đã ghi đè; `POST …/restore` (lý do ≥ 8 ký tự, nhật ký `v2.header.restore`) → BS Nhi mở lại được (W4b); `POST /api/v2/admin/records/{id}/restore-envelope` hoàn tác lần bọc lại gần nhất của một bản ghi (W4c); nhật ký quản trị có `v2.header.rewrap` kèm tài khoản. **Chưa ngăn được lúc ghi** | Phần truy vết/khôi phục: **riêng app**. "Kho chỉ lưu bản mã không tự xác nhận được khoá bọc" là đặc tính chung — muốn kiểm phải có bên giữ khoá tham gia |

Nguồn kỹ thuật dẫn trong mục 15. Mức bằng chứng: W1, W2, W4 và các số liệu mục 7–8 là **đã chạy**; W5, W6, W7 là **suy ra từ thiết kế/lý thuyết**; W8 **đã chạy** (tái hiện + khôi phục).

**Điều đã kiểm và KHÔNG phải điểm yếu** (đã chạy): log Spring và nhật ký quản trị **không chứa** họ tên/CCCD/canary (chặng 4); chặng Spring HTTPS không lộ gì; cổng chặn phát lại và sửa thân yêu cầu.

---

## 10. HTTP hay HTTPS — từng chặng

Phương pháp: **proxy TCP nghe lén trên loopback** chuyển tiếp nguyên byte, ghi mọi byte; hồ sơ giả mang họ tên, CCCD và chuỗi dấu (canary); tìm các chuỗi đó, token và mật khẩu trong byte thu được. (`abe-truyen-tai.e2e.test.ts` → `truyen-tai.json`.)

| Chặng | Giao thức | Kẻ nghe lén thấy gì | Lớp bảo vệ nội dung | Lớp bảo vệ kết nối |
|---|---|---|---|---|
| Máy khách → Spring API | **HTTPS** TLS 1.3, `TLS_AES_256_GCM_SHA384`; HTTP thường → 400 | Không thấy gì (0 chuỗi dấu; byte đầu `0x16`); URL/header/token/mật khẩu cũng ẩn | ABE+AES-GCM | TLS (CA ghim) |
| Máy khách → 3 nút cấp khoá | HTTPS (cấu hình; cùng thư viện TLS) | **Chưa xác minh bằng nghe lén** (chưa đặt proxy ở chặng này) | — | TLS |
| Máy khách → cổng liên thông Bộ Y tế | **HTTP trước / HTTPS sau** (research-server) | Trước: **siêu dữ liệu** (W2), **không** thấy nội dung. Sau: không thấy gì | ABE+AES-GCM (nội dung); chữ ký từng yêu cầu + cửa sổ thời gian (chống phát lại/sửa) | TLS (sau vá) |
| Phát lại / sửa yêu cầu tới cổng | — | Phát lại → `401 yêu cầu đã được dùng (phát lại)`; sửa thân → `401 chữ ký yêu cầu không hợp lệ` | chữ ký ECDSA phủ băm thân | — |
| Tải app web (tệp tĩnh) | **HTTP**, không SRI, có CSP | Mã JS bị sửa được nếu kẻ ở giữa mạng (W3) | — | **Chưa có** |
| Cổng công khai cho phụ huynh qua đường hầm | HTTP nghe loopback, TLS do đường hầm kết thúc (theo thiết kế `launcher/Mo-Internet-PhuHuynh.cmd`) | **Chưa xác minh** (không có đường hầm thật trong phiên này) | — | TLS của đường hầm |
| Máy khác trong LAN mở `http://IP:5180` | HTTP; API vẫn HTTPS | **Chưa xác minh trong phiên này**: trang HTTP không phải ngữ cảnh an toàn, WebCrypto `subtle` bị trình duyệt tắt → dùng app desktop hoặc phục vụ app qua HTTPS | — | — |
| Log máy chủ & nhật ký quản trị | — | Không có họ tên/CCCD/canary | — | — |

**Phân lớp**: **ABE + AES-GCM** bảo vệ *nội dung hồ sơ* ở mọi chặng (kể cả khi chặng đó là HTTP). **TLS** bảo vệ *kết nối*: che siêu dữ liệu/URL/header, xác thực máy chủ (chống mạo danh), chống sửa trên đường. **Chữ ký từng yêu cầu** chống phát lại. ABE **không** thay thế TLS.

---

## 11. Thử đúng quyền, sai quyền, sửa bản mã, phiên/khoá cũ

| Thử | Kết quả | Trạng thái | Test |
|---|---|---|---|
| Đúng quyền: BS Mắt mở lâm sàng Mắt | mở được | Đã tái hiện | `authorship.e2e.test.ts:126` |
| Sai quyền: BS Nhi/TMH có bản mã Mắt | **không** giải mã; Quản trị cũng không | Đã tái hiện | như trên |
| Ghi bản mã với policy giả (mạo danh tác giả, thêm nhánh "mọi bác sĩ"/Device/KetLuan, bỏ nhánh bác sĩ) | `403 POLICY_MISMATCH` | Đã tái hiện | `authorship.e2e.test.ts:190`, `research.e2e.test.ts:288` |
| Policy với nhãn epoch cũ | `EPOCH_STALE` | Đã tái hiện | `research.e2e.test.ts:304`, `abe-pha-hoai-header` W2 |
| Sửa 1 byte bản mã / tráo bản mã giữa hai bản ghi | `RecordIntegrityError` (AES-GCM + AAD) | Đã tái hiện | `authorship.e2e.test.ts:305` |
| Sửa nhãn khoa, sửa `refId`, ghép vùng ảnh khác | `signatureValid=false` / bị loại, đếm `tampered` | Đã tái hiện | như trên |
| Đổi dữ liệu mã hoá khi bọc lại header (iv/ciphertext) | `409` | Suy ra từ mã `RecordController.rewrap`; **chưa có test riêng** | — |
| Bọc lại header sang policy khác (người đọc hợp lệ) | trước: chấp nhận; sau: `403` | Đã tái hiện + vá | `abe-pha-hoai-header.e2e.test.ts` (W1) |
| Ghi đè header bằng **khoá bọc rác** (cùng policy/epoch) | máy chủ **chấp nhận** (không có DEK để kiểm); người đọc khác không mở được; quản trị khôi phục được, truy ra tài khoản | Đã tái hiện; **giảm thiểu**, chưa ngăn | (W4a/W4b/W4c) |
| Phiên đang mở sau hạn chế | từ chối ngay | Đã tái hiện | `abe-chinh-sach-dong` E1 |
| Khoá cũ + bản mã đã sao chép | **vẫn mở** | Đã tái hiện | E2 |
| Khoá cũ + bản mã mới / đã bọc lại | không mở | Đã tái hiện | E3, E4 |
| Phát lại / sửa yêu cầu tới cổng | `401` | Đã tái hiện | `abe-truyen-tai` |
| Thử mọi thay đổi trên bản sao | Mọi test dùng máy chủ **tạm**; không chạm `data-research\` | — | — |

---

## 12. Cấu hình thực nghiệm và số đo

### 12.1 Cấu hình
- Máy: Windows 11, Node v24.19.0, Java (jar Spring Boot đã build), vitest 5.0.4.
- Máy chủ thử: Spring HTTPS + 3 nút cấp khoá cùng máy (loopback); mật khẩu PBKDF2 20.000 vòng (giảm cho test); không có độ trễ mạng.
- Đo: `performance.now()`, **trung vị và p95**; số lần ghi trong từng mục. **Số đo phụ thuộc mạnh vào tải máy**: tôi chạy ba lần (riêng lẻ; song song cả bộ test; tuần tự từng file) nên báo cả khoảng. Bảng dưới lấy **lần tuần tự** (ít nhiễu nhất) làm chính.

### 12.2 Chi phí mật mã (ảnh 5 vùng + gốc) — `anh-doi-chung.json`

| Phép đo | ABE (lần tuần tự; khoảng 3 lần) | B1 | B0 | Số lần |
|---|---|---|---|---|
| Header khoá (byte), trung vị / nhỏ nhất–lớn nhất | **8.047** / 4.850–8.047 (ổn định) | 240 | 120 | — |
| BS RHM mở lại vùng của mình (phiên đã có khoá), trung vị / p95 | **101 ms** / 111 ms (khoảng 101–234 ms) | 0,1 / 0,3 ms | — | 15 |
| Người nhập mở cả 6 bản mã (phiên đã có khoá), trung vị / p95 | **343 ms** / 374 ms (343–807 ms) | 0,7 / 0,9 ms | 0,7 / 1,6 ms | 15 |
| Đăng nhập mới → thấy ảnh (gồm xin vé, 3 nút, giải mã), trung vị | **0,82 s** (0,82–1,9 s) | — | — | 3 |
| Đổi policy hồ sơ cũ (mở + bọc lại 1 bản ghi) | 0,49 s (0,49–1,8 s) | ~0,3–0,8 ms (thêm 1 nhóm) | — | 1 mỗi lần chạy |

**Đọc kết quả**: ABE chậm hơn B0/B1 khoảng **2–3 bậc** ở phần mật mã (phép ghép cặp BLS12-381; cả khoảng 3 lần chạy đều cho tỉ lệ này) — vẫn dưới ~1 s mỗi lần mở với ảnh nhỏ này. Đây là **chi phí mật mã**, không so được end-to-end với B0/B1 (chúng chỉ gồm AES-GCM trong tiến trình). Với ảnh y khoa thật (lớn hơn nhiều) phần ABE (bọc DEK) không đổi, phần AES tăng theo kích thước — **chưa đo**.

### 12.3 Quản trị (kịch bản 2) — `chinh-sach-dong.json`
E6 (n=10): hạn chế trung vị 13 ms (p95 15 ms); yêu cầu đọc bị từ chối ngay sau đó trung vị 13 ms (p95 15 ms); khôi phục 13 ms. E1 (n=1): ghi tín hiệu → từ chối đọc đầu tiên ≈ 157 ms. E4 (n=1): mở + bọc lại 1 hồ sơ ≈ 0,7 s.

### 12.4 Kết quả chạy kiểm thử (13/11/2026)

| Lần chạy | Kết quả | Ghi chú |
|---|---|---|
| Toàn bộ bộ test, **song song** (1 lần) | 204 đạt, **2 lỗi + 1 suite lỗi**, 25 bỏ qua (27 file) | Lỗi do quá tải, **không phải lỗi chức năng**: hai test khởi động máy chủ cùng chạy `vite build` vào cùng thư mục (`research-server*.test.ts`); `authorship.e2e` không gom đủ 2/3 nút trả lời trong hạn lúc máy quá tải nên 25 test bị bỏ qua |
| Chạy lại **tuần tự** (`--no-file-parallelism`): `authorship`, `abe-chinh-sach-dong`, `abe-doi-chung-anh`, `abe-truyen-tai`, `abe-pha-hoai-header`, `research-server`, `research-server-recovery` | **57/57 test đạt** (6/7 file); `research-server-recovery`: cả 2 test đạt nhưng hook dọn dẹp quá 10 s | chạy riêng lại `research-server-recovery`: **2/2 đạt** |
| Sau khi thêm kiểm tra vé ở E1: `abe-chinh-sach-dong` chạy riêng | **10/10 đạt** | `DENY_NO_ENTITLED_ATTRIBUTES` |
| Hồi quy sau khi thêm lịch sử/khôi phục header (tuần tự): `authorship`, `research.e2e`, `account-mode`, `giamsat`, `abe-chinh-sach-dong`, `abe-doi-chung-anh` | **98/98 đạt** (6/6 file) | không có test Java dựng thẳng các lớp đã đổi |
| `abe-pha-hoai-header` | **8/8 đạt** sau vá (W1 trước vá: 2 test lỗi đúng như kỳ vọng — tái hiện; W4a tái hiện ghi đè rác; W4b/W4c khôi phục) | chạy bằng PowerShell, ổ `E:` viết hoa |
| `abe-truyen-tai` | **6/6 đạt** | |
| Giao diện `accounts-ui-check.ts` | **10/10 đạt** | ảnh chụp `.test-runs/accounts-ui/` |
| `gateway.test.ts`, `research-server*.test.ts` sau khi bật HTTPS cổng Bộ Y tế | 13/13 đạt (3 file) | |

**Độ mong manh đã biết của bộ test**: chạy song song toàn bộ trên máy này có thể làm vài test hết thời gian chờ — chưa sửa; khuyến nghị chạy từng file hoặc `--no-file-parallelism`.

---

## 13. Bàn giao

### 13.1 Những gì đã sửa/thêm

| Thay đổi | File / hàm |
|---|---|
| Trạng thái **RESTRICTED**, hạn chế/khôi phục/tín hiệu rủi ro | `UserAccount.java`, `IdentityService.restrict/restore/riskSignal`, `PolicyService.attributesOf`, `ResearchAdminController`, `ResearchGateFilter` |
| Xem thuộc tính theo tài khoản + bảng epoch + nút thao tác | `app/web/src/Accounts.tsx` |
| **Vá W1** | `LegacyBridge.validateHeaderRewrap`, `HeaderController.rewrap` |
| **Vá W2** (cổng Bộ Y tế HTTPS) | `security/src/deploy/byt.ts` (`tls`), `research-server.ts` |
| **Giảm thiểu W8** (lịch sử + khôi phục + truy vết) | `web/KeyHeaderHistory.java`, `HeaderController.rewrap`, `RecordController.rewrap` (nhật ký `v2.*`), `research/ResearchHeaderAdminController.java` (3 API quản trị), 3 route trong `ResearchGateFilter` |
| Thực nghiệm mới | `abe-chinh-sach-dong`, `abe-doi-chung-anh`, `abe-truyen-tai`, `abe-pha-hoai-header` (`security/src/client/*.e2e.test.ts`), `app/test-ui/accounts-ui-check.ts` |
| (Giai đoạn trước) quên mật khẩu, MFA quản trị, tách nút cấp khoá, ảnh răng, v.v. | xem `TAI_KHOAN_NHAN_VIEN_DEMO.md`, `KICH_BAN_ABE_TIEU_BIEU.md` |

### 13.2 Lệnh chạy

```powershell
# build (khi sửa mã Java / web)
cd security\storage; .\mvnw.cmd -o -q -DskipTests package; cd ..\..
npm run web:build

# LƯU Ý (Windows): chạy từ PowerShell với ổ đĩa viết HOA (Set-Location E:\TLCN\medabe). Nếu thư mục làm việc là "e:" chữ thường, vitest báo "Vitest failed to find the current suite".
# thực nghiệm (mỗi lệnh dựng máy chủ tạm riêng; chạy RIÊNG TỪNG FILE hoặc thêm --no-file-parallelism để số đo sạch và không bị hết giờ)
npx vitest run security/src/client/abe-chinh-sach-dong.e2e.test.ts
npx vitest run security/src/client/abe-doi-chung-anh.e2e.test.ts
npx vitest run security/src/client/abe-truyen-tai.e2e.test.ts
npx vitest run security/src/client/abe-pha-hoai-header.e2e.test.ts
npx vitest run --no-file-parallelism security/src/client/authorship.e2e.test.ts security/src/client/giamsat.e2e.test.ts security/src/research/research.e2e.test.ts
npx tsx app/test-ui/accounts-ui-check.ts          # giao diện quản lý thuộc tính (ảnh: .test-runs\accounts-ui\)

# chạy lại máy chủ demo
launcher\restart-demo.ps1 -Yes
```

Kết quả (số liệu): `.test-runs/abe-thuc-nghiem/{chinh-sach-dong,anh-doi-chung,truyen-tai,pha-hoai-header}.json`.

### 13.3 Các bước demo để tự thực hiện
1. Mở "KSK Demo (ban moi)" → vào http://localhost:5180 → đăng nhập `quantri02` (+ mã TOTP, xem `TAI_KHOAN_NHAN_VIEN_DEMO.md`).
2. Trang **Tài khoản**: xem cột *Thuộc tính ABE* của `bsmat01` (`Role:BacSi`, `Khoa:Mat`, `Author`) và `quantri02` ("không có").
3. Nhấn **Báo rủi ro** ở `bsmat01` → thấy thông báo, quyền **chưa đổi**.
4. Nhấn **Hạn chế** (nhập lý do) → `bsmat01` chỉ còn `Author`; bảng *epoch* hiện `Role:BacSi 1`, `Khoa:Mat 1`.
5. Ở trình duyệt khác đăng nhập `bsmat01` (đang mở sẵn từ trước): yêu cầu kế tiếp **không còn thấy** hồ sơ người khác; hồ sơ **do chính `bsmat01` nhập** vẫn đọc được.
6. Nhấn **Khôi phục** → thuộc tính trở lại.
7. Kịch bản ảnh: đăng nhập `nhaplieu01` → tải ảnh nhiều vùng cho một bệnh nhân giả; đăng nhập lần lượt `bsmat01`, `bstmh01`, `bsrhm01`, `bsnhi01` → mỗi người thấy **đúng vùng khoa mình**, `bsnhi01` không thấy gì; `quantri02` không thấy ảnh.

### 13.4 Giới hạn còn lại
- Khoá/bản mã đã sao chép vẫn mở dữ liệu cũ (W4); cửa sổ bọc lại lười (E4): hồ sơ không ai mở lại giữ epoch cũ cho tới khi có người mở.
- 2/3 nút bị chiếm ⇒ mất bảo mật (W5); cả ba nút đang chạy cùng một máy trong demo (có công cụ tách: `node-server.ts`, `tach-nut.ts`).
- Người được đọc có thể chép (W6); siêu dữ liệu lộ cho máy chủ (W7).
- Tải app web qua HTTP không SRI (W3). Đường hầm phụ huynh, LAN thật: chưa xác minh.
- Các đường vào cũ (`demo.ts`, KSK.exe) và bản đóng gói `release\` (05/11/2026) chưa có các thay đổi này.
- Ghi đè header bằng khoá bọc rác **chưa ngăn được lúc ghi** (W8): chỉ phát hiện sau (khi có người không mở được) và khôi phục từ tối đa 5 phiên bản gần nhất; chưa có giao diện quản trị cho việc này (chỉ API). Dữ liệu H2 cục bộ: chỉ phù hợp nghiên cứu, không phải kho sản xuất.
- Biểu mẫu hồ sơ chưa đối chiếu đầy đủ với quy định hiện hành (Thông tư 25/2026) — **chưa xác minh**.
- B0/B1 là mô phỏng trong tiến trình (không có KMS/mạng thật); chỉ so cơ chế bảo vệ, không so độ trễ end-to-end.

---

## 14. Đoạn ngắn để giải thích với thầy

> Trong hệ thống thông thường, dữ liệu được mã hoá khi lưu nhưng **máy chủ giữ khoá và tự giải mã** sau khi kiểm quyền; ai chiếm được máy chủ hoặc khoá của nó thì đọc được tất cả. Với ABE, **máy chủ chỉ giữ bản mã** — mỗi hồ sơ (hoặc từng vùng ảnh) được khoá bằng một *chính sách thuộc tính* (ví dụ "bác sĩ **và** khoa Mắt, hoặc chính người nhập"), còn khoá giải mã được cấp theo thuộc tính của tài khoản bởi 3 nút (cần 2 nút đồng thuận) và giải mã ở **máy của người dùng**. Em đã thử với ảnh nhiều vùng: cả hai bác sĩ đều cầm bản mã nhưng chỉ bác sĩ đúng khoa mở được vùng của mình; khi kẻ tấn công có khoá phía máy chủ, phương án thông thường lộ 6/6 mảnh còn ABE là 0/6. Em cũng so với phương án khoá nhóm do KMS giữ: **quyền đọc giống hệt**, khác là ABE không có một chỗ giữ khoá của mọi khoa, nhưng chậm hơn và header lớn hơn nhiều. Khi nghi tài khoản bị chiếm, quản trị **hạn chế** quyền: máy chủ chặn ngay phiên đang mở (yêu cầu kế tiếp đã bị từ chối; ~13 ms trên loopback), dữ liệu mới/đã bọc lại không còn mở được bằng khoá cũ, nhưng **bản mã đã tải kèm khoá cũ thì vẫn mở được dữ liệu cũ — đây là giới hạn cố hữu của ABE**, không riêng app. Trong quá trình thử, em tìm ra và vá một lỗi riêng của app (người đọc hợp lệ có thể bọc lại header dùng chung sang chính sách khác làm cả lô mất khả năng giải mã), và phát hiện cổng liên thông Bộ Y tế chạy HTTP làm lộ siêu dữ liệu nên đã chuyển sang HTTPS. ABE bảo vệ **nội dung**, TLS bảo vệ **kết nối**; hai lớp bổ sung chứ không thay nhau.

---

## 15. Tài liệu tham khảo

*Đối chiếu thư mục qua tra cứu web trong phiên này (chỉ xem tóm tắt/bản ghi thư mục, **chưa đọc lại toàn văn PDF**); các mục đánh dấu † là từ kiến thức, chưa tra lại.*

1. V. Goyal, O. Pandey, A. Sahai, B. Waters. *Attribute-Based Encryption for Fine-Grained Access Control of Encrypted Data.* ACM CCS 2006. † (KP-ABE)
2. J. Bethencourt, A. Sahai, B. Waters. *Ciphertext-Policy Attribute-Based Encryption.* IEEE S&P 2007, tr. 321–334, DOI 10.1109/SP.2007.11. (CP-ABE)
3. Y. Rouselakis, B. Waters. *Efficient Statically-Secure Large-Universe Multi-Authority Attribute-Based Encryption.* Financial Cryptography 2015, LNCS 8975, tr. 315–332; ePrint 2015/016. (lược đồ dự án dùng, chứng minh an toàn tĩnh trong mô hình random oracle)
4. A. Sahai, H. Seyalioglu, B. Waters. *Dynamic Credentials and Ciphertext Delegation for Attribute-Based Encryption.* CRYPTO 2012; ePrint 2012/437. (thu hồi bằng cập nhật bản mã; chỉ tác dụng với bản mã còn do máy chủ kiểm soát)
5. M. Pirretti, P. Traynor, P. McDaniel, B. Waters. *Secure Attribute-Based Systems.* ACM CCS 2006. † (hết hạn thuộc tính/rekey — tương ứng cơ chế epoch)
6. E. Rescorla. *The Transport Layer Security (TLS) Protocol Version 1.3.* RFC 8446 (2018). (TLS bảo vệ bí mật, toàn vẹn, xác thực máy chủ cho kết nối)
7. W3C. *Subresource Integrity* (Recommendation). † ; MDN. *SubtleCrypto* — chỉ có trong ngữ cảnh an toàn (secure context). †
8. NIST SP 800-38D (AES-GCM, yêu cầu về IV) †; NIST SP 800-57 Part 1 (quản lý khoá) †; NIST SP 800-162 (hướng dẫn ABAC) †.
