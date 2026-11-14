package com.medabe.storage.research;

import com.medabe.storage.domain.ResearchRepos;
import com.medabe.storage.service.AuditService;
import com.medabe.storage.service.EpochService;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Kho ho so luong nghien cuu, hai che do doi chung dung CUNG API/PDP/phien/chu ky:
 *   /api/v2/baseline/... : backend nhan ban ro qua HTTPS, ma hoa khi luu bang KEK cua may chu, TU GIAI MA khi PDP cho phep.
 *   /api/v2/abe/...      : backend chi nhan/tra phong bi (AES-GCM + CP-ABE); khong co khoa; tu choi moi ban ro.
 * Moi ghi/import deu qua PDP + kiem chu ky + userId lay tu PHIEN (khong tin client).
 */
@RestController
@ConditionalOnProperty(prefix = "medabe.research", name = "enabled", havingValue = "true")
public class ResearchRecordController {
    public record RecordIn(String id, String patientRef, String type, String khoa, String supersedes, String manifest, String signature, String content, String payload) {}
    public record BatchIn(List<RecordIn> records) {}

    public static final String SIG_DOMAIN = "medabe/record-sig/v1|";
    private static final Pattern ATTR_VER = Pattern.compile("(MED:[A-Za-z0-9_.:-]+?)#(\\d{4}W\\d{2})\\.(\\d+)");
    private static final int MAX_CONTENT = 1_000_000;

    private final ResearchRepos.Records records;
    private final IdentityService identity;
    private final PolicyService policy;
    private final BaselineVault vault;
    private final EpochService epochs;
    private final AuditService audit;
    private final ObjectMapper mapper;
    private final Clock clock;

    public ResearchRecordController(ResearchRepos.Records records, IdentityService identity, PolicyService policy, BaselineVault vault, EpochService epochs,
                                    AuditService audit, ObjectMapper mapper, Clock clock) {
        this.records = records; this.identity = identity; this.policy = policy; this.vault = vault; this.epochs = epochs; this.audit = audit; this.mapper = mapper; this.clock = clock;
    }

    private static ResponseStatusException err(HttpStatus s, String code) { return new ResponseStatusException(s, code); }

    private static String modeOf(String path) {
        return switch (path) { case "baseline" -> "BASELINE"; case "abe" -> "ABE"; default -> throw err(HttpStatus.NOT_FOUND, "MODE_UNKNOWN"); };
    }

    private PolicyService.Decision decide(IdentityService.Principal p, String action, String section) {
        PolicyService.Decision d = policy.decideRecord(ResearchAuthController.subject(p), action, section);
        audit.log(p.user().userId, "v2.decision", (d.permit() ? "permit" : "deny") + " action=record." + action + " section=" + section + " reason=" + d.reason()
                + " rule=" + d.rule() + " zone=" + p.zone() + " policy=" + d.policyVersion());
        return d;
    }

    // ------------------------------------------------------------------ ghi / import
    private ResearchRecord prepare(IdentityService.Principal p, String mode, RecordIn in, String action) {
        if (in.id() == null || !in.id().matches("[0-9a-f-]{36}")) throw err(HttpStatus.BAD_REQUEST, "ID_INVALID");
        if (in.patientRef() == null || !in.patientRef().matches("[0-9a-f]{32}")) throw err(HttpStatus.BAD_REQUEST, "PATIENT_REF_INVALID");
        if (!"hanhchinh".equals(in.type()) && !"lamsang".equals(in.type())) throw err(HttpStatus.BAD_REQUEST, "TYPE_INVALID");
        boolean hc = "hanhchinh".equals(in.type());
        if (hc ? !"KSK".equals(in.khoa()) : !policy.khoas().contains(in.khoa())) throw err(HttpStatus.BAD_REQUEST, "KHOA_INVALID");
        String section = PolicyService.sectionKey(in.type(), in.khoa());

        PolicyService.Decision d = decide(p, action, section);
        if (!d.permit()) throw err(HttpStatus.FORBIDDEN, d.reason());

        boolean abe = "ABE".equals(mode);
        if (abe) {
            if (in.content() != null) throw err(HttpStatus.BAD_REQUEST, "PLAINTEXT_REJECTED_IN_ABE_MODE");
            if (in.payload() == null || in.payload().length() > 30_000_000) throw err(HttpStatus.BAD_REQUEST, "PAYLOAD_REQUIRED");
            validateAbePayload(in.payload(), section);
        } else {
            if (in.payload() != null) throw err(HttpStatus.BAD_REQUEST, "PAYLOAD_NOT_ALLOWED_IN_BASELINE_MODE");
            if (in.content() == null || in.content().isEmpty() || in.content().length() > MAX_CONTENT) throw err(HttpStatus.BAD_REQUEST, "CONTENT_REQUIRED");
        }

        JsonNode m;
        try { m = mapper.readTree(in.manifest() == null ? "" : in.manifest()); } catch (RuntimeException e) { throw err(HttpStatus.BAD_REQUEST, "MANIFEST_INVALID"); }
        String digest = ResearchCrypto.sha256Hex(abe ? in.payload() : in.content());
        boolean fieldsOk = m.isObject() && m.path("v").asInt(0) == 1 && in.id().equals(m.path("recordId").asString(""))
                && in.patientRef().equals(m.path("patientRef").asString("")) && section.equals(m.path("section").asString(""))
                && mode.equals(m.path("mode").asString(""));
        if (!fieldsOk) throw err(HttpStatus.BAD_REQUEST, "MANIFEST_MISMATCH");
        if (!policy.version().equals(m.path("policyVersion").asString(""))) throw err(HttpStatus.CONFLICT, "POLICY_VERSION_MISMATCH");
        if (!digest.equals(m.path("payloadDigest").asString(""))) throw err(HttpStatus.BAD_REQUEST, "DIGEST_MISMATCH");
        // Nguoi ky = nguoi trong PHIEN va dung thiet bi cua phien (khong tin userId/ten tac gia client tu khai).
        if (!p.user().userId.equals(m.path("signerUserId").asString("")) || !p.device().deviceId.equals(m.path("signerDeviceId").asString("")))
            throw err(HttpStatus.FORBIDDEN, "SIGNER_NOT_SESSION_USER");
        if (!ResearchCrypto.verifyP256(p.device().signPub, SIG_DOMAIN + in.manifest(), in.signature())) throw err(HttpStatus.BAD_REQUEST, "BAD_SIGNATURE");
        if (records.existsById(in.id())) throw err(HttpStatus.CONFLICT, "ID_EXISTS");
        if (in.supersedes() != null) {
            ResearchRecord old = records.findById(in.supersedes()).orElseThrow(() -> err(HttpStatus.BAD_REQUEST, "SUPERSEDES_UNKNOWN"));
            if (!old.mode.equals(mode) || !old.patientRef.equals(in.patientRef()) || !PolicyService.sectionKey(old.type, old.khoa).equals(section)) throw err(HttpStatus.BAD_REQUEST, "SUPERSEDES_MISMATCH");
        }

        ResearchRecord r = new ResearchRecord();
        r.id = in.id(); r.mode = mode; r.patientRef = in.patientRef(); r.type = in.type(); r.khoa = in.khoa(); r.supersedes = in.supersedes();
        r.createdByUserId = p.user().userId; r.signedByUserId = m.path("signerUserId").asString(""); r.signerDeviceId = p.device().deviceId;
        r.policyVersion = policy.version(); r.manifest = in.manifest(); r.signature = in.signature(); r.createdAt = clock.instant();
        if (abe) r.payload = in.payload(); else vault.seal(r, section, in.content());
        return r;
    }

    /** Backend KHONG tin may khach ve policy cua phong bi: chuoi policy (bo nhan epoch) phai bang policy sinh tu ma tran, nhan epoch phai la hien hanh. */
    private void validateAbePayload(String payload, String section) {
        JsonNode e;
        try { e = mapper.readTree(payload); } catch (RuntimeException ex) { throw err(HttpStatus.BAD_REQUEST, "PAYLOAD_INVALID"); }
        boolean ok = e.isObject() && e.path("v").asInt(0) == 2 && e.path("abe").path("policy").isString() && e.path("abe").path("rows").isArray();
        for (String f : new String[] {"wrapIv", "wrappedDek", "iv", "ciphertext"}) ok = ok && e.path(f).isString() && e.path(f).stringValue().matches("[0-9a-f]+");
        if (!ok) throw err(HttpStatus.BAD_REQUEST, "PAYLOAD_INVALID");
        String pol = e.path("abe").path("policy").stringValue();
        EpochService.Directory dir = epochs.directory();
        Matcher m = ATTR_VER.matcher(pol);
        while (m.find()) {
            if (!m.group(2).equals(dir.tag()) || Integer.parseInt(m.group(3)) != dir.counters().getOrDefault(m.group(1), 0)) throw err(HttpStatus.CONFLICT, "EPOCH_STALE");
        }
        if (!ATTR_VER.matcher(pol).replaceAll("$1").equals(policy.abePolicy(section))) throw err(HttpStatus.FORBIDDEN, "POLICY_MISMATCH");
    }

    @PostMapping("/api/v2/{mode}/records")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(HttpServletRequest req, @PathVariable String mode, @RequestBody RecordIn in) {
        IdentityService.Principal p = ResearchAuthController.who(req);
        ResearchRecord r = records.save(prepare(p, modeOf(mode), in, "write"));
        audit.log(p.user().userId, "v2.record.create", "id=" + r.id + " mode=" + r.mode + " section=" + PolicyService.sectionKey(r.type, r.khoa) + " signer=" + r.signedByUserId);
        return Map.of("id", r.id, "policyVersion", r.policyVersion);
    }

    @PostMapping("/api/v2/{mode}/records/batch")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> batch(HttpServletRequest req, @PathVariable String mode, @RequestBody BatchIn in) {
        IdentityService.Principal p = ResearchAuthController.who(req);
        String md = modeOf(mode);
        if (in.records() == null || in.records().isEmpty() || in.records().size() > 500) throw err(HttpStatus.BAD_REQUEST, "BATCH_SIZE");
        Set<String> ids = new HashSet<>();
        List<ResearchRecord> out = new ArrayList<>();
        for (RecordIn r : in.records()) {
            if (r == null || !ids.add(String.valueOf(r.id()))) throw err(HttpStatus.CONFLICT, "ID_DUPLICATE_IN_BATCH");
            out.add(prepare(p, md, r, "import"));       // tat ca-hoac-khong: loi o ban ghi nao thi khong luu ban ghi nao
        }
        records.saveAll(out);
        audit.log(p.user().userId, "v2.record.import", out.size() + " ban ghi mode=" + md + " signer=" + p.user().userId);
        return Map.of("created", out.size(), "policyVersion", policy.version());
    }

    // ------------------------------------------------------------------ doc
    private Map<String, Object> view(ResearchRecord r, Map<String, Map<String, Object>> signers) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.id); m.put("mode", r.mode); m.put("patientRef", r.patientRef); m.put("section", PolicyService.sectionKey(r.type, r.khoa));
        m.put("type", r.type); m.put("khoa", r.khoa); m.put("supersedes", r.supersedes); m.put("createdAt", r.createdAt.toString());
        m.put("createdByUserId", r.createdByUserId); m.put("signedByUserId", r.signedByUserId); m.put("signerDeviceId", r.signerDeviceId);
        m.put("policyVersion", r.policyVersion); m.put("manifest", r.manifest); m.put("signature", r.signature);
        m.put("signer", signers.computeIfAbsent(r.signerDeviceId, id -> {
            Map<String, Object> s = new LinkedHashMap<>();
            identity.device(id).ifPresent(d -> {
                s.put("deviceId", d.deviceId); s.put("userId", d.userId); s.put("signPub", d.signPub); s.put("cert", d.cert);
                identity.user(d.userId).ifPresent(u -> { s.put("gid", u.gid); s.put("displayName", u.displayName); });
            });
            return s;
        }));
        if ("ABE".equals(r.mode)) m.put("payload", r.payload);
        else m.put("content", vault.open(r, PolicyService.sectionKey(r.type, r.khoa)));
        return m;
    }

    private Map<String, Object> denied(String section, String reason, int versions) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("section", section); m.put("denied", true); m.put("reason", reason); m.put("versions", versions); m.put("policyVersion", policy.version());
        return m;
    }

    @GetMapping("/api/v2/{mode}/records")
    public Map<String, Object> list(HttpServletRequest req, @PathVariable String mode, @RequestParam String patientRef) {
        IdentityService.Principal p = ResearchAuthController.who(req);
        String md = modeOf(mode);
        if (!patientRef.matches("[0-9a-f]{32}")) throw err(HttpStatus.BAD_REQUEST, "PATIENT_REF_INVALID");
        Map<String, List<ResearchRecord>> bySection = new LinkedHashMap<>();
        for (ResearchRecord r : records.findByModeAndPatientRefOrderByCreatedAtAsc(md, patientRef)) bySection.computeIfAbsent(PolicyService.sectionKey(r.type, r.khoa), k -> new ArrayList<>()).add(r);
        Map<String, Map<String, Object>> signers = new LinkedHashMap<>();
        List<Map<String, Object>> sections = new ArrayList<>();
        for (Map.Entry<String, List<ResearchRecord>> e : bySection.entrySet()) {
            List<ResearchRecord> versions = e.getValue();
            PolicyService.Decision d = decide(p, "read", e.getKey());
            if (!d.permit()) { sections.add(denied(e.getKey(), d.reason(), versions.size())); continue; }
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("section", e.getKey()); m.put("denied", false); m.put("versions", versions.size()); m.put("latest", view(versions.get(versions.size() - 1), signers));
            sections.add(m);
        }
        return Map.of("mode", md, "patientRef", patientRef, "policyVersion", policy.version(), "sections", sections);
    }

    @GetMapping("/api/v2/{mode}/records/{id}")
    public Map<String, Object> one(HttpServletRequest req, @PathVariable String mode, @PathVariable String id) {
        IdentityService.Principal p = ResearchAuthController.who(req);
        String md = modeOf(mode);
        ResearchRecord r = records.findById(id).filter(x -> x.mode.equals(md)).orElseThrow(() -> err(HttpStatus.NOT_FOUND, "RECORD_NOT_FOUND"));
        PolicyService.Decision d = decide(p, "read", PolicyService.sectionKey(r.type, r.khoa));
        if (!d.permit()) throw err(HttpStatus.FORBIDDEN, d.reason());
        return view(r, new LinkedHashMap<>());
    }

    static String text(byte[] b) { return new String(b, StandardCharsets.UTF_8); }
}
