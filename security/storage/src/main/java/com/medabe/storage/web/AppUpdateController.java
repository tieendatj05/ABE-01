package com.medabe.storage.web;

import com.medabe.storage.MedProps;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import java.util.Set;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * TỰ CẬP NHẬT ứng dụng: chỉ phục vụ MÃ ỨNG DỤNG (app.asar của từng edition, không phải dữ liệu bệnh nhân), để máy nhân viên/quản trị
 * mở lại app sau khi admin đóng gói lại là có tính năng mới, không phải tự tải/cài thủ công.
 *   npm run ... -> app/desktop/update-packaged.mjs ghi admin.asar/user.asar vào thư mục này -> máy khách so hash -> tải -> áp dụng
 *   khi khởi động lại (resources/app.asar), xem app/desktop/main.ts.
 * Đọc công khai trong LAN (như /api/config): đây không phải dữ liệu nhạy cảm. Toàn vẹn chỉ dựa vào hash do CHÍNH máy chủ này báo cáo -
 * không phải chữ ký độc lập; máy khách vốn đã tin máy chủ đã ghép đôi (xem server-proof.ts), nên đây không phải biên tin cậy mới.
 */
@RestController
public class AppUpdateController {
    private static final Set<String> EDITIONS = Set.of("admin", "user");
    private final MedProps props;

    public AppUpdateController(MedProps props) { this.props = props; }

    private Path asarPath(String edition) {
        if (!EDITIONS.contains(edition)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "edition phai la admin hoac user");
        if (props.appUpdatesDir() == null || props.appUpdatesDir().isBlank())
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "chua bat tinh nang tu cap nhat (medabe.app-updates-dir)");
        return Path.of(props.appUpdatesDir(), edition + ".asar");
    }

    @GetMapping("/api/app/version")
    public Map<String, Object> version(@RequestParam String edition) throws IOException {
        Path p = asarPath(edition);
        if (!Files.isRegularFile(p)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "chua co ban cap nhat cho " + edition);
        byte[] bytes = Files.readAllBytes(p);
        String hash = sha256Hex(bytes);
        return Map.of("edition", edition, "hash", hash, "size", bytes.length);
    }

    @GetMapping("/api/app/download")
    public ResponseEntity<FileSystemResource> download(@RequestParam String edition) {
        Path p = asarPath(edition);
        if (!Files.isRegularFile(p)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "chua co ban cap nhat cho " + edition);
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header("Content-Disposition", "attachment; filename=\"" + edition + ".asar\"")
                .body(new FileSystemResource(p));
    }

    static String sha256Hex(byte[] data) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
