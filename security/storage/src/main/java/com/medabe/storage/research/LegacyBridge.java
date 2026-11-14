package com.medabe.storage.research;

import com.medabe.storage.domain.MedicalRecord;
import com.medabe.storage.service.AuditService;
import com.medabe.storage.service.EpochService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;

/**
 * CAU NOI cho app nhan vien: cac endpoint ban ghi/header (/api/records, /api/headers) dung dinh dang phong bi cu, nhung
 * (1) chi nhan PHIEN TAI KHOAN (xac thuc o ResearchGateFilter), (2) tac gia ban ghi do BACKEND gan tu phien (khong tin client),
 * (3) quyen DOC = tap thuoc tinh cua tai khoan THOA policy CP-ABE cua ban ghi (mot nguon: research-policy.json, muc "app"),
 * quyen GHI theo vai tro/khoa, (4) chuoi policy cua phong bi phai BANG policy chuan cua (loai, khoa, tac gia) - nguoi dung khong
 * ghi duoc ban ma co policy yeu hon hoac mang nhanh Author cua nguoi khac, (5) gio lam viec (o cong).
 * Ban ghi nguoi dung khong doc duoc KHONG duoc liet ke (khong lo su ton tai cua khoa khac), va khong bao gio tra ban ma cho nguoi sai quyen.
 */
@Component
@ConditionalOnExpression("${medabe.research.enabled:false} && ${medabe.research.legacy-bridge:false}")
public class LegacyBridge {
    private static final Pattern ATTR_VER = Pattern.compile("(MED:[A-Za-z0-9_.:-]+?)#(\\d{4}W\\d{2})\\.(\\d+)");
    private static final String LOGGED = "medabe.bridge.logged";

    private final PolicyService policy;
    private final AuditService audit;
    private final EpochService epochs;
    private final IdentityService identity;

    public LegacyBridge(PolicyService policy, AuditService audit, EpochService epochs, IdentityService identity) { this.policy = policy; this.audit = audit; this.epochs = epochs; this.identity = identity; }

    private static ResponseStatusException err(HttpStatus s, String code) { return new ResponseStatusException(s, code); }

    IdentityService.Principal principal(HttpServletRequest req) {
        Object p = req.getAttribute(ResearchGateFilter.ATTR);
        if (!(p instanceof IdentityService.Principal ip)) throw err(HttpStatus.UNAUTHORIZED, "SESSION_INVALID");
        return ip;
    }

    /** Tac gia cua ban ghi/header SE TAO: lay tu phien. */
    public String userIdOf(HttpServletRequest req) { return principal(req).user().userId; }

    private void logOnce(HttpServletRequest req, String key, String what) {
        @SuppressWarnings("unchecked") Set<String> logged = (Set<String>) req.getAttribute(LOGGED);
        if (logged == null) { logged = new HashSet<>(); req.setAttribute(LOGGED, logged); }
        if (logged.add(key)) audit.log(principal(req).user().userId, "v2.decision", what + " zone=" + principal(req).zone() + " policy=" + policy.version() + " via=legacy-api");
    }

    private PolicyService.Decision decideWrite(HttpServletRequest req, String action, String type, String khoa) {
        IdentityService.Principal p = principal(req);
        PolicyService.Decision d = policy.decideAppWrite(ResearchAuthController.subject(p), action, type, khoa);
        logOnce(req, action + "|" + type + "|" + khoa + "|" + d.reason(), (d.permit() ? "permit" : "deny") + " action=record." + action + " type=" + type + " reason=" + d.reason() + " rule=" + d.rule());
        return d;
    }

    /**
     * Quyen ghi (write | import) cho (loai, khoa) + kiem chuoi policy cua phong bi. Tra ve chuoi khoa CHUAN (ma danh muc, vd "Mat,Nhi") de luu.
     * headerPolicy != null: phong bi v3, policy cua header chung.
     */
    public String checkWrite(HttpServletRequest req, String action, String type, String khoa, JsonNode envelope, String headerPolicy) {
        PolicyService.Decision d = decideWrite(req, action, type, khoa);
        if (!d.permit()) throw err(HttpStatus.FORBIDDEN, d.reason());
        String canonical = canonicalKhoa(type, khoa);
        String pol = headerPolicy != null ? headerPolicy : envelope != null && envelope.path("v").asInt(0) == 2 ? envelope.path("abe").path("policy").asString("") : null;
        if (pol != null) checkPolicyString(pol, type, canonical, userIdOf(req));
        return canonical;
    }

    /** Quyen xoa: phai la TAC GIA va van con quyen ghi muc nay (quyen doc lai khong keo theo quyen xoa). */
    public void checkDelete(HttpServletRequest req, MedicalRecord r) {
        IdentityService.Principal p = principal(req);
        boolean mine = r.authorUserId != null && r.authorUserId.equals(p.user().userId);
        if (!mine) { logOnce(req, "del|" + r.id, "deny action=record.delete type=" + r.type + " reason=DENY_NOT_AUTHOR"); throw err(HttpStatus.FORBIDDEN, "DENY_NOT_AUTHOR"); }
        PolicyService.Decision d = decideWrite(req, "write", r.type, r.khoa);
        if (!d.permit()) throw err(HttpStatus.FORBIDDEN, d.reason());
    }

    /** Ma khoa chuan de luu: loai khong dung khoa => KSK; con lai la danh sach ma theo danh muc. */
    public String canonicalKhoa(String type, String khoa) {
        if (!policy.knownAppType(type)) throw err(HttpStatus.FORBIDDEN, "DENY_UNKNOWN_RESOURCE");
        if ("none".equals(policy.appKhoaMode(type))) return "KSK";
        try { return String.join(",", policy.appKhoasFor(type, khoa)); } catch (IllegalArgumentException e) { throw err(HttpStatus.FORBIDDEN, "DENY_KHOA_INVALID"); }
    }

    public boolean canRead(HttpServletRequest req, MedicalRecord r) {
        IdentityService.Principal p = principal(req);
        return policy.canReadApp(ResearchAuthController.subject(p), r.type, r.khoa, r.authorUserId, identity.mfaFresh(p));
    }

    private final java.util.Map<String, java.util.ArrayDeque<Long>> privReads = new java.util.concurrent.ConcurrentHashMap<>();
    private static final int ANOMALY_READS = 40;                 // so lan doc trong 10 phut tro len bi coi la bat thuong
    private static final long ANOMALY_WINDOW_MS = 10 * 60_000L;

    /**
     * DOC DIEN RONG (vai tro nhay cam nhu Giam sat): bat buoc nhap LY DO (header X-Access-Reason, ma hoa URL, 8-200 ky tu) cho MOI lan tra cuu/doc;
     * ly do + doi tuong doc duoc ghi nhat ky; doc nhieu bat thuong trong thoi gian ngan phat canh bao rieng. Vai tro thuong khong bi anh huong.
     */
    public void auditPrivilegedRead(HttpServletRequest req, String what) {
        IdentityService.Principal p = principal(req);
        // MFA la thuoc tinh ABE: vai tro requiresMfa chua xac thuc (hoac het han) thi KHONG co thuoc tinh MED:Auth:MFA => khong mo duoc nhanh Giam sat. Bao ro de giao dien hoi ma.
        if (policy.requiresMfa(p.user().role) && !identity.mfaFresh(p)) {
            audit.log(p.user().userId, "v2.decision", "deny action=record.read reason=MFA_REQUIRED role=" + p.user().role + " zone=" + p.zone() + " policy=" + policy.version());
            throw err(HttpStatus.PRECONDITION_REQUIRED, "MFA_REQUIRED");
        }
        if (!policy.roleFlag(p.user().role, "readReasonRequired", false)) return;
        String raw = req.getHeader("X-Access-Reason");
        String reason;
        try { reason = raw == null ? "" : java.net.URLDecoder.decode(raw, java.nio.charset.StandardCharsets.UTF_8).replaceAll("\\p{Cntrl}", " ").strip(); }
        catch (IllegalArgumentException e) { reason = ""; }
        if (reason.length() < 8 || reason.length() > 200) {
            audit.log(p.user().userId, "v2.decision", "deny action=record.read reason=ACCESS_REASON_REQUIRED role=" + p.user().role + " zone=" + p.zone() + " policy=" + policy.version());
            throw err(HttpStatus.PRECONDITION_REQUIRED, "ACCESS_REASON_REQUIRED");
        }
        audit.log(p.user().userId, "v2.giamsat.read", what + " ly-do=\"" + reason + "\" zone=" + p.zone() + " policy=" + policy.version());
        long now = System.currentTimeMillis();
        int n;
        java.util.ArrayDeque<Long> q = privReads.computeIfAbsent(p.user().userId, k -> new java.util.ArrayDeque<>());
        synchronized (q) {
            while (!q.isEmpty() && now - q.peekFirst() > ANOMALY_WINDOW_MS) q.pollFirst();
            q.addLast(now); n = q.size();
        }
        if (n >= ANOMALY_READS && n % 20 == 0) audit.log(p.user().userId, "v2.giamsat.anomaly", "doc-bat-thuong: " + n + " lan trong 10 phut role=" + p.user().role + " zone=" + p.zone());
    }

    public void checkRead(HttpServletRequest req, MedicalRecord r) {
        if (!canRead(req, r)) {
            logOnce(req, "read|" + r.type + "|" + r.khoa, "deny action=record.read type=" + r.type + " reason=DENY_NOT_ENTITLED");
            throw err(HttpStatus.FORBIDDEN, "DENY_NOT_ENTITLED");
        }
    }

    /** Chuoi policy (bo nhan epoch) phai BANG policy chuan cua (loai, khoa, tac gia), nhan epoch phai la hien hanh. authorUserId: tac gia cua ban ghi (null = ban ghi cu: khong co nhanh Author). */
    public void checkPolicyString(String pol, String type, String khoaCsv, String authorUserId) {
        if (!policy.knownAppType(type)) throw err(HttpStatus.FORBIDDEN, "DENY_UNKNOWN_RESOURCE");
        checkEpoch(pol);
        List<String> ks = "none".equals(policy.appKhoaMode(type)) ? List.of() : policy.normalizeKhoaList(khoaCsv);
        if (!policy.policyMatchesApp(ATTR_VER.matcher(pol).replaceAll("$1"), type, ks, authorUserId)) throw err(HttpStatus.FORBIDDEN, "POLICY_MISMATCH");
    }

    private void checkEpoch(String pol) {
        EpochService.Directory dir = epochs.directory();
        Matcher m = ATTR_VER.matcher(pol);
        while (m.find()) {
            if (!m.group(2).equals(dir.tag()) || Integer.parseInt(m.group(3)) != dir.counters().getOrDefault(m.group(1), 0)) throw err(HttpStatus.CONFLICT, "EPOCH_STALE");
        }
    }

    /** Header khoa chung: policy phai la MOT policy chuan cua tai khoan nay (loai/khoa bat ky, tac gia = chinh no, hoac tac gia cua header khi boc lai). */
    public void validateHeaderPolicy(HttpServletRequest req, String pol, String authorUserId) {
        checkEpoch(pol);
        if (!matchesSomeCanonical(ATTR_VER.matcher(pol).replaceAll("$1"), authorUserId)) throw err(HttpStatus.FORBIDDEN, "POLICY_MISMATCH");
    }

    private boolean matchesSomeCanonical(String stripped, String authorUserId) {
        for (String type : policy.appTypes()) {
            if ("many".equals(policy.appKhoaMode(type))) continue;
            if ("none".equals(policy.appKhoaMode(type))) { if (policy.policyMatchesApp(stripped, type, List.of(), authorUserId)) return true; continue; }
            for (String k : policy.catalogCodes()) if (policy.policyMatchesApp(stripped, type, List.of(k), authorUserId)) return true;
        }
        return false;
    }

    /**
     * Boc lai header CHUNG (PUT /api/headers/{id}). Ngoai viec policy moi phai la policy chuan va dung epoch, neu header HIEN TAI dang mang mot policy chuan thi policy moi
     * phai CUNG CAU TRUC (chi duoc lam moi nhan epoch). Neu khong, mot nguoi doc hop le co the boc lai header sang policy chuan cua MUC KHAC (vd Hanh chinh -> Lam sang Mat) va
     * lam ca lo ban ghi khong con giai ma duoc voi cac nguoi doc hop le khac. Header cu khong con khop policy chuan nao (tao truoc khi co tai khoan, hoac ma tran doi phien ban)
     * van duoc chuyen sang policy chuan nhu truoc de khong lam hong du lieu cu.
     */
    public void validateHeaderRewrap(HttpServletRequest req, String newPol, String oldPol, String authorUserId) {
        validateHeaderPolicy(req, newPol, authorUserId);
        String sn = ATTR_VER.matcher(newPol).replaceAll("$1"), so = ATTR_VER.matcher(oldPol == null ? "" : oldPol).replaceAll("$1");
        if (!matchesSomeCanonical(so, authorUserId)) return;                        // header cu: cho phep chuyen sang policy chuan
        List<Set<String>> a = PolicyService.parseDnf(sn), b = PolicyService.parseDnf(so);
        if (a != null && b != null && new HashSet<>(a).equals(new HashSet<>(b))) return;
        logOnce(req, "rewrap-structure", "deny action=header.rewrap reason=POLICY_STRUCTURE_CHANGED");
        throw err(HttpStatus.FORBIDDEN, "POLICY_MISMATCH");
    }

    /**
     * Nguoi nay co the mo header nay khong = tap thuoc tinh THAT cua tai khoan (backend cap) thoa policy cua header.
     * Header CU (tao truoc khi co tai khoan, con nhanh may tao/So Y te/pha vo kinh) cung duoc xet bang quy tac nay.
     */
    public boolean canReadHeaderPolicy(HttpServletRequest req, String pol) {
        String stripped = ATTR_VER.matcher(pol).replaceAll("$1");
        Set<String> mine = policy.attributesOf(ResearchAuthController.subject(principal(req)), identity.mfaFresh(principal(req)));
        List<Set<String>> dnf = PolicyService.parseDnf(stripped);
        if (dnf == null) {                                       // dang cu (chua chuan hoa): tach thu cong
            dnf = new ArrayList<>();
            for (String branch : stripped.split("\\s+OR\\s+")) {
                Set<String> b = new HashSet<>();
                for (String a : branch.replaceAll("[()]", " ").trim().split("\\s+AND\\s+")) b.add(a.trim());
                dnf.add(b);
            }
        }
        return PolicyService.satisfies(dnf, mine);
    }
}
