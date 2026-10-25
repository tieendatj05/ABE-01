package com.medabe.storage;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.medabe.storage.domain.DeviceEntity;
import com.medabe.storage.domain.Repos;
import com.medabe.storage.service.AuditService;
import com.medabe.storage.service.EventService;
import com.medabe.storage.service.SecurityAgentService;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * Agent bảo vệ hệ thống: mỗi luật tự phát hiện bất thường và TỰ KHOÁ ngay trong cùng một lần ghi sự kiện (không cần job nền),
 * trừ luật kiểm tra chuỗi audit (gọi thủ công agent.checkAuditIntegrity() ở test cuối). Ngưỡng đặt thấp để test nhanh, gọn.
 */
@SpringBootTest(properties = {
        "medabe.pk-json={\"id\":\"MED\"}",
        "medabe.siem-file=target/test-siem-agent.jsonl",
        "spring.datasource.url=jdbc:h2:mem:agenttest;DB_CLOSE_DELAY=-1",
        "medabe.fail-threshold=3", "medabe.fail-window-minutes=10",
        "medabe.agent-denied-threshold=3", "medabe.agent-denied-window-minutes=10",
        "medabe.agent-hw-burst-count=3", "medabe.agent-hw-burst-window-minutes=10",
        "medabe.agent-breakglass-patients=3", "medabe.agent-breakglass-window-minutes=10",
})
class SecurityAgentTest {
    @Autowired EventService events;
    @Autowired SecurityAgentService agent;
    @Autowired AuditService audit;
    @Autowired Repos.Devices devices;
    @Autowired Repos.Audit auditRepo;
    @Autowired Repos.Kv kv;

    private static final AtomicLong SEQ = new AtomicLong();
    private String gid() { return String.format("%032x", SEQ.incrementAndGet()); }

    private DeviceEntity device(String gid) {
        DeviceEntity d = new DeviceEntity();
        d.gid = gid; d.name = "May " + gid.substring(0, 6); d.deviceId = gid.substring(0, 16);
        d.devicePub = "04" + "a".repeat(128); d.disabled = false; d.createdAt = Instant.now();
        return devices.save(d);
    }

    @Test
    void giaiMaThatBaiLienTiepThiTuKhoaThietBi() {
        String g = gid();
        device(g);
        for (int i = 0; i < 2; i++) events.record("device:x", "DECRYPT_FAIL", "WARN", "thu " + i, null, g);
        assertFalse(devices.findById(g).orElseThrow().disabled);                 // chưa đủ ngưỡng (3)
        events.record("device:x", "DECRYPT_FAIL", "WARN", "thu 3", null, g);
        assertTrue(devices.findById(g).orElseThrow().disabled);                  // đủ ngưỡng -> tự khoá
        assertTrue(events.latest().stream().anyMatch(e -> "DEVICE_LOCKED".equals(e.type) && g.equals(e.deviceGid)));
    }

    @Test
    void doQuyenLienTucThiTuKhoaThietBi() {
        String g = gid();
        device(g);
        events.record("device:x", "ACCESS_DENIED", "INFO", "a", null, g);
        events.record("device:x", "ACCESS_DENIED", "INFO", "b", null, g);
        assertFalse(devices.findById(g).orElseThrow().disabled);
        events.record("device:x", "ACCESS_DENIED", "INFO", "c", null, g);
        assertTrue(devices.findById(g).orElseThrow().disabled);
        assertTrue(events.latest().stream().anyMatch(e -> "AGENT_ACCESS_DENIED_BURST".equals(e.type) && "CRITICAL".equals(e.severity)));
    }

    @Test
    void dangKyHangLoatCungPhanCungThiTuKhoaCacThietBiMoiGiuLaiThietBiGoc() throws InterruptedException {
        String hw = "b".repeat(64);
        DeviceEntity first = device(gid());
        first.hwHash = hw; devices.save(first);
        Thread.sleep(5);
        DeviceEntity second = device(gid());
        second.hwHash = hw; devices.save(second);
        // Sự kiện DUPLICATE_HARDWARE do RegistryController phát ra khi đăng ký thiết bị THỨ HAI trùng phần cứng; subject = mã phần cứng.
        events.record("registry", "DUPLICATE_HARDWARE", "WARN", "trung phan cung", hw, second.gid);
        assertFalse(devices.findById(first.gid).orElseThrow().disabled);
        assertFalse(devices.findById(second.gid).orElseThrow().disabled);        // mới 2 thiết bị, chưa đủ ngưỡng (3)

        Thread.sleep(5);
        DeviceEntity third = device(gid());
        third.hwHash = hw; devices.save(third);
        events.record("registry", "DUPLICATE_HARDWARE", "WARN", "trung phan cung", hw, third.gid);

        assertFalse(devices.findById(first.gid).orElseThrow().disabled);         // thiết bị ĐĂNG KÝ SỚM NHẤT được giữ lại
        assertTrue(devices.findById(second.gid).orElseThrow().disabled);         // các thiết bị sau đó bị khoá
        assertTrue(devices.findById(third.gid).orElseThrow().disabled);
        assertTrue(events.latest().stream().anyMatch(e -> "AGENT_DUPLICATE_HARDWARE_BURST".equals(e.type)));
    }

    @Test
    void phaVoKinhNhieuBenhNhanThiTuKhoaThietBiNhungKhongDongCacLanDangHieuLuc() {
        String g = gid();
        device(g);
        events.record("node:BenhVien", "BREAK_GLASS", "CRITICAL", "x", "p1".repeat(16), g);
        events.record("node:BenhVien", "BREAK_GLASS", "CRITICAL", "x", "p2".repeat(16), g);
        assertFalse(devices.findById(g).orElseThrow().disabled);
        events.record("node:BenhVien", "BREAK_GLASS", "CRITICAL", "x", "p3".repeat(16), g);
        assertTrue(devices.findById(g).orElseThrow().disabled);
        assertTrue(events.latest().stream().anyMatch(e -> "AGENT_BREAK_GLASS_ABUSE".equals(e.type)));
        // 3 sự kiện BREAK_GLASS gốc vẫn còn nguyên (chưa bị đóng), đúng như thiết kế: không cắt cấp cứu đang hiệu lực.
        assertEquals(3, events.latest().stream().filter(e -> "BREAK_GLASS".equals(e.type) && g.equals(e.deviceGid)).count());
    }

    @Test
    void motLanPhaVoKinhDonLeKhongBiAnhHuong() {
        String g = gid();
        device(g);
        events.record("node:BenhVien", "BREAK_GLASS", "CRITICAL", "x", "benh-nhan-mot-minh", g);
        assertFalse(devices.findById(g).orElseThrow().disabled);
    }

    @Test
    void chuoiAuditBiSuaThiTuTatDangKyTuDo() {
        audit.log("test", "tao-mot-ban-ghi", "truoc khi bi sua");
        assertTrue((Boolean) audit.verify().get("ok"));
        // Mô phỏng kẻ tấn công SỬA TRỰC TIẾP trong DB (bỏ qua AuditService.log, không cập nhật lại hash): chuỗi băm sẽ gãy.
        var row = auditRepo.findTopByOrderBySeqDesc().orElseThrow();
        row.detail = row.detail + " (DA BI SUA TRUC TIEP TRONG DB)";
        auditRepo.save(row);
        assertFalse((Boolean) audit.verify().get("ok"));

        agent.checkAuditIntegrity();
        assertTrue(events.latest().stream().anyMatch(e -> "AGENT_AUDIT_TAMPERED".equals(e.type)));
        assertEquals("false", kv.findById("enrollment.open").orElseThrow().v);   // tự khoá đăng ký mới
        agent.checkAuditIntegrity(); // gọi lại: không báo thêm lần nữa cho cùng điểm gãy
        assertEquals(1, events.latest().stream().filter(e -> "AGENT_AUDIT_TAMPERED".equals(e.type)).count());
    }
}
