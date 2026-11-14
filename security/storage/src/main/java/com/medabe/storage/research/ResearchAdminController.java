package com.medabe.storage.research;

import com.medabe.storage.domain.AuditLog;
import com.medabe.storage.service.AuditService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Quan tri: lich gio (quyen rieng schedule.manage), nguoi dung/thiet bi (user.manage), nhat ky (audit.read).
 * Tai khoan Quan tri KHONG co quyen doc/ghi ho so va KHONG co thuoc tinh ABE nao (xem research-policy.json).
 */
@RestController
@ConditionalOnProperty(prefix = "medabe.research", name = "enabled", havingValue = "true")
public class ResearchAdminController {
    public record ScheduleIn(Integer expectedVersion, Map<String, Map<String, Object>> days, String reason) {}
    public record UserIn(String username, String password, String role, String khoa, String displayName, String phone) {}
    public record UserPatch(String role, String khoa, String status) {}

    private final IdentityService identity;
    private final PolicyService policy;
    private final ScheduleService schedule;
    private final AuditService audit;

    public ResearchAdminController(IdentityService identity, PolicyService policy, ScheduleService schedule, AuditService audit) {
        this.identity = identity; this.policy = policy; this.schedule = schedule; this.audit = audit;
    }

    private IdentityService.Principal require(HttpServletRequest req, String permission) {
        IdentityService.Principal p = ResearchAuthController.who(req);
        PolicyService.Decision d = policy.decidePermission(ResearchAuthController.subject(p), permission);
        if (!d.permit()) {
            audit.log(p.user().userId, "v2.decision", "deny action=" + permission + " reason=" + d.reason() + " zone=" + p.zone() + " policy=" + d.policyVersion());
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, d.reason());
        }
        return p;
    }

    @GetMapping("/api/v2/admin/schedule")
    public Map<String, Object> getSchedule(HttpServletRequest req) {
        require(req, "schedule.manage");
        Map<String, Object> m = new LinkedHashMap<>(schedule.current().view());
        m.putAll(schedule.status());
        return m;
    }

    @PutMapping("/api/v2/admin/schedule")
    public Map<String, Object> putSchedule(HttpServletRequest req, @RequestBody ScheduleIn in) {
        IdentityService.Principal p = require(req, "schedule.manage");
        Map<String, Object> m = new LinkedHashMap<>(schedule.update(in.expectedVersion(), in.days(), p.user().userId, in.reason()).view());
        m.putAll(schedule.status());
        return m;
    }

    private Map<String, Object> userView(UserAccount u) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("userId", u.userId); m.put("username", u.username); m.put("displayName", u.displayName);
        m.put("role", u.role); m.put("khoa", u.khoa); m.put("status", u.status); m.put("gid", u.gid);
        m.put("phone", u.phone); m.put("mustChangePassword", u.mustChangePassword);
        m.put("requestedBy", u.requestedBy);        // chi co khi PENDING_APPROVAL: nguoi duyet phai KHAC nguoi nay
        // THUOC TINH ABE ma tai khoan nay duoc phep xin khoa (backend quyet dinh, cung nguon voi policy ma hoa). Quan tri: rong. MFA chi co theo phien nen khong liet ke o day.
        m.put("attributes", policy.attributesOf(new PolicyService.Subject(u.userId, u.role, u.khoa, u.status), false));
        if ("RESTRICTED".equals(u.status)) { m.put("restrictedAt", String.valueOf(u.restrictedAt)); m.put("restrictedBy", u.restrictedBy); m.put("restrictReason", u.restrictReason); }
        return m;
    }

    /** Dat lai MFA cua mot tai khoan (mat dien thoai). Vai tro nhay cam: tai khoan thanh "cho duyet" (can quan tri KHAC). */
    /** Yeu cau cap lai mat khau do nhan vien gui tu man hinh dang nhap, dang cho quan tri xu ly. */
    @GetMapping("/api/v2/admin/password-requests")
    public List<Map<String, Object>> passwordRequests(HttpServletRequest req) {
        require(req, "user.manage");
        return identity.openPasswordRequests();
    }

    /** Quan tri DA xac minh nguoi xin: cap mat khau tam (hien MOT lan). Khong tu cap cho chinh minh. */
    @PostMapping("/api/v2/admin/password-requests/{id}/fulfill")
    public Map<String, Object> fulfillPasswordRequest(HttpServletRequest req, @PathVariable String id) {
        IdentityService.Principal p = require(req, "user.manage");
        return Map.of("temporaryPassword", identity.fulfillPasswordRequest(id, p.user().userId));
    }

    @PostMapping("/api/v2/admin/password-requests/{id}/reject")
    public Map<String, Object> rejectPasswordRequest(HttpServletRequest req, @PathVariable String id) {
        IdentityService.Principal p = require(req, "user.manage");
        identity.rejectPasswordRequest(id, p.user().userId);
        return Map.of("ok", true);
    }

    public record RestrictIn(String reason, Boolean rotateKeys, Boolean revokeSessions) {}
    public record RestoreIn(String reason) {}
    public record RiskIn(String kind, String detail, Boolean simulated) {}

    /** Giam quyen khi nghi tai khoan bi chiem (xem IdentityService.restrict). Can ly do (>= 8 ky tu); khong tu han che chinh minh. */
    @PostMapping("/api/v2/admin/users/{id}/restrict")
    public Map<String, Object> restrict(HttpServletRequest req, @PathVariable String id, @RequestBody RestrictIn in) {
        IdentityService.Principal p = require(req, "user.manage");
        return userView(identity.restrict(id, p.user().userId, in.reason(), in.rotateKeys() == null || in.rotateKeys(), in.revokeSessions() == null || in.revokeSessions()));
    }

    /** Khoi phuc sau khi xac minh (xem IdentityService.restore). */
    @PostMapping("/api/v2/admin/users/{id}/restore")
    public Map<String, Object> restore(HttpServletRequest req, @PathVariable String id, @RequestBody RestoreIn in) {
        IdentityService.Principal p = require(req, "user.manage");
        return userView(identity.restore(id, p.user().userId, in.reason()));
    }

    /** Ghi tin hieu rui ro (khong doi quyen). simulated=true danh dau tin hieu GIA LAP dung cho thu nghiem. */
    @PostMapping("/api/v2/admin/users/{id}/risk-signal")
    public Map<String, Object> riskSignal(HttpServletRequest req, @PathVariable String id, @RequestBody RiskIn in) {
        IdentityService.Principal p = require(req, "user.manage");
        identity.riskSignal(id, p.user().userId, in.kind(), in.detail(), in.simulated() != null && in.simulated());
        return Map.of("ok", true);
    }

    @PostMapping("/api/v2/admin/users/{id}/mfa-reset")
    public Map<String, Object> mfaReset(HttpServletRequest req, @PathVariable String id) {
        IdentityService.Principal p = require(req, "user.manage");
        return userView(identity.mfaReset(id, p.user().userId));
    }

    /** Duyet tai khoan vai tro nhay cam (Giam sat). Phai la QUAN TRI KHAC nguoi da yeu cau; ghi nhat ky. */
    @PostMapping("/api/v2/admin/users/{id}/approve")
    public Map<String, Object> approve(HttpServletRequest req, @PathVariable String id) {
        IdentityService.Principal p = require(req, "user.manage");
        return userView(identity.approve(id, p.user().userId));
    }

    @GetMapping("/api/v2/admin/users")
    public List<Map<String, Object>> users(HttpServletRequest req) { require(req, "user.manage"); return identity.listUsers().stream().map(this::userView).toList(); }

    @PostMapping("/api/v2/admin/users")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createUser(HttpServletRequest req, @RequestBody UserIn in) {
        IdentityService.Principal p = require(req, "user.manage");
        // Mat khau admin dat/sinh CHI la mat khau TAM: nhan vien phai tu doi o lan dang nhap dau. Bo trong password = he thong sinh ngau nhien va tra ve MOT lan.
        boolean generated = in.password() == null || in.password().isBlank();
        String pw = generated ? identity.temporaryPasswordFor(in.role()) : in.password();
        Map<String, Object> out = new LinkedHashMap<>(userView(identity.createUser(in.username(), pw, in.role(), in.khoa(), in.displayName(), in.phone(), true, p.user().userId)));
        if (generated) out.put("temporaryPassword", pw);
        return out;
    }

    @PutMapping("/api/v2/admin/users/{id}")
    public Map<String, Object> patchUser(HttpServletRequest req, @PathVariable String id, @RequestBody UserPatch in) {
        IdentityService.Principal p = require(req, "user.manage");
        if (id.equals(p.user().userId) && in.status() != null && !"ACTIVE".equals(in.status())) throw new ResponseStatusException(HttpStatus.CONFLICT, "CANNOT_DISABLE_SELF");
        return userView(identity.updateUser(id, in.role(), in.khoa(), in.status(), p.user().userId));
    }

    @PostMapping("/api/v2/admin/users/{id}/reset-password")
    public Map<String, Object> resetPassword(HttpServletRequest req, @PathVariable String id) {
        IdentityService.Principal p = require(req, "user.manage");
        return Map.of("temporaryPassword", identity.resetPassword(id, p.user().userId));
    }

    @GetMapping("/api/v2/admin/devices")
    public List<Map<String, Object>> devices(HttpServletRequest req) {
        require(req, "user.manage");
        return identity.allDevices().stream().map(d -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("deviceId", d.deviceId); m.put("userId", d.userId); m.put("label", d.label); m.put("status", d.status); m.put("createdAt", d.createdAt.toString());
            return m;
        }).toList();
    }

    @PostMapping("/api/v2/admin/devices/{id}/revoke")
    public Map<String, Object> revoke(HttpServletRequest req, @PathVariable String id) {
        IdentityService.Principal p = require(req, "user.manage");
        identity.revokeDevice(id, p.user().userId);
        return Map.of("ok", true);
    }

    @GetMapping("/api/v2/admin/audit")
    public Map<String, Object> audit(HttpServletRequest req, @RequestParam(defaultValue = "200") int limit) {
        require(req, "audit.read");
        List<AuditLog> all = audit.all();
        List<Map<String, Object>> rows = all.stream().filter(a -> a.action.startsWith("v2.")).skip(Math.max(0, all.size() - Math.min(Math.max(limit, 1), 1000)))
                .map(a -> { Map<String, Object> m = new LinkedHashMap<>(); m.put("seq", a.seq); m.put("ts", a.ts.toString()); m.put("actor", a.actor); m.put("action", a.action); m.put("detail", a.detail); return m; }).toList();
        return Map.of("chain", audit.verify(), "records", rows);
    }
}
