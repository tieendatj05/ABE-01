package com.medabe.storage.research;

import com.medabe.storage.service.RegistryService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Trang thai, dang nhap (kem chung minh so huu khoa thiet bi), dang xuat, dang ky thiet bi, tai lieu policy co chu ky. */
@RestController
@ConditionalOnProperty(prefix = "medabe.research", name = "enabled", havingValue = "true")
public class ResearchAuthController {
    public record LoginIn(String username, String password, String deviceId, String nonce, String sig) {}
    public record EnrollIn(String signPub, String label, String password) {}
    public record PasswordIn(String currentPassword, String newPassword) {}
    public record ForgotIn(String username) {}
    public record MfaEnrollIn(String password) {}
    public record MfaVerifyIn(String code) {}

    private final IdentityService identity;
    private final ScheduleService schedule;
    private final PolicyService policy;
    private final NetworkPolicy network;
    private final RegistryService registry;

    public ResearchAuthController(IdentityService identity, ScheduleService schedule, PolicyService policy, NetworkPolicy network, RegistryService registry) {
        this.identity = identity; this.schedule = schedule; this.policy = policy; this.network = network; this.registry = registry;
    }

    static IdentityService.Principal who(HttpServletRequest req) { return (IdentityService.Principal) req.getAttribute(ResearchGateFilter.ATTR); }

    /** Trang thai nghiep vu: ai cung xem duoc (ke ca ngoai gio) de giao dien hien thong bao khoa. KHONG tra du lieu nhay cam. */
    @GetMapping("/api/v2/status")
    public Map<String, Object> status(HttpServletRequest req) {
        Map<String, Object> m = new LinkedHashMap<>(schedule.status());
        m.put("policyVersion", policy.version());
        m.put("networkZone", network.zoneOf(req.getRemoteAddr()));
        m.put("registryPk", registry.publicKeyHex());
        m.put("afterHoursAllowed", policy.afterHoursAllowed());
        return m;
    }

    @GetMapping("/api/v2/auth/challenge")
    public Map<String, Object> challenge() { return Map.of("nonce", identity.newChallenge(), "ttlSeconds", 60); }

    private Map<String, Object> userView(IdentityService.Principal p) {
        UserAccount u = p.user();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("userId", u.userId); m.put("username", u.username); m.put("displayName", u.displayName);
        m.put("role", u.role); m.put("khoa", u.khoa); m.put("status", u.status); m.put("gid", u.gid);
        m.put("mustChangePassword", u.mustChangePassword);
        m.put("deviceId", p.device() == null ? null : p.device().deviceId);
        m.put("sessionId", p.session().sessionId);
        m.put("networkZone", p.zone());
        m.put("expiresAt", p.session().expiresAt.toString());
        return m;
    }

    @PostMapping("/api/v2/auth/login")
    public Map<String, Object> login(HttpServletRequest req, @RequestBody LoginIn in) {
        String ip = req.getRemoteAddr();
        IdentityService.LoginResult r = identity.login(in.username(), in.password(), in.deviceId(), in.nonce(), in.sig(), ip, network.zoneOf(ip));
        IdentityService.Principal p = new IdentityService.Principal(r.user(), r.session(), r.device(), ip, network.zoneOf(ip));
        if (!policy.roleFlag(r.user().role, "remoteAllowed", true) && network.viaProxy(req)) {           // vai tro nhay cam: khong dang nhap qua Internet
            identity.logout(p);
            throw new org.springframework.web.server.ResponseStatusException(HttpStatus.FORBIDDEN, "DENY_REMOTE_ACCESS");
        }
        Map<String, Object> m = userView(p);
        m.put("token", r.token());
        m.putAll(schedule.status());
        m.put("policyVersion", policy.version());
        return m;
    }

    /**
     * Quen mat khau (chua dang nhap): chi GUI YEU CAU cho quan tri, khong doi gi va khong tra thong tin ve tai khoan. Luon tra cung mot ket qua.
     * Quan tri xac minh danh tinh roi cap mat khau tam o trang Quan tri tai khoan.
     */
    @PostMapping("/api/v2/auth/forgot")
    public Map<String, Object> forgot(HttpServletRequest req, @RequestBody ForgotIn in) {
        identity.requestPasswordReset(in.username(), req.getRemoteAddr());
        return Map.of("ok", true);
    }

    @PostMapping("/api/v2/auth/logout")
    @ResponseStatus(HttpStatus.OK)
    public Map<String, Object> logout(HttpServletRequest req) { identity.logout(who(req)); return Map.of("ok", true); }

    @PostMapping("/api/v2/auth/password")
    public Map<String, Object> changePassword(HttpServletRequest req, @RequestBody PasswordIn in) {
        identity.changePassword(who(req), in.currentPassword(), in.newPassword());
        return Map.of("ok", true);
    }

    /** Trang thai MFA cua phien nay (can dang ky? da dang ky? da xac thuc con han?). */
    @GetMapping("/api/v2/auth/mfa")
    public Map<String, Object> mfaStatus(HttpServletRequest req) { return Map.of("mfa", identity.mfaStatus(who(req))); }

    /** Bat dau dang ky MFA (nhap lai mat khau). Tra bi mat + URI otpauth (hien thi mot lan de quet ma QR). */
    @PostMapping("/api/v2/auth/mfa/enroll")
    public Map<String, Object> mfaEnroll(HttpServletRequest req, @RequestBody MfaEnrollIn in) {
        IdentityService.MfaEnrollment e = identity.mfaEnroll(who(req), in.password());
        return Map.of("secret", e.secret(), "uri", e.uri());
    }

    /** Nhap ma 6 so tu ung dung xac thuc: dung => phien nhan thuoc tinh ABE MED:Auth:MFA (xem /auth/me). */
    @PostMapping("/api/v2/auth/mfa/verify")
    public Map<String, Object> mfaVerify(HttpServletRequest req, @RequestBody MfaVerifyIn in) {
        identity.mfaVerify(who(req), in.code());
        return Map.of("ok", true, "mfa", identity.mfaStatus(who(req)));
    }

    @GetMapping("/api/v2/auth/me")
    public Map<String, Object> me(HttpServletRequest req) {
        Map<String, Object> m = userView(who(req));
        m.put("attributes", policy.attributesOf(subject(who(req)), identity.mfaFresh(who(req))));      // gom MED:Auth:MFA khi phien vua xac thuc TOTP
        m.put("mfa", identity.mfaStatus(who(req)));
        m.putAll(schedule.status());
        m.put("policyVersion", policy.version());
        return m;
    }

    static PolicyService.Subject subject(IdentityService.Principal p) {
        return new PolicyService.Subject(p.user().userId, p.user().role, p.user().khoa, p.user().status);
    }

    private Map<String, Object> deviceView(UserDevice d, UserAccount u) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("deviceId", d.deviceId); m.put("userId", d.userId); m.put("gid", u.gid); m.put("label", d.label);
        m.put("signPub", d.signPub); m.put("cert", d.cert); m.put("status", d.status); m.put("createdAt", d.createdAt.toString());
        m.put("registryPk", registry.publicKeyHex());
        return m;
    }

    @PostMapping("/api/v2/devices")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> enroll(HttpServletRequest req, @RequestBody EnrollIn in) {
        IdentityService.Principal p = who(req);
        return deviceView(identity.enroll(p, in.password(), in.signPub(), in.label()), p.user());
    }

    @GetMapping("/api/v2/devices")
    public List<Map<String, Object>> myDevices(HttpServletRequest req) {
        IdentityService.Principal p = who(req);
        return identity.devicesOf(p.user().userId).stream().map(d -> deviceView(d, p.user())).toList();
    }

    @GetMapping("/api/v2/policy")
    public Map<String, Object> policyDocument() { return policy.signedDocument(); }
}
