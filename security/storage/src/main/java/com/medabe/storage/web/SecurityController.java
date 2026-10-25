package com.medabe.storage.web;

import com.medabe.storage.domain.DeviceEntity;
import com.medabe.storage.domain.SecurityEvent;
import com.medabe.storage.service.AuditService;
import com.medabe.storage.service.EpochService;
import com.medabe.storage.service.AiAnalysisService;
import com.medabe.storage.service.EventService;
import com.medabe.storage.service.NetSensorService;
import com.medabe.storage.service.SecurityAgentService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

/** Epoch cong khai, su kien an ninh (SIEM) va nhat ky quan tri. */
@RestController
public class SecurityController {
    public record EventIn(String source, String type, String severity, String detail, String subject, String deviceGid) {}
    public record BumpIn(String base) {}

    private static final Set<String> SEV = Set.of("INFO", "WARN", "CRITICAL");
    /** Thiet bi chi duoc tu bao 2 loai su kien nay; cac loai khac (BREAK_GLASS...) chi nut cap khoa moi gui duoc. */
    private static final Set<String> DEVICE_TYPES = Set.of("DECRYPT_FAIL", "ACCESS_DENIED");

    private final EpochService epochs;
    private final EventService events;
    private final AuditService audit;
    private final Auth auth;
    private final ObjectMapper mapper;
    private final SecurityAgentService agent;
    private final NetSensorService net;
    private final AiAnalysisService ai;

    public SecurityController(EpochService epochs, EventService events, AuditService audit, Auth auth, ObjectMapper mapper, SecurityAgentService agent, NetSensorService net, AiAnalysisService ai) {
        this.epochs = epochs; this.events = events; this.audit = audit; this.auth = auth; this.mapper = mapper; this.agent = agent; this.net = net; this.ai = ai;
    }

    // ---------- Cam bien mang (phat hien ARP spoofing/MITM) ----------
    public record NetObsIn(String ip, String mac, String state) {}
    public record NetObservationsIn(String sensorId, String iface, List<NetObsIn> observations) {}

    /** Tram quan tri (tien trinh chinh Electron) gui bang neighbor da thu thap. Xac thuc bang X-Admin-Token (thiet bi thuong khong gia mao duoc). */
    @PostMapping("/api/admin/net-observations")
    public Map<String, Object> netObservations(HttpServletRequest req, @RequestBody NetObservationsIn in) {
        auth.admin(req);
        if (in == null || in.observations() == null || in.observations().size() > 512)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "observations sai (toi da 512)");
        String iface = in.iface() == null || !in.iface().matches("[A-Za-z0-9 _.\\-]{1,60}") ? "net" : in.iface();
        String sensorId = in.sensorId() == null || !in.sensorId().matches("[A-Za-z0-9 _.\\-]{1,60}") ? "sensor" : in.sensorId();
        List<NetSensorService.Observation> obs = new ArrayList<>();
        for (NetObsIn o : in.observations()) {
            if (o.ip() == null || !o.ip().matches("[0-9a-fA-F.:]{3,45}")) continue;   // IPv4/IPv6 tho; loc bo rac
            obs.add(new NetSensorService.Observation(o.ip(), o.mac(), o.state()));
        }
        return net.ingest(sensorId, iface, obs);
    }

    @GetMapping("/api/admin/net-status")
    public Map<String, Object> netStatus(HttpServletRequest req) { auth.admin(req); return net.status(); }

    @PostMapping("/api/admin/net-baseline/approve")
    public Map<String, Object> netApprove(HttpServletRequest req) { auth.admin(req); return net.approveBaseline("admin"); }

    // ---------- Phan tich canh bao bang Gemini (TAT mac dinh; luat bao ve khong phu thuoc) ----------
    public record AnalyzeIn(List<Long> ids) {}

    @GetMapping("/api/admin/ai/status")
    public Map<String, Object> aiStatus(HttpServletRequest req) { auth.admin(req); return ai.status(); }

    @PostMapping("/api/admin/ai/analyze")
    public Map<String, Object> aiAnalyze(HttpServletRequest req, @RequestBody AnalyzeIn in) {
        auth.admin(req);
        if (in == null || in.ids() == null || in.ids().isEmpty() || in.ids().size() > 50)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "ids sai (1..50)");
        List<SecurityEvent> evs = events.latest().stream().filter(e -> in.ids().contains(e.id)).toList();
        return ai.analyze(evs);
    }

    /** Trạng thái agent bảo vệ (luật đang theo dõi, số cảnh báo đã tự xử lý) - hiển thị ở Giám sát an ninh. */
    @GetMapping("/api/admin/agent")
    public Map<String, Object> agentStatus(HttpServletRequest req) {
        auth.admin(req);
        return agent.status();
    }

    @GetMapping("/api/epochs")
    public EpochService.Directory directory() { return epochs.directory(); }

    @PostMapping("/api/admin/epochs/bump")
    public Map<String, Object> bump(HttpServletRequest req, @RequestBody BumpIn in) {
        auth.admin(req);
        if (in.base() == null || !in.base().matches("MED:[A-Za-z0-9_.:-]{1,200}")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "base sai");
        int c = epochs.bump(in.base());
        audit.log("admin", "epoch.bump", in.base() + " -> " + c);
        events.record("admin", "EPOCH_BUMPED", "INFO", in.base() + " -> " + c, null, null);
        return Map.of("base", in.base(), "counter", c);
    }

    public record CloseIn(String subject) {}

    /** Quan tri dong som mot lan pha-vo-kinh (ket thuc tinh huong khan cap truoc han 24 gio). */
    @PostMapping("/api/admin/break-glass/close")
    public Map<String, Object> closeBreakGlass(HttpServletRequest req, @RequestBody CloseIn in) {
        auth.admin(req);
        if (in.subject() == null || !in.subject().matches("[0-9a-f]{8,64}")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "subject sai");
        return Map.of("counter", events.closeBreakGlass(in.subject(), "admin", "break-glass.close", epochs));
    }

    /** Nut cap khoa (X-Service-Token) gui moi loai su kien; thiet bi (Bearer) chi gui DECRYPT_FAIL/ACCESS_DENIED. */
    @PostMapping("/api/events")
    public Map<String, Object> event(HttpServletRequest req, @RequestBody EventIn in) {
        String severity = in.severity() == null ? "INFO" : in.severity();
        if (!SEV.contains(severity)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "severity sai");
        if (in.type() == null || !in.type().matches("[A-Z_]{3,40}")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "type sai");
        if (auth.isService(req)) {
            // Chỉ nút cấp khoá (đã xác thực bằng X-Service-Token) mới được tự khai deviceGid cho sự kiện (vd ai kích hoạt phá-vỡ-kính);
            // thiết bị thường (Bearer) không đi qua nhánh này nên không tự gán deviceGid cho người khác được.
            String gid = in.deviceGid() != null && in.deviceGid().matches("[0-9a-f]{32}") ? in.deviceGid() : null;
            return Map.of("id", events.record(String.valueOf(in.source()), in.type(), severity, in.detail(), in.subject(), gid).id);
        }
        DeviceEntity d = auth.device(req);
        if (!DEVICE_TYPES.contains(in.type())) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "thiet bi khong duoc gui loai su kien nay");
        SecurityEvent e = events.record("device:" + d.name, in.type(), "DECRYPT_FAIL".equals(in.type()) ? "WARN" : "INFO", in.detail(), null, d.gid);
        return Map.of("id", e.id);
    }

    @GetMapping("/api/admin/events")
    public List<Map<String, Object>> latest(HttpServletRequest req) {
        auth.admin(req);
        return events.latest().stream().map(events::toMap).toList();
    }

    /** Nguon cho SIEM keo ve: NDJSON (mac dinh) hoac CEF. Dung ?after=<id> de lay tiep. */
    @GetMapping("/api/siem/events")
    public ResponseEntity<String> siem(HttpServletRequest req, @RequestParam(defaultValue = "0") long after,
                                       @RequestParam(defaultValue = "json") String format) {
        auth.siem(req);
        List<SecurityEvent> list = events.after(after);
        StringBuilder sb = new StringBuilder();
        for (SecurityEvent e : list) {
            sb.append("cef".equals(format) ? events.toCef(e) : mapper.writeValueAsString(events.toMap(e))).append('\n');
        }
        return ResponseEntity.ok().contentType(MediaType.TEXT_PLAIN).body(sb.toString());
    }

    @GetMapping("/api/admin/audit")
    public Map<String, Object> audit(HttpServletRequest req) {
        auth.admin(req);
        return Map.of("chain", audit.verify(), "records", audit.all());
    }
}
