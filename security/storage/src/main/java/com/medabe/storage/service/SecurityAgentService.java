package com.medabe.storage.service;

import com.medabe.storage.MedProps;
import com.medabe.storage.domain.ConfigKv;
import com.medabe.storage.domain.DeviceEntity;
import com.medabe.storage.domain.Repos;
import com.medabe.storage.domain.SecurityEvent;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

/**
 * AGENT BẢO VỆ HỆ THỐNG: không gọi mô hình ngôn ngữ nào, chạy hoàn toàn trong máy chủ (không cần Internet, không tốn phí,
 * không rớt khi demo). Vòng lặp PHÁT HIỆN → QUYẾT ĐỊNH → HÀNH ĐỘNG thật: lắng nghe mọi sự kiện an ninh ngay khi được ghi
 * (qua EventService.SecurityEventRecorded), áp một số luật phát hiện bất thường, và khi vượt ngưỡng thì TỰ ĐỘNG khoá
 * thiết bị / khoá đăng ký mới — không chờ admin bấm nút.
 *
 * Các luật (mỗi luật độc lập, có ngưỡng cấu hình riêng trong MedProps):
 *  1. Giải mã thất bại liên tiếp từ một thiết bị            -> nghi vấn mạo danh thuộc tính / brute-force    -> khoá thiết bị
 *  2. Bị từ chối quyền đọc (ACCESS_DENIED) liên tiếp         -> nghi vấn dò quyền có hệ thống                -> khoá thiết bị
 *  3. Nhiều thiết bị đăng ký CÙNG một phần cứng trong ít phút -> nghi vấn đăng ký hàng loạt / nhân bản thiết bị -> khoá các thiết bị đó
 *  4. Một thiết bị phá-vỡ-kính nhiều BỆNH NHÂN KHÁC NHAU trong ít phút -> nghi vấn lạm dụng cấp cứu           -> khoá thiết bị
 *  5. (SecurityAgentJob, chạy định kỳ) Chuỗi băm nhật ký quản trị bị sửa/xoá -> hệ thống có thể đã bị can thiệp -> tắt đăng ký tự do
 *
 * Mọi hành động TỰ ĐỘNG đều ghi một sự kiện AGENT_* (CRITICAL) để không "âm thầm" - admin luôn thấy agent vừa làm gì trong
 * màn hình Giám sát an ninh, và chuỗi audit vẫn ghi lại actor "agent".
 */
@Service
public class SecurityAgentService {
    private final Repos.Events eventRepo;
    private final Repos.Devices devices;
    private final Repos.Kv kv;
    private final EventService events;
    private final AuditService audit;
    private final MedProps props;
    private final Clock clock;

    public SecurityAgentService(Repos.Events eventRepo, Repos.Devices devices, Repos.Kv kv, EventService events, AuditService audit, MedProps props, Clock clock) {
        this.eventRepo = eventRepo; this.devices = devices; this.kv = kv; this.events = events; this.audit = audit; this.props = props; this.clock = clock;
    }

    @EventListener
    public void onEvent(EventService.SecurityEventRecorded ev) {
        if (!props.agentEnabled()) return;
        SecurityEvent e = ev.event();
        // Bỏ qua chính sự kiện do agent vừa tạo ra, tránh agent tự phản ứng với cảnh báo của chính mình.
        if (e.type != null && e.type.startsWith("AGENT_")) return;
        switch (String.valueOf(e.type)) {
            case "DECRYPT_FAIL" -> ruleRepeatedDecryptFail(e);
            case "ACCESS_DENIED" -> ruleRepeatedAccessDenied(e);
            case "DUPLICATE_HARDWARE" -> ruleHardwareBurst(e);
            case "BREAK_GLASS" -> ruleBreakGlassAbuse(e);
            default -> { /* không có luật cho loại này */ }
        }
    }

    private Instant since(int minutes) { return Instant.now(clock).minus(minutes, ChronoUnit.MINUTES); }

    /** Thiết bị còn hoạt động và chưa bị khoá bởi chính agent trong lần xử lý này (tránh khoá/ghi cảnh báo lặp). */
    private DeviceEntity activeDevice(String gid) {
        if (gid == null) return null;
        DeviceEntity d = devices.findById(gid).orElse(null);
        return (d != null && !d.disabled) ? d : null;
    }

    private void disableAndAlert(DeviceEntity d, String type, String reason) {
        d.disabled = true;
        devices.save(d);
        audit.log("agent", "device.auto-lock", d.name + ": " + reason);
        events.record("agent", type, "CRITICAL", "Agent tự khoá thiết bị \"" + d.name + "\": " + reason, null, d.gid);
    }

    // ---------- Luật 1: giải mã thất bại liên tiếp (giữ ngưỡng/khung giờ như trước đây) ----------
    private void ruleRepeatedDecryptFail(SecurityEvent e) {
        DeviceEntity d = activeDevice(e.deviceGid);
        if (d == null) return;
        long n = eventRepo.countByDeviceGidAndTypeAndTsAfter(e.deviceGid, "DECRYPT_FAIL", since(props.failWindowMinutes()));
        if (n >= props.failThreshold()) {
            disableAndAlert(d, "DEVICE_LOCKED", n + " lần giải mã thất bại trong " + props.failWindowMinutes() + " phút (nghi vấn giả mạo thuộc tính hoặc brute-force)");
        }
    }

    // ---------- Luật 2: bị từ chối quyền đọc liên tiếp (dò quyền có hệ thống) ----------
    private void ruleRepeatedAccessDenied(SecurityEvent e) {
        DeviceEntity d = activeDevice(e.deviceGid);
        if (d == null) return;
        long n = eventRepo.countByDeviceGidAndTypeAndTsAfter(e.deviceGid, "ACCESS_DENIED", since(props.agentDeniedWindowMinutes()));
        if (n >= props.agentDeniedThreshold()) {
            disableAndAlert(d, "AGENT_ACCESS_DENIED_BURST", n + " lần bị từ chối quyền đọc trong " + props.agentDeniedWindowMinutes() + " phút (nghi vấn dò quyền có hệ thống, ví dụ thử mở hàng loạt hồ sơ không có quyền)");
        }
    }

    // ---------- Luật 3: nhiều thiết bị đăng ký cùng phần cứng trong thời gian ngắn ----------
    private void ruleHardwareBurst(SecurityEvent e) {
        String hw = e.subject; // RegistryController ghi mã phần cứng vào subject cho sự kiện này
        if (hw == null || !hw.matches("[0-9a-f]{64}")) return;
        List<DeviceEntity> burst = devices.findByHwHashAndCreatedAtAfter(hw, since(props.agentHwBurstWindowMinutes()));
        if (burst.size() < props.agentHwBurstCount()) return;
        // Giữ lại thiết bị đăng ký SỚM NHẤT trong đợt (nhiều khả năng là thiết bị gốc hợp lệ); khoá các thiết bị đăng ký sau đó.
        DeviceEntity earliest = burst.stream().min((a, b) -> a.createdAt.compareTo(b.createdAt)).orElse(null);
        int locked = 0;
        for (DeviceEntity d : burst) {
            if (d == earliest || d.disabled) continue;
            d.disabled = true;
            devices.save(d);
            locked++;
        }
        if (locked > 0) {
            audit.log("agent", "device.auto-lock-burst", burst.size() + " thiết bị cùng phần cứng " + hw.substring(0, 12) + "… trong " + props.agentHwBurstWindowMinutes() + " phút, đã khoá " + locked);
            events.record("agent", "AGENT_DUPLICATE_HARDWARE_BURST", "CRITICAL",
                    locked + "/" + burst.size() + " thiết bị đăng ký cùng một phần cứng (" + hw.substring(0, 12) + "…) trong " + props.agentHwBurstWindowMinutes()
                            + " phút đã bị TỰ ĐỘNG KHOÁ (nghi vấn đăng ký hàng loạt hoặc nhân bản thiết bị); giữ lại thiết bị đăng ký sớm nhất.", hw, null);
        }
    }

    // ---------- Luật 4: một thiết bị phá-vỡ-kính nhiều bệnh nhân khác nhau trong thời gian ngắn ----------
    private void ruleBreakGlassAbuse(SecurityEvent e) {
        DeviceEntity d = activeDevice(e.deviceGid);
        if (d == null) return;
        List<SecurityEvent> recent = eventRepo.findByDeviceGidAndTypeAndTsAfter(e.deviceGid, "BREAK_GLASS", since(props.agentBreakglassWindowMinutes()));
        Set<String> patients = recent.stream().map(x -> x.subject).filter(s -> s != null).collect(Collectors.toSet());
        if (patients.size() >= props.agentBreakglassPatients()) {
            // KHÔNG tự đóng các lần phá-vỡ-kính đang hiệu lực (bệnh nhân có thể vẫn đang cấp cứu thật); chỉ chặn thiết bị kích hoạt THÊM.
            disableAndAlert(d, "AGENT_BREAK_GLASS_ABUSE",
                    "phá-vỡ-kính " + patients.size() + " bệnh nhân khác nhau trong " + props.agentBreakglassWindowMinutes() + " phút (nghi vấn lạm dụng cấp cứu). Các lần phá-vỡ-kính đang hiệu lực KHÔNG bị đóng.");
        }
    }

    /** Chuỗi audit bị sửa/xoá (gọi định kỳ từ SecurityAgentJob) -> khoá đăng ký mới để ngăn kẻ lợi dụng lúc hệ thống bị can thiệp. Không báo lặp cho cùng một điểm gãy. */
    public void checkAuditIntegrity() {
        if (!props.agentEnabled()) return;
        Map<String, Object> chain = audit.verify();
        if (Boolean.TRUE.equals(chain.get("ok"))) return;
        Object brokenAt = chain.get("brokenAt");
        String key = "agent.audit.lastBroken";
        String already = kv.findById(key).map(v -> v.v).orElse(null);
        if (String.valueOf(brokenAt).equals(already)) return; // đã cảnh báo cho đúng điểm gãy này rồi
        kv.save(new ConfigKv(key, String.valueOf(brokenAt)));
        kv.save(new ConfigKv("enrollment.open", "false"));
        audit.log("agent", "enrollment.auto-close", "chuỗi nhật ký gãy tại #" + brokenAt);
        events.record("agent", "AGENT_AUDIT_TAMPERED", "CRITICAL",
                "Chuỗi băm nhật ký quản trị KHÔNG toàn vẹn (gãy tại #" + brokenAt + ") - hệ thống có thể đã bị can thiệp. "
                        + "Đã TỰ ĐỘNG tắt đăng ký tự do ở registry để chặn thiết bị lạ tự đăng ký trong lúc chờ kiểm tra thủ công.", null, null);
    }

    /** Trạng thái + ngưỡng hiện hành, hiển thị ở màn hình Giám sát an ninh. */
    public Map<String, Object> status() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("enabled", props.agentEnabled());
        m.put("totalAlerts", eventRepo.countByTypeStartingWith("AGENT_") + eventRepo.countByTypeStartingWith("DEVICE_LOCKED"));
        m.put("rules", List.of(
                Map.of("ten", "Giải mã thất bại liên tiếp", "nguong", props.failThreshold() + " lần / " + props.failWindowMinutes() + " phút", "hanhDong", "Khoá thiết bị"),
                Map.of("ten", "Bị từ chối quyền đọc liên tiếp (dò quyền)", "nguong", props.agentDeniedThreshold() + " lần / " + props.agentDeniedWindowMinutes() + " phút", "hanhDong", "Khoá thiết bị"),
                Map.of("ten", "Nhiều thiết bị cùng phần cứng (đăng ký hàng loạt)", "nguong", props.agentHwBurstCount() + " thiết bị / " + props.agentHwBurstWindowMinutes() + " phút", "hanhDong", "Khoá các thiết bị mới"),
                Map.of("ten", "Phá-vỡ-kính nhiều bệnh nhân (lạm dụng cấp cứu)", "nguong", props.agentBreakglassPatients() + " bệnh nhân / " + props.agentBreakglassWindowMinutes() + " phút", "hanhDong", "Khoá thiết bị"),
                Map.of("ten", "Chuỗi nhật ký quản trị bị sửa/xoá", "nguong", "kiểm tra mỗi 2 phút", "hanhDong", "Tắt đăng ký tự do")));
        return m;
    }
}
