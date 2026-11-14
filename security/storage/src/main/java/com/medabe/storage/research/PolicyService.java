package com.medabe.storage.research;

import com.medabe.storage.service.RegistryService;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Diem QUYET DINH ABAC (PDP) duy nhat o backend. Doc ma tran quyen tu research-policy.json (co version + bam), tra ve
 * permit/deny kem MA LY DO va phien ban policy. Cung ma tran nay sinh ra policy giai ma CP-ABE (abePolicy) nhung hai lop
 * duoc thuc thi doc lap: lop nay o backend, lop kia bang toan hoc o may khach.
 */
@Service
@ConditionalOnProperty(prefix = "medabe.research", name = "enabled", havingValue = "true")
public class PolicyService {
    public record Subject(String userId, String role, String khoa, String status) {}
    public record Decision(boolean permit, String reason, String policyVersion, String rule) {
        public static Decision permit(String rule, String v) { return new Decision(true, "PERMIT_ROLE_MATRIX", v, rule); }
        public static Decision deny(String reason, String v, String rule) { return new Decision(false, reason, v, rule); }
    }

    public static final String DOMAIN = "medabe/policy/v1|";
    private final JsonNode doc;
    private final String version;
    private final String hash;
    private final ObjectMapper mapper;
    private final RegistryService registry;
    private final Map<String, String> abePolicies = new LinkedHashMap<>();
    /** CHI de kiem thu: gia lap loi phan quyen backend (PDP bi bo qua o lop DOC). Chi bat duoc qua endpoint bang chung. */
    private final AtomicBoolean simulatedReadDefect = new AtomicBoolean(false);

    /** Bat bang medabe.research.admin-mfa (env MEDABE_RESEARCH_ADMIN_MFA): vai tro QUAN_TRI phai xac thuc TOTP truoc moi thao tac quan tri (xem ResearchGateFilter). */
    private final boolean adminMfa;
    private final int adminMfaFreshMinutes;

    public PolicyService(ObjectMapper mapper, RegistryService registry,
                         @org.springframework.beans.factory.annotation.Value("${medabe.research.admin-mfa:false}") boolean adminMfa,
                         @org.springframework.beans.factory.annotation.Value("${medabe.research.admin-mfa-fresh-minutes:480}") int adminMfaFreshMinutes) throws Exception {
        this.mapper = mapper; this.registry = registry; this.adminMfa = adminMfa; this.adminMfaFreshMinutes = Math.max(1, adminMfaFreshMinutes);
        byte[] raw;
        try (InputStream in = PolicyService.class.getResourceAsStream("/research-policy.json")) {
            if (in == null) throw new IllegalStateException("thieu research-policy.json");
            raw = in.readAllBytes();
        }
        this.doc = mapper.readTree(new String(raw, StandardCharsets.UTF_8));
        this.version = doc.get("version").stringValue();
        this.hash = ResearchCrypto.HEX.formatHex(ResearchCrypto.sha256(raw));
        for (String key : sectionKeys()) abePolicies.put(key, deriveAbePolicy(key));
    }

    public String version() { return version; }
    public String hash() { return hash; }
    public JsonNode matrix() { return doc; }
    public AtomicBoolean simulatedReadDefect() { return simulatedReadDefect; }

    public List<String> sectionKeys() {
        List<String> out = new ArrayList<>();
        doc.get("sections").propertyNames().forEach(out::add);
        return out;
    }
    public boolean knownSection(String key) { return key != null && doc.get("sections").has(key); }
    public static String sectionKey(String type, String khoa) { return "lamsang".equals(type) ? "lamsang." + khoa : type; }
    public List<String> khoas() {
        List<String> out = new ArrayList<>();
        doc.get("khoas").forEach(n -> out.add(n.stringValue()));
        return out;
    }
    public boolean knownRole(String role) { return doc.get("roles").has(role); }

    /** Tham so bao mat RIENG cua mot vai tro (vd GIAM_SAT: maxDevices, idleMinutes, sessionHours, minPasswordLength). Khong khai bao => gia tri mac dinh `def`. */
    public int roleInt(String role, String field, int def) {
        if (!knownRole(role)) return def;
        JsonNode n = doc.get("roles").get(role).get(field);
        return n != null && n.isNumber() ? n.asInt(def) : def;
    }
    public boolean roleFlag(String role, String field, boolean def) {
        if (!knownRole(role)) return def;
        JsonNode n = doc.get("roles").get(role).get(field);
        return n != null && n.isBoolean() ? n.asBoolean(def) : def;
    }
    public boolean roleNeedsKhoa(String role) { return knownRole(role) && doc.get("roles").get(role).get("needsKhoa").asBoolean(false); }
    public Set<String> afterHoursAllowed() {
        Set<String> s = new LinkedHashSet<>();
        doc.get("afterHoursAllowed").forEach(n -> s.add(n.stringValue()));
        return s;
    }
    public String sectionType(String key) { return doc.get("sections").get(key).get("type").stringValue(); }
    public String sectionKhoa(String key) { return doc.get("sections").get(key).get("khoa").stringValue(); }

    /** Thuoc tinh ABE (co tien to MED:) ma tai khoan nay DUOC PHEP xin khoa. Quan tri: rong. Moi tai khoan co thuoc tinh con co MED:Author:<userId> (chi cua CHINH no). */
    public Set<String> attributesOf(Subject s) { return attributesOf(s, false); }

    /** Thuoc tinh MFA: vai tro co requiresMfa chi nhan MED:Auth:MFA khi PHIEN VUA xac thuc TOTP dung (mfaFresh). Day la thuoc tinh ABE thuc su: policy cua Giam sat doi hoi no. */
    public static final String MFA_ATTR = "MED:Auth:MFA";
    public boolean requiresMfa(String role) { return roleFlag(role, "requiresMfa", false) || mfaGatesActions(role); }
    public int mfaFreshMinutes(String role) { return roleInt(role, "mfaFreshMinutes", "QUAN_TRI".equals(role) ? adminMfaFreshMinutes : 10); }
    /** true: vai tro nay bi chan moi thao tac quan tri cho den khi phien xac thuc TOTP con han (hien chi QUAN_TRI, khi admin-mfa bat). */
    public boolean mfaGatesActions(String role) { return adminMfa && "QUAN_TRI".equals(role); }

    public Set<String> attributesOf(Subject s, boolean mfaFresh) {
        Set<String> out = new LinkedHashSet<>();
        if (s == null || !knownRole(s.role())) return out;
        // Tài khoản bị HẠN CHẾ (nghi bị chiếm): chỉ còn thuộc tính tác giả => chỉ đọc lại được dữ liệu do chính mình nhập; mất mọi thuộc tính vai trò/khoa/MFA.
        if ("RESTRICTED".equals(s.status())) { if (s.userId() != null) out.add("MED:" + doc.get("app").get("authorAttribute").stringValue() + ":" + s.userId()); return out; }
        JsonNode role = doc.get("roles").get(s.role());
        role.get("attributes").forEach(a -> out.add("MED:" + a.stringValue()));
        if (role.has("appAttributes")) role.get("appAttributes").forEach(a -> out.add("MED:" + a.stringValue()));
        if (roleAcceptsKhoa(s.role())) for (String k : subjectKhoas(s)) out.add("MED:Khoa:" + k);
        if (!out.isEmpty() && s.userId() != null) out.add("MED:" + doc.get("app").get("authorAttribute").stringValue() + ":" + s.userId());
        if (mfaFresh && requiresMfa(s.role()) && !out.isEmpty()) out.add(MFA_ATTR);
        return out;
    }

    private Set<String> ruleAttrs(JsonNode rule) {
        Set<String> out = new LinkedHashSet<>();
        JsonNode role = doc.get("roles").get(rule.get("role").stringValue());
        role.get("attributes").forEach(a -> out.add("MED:" + a.stringValue()));
        if (rule.has("khoa")) out.add("MED:Khoa:" + rule.get("khoa").stringValue());
        return out;
    }

    public boolean roleAcceptsKhoa(String role) {
        return knownRole(role) && (roleNeedsKhoa(role) || doc.get("roles").get(role).path("acceptsKhoa").asBoolean(false));
    }

    // ------------------------------------------------------------------ DANH MUC KHOA (ma on dinh, doc lap voi ten hien thi)
    private static String foldName(String raw) {
        String n = java.text.Normalizer.normalize(raw == null ? "" : raw, java.text.Normalizer.Form.NFC);
        return n.strip().toLowerCase(java.util.Locale.ROOT).replaceAll("\\s+", " ");
    }

    private Map<String, String> aliasIndex;      // ten da chuan hoa -> ma khoa ("" = mo ho)
    private synchronized Map<String, String> aliasIndex() {
        if (aliasIndex != null) return aliasIndex;
        Map<String, String> idx = new LinkedHashMap<>();
        for (JsonNode c : doc.get("khoaCatalog")) {
            String code = c.get("code").stringValue();
            List<String> names = new ArrayList<>(List.of(code, c.get("label").stringValue()));
            c.get("aliases").forEach(a -> names.add(a.stringValue()));
            for (String nm : names) idx.merge(foldName(nm), code, (a, b) -> a.equals(b) ? a : "");
        }
        return aliasIndex = idx;
    }

    /** Ten hien thi bat ky ("Mắt", "MẮT", " mat ", ky tu to hop hoac tach roi) -> ma khoa on dinh. Khong co trong danh muc hoac mo ho -> empty. */
    public java.util.Optional<String> normalizeKhoa(String raw) {
        if (raw == null) return java.util.Optional.empty();
        String code = aliasIndex().get(foldName(raw));
        return code == null || code.isEmpty() ? java.util.Optional.empty() : java.util.Optional.of(code);
    }

    public List<String> catalogCodes() {
        List<String> out = new ArrayList<>();
        doc.get("khoaCatalog").forEach(c -> out.add(c.get("code").stringValue()));
        return out;
    }

    /** "mat, NHI" -> [Nhi, Mat] (theo thu tu danh muc, khong trung). Phan tu khong hop le -> IllegalArgumentException(gia tri). */
    public List<String> normalizeKhoaList(String csv) {
        java.util.TreeSet<Integer> order = new java.util.TreeSet<>();
        List<String> codes = catalogCodes();
        if (csv != null) for (String part : csv.split(",")) {
            if (part.isBlank()) continue;
            String code = normalizeKhoa(part).orElseThrow(() -> new IllegalArgumentException(part.strip()));
            order.add(codes.indexOf(code));
        }
        List<String> out = new ArrayList<>();
        for (int i : order) out.add(codes.get(i));
        return out;
    }

    public List<String> subjectKhoas(Subject s) {
        if (s == null || s.khoa() == null || s.khoa().isBlank()) return List.of();
        try { return normalizeKhoaList(s.khoa()); } catch (IllegalArgumentException e) { return List.of(); }
    }

    // ------------------------------------------------------------------ MO HINH TAC GIA (app dang dung)
    public boolean knownAppType(String type) { return type != null && doc.get("app").get("types").has(type); }
    public List<String> appTypes() { List<String> out = new ArrayList<>(); doc.get("app").get("types").propertyNames().forEach(out::add); return out; }
    public String appKhoaMode(String type) { return doc.get("app").get("types").get(type).get("khoa").stringValue(); }

    /** DNF (OR cua cac AND) cua policy giai ma CP-ABE cho (loai, cac khoa, tac gia). uid = null: ban ghi CU khong biet tac gia theo tai khoan -> bo nhanh Author. Thuoc tinh CHUA gan epoch. */
    public List<List<String>> appDnf(String type, List<String> khoas, String uid) {
        List<List<String>> out = new ArrayList<>();
        String author = doc.get("app").get("authorAttribute").stringValue();
        for (JsonNode tok : doc.get("app").get("types").get(type).get("policy")) {
            String t = tok.stringValue();
            if (t.equals(author)) { if (uid != null) out.add(List.of("MED:" + t + ":" + uid)); }
            else if (t.endsWith("&Khoa")) { for (String k : khoas) out.add(List.of("MED:" + t.substring(0, t.length() - 5), "MED:Khoa:" + k)); }
            else if (t.contains("+")) { List<String> and = new ArrayList<>(); for (String a : t.split("\\+")) and.add("MED:" + a); out.add(and); }   // "A+B" = nhanh (A AND B)
            else out.add(List.of("MED:" + t));
        }
        return out;
    }

    /** Chuoi policy chuan (chua gan epoch): "A OR (B AND C)". Phia may khach dung CUNG dinh dang tu tai lieu policy da ky. */
    public String appPolicy(String type, List<String> khoas, String uid) {
        List<String> parts = new ArrayList<>();
        for (List<String> b : appDnf(type, khoas, uid)) parts.add(b.size() == 1 ? b.get(0) : "(" + String.join(" AND ", b) + ")");
        return String.join(" OR ", parts);
    }

    private static final String ATOM = "MED:[A-Za-z0-9_.:-]+";
    private static final java.util.regex.Pattern BRANCH = java.util.regex.Pattern.compile(ATOM + "|\\(" + ATOM + "(?: AND " + ATOM + ")+\\)");

    /** Phan tich chuoi policy DANG CHUAN (nhanh don hoac (a AND b ...) noi bang OR). Dang khac -> null (khong tin). */
    public static List<Set<String>> parseDnf(String pol) {
        if (pol == null || pol.isBlank() || pol.length() > 4000) return null;
        List<Set<String>> out = new ArrayList<>();
        for (String br : pol.strip().split(" OR ", -1)) {
            if (!BRANCH.matcher(br).matches()) return null;
            out.add(new java.util.TreeSet<>(List.of(br.replaceAll("[()]", "").split(" AND "))));
        }
        return out;
    }

    private static List<Set<String>> sets(List<List<String>> l) {
        List<Set<String>> o = new ArrayList<>();
        for (List<String> b : l) o.add(new java.util.TreeSet<>(b));
        return o;
    }

    /** Policy (da bo nhan epoch) co BANG DUNG policy chuan cua (loai, khoa, tac gia) khong? So sanh theo tap nhanh, khong phu thuoc thu tu. */
    public boolean policyMatchesApp(String strippedPolicy, String type, List<String> khoas, String uid) {
        List<Set<String>> given = parseDnf(strippedPolicy);
        List<Set<String>> want = sets(appDnf(type, khoas, uid));
        return given != null && given.size() == want.size() && new java.util.HashSet<>(given).equals(new java.util.HashSet<>(want));
    }

    /** Tap thuoc tinh THOA policy (co it nhat mot nhanh ma moi thuoc tinh deu co)? */
    public static boolean satisfies(List<Set<String>> dnf, Set<String> attrs) {
        if (dnf == null) return false;
        for (Set<String> b : dnf) if (attrs.containsAll(b)) return true;
        return false;
    }

    /** Cac khoa hop le cho (loai) theo che do khoa; sai -> IllegalArgumentException. Che do 'none': khong dung khoa trong quyen. */
    public List<String> appKhoasFor(String type, String khoaRaw) {
        String mode = appKhoaMode(type);
        if ("none".equals(mode)) return List.of();
        List<String> ks = normalizeKhoaList(khoaRaw);
        if (ks.isEmpty() || ("one".equals(mode) && ks.size() != 1) || ks.size() > 4) throw new IllegalArgumentException(String.valueOf(khoaRaw));
        return ks;
    }

    /** Quyen GHI/NHAP cua tai khoan cho (loai, khoa). Day la quyen ghi (khong phai doc), kiem o backend. */
    public Decision decideAppWrite(Subject s, String action, String type, String khoaRaw) {
        if (s == null || !"ACTIVE".equals(s.status())) return Decision.deny(s != null && "RESTRICTED".equals(s.status()) ? "DENY_ACCOUNT_RESTRICTED" : "DENY_ACCOUNT_DISABLED", version, "account");
        if (!knownAppType(type)) return Decision.deny("DENY_UNKNOWN_RESOURCE", version, String.valueOf(type));
        String rule = "app." + type + "." + action;
        boolean allowed = false;
        for (JsonNode r : doc.get("app").get("types").get(type).get("write")) if (r.stringValue().equals(s.role())) allowed = true;
        if (!allowed) return Decision.deny("DENY_ROLE_NOT_ALLOWED", version, rule);
        List<String> ks;
        try { ks = appKhoasFor(type, khoaRaw); } catch (IllegalArgumentException e) { return Decision.deny("DENY_KHOA_INVALID", version, rule); }
        switch (s.role()) {
            case "BAC_SI", "KET_LUAN" -> { if (!subjectKhoas(s).containsAll(ks)) return Decision.deny("DENY_KHOA_MISMATCH", version, rule); }
            case "KTV" -> { if (!ks.isEmpty() && !ks.equals(List.of("XetNghiem"))) return Decision.deny("DENY_KHOA_MISMATCH", version, rule); }
            default -> { }
        }
        return Decision.permit(rule + ":" + s.role(), version);
    }

    /** Tai khoan nay DOC duoc ban ghi nay khong? = tap thuoc tinh cua tai khoan thoa policy cua ban ghi (cung nguon voi policy ma hoa). authorUserId == null: ban ghi cu. */
    public boolean canReadApp(Subject s, String type, String khoaCsv, String authorUserId) { return canReadApp(s, type, khoaCsv, authorUserId, false); }

    /** mfaFresh: phien nay vua xac thuc MFA con han (xem IdentityService.mfaFresh). Nhanh Giam sat can ca Auth:MFA. */
    public boolean canReadApp(Subject s, String type, String khoaCsv, String authorUserId, boolean mfaFresh) {
        if (s == null || !("ACTIVE".equals(s.status()) || "RESTRICTED".equals(s.status())) || !knownAppType(type)) return false;
        Set<String> mine = attributesOf(s, mfaFresh);
        if (mine.isEmpty()) return false;
        List<String> ks;
        try { ks = normalizeKhoaList(khoaCsv); } catch (IllegalArgumentException e) { ks = List.of(); }
        return satisfies(sets(appDnf(type, ks, authorUserId)), mine);
    }

    private String deriveAbePolicy(String key) {
        Set<String> branches = new LinkedHashSet<>();
        for (JsonNode rule : doc.get("sections").get(key).get("read")) {
            Set<String> attrs = ruleAttrs(rule);
            if (attrs.isEmpty()) throw new IllegalStateException("vai tro " + rule.get("role") + " khong co thuoc tinh ABE nhung duoc doc " + key);
            branches.add(String.join(" AND ", attrs));
        }
        return String.join(" OR ", branches);
    }

    /** Policy giai ma CP-ABE (chua gan nhan epoch) cua mot muc, sinh tu ma tran. */
    public String abePolicy(String key) { return abePolicies.get(key); }
    public Map<String, String> abePolicies() { return abePolicies; }

    /** action: read | write | import. Danh gia thuan tuy theo (vai tro, khoa, trang thai) - gio lam viec duoc kiem o cong rieng. */
    public Decision decideRecord(Subject s, String action, String key) {
        if (s == null || !"ACTIVE".equals(s.status())) return Decision.deny(s != null && "RESTRICTED".equals(s.status()) ? "DENY_ACCOUNT_RESTRICTED" : "DENY_ACCOUNT_DISABLED", version, "account");
        if (!knownSection(key)) return Decision.deny("DENY_UNKNOWN_RESOURCE", version, key);
        if ("read".equals(action) && simulatedReadDefect.get()) return new Decision(true, "PERMIT_SIMULATED_BACKEND_DEFECT", version, key + ".read:DEFECT");
        JsonNode rules = doc.get("sections").get(key).get(action);
        if (rules == null || rules.size() == 0) return Decision.deny("DENY_ACTION_NOT_DEFINED", version, key + "." + action);
        boolean roleSeen = false;
        for (JsonNode r : rules) {
            if (!r.get("role").stringValue().equals(s.role())) continue;
            roleSeen = true;
            if (!r.has("khoa") || subjectKhoas(s).contains(r.get("khoa").stringValue()))
                return Decision.permit(key + "." + action + ":" + s.role() + (r.has("khoa") ? "/" + r.get("khoa").stringValue() : ""), version);
        }
        return Decision.deny(roleSeen ? "DENY_KHOA_MISMATCH" : "DENY_ROLE_NOT_ALLOWED", version, key + "." + action);
    }

    public Decision decidePermission(Subject s, String permission) {
        if (s == null || !"ACTIVE".equals(s.status())) return Decision.deny(s != null && "RESTRICTED".equals(s.status()) ? "DENY_ACCOUNT_RESTRICTED" : "DENY_ACCOUNT_DISABLED", version, "account");
        JsonNode roles = doc.get("permissions").get(permission);
        if (roles != null) for (JsonNode r : roles) if (r.stringValue().equals(s.role())) return Decision.permit(permission + ":" + s.role(), version);
        return Decision.deny("DENY_ROLE_NOT_ALLOWED", version, permission);
    }

    /** Tai lieu policy gui cho may khach: payload (chuoi JSON nguyen van) + chu ky Ed25519 cua registry de may khach ghim. */
    public Map<String, Object> signedDocument() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("version", version);
        body.put("hash", hash);
        body.put("abePolicies", abePolicies);
        body.put("matrix", doc);
        String payload = mapper.writeValueAsString(body);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("payload", payload);
        out.put("signature", registry.signMessage(DOMAIN + payload));
        return out;
    }
}
