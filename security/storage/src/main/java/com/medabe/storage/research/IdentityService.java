package com.medabe.storage.research;

import com.medabe.storage.domain.ResearchRepos;
import com.medabe.storage.service.AuditService;
import com.medabe.storage.service.RegistryService;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * Danh tinh nguoi dung (tai khoan, GID on dinh), PHIEN dang nhap va THIET BI (khoa ky ca nhan + chung chi). Ba khai niem tach roi:
 * mot nguoi co nhieu thiet bi va nhieu phien; hai nguoi tren cung mot may co hai thiet bi/hai phien rieng, khong chia se gi.
 * Vai tro, khoa, trang thai CHI do backend quan ly. Khong dung ten tu nhap, IP hay Wi-Fi de xac thuc.
 */
@Service
@ConditionalOnProperty(prefix = "medabe.research", name = "enabled", havingValue = "true")
public class IdentityService {
    /** Chu the da xac thuc cua mot yeu cau. device == null: phien chua gan thiet bi. */
    public record Principal(UserAccount user, UserSession session, UserDevice device, String ip, String zone) {}
    public record LoginResult(String token, UserAccount user, UserSession session, UserDevice device) {}

    public static final String CERT_DOMAIN = "medabe/user-cert/v1|";
    public static final String LOGIN_DOMAIN = "medabe/login/v1|";
    private static final SecureRandom RNG = new SecureRandom();
    private static final long CHALLENGE_TTL_MS = 60_000;

    private final ResearchRepos.Users users;
    private final ResearchRepos.Devices devices;
    private final ResearchRepos.Sessions sessions;
    private final ResearchProps props;
    private final PolicyService policy;
    private final RegistryService registry;
    private final AuditService audit;
    private final Clock clock;
    private final Map<String, Long> challenges = new ConcurrentHashMap<>();
    private final Map<String, long[]> ipRate = new ConcurrentHashMap<>();
    private final byte[] dummySalt = ResearchCrypto.random(16);

    public IdentityService(ResearchRepos.Users users, ResearchRepos.Devices devices, ResearchRepos.Sessions sessions, ResearchProps props,
                           PolicyService policy, RegistryService registry, AuditService audit, Clock clock, com.medabe.storage.service.EpochService epochs, BaselineVault vault,
                           ResearchRepos.PasswordRequests passwordRequests) {
        this.epochs = epochs; this.vault = vault; this.passwordRequests = passwordRequests;
        this.users = users; this.devices = devices; this.sessions = sessions; this.props = props; this.policy = policy;
        this.registry = registry; this.audit = audit; this.clock = clock;
    }

    private final ResearchRepos.PasswordRequests passwordRequests;
    private final com.medabe.storage.service.EpochService epochs;
    private final BaselineVault vault;

    private Instant now() { return clock.instant(); }
    private static ResponseStatusException err(HttpStatus s, String code) { return new ResponseStatusException(s, code); }

    // ------------------------------------------------------------------ mat khau
    static String pbkdf2(String password, byte[] salt, int iterations) {
        try {
            byte[] h = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(new PBEKeySpec(password.toCharArray(), salt, iterations, 256)).getEncoded();
            return ResearchCrypto.HEX.formatHex(h);
        } catch (Exception e) { throw new IllegalStateException(e); }
    }
    private boolean passwordOk(UserAccount u, String password) {
        String h = pbkdf2(password, ResearchCrypto.HEX.parseHex(u.passwordSalt), u.passwordIterations);
        return MessageDigest.isEqual(h.getBytes(StandardCharsets.UTF_8), u.passwordHash.getBytes(StandardCharsets.UTF_8));
    }
    static void checkPasswordStrength(String pw) { checkPasswordStrength(pw, 10); }
    static void checkPasswordStrength(String pw, int minLen) {
        if (pw == null || pw.length() < minLen || pw.length() > 128 || !pw.matches(".*[A-Za-z].*") || !pw.matches(".*[0-9].*"))
            throw err(HttpStatus.BAD_REQUEST, "PASSWORD_WEAK: toi thieu " + minLen + " ky tu, co chu va so");
    }
    private int minPasswordLength(String role) { return Math.max(10, policy.roleInt(role, "minPasswordLength", 10)); }

    /** Vai tro nhay cam (vd GIAM_SAT): moi hanh dong dua tai khoan ve trang thai DUNG DUOC deu phai co QUAN TRI KHAC duyet. "system" = nap tai khoan mau luc khoi dong. */
    private boolean sensitive(String role, String actor) { return policy.roleFlag(role, "requiresSecondApproval", false) && !"system".equals(actor); }

    // ------------------------------------------------------------------ tai khoan
    public UserAccount createUser(String username, String password, String role, String khoa, String displayName, String actor) {
        return createUser(username, password, role, khoa, displayName, null, false, actor);
    }

    private static final String TEMP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

    /** Mat khau tam 12 ky tu ngau nhien (bo ky tu de nham 0/O/1/l/I), chac chan co chu va so. Chi hien cho admin MOT lan. */
    public static String generateTemporaryPassword() { return generateTemporaryPassword(12); }

    /** Mat khau tam dai du cho vai tro (vai tro co yeu cau mat khau dai hon thi mat khau tam cung dai hon). */
    public String temporaryPasswordFor(String role) { return generateTemporaryPassword(Math.max(12, minPasswordLength(role) + 2)); }

    public static String generateTemporaryPassword(int len) {
        for (;;) {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < len; i++) sb.append(TEMP_ALPHABET.charAt(RNG.nextInt(TEMP_ALPHABET.length())));
            String pw = sb.toString();
            if (pw.matches(".*[A-Za-z].*") && pw.matches(".*[0-9].*")) return pw;
        }
    }

    /** 0901 234 567 / +84901234567 / 0901.234.567 -> 0901234567. Khong hop le -> PHONE_INVALID. */
    static String normalizePhone(String raw) {
        String d = raw.replaceAll("[\\s.\\-()]", "");
        if (d.startsWith("+84")) d = "0" + d.substring(3);
        if (!d.matches("0[0-9]{9,10}")) throw err(HttpStatus.BAD_REQUEST, "PHONE_INVALID");
        return d;
    }

    /**
     * Admin cap tai khoan cho nhan vien theo so dien thoai. mustChange=true: mat khau admin dat/sinh chi la mat khau TAM - nhan vien phai tu doi o lan
     * dang nhap dau, tu do ve sau admin KHONG biet mat khau (neu khong, admin dang nhap/dang ky thiet bi/ky thay nhan vien duoc).
     */
    public UserAccount createUser(String username, String password, String role, String khoa, String displayName, String phone, boolean mustChange, String actor) {
        String ph = phone == null || phone.isBlank() ? null : normalizePhone(phone);
        if ((username == null || username.isBlank()) && ph != null) username = ph;          // mac dinh ten dang nhap = so dien thoai
        if (username != null) username = username.trim().toLowerCase();
        if (username == null || !username.matches("[a-z0-9._@+-]{3,80}") || (username.contains("@") && !username.matches("[a-z0-9._+-]+@[a-z0-9-]+(\\.[a-z0-9-]+)+"))) throw err(HttpStatus.BAD_REQUEST, "USERNAME_INVALID");
        if (!policy.knownRole(role)) throw err(HttpStatus.BAD_REQUEST, "ROLE_INVALID");
        String khoaCsv = canonicalKhoa(role, khoa);
        checkPasswordStrength(password, minPasswordLength(role));
        if (users.findByUsername(username).isPresent()) throw err(HttpStatus.CONFLICT, "USERNAME_EXISTS");
        if (ph != null && users.findByPhone(ph).isPresent()) throw err(HttpStatus.CONFLICT, "PHONE_EXISTS");
        UserAccount u = new UserAccount();
        u.userId = "u-" + UUID.randomUUID();
        u.username = username; u.phone = ph; u.mustChangePassword = mustChange;
        u.displayName = displayName == null || displayName.isBlank() ? username : displayName.trim();
        setPassword(u, password);
        u.role = role; u.khoa = khoaCsv;
        boolean pending = sensitive(role, actor);
        u.status = pending ? "PENDING_APPROVAL" : "ACTIVE"; u.requestedBy = pending ? actor : null;
        u.gid = ResearchCrypto.randomHex(16);
        u.createdAt = now();
        users.save(u);
        audit.log(actor, "v2.user.create", "userId=" + u.userId + " role=" + role + (u.khoa != null ? " khoa=" + u.khoa : "")
                + (ph != null ? " phone=***" + ph.substring(ph.length() - 3) : "") + (mustChange ? " mat-khau-tam" : "") + (pending ? " CHO-QUAN-TRI-KHAC-DUYET" : ""));
        return u;
    }

    private void setPassword(UserAccount u, String password) {
        byte[] salt = ResearchCrypto.random(16);
        u.passwordSalt = ResearchCrypto.HEX.formatHex(salt);
        u.passwordIterations = props.passwordIterations();
        u.passwordHash = pbkdf2(password, salt, u.passwordIterations);
        u.passwordChangedAt = now();
    }

    /** Nhan vien tu doi mat khau (can mat khau hien tai). Cac phien KHAC cua nguoi nay bi thu hoi; mat khau moi khong duoc trung mat khau cu. */
    public void changePassword(Principal p, String current, String next) {
        UserAccount u = users.findById(p.user().userId).orElseThrow(() -> err(HttpStatus.NOT_FOUND, "USER_NOT_FOUND"));
        if (current == null || !passwordOk(u, current)) {
            u.failedCount++;
            if (u.failedCount >= props.maxFailedLogins()) { u.lockedUntil = now().plus(Duration.ofMinutes(props.lockMinutes())); u.failedCount = 0; }
            users.save(u);
            audit.log(u.userId, "v2.user.password-change.deny", "mat khau hien tai sai");
            throw err(HttpStatus.UNAUTHORIZED, "STEP_UP_FAILED");
        }
        checkPasswordStrength(next, minPasswordLength(u.role));
        if (next.equals(current)) throw err(HttpStatus.BAD_REQUEST, "PASSWORD_REUSED");
        setPassword(u, next);
        boolean wasTemp = u.mustChangePassword;
        u.mustChangePassword = false; u.failedCount = 0;
        users.save(u);
        for (UserSession s : sessions.findByUserIdAndRevokedAtIsNull(u.userId)) if (!s.sessionId.equals(p.session().sessionId)) { s.revokedAt = now(); sessions.save(s); }
        audit.log(u.userId, "v2.user.password-change", wasTemp ? "doi mat khau tam lan dau" : "tu doi mat khau");
    }

    /** Admin cap lai mat khau TAM (quen mat khau/mat may). Moi phien bi thu hoi, nhan vien phai doi lai o lan dang nhap ke tiep. Tra ve mat khau tam (hien MOT lan). */
    public String resetPassword(String userId, String actor) {
        UserAccount u = users.findById(userId).orElseThrow(() -> err(HttpStatus.NOT_FOUND, "USER_NOT_FOUND"));
        String temp = temporaryPasswordFor(u.role);
        setPassword(u, temp);
        u.mustChangePassword = true; u.failedCount = 0; u.lockedUntil = null;
        // Admin vua nhin thay mat khau tam: voi vai tro nhay cam, tai khoan CHUA dung duoc cho den khi QUAN TRI KHAC duyet (neu khong admin tu dang nhap thay nguoi do).
        boolean pending = sensitive(u.role, actor);
        if (pending) { u.status = "PENDING_APPROVAL"; u.requestedBy = actor; }
        users.save(u);
        revokeSessionsOfUser(u.userId);
        audit.log(actor, "v2.user.password-reset", "userId=" + userId + " mat-khau-tam" + (pending ? " CHO-QUAN-TRI-KHAC-DUYET" : ""));
        return temp;
    }

    // ------------------------------------------------------------------ KHOI PHUC MAT KHAU
    /** Yeu cau con mo qua han nay thi tu het han (nguoi duyet khong con nho ai da xin; nhan vien gui lai neu van can). */
    private static final Duration REQUEST_TTL = Duration.ofHours(72);
    /** Tran so yeu cau dang mo: chan nguoi la bom yeu cau lam ngap danh sach cua quan tri. */
    private static final long MAX_OPEN_REQUESTS = 500;
    private final Map<String, long[]> forgotRate = new ConcurrentHashMap<>();

    /**
     * Nhan vien quen mat khau gui yeu cau (chua dang nhap). LUON tra cung mot ket qua dau co hay khong co tai khoan (khong de do ten dang nhap). Chi tai khoan
     * DANG HOAT DONG moi tao yeu cau, moi nguoi toi da MOT yeu cau dang mo, moi dia chi toi da 10 yeu cau/phut. Yeu cau KHONG doi mat khau: chi bao quan tri.
     */
    public void requestPasswordReset(String username, String ip) {
        long t = System.currentTimeMillis();
        long[] w = forgotRate.merge(ip == null ? "?" : ip, new long[] {t, 1}, (o, n) -> t - o[0] > 60_000 ? n : new long[] {o[0], o[1] + 1});
        if (w[1] > 10) throw err(HttpStatus.TOO_MANY_REQUESTS, "FORGOT_RATE_LIMIT");
        forgotRate.values().removeIf(x -> t - x[0] > 120_000);
        String name = username == null ? "" : username.trim().toLowerCase();
        UserAccount u = name.isEmpty() || name.length() > 80 ? null : users.findByUsername(name).orElse(null);
        if (u == null || !"ACTIVE".equals(u.status)) { audit.log("anonymous", "v2.password-request.ignored", "tai khoan khong ton tai hoac khong hoat dong ip=" + ip); return; }
        if (passwordRequests.findFirstByUserIdAndStatus(u.userId, "OPEN").isPresent()) return;       // da co yeu cau dang cho quan tri
        if (passwordRequests.countByStatus("OPEN") >= MAX_OPEN_REQUESTS) { audit.log("anonymous", "v2.password-request.flood", "qua nhieu yeu cau dang mo ip=" + ip); return; }
        PasswordResetRequest r = new PasswordResetRequest();
        r.id = "pr-" + UUID.randomUUID(); r.userId = u.userId; r.status = "OPEN"; r.createdAt = now(); r.fromIp = ip;
        passwordRequests.save(r);
        audit.log(u.userId, "v2.password-request", "nhan vien xin cap lai mat khau ip=" + ip);
    }

    /** Cac yeu cau dang cho quan tri (kem ten/vai tro de nhan ra nguoi). Yeu cau qua han duoc danh dau EXPIRED. */
    public List<Map<String, Object>> openPasswordRequests() {
        Instant cutoff = now().minus(REQUEST_TTL);
        List<Map<String, Object>> out = new java.util.ArrayList<>();
        for (PasswordResetRequest r : passwordRequests.findByStatusOrderByCreatedAtAsc("OPEN")) {
            if (r.createdAt != null && r.createdAt.isBefore(cutoff)) { r.status = "EXPIRED"; r.handledAt = now(); passwordRequests.save(r); continue; }
            UserAccount u = users.findById(r.userId).orElse(null);
            if (u == null) continue;
            Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("id", r.id); m.put("userId", u.userId); m.put("username", u.username); m.put("displayName", u.displayName);
            m.put("role", u.role); m.put("phone", u.phone); m.put("createdAt", r.createdAt.toString()); m.put("fromIp", r.fromIp);
            out.add(m);
        }
        return out;
    }

    private PasswordResetRequest openRequest(String id) {
        PasswordResetRequest r = passwordRequests.findById(id).orElseThrow(() -> err(HttpStatus.NOT_FOUND, "REQUEST_NOT_FOUND"));
        if (!"OPEN".equals(r.status)) throw err(HttpStatus.CONFLICT, "REQUEST_NOT_OPEN");
        return r;
    }

    /**
     * Quan tri DA xac minh nguoi xin va cap mat khau TAM (hien MOT lan). Khong tu cap cho chinh minh (quan tri quen mat khau phai nho quan tri KHAC);
     * vai tro nhay cam van phai co quan tri KHAC duyet nhu moi lan cap lai mat khau (xem resetPassword).
     */
    public String fulfillPasswordRequest(String id, String actor) {
        PasswordResetRequest r = openRequest(id);
        if (r.userId.equals(actor)) {
            audit.log(actor, "v2.password-request.deny", "DENY_SELF_FULFILL request=" + id);
            throw err(HttpStatus.FORBIDDEN, "DENY_SELF_FULFILL");
        }
        String temp = resetPassword(r.userId, actor);
        r.status = "DONE"; r.handledBy = actor; r.handledAt = now();
        passwordRequests.save(r);
        audit.log(actor, "v2.password-request.done", "request=" + id + " userId=" + r.userId);
        return temp;
    }

    public void rejectPasswordRequest(String id, String actor) {
        PasswordResetRequest r = openRequest(id);
        r.status = "REJECTED"; r.handledBy = actor; r.handledAt = now();
        passwordRequests.save(r);
        audit.log(actor, "v2.password-request.reject", "request=" + id + " userId=" + r.userId);
    }

    /**
     * KHOI PHUC CUC BO tai khoan QUAN TRI (mat het quan tri / quen mat khau cua quan tri duy nhat). Chi chay luc KHOI DONG may chu khi nguoi co quyen tren
     * may chu dat bien moi truong (xem Khoi-Phuc-Mat-Khau-Quan-Tri.cmd): quyen vat ly voi may chu = quyen voi CSDL, nen khong mo them cua nao qua mang.
     * Dat mat khau TAM, buoc doi o lan dang nhap dau, mo khoa, thu hoi moi phien. KHONG dung cho vai tro khac (nhan vien thuong nho quan tri cap lai).
     */
    public void recoverLocalAdmin(String username, String temporaryPassword) {
        UserAccount u = users.findByUsername(username == null ? "" : username.trim().toLowerCase()).orElseThrow(() -> err(HttpStatus.NOT_FOUND, "USER_NOT_FOUND"));
        if (!"QUAN_TRI".equals(u.role)) throw err(HttpStatus.BAD_REQUEST, "RECOVERY_ONLY_FOR_ADMIN");
        checkPasswordStrength(temporaryPassword, minPasswordLength(u.role));
        setPassword(u, temporaryPassword);
        u.mustChangePassword = true; u.failedCount = 0; u.lockedUntil = null; u.status = "ACTIVE"; u.requestedBy = null;
        u.totpSecretSealed = null; u.totpEnabled = false; u.totpLastStep = 0;      // mat dien thoai + mat mat khau: quyen vat ly voi may chu cung dat lai MFA, nguoi dung dang ky lai o lan dang nhap dau
        users.save(u);
        revokeSessionsOfUser(u.userId);
        audit.log("local-console", "v2.password-recover-local", "userId=" + u.userId + " role=QUAN_TRI mat-khau-tam");
    }

    // ------------------------------------------------------------------ GIAM QUYEN KHI NGHI TAI KHOAN BI CHIEM
    /** Tai khoan con dung duoc de dang nhap/duy tri phien: ACTIVE hoac RESTRICTED (bi han che). */
    private static boolean live(String status) { return "ACTIVE".equals(status) || "RESTRICTED".equals(status); }
    private static final java.util.Set<String> RISK_KINDS = java.util.Set.of("ANOMALOUS_READ_VOLUME", "NEW_DEVICE_BULK_READ", "OFF_HOURS_ACCESS", "REPORTED_BY_OWNER", "OTHER");

    /** Ghi MOT tin hieu rui ro vao nhat ky (chua doi quyen gi). simulated: tin hieu GIA LAP dung cho thu nghiem. Quyet dinh giam quyen la cua nguoi (xem restrict). */
    public void riskSignal(String userId, String actor, String kind, String detail, boolean simulated) {
        UserAccount u = users.findById(userId).orElseThrow(() -> err(HttpStatus.NOT_FOUND, "USER_NOT_FOUND"));
        if (kind == null || !RISK_KINDS.contains(kind)) throw err(HttpStatus.BAD_REQUEST, "RISK_KIND_INVALID");
        String d = detail == null ? "" : detail.replaceAll("[\\r\\n]", " ").trim();
        if (d.length() > 200) d = d.substring(0, 200);
        audit.log(actor, "v2.risk.signal", "userId=" + u.userId + " kind=" + kind + " nguon=" + (simulated ? "GIA_LAP" : "QUAN_TRI") + (d.isEmpty() ? "" : " chi-tiet=" + d));
    }

    /**
     * GIAM QUYEN (nghi tai khoan bi chiem): ACTIVE -> RESTRICTED. Tai khoan chi con thuoc tinh TAC GIA (doc lai du lieu CHINH MINH nhap), mat moi thuoc tinh vai tro/khoa/MFA,
     * khong ghi, khong quan tri. Moi yeu cau ke tiep cua phien dang mo bi may chu danh gia lai ngay (khong can cho het phien).
     *  - revokeSessions: thu hoi phien (buoc dang nhap lai). Mac dinh BAT.
     *  - rotateKeys: tang bo dem epoch cua cac thuoc tinh vai tro/khoa nguoi nay dang giu => ban ghi duoc boc lai (khi co nguoi hop le mo) se KHONG mo duoc bang khoa cu cua nguoi nay.
     *    LUU Y: ban ma da sao chep truoc do + khoa da giai ma o bo nho may ho van mo duoc ban cu: ABE khong "rut" khoa da cap (xem bao cao).
     */
    public UserAccount restrict(String userId, String actor, String reason, boolean rotateKeys, boolean revokeSessions) {
        UserAccount u = users.findById(userId).orElseThrow(() -> err(HttpStatus.NOT_FOUND, "USER_NOT_FOUND"));
        if (userId.equals(actor)) throw err(HttpStatus.CONFLICT, "CANNOT_RESTRICT_SELF");
        if (reason == null || reason.trim().length() < 8) throw err(HttpStatus.BAD_REQUEST, "REASON_REQUIRED");
        if (!"ACTIVE".equals(u.status)) throw err(HttpStatus.CONFLICT, "NOT_ACTIVE");
        java.util.Set<String> held = new java.util.LinkedHashSet<>(policy.attributesOf(new PolicyService.Subject(u.userId, u.role, u.khoa, u.status), false));
        u.status = "RESTRICTED"; u.restrictedAt = now(); u.restrictedBy = actor; u.restrictReason = reason.trim().length() > 300 ? reason.trim().substring(0, 300) : reason.trim();
        users.save(u);
        java.util.List<String> rotated = new java.util.ArrayList<>();
        if (rotateKeys) for (String a : held) if (!a.startsWith("MED:Author:") && !PolicyService.MFA_ATTR.equals(a)) { epochs.bump(a); rotated.add(a); }
        if (revokeSessions) revokeSessionsOfUser(u.userId);
        audit.log(actor, "v2.account.restrict", "userId=" + u.userId + " role=" + u.role + " con-lai=Author da-giu=" + held.size() + " epoch-tang=" + rotated + " thu-hoi-phien=" + revokeSessions + " ly-do=" + u.restrictReason);
        return u;
    }

    /** KHOI PHUC sau khi xac minh: RESTRICTED -> ACTIVE (can ly do). Vai tro nhay cam/quan tri: nguoi khoi phuc PHAI KHAC nguoi da han che. Khoa moi cap theo phien ban epoch hien hanh. */
    public UserAccount restore(String userId, String actor, String reason) {
        UserAccount u = users.findById(userId).orElseThrow(() -> err(HttpStatus.NOT_FOUND, "USER_NOT_FOUND"));
        if (userId.equals(actor)) throw err(HttpStatus.CONFLICT, "CANNOT_RESTORE_SELF");
        if (reason == null || reason.trim().length() < 8) throw err(HttpStatus.BAD_REQUEST, "REASON_REQUIRED");
        if (!"RESTRICTED".equals(u.status)) throw err(HttpStatus.CONFLICT, "NOT_RESTRICTED");
        if ((sensitive(u.role, actor) || "QUAN_TRI".equals(u.role)) && actor.equals(u.restrictedBy)) {
            audit.log(actor, "v2.account.restore.deny", "userId=" + userId + " DENY_SELF_APPROVAL (nguoi han che khong tu khoi phuc tai khoan nhay cam)");
            throw err(HttpStatus.FORBIDDEN, "DENY_SELF_APPROVAL");
        }
        u.status = "ACTIVE"; String by = u.restrictedBy; u.restrictedAt = null; u.restrictedBy = null; u.restrictReason = null;
        users.save(u);
        audit.log(actor, "v2.account.restore", "userId=" + u.userId + " han-che-boi=" + by + " ly-do=" + (reason.trim().length() > 300 ? reason.trim().substring(0, 300) : reason.trim()));
        return u;
    }

    /** Duyet tai khoan nhay cam: nguoi duyet PHAI KHAC nguoi yeu cau (hai quan tri vien cung dong y). */
    public UserAccount approve(String userId, String actor) {
        UserAccount u = users.findById(userId).orElseThrow(() -> err(HttpStatus.NOT_FOUND, "USER_NOT_FOUND"));
        if (!"PENDING_APPROVAL".equals(u.status)) throw err(HttpStatus.CONFLICT, "NOT_PENDING");
        if (actor == null || actor.equals(u.requestedBy) || actor.equals(u.userId)) {
            audit.log(actor == null ? "anonymous" : actor, "v2.privileged.approve.deny", "userId=" + userId + " reason=DENY_SELF_APPROVAL");
            throw err(HttpStatus.FORBIDDEN, "DENY_SELF_APPROVAL");
        }
        u.status = "ACTIVE"; String by = u.requestedBy; u.requestedBy = null;
        users.save(u);
        audit.log(actor, "v2.privileged.approve", "userId=" + userId + " role=" + u.role + " yeu-cau-boi=" + by);
        return u;
    }

    /** Khoa nhap vao (ten hien thi bat ky, nhieu khoa cach nhau dau phay) -> chuoi MA khoa chuan theo danh muc. Vai tro khong nhan khoa ma co khoa => loi. */
    private String canonicalKhoa(String role, String khoa) {
        if (policy.roleAcceptsKhoa(role)) {
            List<String> ks;
            try { ks = policy.normalizeKhoaList(khoa); } catch (IllegalArgumentException e) { throw err(HttpStatus.BAD_REQUEST, "KHOA_INVALID"); }
            if (policy.roleNeedsKhoa(role) && ks.isEmpty()) throw err(HttpStatus.BAD_REQUEST, "KHOA_INVALID");
            return ks.isEmpty() ? null : String.join(",", ks);
        }
        if (khoa != null && !khoa.isBlank()) throw err(HttpStatus.BAD_REQUEST, "KHOA_NOT_ALLOWED_FOR_ROLE");
        return null;
    }

    /** Doi vai tro/khoa/trang thai. Khoa tai khoan => thu hoi moi phien (hieu luc ngay tren yeu cau ke tiep). */
    public UserAccount updateUser(String userId, String role, String khoa, String status, String actor) {
        UserAccount u = users.findById(userId).orElseThrow(() -> err(HttpStatus.NOT_FOUND, "USER_NOT_FOUND"));
        String before = u.role + "/" + u.khoa + "/" + u.status;
        String newRole = role != null ? role : u.role;
        if (!policy.knownRole(newRole)) throw err(HttpStatus.BAD_REQUEST, "ROLE_INVALID");
        String newKhoa = role != null || khoa != null ? khoa : u.khoa;
        String khoaCsv = canonicalKhoa(newRole, newKhoa);
        if (status != null && !List.of("ACTIVE", "DISABLED").contains(status)) throw err(HttpStatus.BAD_REQUEST, "STATUS_INVALID");
        String oldStatus = u.status, oldRole = u.role;
        // Tai khoan dang cho duyet chi duoc DUYET bang endpoint rieng (nguoi duyet khac nguoi yeu cau), khong the "mo khoa" de lach.
        if ("PENDING_APPROVAL".equals(oldStatus) && "ACTIVE".equals(status)) throw err(HttpStatus.CONFLICT, "USE_APPROVAL");
        if ("RESTRICTED".equals(oldStatus) && "ACTIVE".equals(status)) throw err(HttpStatus.CONFLICT, "USE_RESTORE");        // tài khoản bị hạn chế chỉ được KHÔI PHỤC bằng endpoint riêng (có lý do + nhật ký)
        List<String> before0 = u.khoa == null || u.khoa.isBlank() ? List.of() : List.of(u.khoa.split(","));
        u.role = newRole; u.khoa = khoaCsv;
        if (status != null) u.status = status;
        // Vai tro nhay cam: doi SANG vai tro nay, hoac mo khoa lai, deu thanh "cho duyet" (can quan tri khac).
        if (sensitive(newRole, actor) && "ACTIVE".equals(u.status) && (!newRole.equals(oldRole) || !"ACTIVE".equals(oldStatus))) { u.status = "PENDING_APPROVAL"; u.requestedBy = actor; }
        users.save(u);
        if (!"ACTIVE".equals(u.status) || !before.startsWith(u.role + "/" + u.khoa + "/")) revokeSessionsOfUser(u.userId);
        // THAY DOI QUYEN: khoa bi go => tang bo dem epoch cua thuoc tinh khoa do (khoa moi cap tren ban ghi moi phai co bo dem moi; ban ghi cu duoc boc lai khi duoc mo).
        List<String> after0 = u.khoa == null ? List.of() : List.of(u.khoa.split(","));
        for (String k : before0) if (!after0.contains(k)) epochs.bump("MED:Khoa:" + k);
        audit.log(actor, "v2.user.update", "userId=" + userId + " " + before + " -> " + u.role + "/" + u.khoa + "/" + u.status + (before0.stream().anyMatch(k -> !after0.contains(k)) ? " khoa-bi-go:epoch-tang" : ""));
        return u;
    }


    // ------------------------------------------------------------------ MFA (TOTP): nhan to xac thuc thu hai, dong thoi la THUOC TINH ABE (MED:Auth:MFA)
    public record MfaStatus(boolean required, boolean enrolled, boolean verified, int freshMinutes) {}
    public record MfaEnrollment(String secret, String uri) {}

    /** Phien nay vua xac thuc MFA con han? (chi vai tro co requiresMfa). Quyet dinh cap thuoc tinh MED:Auth:MFA + quyen doc cua nhanh Giam sat. */
    public boolean mfaFresh(Principal p) {
        if (p == null || !policy.requiresMfa(p.user().role) || p.session().mfaVerifiedAt == null) return false;
        return p.session().mfaVerifiedAt.plus(Duration.ofMinutes(policy.mfaFreshMinutes(p.user().role))).isAfter(now());
    }

    public MfaStatus mfaStatus(Principal p) {
        UserAccount u = users.findById(p.user().userId).orElseThrow(() -> err(HttpStatus.NOT_FOUND, "USER_NOT_FOUND"));
        return new MfaStatus(policy.requiresMfa(u.role), u.totpEnabled, mfaFresh(p), policy.mfaFreshMinutes(u.role));
    }

    private void failStepUp(UserAccount u, String what) {
        u.failedCount++;
        if (u.failedCount >= props.maxFailedLogins()) { u.lockedUntil = now().plus(Duration.ofMinutes(props.lockMinutes())); u.failedCount = 0; }
        users.save(u);
        audit.log(u.userId, what, "that bai");
    }

    /** Bat dau dang ky MFA: can NHAP LAI MAT KHAU (nguoi chiem phien dang mo khong tu dang ky MFA cua ho duoc). Tra bi mat + URI otpauth MOT lan; chua co hieu luc cho den khi nhap dung ma dau tien. */
    public MfaEnrollment mfaEnroll(Principal p, String password) {
        UserAccount u = users.findById(p.user().userId).orElseThrow(() -> err(HttpStatus.NOT_FOUND, "USER_NOT_FOUND"));
        if (!policy.requiresMfa(u.role)) throw err(HttpStatus.FORBIDDEN, "MFA_NOT_AVAILABLE_FOR_ROLE");
        if (u.lockedUntil != null && u.lockedUntil.isAfter(now())) throw err(HttpStatus.TOO_MANY_REQUESTS, "ACCOUNT_LOCKED");
        if (password == null || !passwordOk(u, password)) { failStepUp(u, "v2.mfa.enroll.deny"); throw err(HttpStatus.UNAUTHORIZED, "STEP_UP_FAILED"); }
        if (u.totpEnabled) throw err(HttpStatus.CONFLICT, "MFA_ALREADY_ENROLLED");
        String secret = Totp.newSecretBase32();
        u.totpSecretSealed = vault.sealSecret(u.userId, secret); u.totpLastStep = 0;
        users.save(u);
        audit.log(u.userId, "v2.mfa.enroll.begin", "cho nhap ma dau tien");
        return new MfaEnrollment(secret, Totp.otpauthUri("MedABE", u.username, secret));
    }

    /** Nhap ma 6 so: dung => phien nay nhan thuoc tinh MED:Auth:MFA trong mfaFreshMinutes. Sai nhieu lan => khoa tai khoan; mot ma chi dung mot lan. */
    public void mfaVerify(Principal p, String code) {
        UserAccount u = users.findById(p.user().userId).orElseThrow(() -> err(HttpStatus.NOT_FOUND, "USER_NOT_FOUND"));
        if (!policy.requiresMfa(u.role)) throw err(HttpStatus.FORBIDDEN, "MFA_NOT_AVAILABLE_FOR_ROLE");
        if (u.totpSecretSealed == null) throw err(HttpStatus.CONFLICT, "MFA_NOT_ENROLLED");
        if (u.lockedUntil != null && u.lockedUntil.isAfter(now())) throw err(HttpStatus.TOO_MANY_REQUESTS, "ACCOUNT_LOCKED");
        byte[] key = Totp.unbase32(vault.openSecret(u.userId, u.totpSecretSealed));
        long step = Totp.verify(key, code, now().getEpochSecond());
        java.util.Arrays.fill(key, (byte) 0);
        if (step < 0) { failStepUp(u, "v2.mfa.verify.deny"); throw err(HttpStatus.UNAUTHORIZED, "MFA_CODE_INVALID"); }
        if (step <= u.totpLastStep) { audit.log(u.userId, "v2.mfa.verify.deny", "ma da dung roi (phat lai)"); throw err(HttpStatus.UNAUTHORIZED, "MFA_CODE_REUSED"); }
        boolean first = !u.totpEnabled;
        u.totpEnabled = true; u.totpLastStep = step; u.failedCount = 0;
        users.save(u);
        UserSession s = p.session(); s.mfaVerifiedAt = now(); sessions.save(s);
        audit.log(u.userId, "v2.mfa.verify", (first ? "xac-nhan-dang-ky " : "") + "session=" + s.sessionId.substring(0, 8) + " hieu-luc=" + policy.mfaFreshMinutes(u.role) + "phut");
    }

    /** Quan tri dat lai MFA (mat dien thoai): xoa bi mat, thu hoi phien. Vai tro nhay cam => tai khoan CHO QUAN TRI KHAC DUYET (admin khong tu dat lai roi vao). */
    public UserAccount mfaReset(String userId, String actor) {
        UserAccount u = users.findById(userId).orElseThrow(() -> err(HttpStatus.NOT_FOUND, "USER_NOT_FOUND"));
        if (!policy.requiresMfa(u.role)) throw err(HttpStatus.BAD_REQUEST, "MFA_NOT_AVAILABLE_FOR_ROLE");
        u.totpSecretSealed = null; u.totpEnabled = false; u.totpLastStep = 0;
        // Dat lai MFA cua mot QUAN TRI cung can QUAN TRI KHAC duyet: neu khong, mot quan tri bi chiem co the xoa MFA cua quan tri kia roi doi mat khau de chiem luon.
        boolean pending = sensitive(u.role, actor) || (policy.mfaGatesActions(u.role) && !"system".equals(actor));
        if (pending) { u.status = "PENDING_APPROVAL"; u.requestedBy = actor; }
        users.save(u);
        revokeSessionsOfUser(u.userId);
        audit.log(actor, "v2.mfa.reset", "userId=" + userId + (pending ? " CHO-QUAN-TRI-KHAC-DUYET" : ""));
        return u;
    }

    public List<UserAccount> listUsers() { return users.findAll(); }
    public Optional<UserAccount> user(String userId) { return users.findById(userId); }
    public Optional<UserDevice> device(String deviceId) { return devices.findById(deviceId); }
    public List<UserDevice> devicesOf(String userId) { return devices.findByUserId(userId); }
    public List<UserDevice> allDevices() { return devices.findAll(); }

    private void revokeSessionsOfUser(String userId) {
        for (UserSession s : sessions.findByUserIdAndRevokedAtIsNull(userId)) { s.revokedAt = now(); sessions.save(s); }
    }

    // ------------------------------------------------------------------ dang nhap
    public String newChallenge() {
        long t = System.currentTimeMillis();
        challenges.values().removeIf(exp -> exp < t);
        if (challenges.size() > 10_000) throw err(HttpStatus.TOO_MANY_REQUESTS, "CHALLENGE_FLOOD");
        String nonce = ResearchCrypto.randomHex(16);
        challenges.put(nonce, t + CHALLENGE_TTL_MS);
        return nonce;
    }
    private boolean consumeChallenge(String nonce) {
        Long exp = nonce == null ? null : challenges.remove(nonce);
        return exp != null && exp >= System.currentTimeMillis();
    }
    private void ipLimit(String ip) {
        long t = System.currentTimeMillis();
        long[] w = ipRate.merge(ip, new long[] {t, 1}, (o, n) -> t - o[0] > 60_000 ? n : new long[] {o[0], o[1] + 1});
        if (w[1] > props.loginRatePerMinute()) throw err(HttpStatus.TOO_MANY_REQUESTS, "LOGIN_RATE_LIMIT");
    }

    public LoginResult login(String username, String password, String deviceId, String nonce, String sig, String ip, String zone) {
        ipLimit(ip);
        UserAccount u = username == null ? null : users.findByUsername(username.trim().toLowerCase()).orElse(null);
        if (u == null) { pbkdf2(password == null ? "" : password, dummySalt, props.passwordIterations()); audit.log("anonymous", "v2.login.fail", "username khong ton tai ip=" + ip); throw err(HttpStatus.UNAUTHORIZED, "BAD_CREDENTIALS"); }
        Instant t = now();
        if (u.lockedUntil != null && u.lockedUntil.isAfter(t)) throw err(HttpStatus.TOO_MANY_REQUESTS, "ACCOUNT_LOCKED");
        if (password == null || !passwordOk(u, password)) {
            u.failedCount++;
            if (u.failedCount >= props.maxFailedLogins()) { u.lockedUntil = t.plus(Duration.ofMinutes(props.lockMinutes())); u.failedCount = 0; audit.log(u.userId, "v2.login.lock", "khoa tai khoan " + props.lockMinutes() + " phut ip=" + ip); }
            users.save(u);
            audit.log(u.userId, "v2.login.fail", "sai mat khau ip=" + ip + " zone=" + zone);
            throw err(HttpStatus.UNAUTHORIZED, "BAD_CREDENTIALS");
        }
        if (u.failedCount != 0 || u.lockedUntil != null) { u.failedCount = 0; u.lockedUntil = null; users.save(u); }
        if ("PENDING_APPROVAL".equals(u.status)) { audit.log(u.userId, "v2.login.deny", "tai khoan cho quan tri khac duyet ip=" + ip); throw err(HttpStatus.FORBIDDEN, "DENY_PENDING_APPROVAL"); }
        if (!live(u.status)) { audit.log(u.userId, "v2.login.deny", "tai khoan bi khoa ip=" + ip); throw err(HttpStatus.FORBIDDEN, "DENY_ACCOUNT_DISABLED"); }

        UserDevice d = null;
        if (deviceId != null && !deviceId.isBlank()) {
            d = devices.findById(deviceId).orElse(null);
            boolean ok = d != null && d.userId.equals(u.userId) && "ACTIVE".equals(d.status) && consumeChallenge(nonce)
                    && ResearchCrypto.verifyP256(d.signPub, LOGIN_DOMAIN + nonce + "|" + username + "|" + deviceId, sig);
            if (!ok) { audit.log(u.userId, "v2.login.deny", "chung minh thiet bi sai deviceId=" + deviceId + " ip=" + ip); throw err(HttpStatus.UNAUTHORIZED, "DEVICE_PROOF_INVALID"); }
        }
        byte[] tok = new byte[32];
        RNG.nextBytes(tok);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(tok);
        UserSession s = new UserSession();
        s.sessionId = UUID.randomUUID().toString(); s.tokenHash = ResearchCrypto.sha256Hex(token);
        s.userId = u.userId; s.deviceId = d == null ? null : d.deviceId;
        s.createdAt = t; s.lastSeenAt = t; s.expiresAt = t.plus(Duration.ofHours(Math.min(props.sessionHours(), policy.roleInt(u.role, "sessionHours", props.sessionHours()))));
        s.remoteAddr = ip; s.zone = zone;
        sessions.save(s);
        audit.log(u.userId, "v2.login", "session=" + s.sessionId.substring(0, 8) + " device=" + (d == null ? "-" : d.deviceId) + " ip=" + ip + " zone=" + zone);
        return new LoginResult(token, u, s, d);
    }

    /** Xac thuc token phien MOI yeu cau: con han, khong bi thu hoi, tai khoan + thiet bi con hoat dong. */
    public Optional<Principal> authenticate(String token, String ip, String zone) {
        if (token == null || token.isBlank()) return Optional.empty();
        UserSession s = sessions.findByTokenHash(ResearchCrypto.sha256Hex(token)).orElse(null);
        Instant t = now();
        if (s == null || s.revokedAt != null || !s.expiresAt.isAfter(t)) return Optional.empty();
        UserAccount u = users.findById(s.userId).orElse(null);
        if (u == null || !live(u.status)) return Optional.empty();
        int idle = Math.min(props.idleMinutes(), policy.roleInt(u.role, "idleMinutes", props.idleMinutes()));   // vai tro nhay cam co phien ngan hon
        if (s.lastSeenAt.plus(Duration.ofMinutes(idle)).isBefore(t)) return Optional.empty();
        UserDevice d = null;
        if (s.deviceId != null) {
            d = devices.findById(s.deviceId).orElse(null);
            if (d == null || !"ACTIVE".equals(d.status)) return Optional.empty();
        }
        if (Duration.between(s.lastSeenAt, t).getSeconds() >= 5) { s.lastSeenAt = t; sessions.save(s); }
        return Optional.of(new Principal(u, s, d, ip, zone));
    }

    /** Phien con hieu luc (chua thu hoi, chua het han tuyet doi) - dung khi nut cap khoa doi ve cap khoa. Tai khoan/thiet bi phai con hoat dong. */
    public Optional<Principal> activeBySessionId(String sessionId) {
        UserSession s = sessionId == null ? null : sessions.findById(sessionId).orElse(null);
        if (s == null || s.revokedAt != null || !s.expiresAt.isAfter(now())) return Optional.empty();
        UserAccount u = users.findById(s.userId).orElse(null);
        UserDevice d = s.deviceId == null ? null : devices.findById(s.deviceId).orElse(null);
        if (u == null || !live(u.status) || d == null || !"ACTIVE".equals(d.status)) return Optional.empty();
        return Optional.of(new Principal(u, s, d, s.remoteAddr, s.zone));
    }

    public void logout(Principal p) {
        p.session().revokedAt = now();
        sessions.save(p.session());
        audit.log(p.user().userId, "v2.logout", "session=" + p.session().sessionId.substring(0, 8));
    }

    // ------------------------------------------------------------------ thiet bi + chung chi
    public static String certMessage(String userId, String gid, String deviceId, String signPub) {
        return CERT_DOMAIN + userId + "|" + gid + "|" + deviceId + "|" + signPub;
    }

    /** Dang ky thiet bi MOI cho chinh nguoi dang nhap (can nhap lai mat khau). Day la quy trinh hop le de doi may, khong phai pha vo kinh. */
    public UserDevice enroll(Principal p, String password, String signPub, String label) {
        UserAccount u = p.user();
        if (password == null || !passwordOk(u, password)) {
            u.failedCount++;
            if (u.failedCount >= props.maxFailedLogins()) { u.lockedUntil = now().plus(Duration.ofMinutes(props.lockMinutes())); u.failedCount = 0; }
            users.save(u);
            audit.log(u.userId, "v2.device.enroll.deny", "nhap lai mat khau sai");
            throw err(HttpStatus.UNAUTHORIZED, "STEP_UP_FAILED");
        }
        String pub = signPub == null ? "" : signPub.toLowerCase();
        if (!ResearchCrypto.validP256Pub(pub)) throw err(HttpStatus.BAD_REQUEST, "SIGN_PUB_INVALID");
        String id = ResearchCrypto.deviceIdOf(pub);
        if (devices.existsById(id)) throw err(HttpStatus.CONFLICT, "DEVICE_EXISTS");
        if (devices.countByUserIdAndStatus(u.userId, "ACTIVE") >= Math.min(props.maxDevices(), policy.roleInt(u.role, "maxDevices", props.maxDevices()))) throw err(HttpStatus.CONFLICT, "DEVICE_LIMIT");
        UserDevice d = new UserDevice();
        d.deviceId = id; d.userId = u.userId; d.signPub = pub;
        d.label = label == null || label.isBlank() ? "may" : label.trim().substring(0, Math.min(60, label.trim().length()));
        d.cert = registry.signMessage(certMessage(u.userId, u.gid, id, pub));
        d.status = "ACTIVE"; d.createdAt = now();
        devices.save(d);
        audit.log(u.userId, "v2.device.enroll", "device=" + id + " label=" + d.label + " zone=" + p.zone());
        return d;
    }

    public UserDevice revokeDevice(String deviceId, String actor) {
        UserDevice d = devices.findById(deviceId).orElseThrow(() -> err(HttpStatus.NOT_FOUND, "DEVICE_NOT_FOUND"));
        d.status = "REVOKED"; d.revokedAt = now();
        devices.save(d);
        for (UserSession s : sessions.findByDeviceIdAndRevokedAtIsNull(deviceId)) { s.revokedAt = now(); sessions.save(s); }
        audit.log(actor, "v2.device.revoke", "device=" + deviceId + " userId=" + d.userId);
        return d;
    }
}
