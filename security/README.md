# Phần bảo mật (độc lập với ứng dụng)

Toàn bộ mật mã, cấp khoá, kho ciphertext và giám sát nằm trong thư mục này. Ứng dụng (`../app`) chỉ nói chuyện với phần này qua **một cổng duy nhất**: [`src/index.ts`](src/index.ts). Muốn đưa vào hệ thống khác, lấy thư mục `security/` đi là đủ.

```
security/
  src/index.ts            <- CỔNG DUY NHẤT của SDK (chạy trong trình duyệt/Electron)
  src/abe/                CP-ABE đa cơ quan RW15 + khoá sinh ngưỡng 2-trên-3 + header chung (rw15.ts, lsss.ts, policy.ts)
  src/client/             MedClient (lưu/đọc/phá vỡ kính), khoá thiết bị + kho khoá, policy tự sinh theo hồ sơ
  src/hardware.ts         nhận diện phần cứng máy trạm (CPU/board/BIOS/ổ đĩa/MAC) - dùng ở tiến trình chính của Electron
  src/authority/node.ts   MỘT nút cấp khoá (Bệnh viện / Sở Y tế / App điện thoại), tự duyệt theo chính sách của nó
  src/deploy/             khởi tạo dealer, chạy 3 nút, chạy cả hệ thống demo
  src/byt/                Cổng liên thông Bộ Y tế (mô phỏng): nhận bản mã hoá, ký biên nhận (receipt.ts, gateway.ts)
  storage/                Spring Boot + JPA: kho ciphertext MÙ, registry định danh, epoch, audit chuỗi băm, SIEM
```

## Cổng SDK (`src/index.ts`)
| Dùng | Hàm |
|---|---|
| Lưu | `client.saveRecord({ patientCode, type, khoa, data, group })` / `client.saveMany([...])` (nhập lô: chỉ 1 phép ABE) |
| Đọc | `client.listRecords(patientCode)`, `client.listGroup(unit)`, `client.openRecord(rec)`, `client.openMany(rows)` |
| Cấp cứu | `client.breakGlass(patientCode, lyDo)` |
| Khoá | `MedClient.register(...)`, `client.claim(nút, mã)`, `sealVault/openVault`, `loadOrCreateDeviceKeys` |
| Chính sách | `policyFor(profile, epoch)` — nơi DUY NHẤT quyết định "ai đọc loại dữ liệu nào" |

Ứng dụng **không** thấy khoá, policy, epoch hay bọc lại khoá; chúng tự động.

## Mô hình
- **Mã hoá lai**: AES-256-GCM cho dữ liệu; CP-ABE chỉ bọc khoá AES (DEK).
- **Mỗi mục của phiếu khám là một bản ghi riêng, policy riêng** (`src/client/policy.ts`): Tiếp đón đọc Hành chính nhưng không đọc Lâm sàng; bác sĩ chỉ đọc lâm sàng của khoa mình; bác sĩ kết luận đọc tất cả; mỗi bản ghi có nhánh "thiết bị tác giả" và nhánh phá-vỡ-kính theo bệnh nhân.
- **Header chung** (`KeyHeader`): các bản ghi cùng chính sách (vd cả lô Hành chính của một trường) dùng chung MỘT header ABE; mỗi bản ghi có khoá con `HKDF(DEK, recordId)` và chữ ký số riêng. Nhập 1.000 hồ sơ = 1 phép ABE; mở danh sách 1.000 dòng = 1 phép ABE + 1.000 phép AES; đổi epoch chỉ bọc lại 1 header.
- **Cấp khoá ngưỡng 2-trên-3**: bí mật gốc chia Shamir cho 3 nút; cần ≥ 2 nút (mỗi nút tự duyệt) mới ghép được khoá; một nút bị hack không tạo được khoá.
- **Danh tính**: registry cấp GID duy nhất + chứng chỉ Ed25519 gắn với khoá công khai thiết bị; khoá ABE gắn `H(GID)` nên ghép khoá của hai người không giải mã được. Nút còn yêu cầu thiết bị chứng minh sở hữu khoá riêng (PoP).
- **Chỉ mục mù**: máy chủ chỉ thấy `HMAC(mã bệnh nhân)` và `HMAC(mã đơn vị)`, không thấy mã gốc.
- **Epoch/thu hồi**: tên thuộc tính gắn `#<tuần>.<bộ đếm>`; thu hồi tăng bộ đếm; bản ghi/header được **tự bọc lại** khi người còn quyền mở nó.
- **SIEM**: sự kiện (phá vỡ kính, giải mã thất bại, khoá thiết bị...) ra `data/siem/events.jsonl` (JSON, cho Wazuh) và `/api/siem/events?format=cef`; ≥5 lần `DECRYPT_FAIL`/10 phút ⇒ tự khoá thiết bị.

## API máy chủ (Spring, `storage/`) — để tích hợp từ ngôn ngữ khác
`GET /api/config` · `POST /api/register` · `GET /api/epochs` · `POST/GET /api/records`, `POST /api/records/batch`, `DELETE /api/records/{id}` · `POST/GET/PUT /api/headers` · `POST /api/events` · `GET /api/siem/events`. Máy chủ **không giải mã được** gì; mọi mã hoá/giải mã/ký nằm ở máy trạm. Phần mật mã hiện bằng TypeScript (cặp ghép BLS12-381); nếu hệ thống đích là .NET/Java, cách phù hợp là chạy SDK này như một **agent cục bộ** trên máy trạm (HTTP 127.0.0.1) và để ứng dụng cũ gọi qua đó — **chưa làm**, đây là hướng tiếp theo.

## Liên thông Bộ Y tế (mô phỏng)
`MedClient.bytSubmit/bytStatus/bytRecords/bytStats`: gửi bản ghi **đã mã hoá** kèm header ABE lên cổng (`src/byt/gateway.ts`, cổng 8095), nhận biên nhận Ed25519 (`verifyReceipt`). Mỗi yêu cầu được ký bằng khoá thiết bị; cổng kiểm chứng chỉ của registry nên không cần token. Cán bộ `Org:SoYTe` tải ciphertext từ cổng rồi giải mã bằng ABE như bình thường. Phụ huynh tra qua `/api/public/*` của cổng (cần CCCD + mã tra cứu).

## Kiểm thử
```
npm run security:jar          # đóng gói Spring (cần Java 25)
npm run security:test         # 28 test: lõi ABE/ngưỡng/header chung, phần cứng, đầu-cuối trên Spring + 3 nút thật
cd security/storage && ./mvnw test
```

## Quản trị: ai được cấu hình bảo mật
- Token quản trị (registry + từng nút + mã duyệt) **sinh ngẫu nhiên** lần đầu chạy (`security/src/deploy/secrets.ts` → `admin-secrets.json`), không có giá trị mặc định đoán được; không in ra console.
- Việc quản trị chạy từ **trạm quản trị** (xem `app/desktop/adminvault.ts`): token cất trong kho mã hoá bằng mật khẩu quản trị (scrypt → AES-GCM) + DPAPI + buộc phần cứng, khoá sau 5 lần sai (tăng gấp đôi mỗi đợt), tự khoá sau 5 phút; giao diện không thấy token, tiến trình chính gọi máy chủ qua danh sách trắng đường dẫn.
- Máy chủ (Spring) và các nút đều **chống dò token**: sai 5 lần/phút từ một địa chỉ thì HTTP 429 trong 60 giây, kể cả khi sau đó đưa đúng token.
- Bản build `user` của ứng dụng không chứa mã quản trị (kiểm tra trong `app/test-ui/user-edition-check.mjs`).

## Giới hạn — phải nói thật
- **Quyền GHI không được ép bằng mật mã**: ABE bảo vệ việc ĐỌC. Một người có thể mã hoá một bản ghi giả vào policy bất kỳ; giao diện chỉ gợi ý quyền ghi theo vai trò. Hướng giảm thiểu: nút cấp *chứng chỉ vai trò có ký* và người đọc kiểm tra vai trò của tác giả.
- **Thu hồi chỉ bảo vệ từ lúc được bọc lại**; ai đã tải/giải mã trước đó hoặc giữ khoá epoch cũ vẫn đọc được bản chưa ai mở lại.
- **Header chung**: ai đọc được một bản ghi trong lô thì đọc được cả lô (đúng vì cùng chính sách, nhưng không có tách biệt theo từng bệnh nhân trong lô). Mục lâm sàng/kết luận KHÔNG dùng header chung (mỗi bản ghi một header, có nhánh phá-vỡ-kính theo bệnh nhân).
- **Dealer tin cậy khi khởi tạo** (bí mật gốc tồn tại thoáng qua); bản thật dùng sinh khoá phân tán (DKG).
- **Metadata công khai**: loại mục, khoa, thời điểm, chính sách, kích thước, thiết bị tạo, số bản ghi theo đơn vị.
- **Phá-vỡ-kính hết hạn là "cố gắng hết sức"**: chắc chắn chỉ có cảnh báo + nhật ký.
- Máy trạm nhiễm mã độc khi đang mở khoá vẫn lấy được dữ liệu; cặp ghép không kháng lượng tử; **chưa kiểm toán mật mã** — không dùng cho dữ liệu bệnh nhân thật.

## Agent bảo vệ hệ thống (chạy trong máy chủ, không gọi AI ngoài)
`SecurityAgentService` (Java, `security/storage/.../service/SecurityAgentService.java`) lắng nghe MỌI sự kiện an ninh ngay khi được ghi
và tự quyết định có hành động không - vòng lặp phát hiện → quyết định → hành động thật, không phải chỉ cảnh báo. Không gọi mô hình
ngôn ngữ nào nên chạy offline, không tốn phí, không phụ thuộc mạng lúc demo.

| Luật | Ngưỡng mặc định | Hành động tự động |
|---|---|---|
| Giải mã thất bại liên tiếp (1 thiết bị) | 5 lần / 10 phút | Khoá thiết bị |
| Bị từ chối quyền đọc liên tiếp (dò quyền) | 8 lần / 5 phút | Khoá thiết bị |
| Nhiều thiết bị đăng ký cùng phần cứng (đăng ký hàng loạt/nhân bản) | 3 thiết bị / 5 phút | Khoá các thiết bị đăng ký sau, giữ thiết bị sớm nhất |
| Một thiết bị phá-vỡ-kính nhiều bệnh nhân khác nhau (lạm dụng cấp cứu) | 3 bệnh nhân / 15 phút | Khoá thiết bị (không đóng các lần cấp cứu đang hiệu lực) |
| Chuỗi băm nhật ký quản trị bị sửa/xoá (kiểm mỗi 2 phút) | gãy chuỗi | Tắt đăng ký tự do |

Mọi hành động tự động đều ghi sự kiện `AGENT_*`/`DEVICE_LOCKED` (CRITICAL) và một dòng trong chuỗi audit (`actor: "agent"`), hiển thị
nổi bật ở **Giám sát an ninh**. Ngưỡng đổi được bằng biến môi trường (`MEDABE_AGENT_*`, xem `application.properties`); tắt hẳn bằng
`MEDABE_AGENT_ENABLED=false`. Test: `security/storage/.../test/.../SecurityAgentTest.java` (6 ca, mỗi luật một ca + 1 ca "không báo động
nhầm với một lần phá-vỡ-kính bình thường").
