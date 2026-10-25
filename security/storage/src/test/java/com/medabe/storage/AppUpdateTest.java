package com.medabe.storage;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.medabe.storage.web.AppUpdateController;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

/**
 * Tự cập nhật: máy khách so hash app.asar đang chạy với bản máy chủ đang giữ, tải về nếu khác (xem UpdateBanner.tsx).
 * Gọi thẳng controller (cùng cách các test khác trong gói này đang làm) thay vì dựng server thật.
 */
@SpringBootTest(properties = {
        "medabe.pk-json={\"id\":\"MED\"}",
        "medabe.siem-file=target/test-siem-appupdate.jsonl",
        "spring.datasource.url=jdbc:h2:mem:appupdatetest;DB_CLOSE_DELAY=-1",
        "medabe.app-updates-dir=target/test-app-updates",
})
class AppUpdateTest {
    @Autowired AppUpdateController controller;

    @Test
    void chuaCoFileThiBao404KhongPhaiLoi500() {
        var e = assertThrows(ResponseStatusException.class, () -> controller.version("user"));
        assertTrue(e.getStatusCode().is4xxClientError());
    }

    @Test
    void editionSaiBiTuChoi() {
        var e = assertThrows(ResponseStatusException.class, () -> controller.version("hacker"));
        assertEquals(400, e.getStatusCode().value());
    }

    @Test
    void coFileThiBaoDungHashVaDungKichThuoc() throws IOException, java.security.NoSuchAlgorithmException {
        Path dir = Path.of("target", "test-app-updates");
        Files.createDirectories(dir);
        byte[] content = "noi dung gia lap app.asar".getBytes();
        Files.write(dir.resolve("user.asar"), content);

        Map<String, Object> info = controller.version("user");
        assertEquals("user", info.get("edition"));
        assertEquals(content.length, info.get("size"));
        assertEquals(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content)), info.get("hash"));

        var dl = controller.download("user");
        assertEquals(200, dl.getStatusCode().value());
        assertEquals(content.length, dl.getBody().contentLength());

        Files.deleteIfExists(dir.resolve("user.asar")); // dọn dẹp
    }
}
