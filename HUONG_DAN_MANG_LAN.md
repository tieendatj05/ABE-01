# KSK Nhân viên dùng chung Wi-Fi/LAN với máy KSK Admin

## Chạy trên hai máy

1. Máy chủ: mở `release/KSK-win32-x64/KSK.exe`. Giữ ứng dụng mở để máy chủ và các nút cấp khóa hoạt động.
2. Lần đầu chạy `Cau-Hinh-Mang-LAN.cmd` trên máy chủ và máy nhân viên, chấp nhận hộp quyền quản trị Windows. Script chỉ cho phép **LocalSubnet** trên các hồ sơ mạng; không đổi chế độ Public/Private của Wi-Fi.
3. Nhân viên: chép **cả thư mục** `release/KSK-NhanVien-win32-x64/` sang máy nhân viên (không chỉ chép một file exe), rồi dùng bản `release/KSK-NhanVien-win32-x64/KSK-NhanVien.exe` đã cập nhật; kết nối cùng mạng với Admin và mở ứng dụng.
4. App tự tìm máy chủ. Thiết bị mới vẫn cần được Admin cho đăng ký/cấp gói và cấp đúng thuộc tính. Cùng mạng không tự có quyền quản trị hoặc quyền ABE.
5. Chọn cùng **Công ty** để xem cùng danh sách. Đăng ký mới không tự tạo học sinh; cần import dữ liệu vào đúng kho trên Admin.

## Khi Admin đổi Wi-Fi hoặc IP

Ứng dụng không còn đóng cứng IP lúc đóng gói. Nhân viên đổi sang cùng mạng mới rồi bấm **Tìm máy chủ trong mạng**, hoặc đợi app tự dò.
Danh tính máy chủ được kiểm chứng bằng chữ ký registry trước khi gửi token. Thiết bị đã đăng ký giữ nguyên danh tính; không tự xóa kho khóa hay đăng ký sang một máy chủ lạ.
Nếu mạng có nhiều KSK độc lập, máy mới cần chọn đúng máy chủ. Máy đã đăng ký chỉ nối lại hệ thống khớp chứng chỉ của mình.

## Khi khác mạng, mất Wi-Fi hoặc máy chủ tắt

Sau lượt heartbeat thất bại, app bỏ màn hình phiếu khám, danh sách, preview import và báo cáo; xóa cache khóa/DEK có thể dùng trong phiên và hủy yêu cầu đang chạy.
Không nhập, lưu, xem hoặc xuất báo cáo khi chưa kết nối lại. Màn hình thông báo lý do và tự tìm lại máy chủ.
Độ trễ phát hiện gồm chu kỳ kiểm tra khoảng 3 giây và thời gian timeout mạng. App không tự gửi lại lệnh lưu đã lỗi để tránh trùng dữ liệu.
Dữ liệu đang nhập nhưng chưa Lưu không được giữ qua lúc khóa kết nối; cần nhập lại.
Tệp/báo cáo hoặc ảnh đã xuất trước đó không thể thu hồi bằng việc ngắt mạng.

## Điều kiện của Wi-Fi

- Không cần Internet; cần hai máy liên lạc nội bộ được.
- Guest Wi-Fi, AP/client isolation hoặc VLAN tách máy có thể ngăn hai máy kết nối dù tên Wi-Fi giống nhau. Tắt cô lập thiết bị hoặc dùng mạng nội bộ cho phép máy liên lạc.
- Phạm vi hiện tại là IPv4 cùng subnet của card mạng thật (Wi-Fi/Ethernet); không hỗ trợ IPv6-only hoặc tự mở qua Internet/VPN.
- UDP 43821 dùng để dò; TCP 8090 và 9001–9003 dùng cho kho dữ liệu/cấp khóa. Firewall chỉ cho các địa chỉ LocalSubnet, ở cả mạng Public và Private.
- Cùng máy tính có thể kết nối qua localhost để chạy thử.

## Bảo mật ABE giữ vai trò gì?

LAN quyết định app có kết nối/làm việc được không. ABE quyết định thuộc tính nào giải mã được hồ sơ qua kênh nhân viên.
Dò máy chủ và heartbeat không làm mất yêu cầu đăng ký, chữ ký hoặc ngưỡng cấp khóa 2/3.
Chữ ký khám phá máy chủ không thay thế TLS: HTTP chưa chống mọi nghe lén trên Wi-Fi; dùng mạng nội bộ tin cậy cho bản demo.
Kênh phụ huynh bằng CCCD là cơ chế riêng; xem `HUONG_DAN_THUYET_TRINH.md` để trình bày đúng giới hạn ABE.

## Tự kiểm tra trước demo

- Cùng Wi-Fi: mở Admin, mở Nhân viên, chờ **Đã kết nối**, import học sinh giả và tải lại.
- Tắt Wi-Fi của máy nhân viên: chờ thông báo chưa kết nối, xác nhận danh sách biến mất và không có màn Import/Báo cáo.
- Nối lại cùng Wi-Fi: app tự tìm lại đúng máy chủ và tải lại hồ sơ.
- Chuyển cả hai máy sang Wi-Fi khác: lặp lại, không sửa IP trong code/đóng gói lại.
- Nếu kết nối thất bại: kiểm tra firewall LocalSubnet và chế độ cô lập thiết bị của router.

## Kết quả kiểm tra bản cập nhật 17/10/2026

- TypeScript và build cả hai bản nhân viên/quản trị đạt.
- Bộ Vitest: 54 bài đạt; Java: 5 bài đạt. Ca tiếp tục đăng ký sau mất nút được chạy riêng và đạt.
- File KSK-NhanVien.exe được chạy với 5 học sinh giả: import số điện thoại dạng số, lưu chỉ số khám, tải lại, khóa nội dung khi mô phỏng offline và tự khôi phục khi online đều đạt.
- KSK.exe được chạy với hồ sơ thử mới: máy chủ nhúng, endpoint ký proof, UDP discovery và giao diện quản trị đều hoạt động.
- Firewall máy phát triển đã xác nhận 7 quy tắc KSK chỉ cho RemoteAddress=LocalSubnet.
- Chưa thử trực tiếp trên hai laptop đổi sang một Wi-Fi khác; cần nghiệm thu tại mạng thực tế, nhất là router có AP isolation hoặc VLAN.
