package com.medabe.storage.web;

import com.medabe.storage.domain.DeviceEntity;
import com.medabe.storage.domain.MedicalRecord;
import com.medabe.storage.domain.Repos;
import com.medabe.storage.service.AuditService;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Kho ban ghi MU: chi nhan/tra "phong bi" da ma hoa. May chu khong the (va khong co khoa de) doc noi dung;
 * viec kiem soat truy cap la ma hoa (ABE), khong phai kiem tra quyen o day.
 */
@RestController
public class RecordController {
    public record RecordIn(String id, String patientIdx, String groupIdx, String type, String khoa, String authorDevice, JsonNode envelope, String parentIdx, JsonNode parentWrap, String refId) {}

    private static final Set<String> TYPES = Set.of("hanhchinh", "lankham", "tiensu", "thecuc", "lamsang", "canlamsang", "ketluan", "anh", "vung");
    private static final int MAX_ENVELOPE = 30_000_000;
    private final Repos.Records records;
    private final Repos.KeyHeaders headers;
    private final AuditService audit;
    private final Auth auth;
    private final ObjectMapper mapper;
    /** Co mat khi bat cau noi tai khoan (medabe.research.legacy-bridge): kiem quyen theo vai tro/khoa + chuoi policy. null = hanh vi cu. */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.medabe.storage.research.LegacyBridge bridge;

    public RecordController(Repos.Records records, Repos.KeyHeaders headers, AuditService audit, Auth auth, ObjectMapper mapper) {
        this.headers = headers; this.records = records; this.audit = audit; this.auth = auth; this.mapper = mapper;
    }

    private static String text(JsonNode n, String f) {
        JsonNode v = n.get(f);
        return v != null && v.isString() ? v.stringValue() : "";
    }

    private void validEnvelope(JsonNode e) {
        boolean ok;
        if (e != null && e.isObject() && e.path("v").asInt(0) == 3) {
            // Phong bi dung header chung: chi co headerId + iv + ciphertext; header phai ton tai.
            ok = text(e, "headerId").matches("[0-9a-f-]{36}") && headers.existsById(text(e, "headerId"))
                    && text(e, "iv").matches("[0-9a-f]+") && text(e, "ciphertext").matches("[0-9a-f]+");
        } else {
            ok = e != null && e.isObject() && e.path("v").asInt(0) == 2
                    && e.path("abe").path("policy").isString() && e.path("abe").path("rows").isArray();
            for (String f : new String[] {"wrapIv", "wrappedDek", "iv", "ciphertext"}) ok = ok && text(e, f).matches("[0-9a-f]+");
        }
        if (!ok) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "envelope sai dinh dang");
    }

    private Map<String, Object> view(MedicalRecord r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.id); m.put("patientIdx", r.patientIdx); m.put("groupIdx", r.groupIdx); m.put("type", r.type); m.put("khoa", r.khoa);
        m.put("authorDevice", r.authorDevice); m.put("createdAt", r.createdAt.toString());
        if (r.authorUserId != null) m.put("authorUserId", r.authorUserId);
        if (r.refId != null) m.put("refId", r.refId);
        m.put("envelope", mapper.readTree(r.envelope));
        if (r.parentIdx != null) m.put("parentIdx", r.parentIdx);
        if (r.parentWrap != null) m.put("parentWrap", mapper.readTree(r.parentWrap));
        return m;
    }

    public record BatchIn(List<RecordIn> records) {}

    @PostMapping("/api/records/batch")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> batch(HttpServletRequest req, @RequestBody BatchIn in) {
        DeviceEntity d = auth.device(req);
        if (in.records() == null || in.records().isEmpty() || in.records().size() > 500) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "batch phai co 1..500 ban ghi");
        String uid = bridge == null ? null : bridge.userIdOf(req);
        List<MedicalRecord> out = new java.util.ArrayList<>();
        for (RecordIn r : in.records()) out.add(build(d, r, uid, bridge == null ? r.khoa() : bridgeWrite(req, "import", r.type(), r.khoa(), r.envelope())));
        records.saveAll(out);
        audit.log(d.name, "record.create-batch", out.size() + " ban ghi, type=" + out.get(0).type);
        return Map.of("created", out.size());
    }

    @PostMapping("/api/records")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, String> create(HttpServletRequest req, @RequestBody RecordIn in) {
        DeviceEntity d = auth.device(req);
        String khoa = bridge == null ? in.khoa() : bridgeWrite(req, "write", in.type(), in.khoa(), in.envelope());
        MedicalRecord r = records.save(build(d, in, bridge == null ? null : bridge.userIdOf(req), khoa));
        audit.log(d.name, "record.create", r.id + " type=" + r.type + " khoa=" + r.khoa);
        return Map.of("id", r.id);
    }

    /** Cau noi: quyen ghi theo (vai tro, khoa, muc) + policy cua phong bi (v2: chuoi trong phong bi; v3: policy cua header chung) phai dung ma tran. */
    private String bridgeWrite(HttpServletRequest req, String action, String type, String khoa, JsonNode env) {
        String hp = env != null && env.path("v").asInt(0) == 3 ? headers.findById(text(env, "headerId")).map(h -> h.policy).orElse("") : null;
        return bridge.checkWrite(req, action, type, khoa, env, hp);
    }

    /** Cau noi: ban ghi nguoi dung KHONG duoc doc bi LOAI HAN khoi ket qua (khong lo loai/khoa/tac gia/thoi gian cua khoa khac) va khong bao gio tra ban ma. */
    private List<Map<String, Object>> visibleList(HttpServletRequest req, java.util.Collection<MedicalRecord> rows, jakarta.servlet.http.HttpServletResponse res) {
        List<Map<String, Object>> out = new java.util.ArrayList<>();
        int hidden = 0;
        for (MedicalRecord r : rows) { if (bridge == null || bridge.canRead(req, r)) out.add(view(r)); else hidden++; }
        // AN TOAN CHAN DOAN: chi tra SO LUONG muc bi han che (khong tra loai/khoa/noi dung/thoi gian), de giao dien noi ro "con muc ban khong duoc xem" thay vi hien o trong nhu the la binh thuong.
        if (bridge != null && res != null) res.setHeader("X-Restricted-Count", String.valueOf(hidden));
        return out;
    }

    private MedicalRecord build(DeviceEntity d, RecordIn in, String authorUserId, String khoa) {
        if (in.id() == null || !in.id().matches("[0-9a-f-]{36}")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "id sai");
        if (in.patientIdx() == null || !in.patientIdx().matches("[0-9a-f]{32}")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "patientIdx sai");
        if (in.groupIdx() != null && !in.groupIdx().matches("[0-9a-f]{32}")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "groupIdx sai");
        if (!TYPES.contains(in.type())) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "type khong hop le");
        if (khoa == null || !khoa.matches("[A-Za-z0-9_,]{1,60}")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "khoa sai");
        boolean imagePart = "vung".equals(in.type()) || "anh".equals(in.type());
        if (imagePart != (in.refId() != null)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "refId chi dung (va bat buoc) cho type=anh|vung");
        if (in.refId() != null && !in.refId().matches("[0-9a-f-]{36}")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "refId sai");
        if (!d.deviceId.equals(in.authorDevice())) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "authorDevice phai la thiet bi dang goi");
        validEnvelope(in.envelope());
        if (in.parentIdx() != null && !in.parentIdx().matches("[0-9a-f]{32}")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "parentIdx sai");
        if (in.parentWrap() != null && !(in.parentWrap().isObject() && text(in.parentWrap(), "iv").matches("[0-9a-f]{24}") && text(in.parentWrap(), "ct").matches("[0-9a-f]{1,256}")))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "parentWrap sai dinh dang");
        String json = mapper.writeValueAsString(in.envelope());
        if (json.length() > MAX_ENVELOPE) throw new ResponseStatusException(HttpStatus.CONTENT_TOO_LARGE, "ban ghi qua lon");
        if (records.existsById(in.id())) throw new ResponseStatusException(HttpStatus.CONFLICT, "id da ton tai");

        MedicalRecord r = new MedicalRecord();
        r.id = in.id(); r.patientIdx = in.patientIdx(); r.groupIdx = in.groupIdx(); r.type = in.type(); r.khoa = khoa; r.authorUserId = authorUserId; r.refId = in.refId();
        r.parentIdx = in.parentIdx(); r.parentWrap = in.parentWrap() == null ? null : mapper.writeValueAsString(in.parentWrap());
        r.authorDevice = in.authorDevice(); r.envelope = json; r.createdAt = Instant.now(); r.updatedAt = r.createdAt;
        return r;
    }

    public record ParentWrapIn(String id, String parentIdx, JsonNode parentWrap) {}
    public record ParentWrapsIn(List<ParentWrapIn> items) {}

    /**
     * Thay duong tra cuu cua phu huynh (chi muc + ban boc khoa) cho ban ghi DA CO, vd sau khi doi cach tra cuu sang CCCD + ngay sinh.
     * Du lieu ma hoa giu nguyen. May chu khong kiem tra duoc ban boc dung hay sai (khong co khoa), nen chi nhan thiet bi da dang ky va ghi nhat ky.
     */
    @PutMapping("/api/records/parent-wraps")
    public Map<String, Object> parentWraps(HttpServletRequest req, @RequestBody ParentWrapsIn in) {
        DeviceEntity d = auth.device(req);
        if (in.items() == null || in.items().isEmpty() || in.items().size() > 500) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "items phai co 1..500 phan tu");
        int n = 0;
        for (ParentWrapIn p : in.items()) {
            if (p.id() == null || !p.id().matches("[0-9a-f-]{36}") || p.parentIdx() == null || !p.parentIdx().matches("[0-9a-f]{32}")
                || p.parentWrap() == null || !(p.parentWrap().isObject() && text(p.parentWrap(), "iv").matches("[0-9a-f]{24}") && text(p.parentWrap(), "ct").matches("[0-9a-f]{1,256}")))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "parent-wrap sai dinh dang");
            MedicalRecord r = records.findById(p.id()).orElse(null);
            if (r == null) continue;
            r.parentIdx = p.parentIdx(); r.parentWrap = mapper.writeValueAsString(p.parentWrap()); r.updatedAt = Instant.now();
            records.save(r);
            n++;
        }
        audit.log(d.name, "record.parent-rewrap", n + " ban ghi");
        return Map.of("updated", n);
    }

    /** Dau van tay cua mot nhom (so ban ghi + thoi diem moi nhat): may khach hoi moi vai giay, co nguoi khac nhap thi tai lai danh sach. */
    @GetMapping("/api/records/version")
    public Map<String, Object> groupVersion(HttpServletRequest req, @RequestParam(required = false) String groupIdx, @RequestParam(required = false) String type,
                                            @RequestParam(required = false) String patientIdx) {
        auth.device(req);
        if (patientIdx != null) {
            // App tra cuu: "ho so cua benh nhan nay co gi moi chua?". CHI dem cac muc tai khoan nay DUOC XEM (khong lo co them muc cua khoa khac),
            // khong ghi nhat ky / khong tinh vao canh bao doc nhieu (hoi moi vai giay), va rat re (khong tra ban ma).
            if (!patientIdx.matches("[0-9a-f]{32}")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tham so sai");
            int n = 0; String last = "";
            for (MedicalRecord r : records.findByPatientIdxOrderByCreatedAtAsc(patientIdx)) {
                if (bridge != null && !bridge.canRead(req, r)) continue;
                n++; String t = r.createdAt.toString(); if (t.compareTo(last) > 0) last = t;
            }
            Map<String, Object> m = new LinkedHashMap<>(); m.put("n", n); m.put("last", last);
            return m;
        }
        if (groupIdx == null || type == null || !groupIdx.matches("[0-9a-f]{32}") || !TYPES.contains(type)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tham so sai");
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("n", records.countByGroupIdxAndType(groupIdx, type));
        m.put("last", records.findFirstByGroupIdxAndTypeOrderByCreatedAtDesc(groupIdx, type).map(r -> r.createdAt.toString()).orElse(""));
        return m;
    }

    @GetMapping("/api/records")
    public List<Map<String, Object>> list(HttpServletRequest req, jakarta.servlet.http.HttpServletResponse res, @RequestParam(required = false) String patientIdx,
                                          @RequestParam(required = false) String groupIdx, @RequestParam(required = false) String type) {
        DeviceEntity d = auth.device(req);
        if (patientIdx != null && patientIdx.matches("[0-9a-f]{32}")) {
            if (bridge != null) bridge.auditPrivilegedRead(req, "list patientIdx=" + patientIdx.substring(0, 8));
            audit.log(d.name, "record.list", "patientIdx=" + patientIdx.substring(0, 8));
            return visibleList(req, records.findByPatientIdxOrderByCreatedAtAsc(patientIdx), res);
        }
        if (groupIdx != null && groupIdx.matches("[0-9a-f]{32}") && type != null && TYPES.contains(type)) {
            if (bridge != null) bridge.auditPrivilegedRead(req, "list-group groupIdx=" + groupIdx.substring(0, 8) + " type=" + type);
            audit.log(d.name, "record.list-group", "groupIdx=" + groupIdx.substring(0, 8) + " type=" + type);
            return visibleList(req, records.latestByGroupAndType(groupIdx, type).stream().limit(5000).toList(), null);
        }
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "can patientIdx, hoac groupIdx kem type");
    }

    // Tra cuu phu huynh KHONG can tai khoan: khoa suy ra tu CCCD, la duong doc doc lap voi ABE.
    // Ai biet CCCD co the doc; rate limit chi giam toc do do online, khong thay the xac minh/OTP.
    private final Map<String, long[]> parentRate = new java.util.concurrent.ConcurrentHashMap<>();

    @GetMapping("/api/public/parent-records")
    public List<Map<String, Object>> parentRecords(HttpServletRequest req, @RequestParam String parentIdx) {
        long now = System.currentTimeMillis();
        long[] w = parentRate.merge(req.getRemoteAddr(), new long[] {now, 1}, (o, n) -> now - o[0] > 60_000 ? n : new long[] {o[0], o[1] + 1});
        if (w[1] > 20) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "tra cuu qua nhanh, thu lai sau");
        if (!parentIdx.matches("[0-9a-f]{32}")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "parentIdx sai");
        List<MedicalRecord> rows = records.findTop500ByParentIdxOrderByCreatedAtAsc(parentIdx);
        if (!rows.isEmpty()) audit.log("phu-huynh", "parent.view", "parentIdx=" + parentIdx.substring(0, 8) + " " + rows.size() + " ban ghi");
        return rows.stream().filter(r -> r.parentWrap != null).map(this::view).toList();
    }

    private final Map<String, long[]> versionRate = new java.util.concurrent.ConcurrentHashMap<>();

    /** Dau van tay nho cua "co du lieu moi chua" (so ban ghi + thoi diem moi nhat) de ung dung phu huynh kiem tra moi vai giay ma khong tai lai ca ho so. */
    @GetMapping("/api/public/parent-version")
    public Map<String, Object> parentVersion(HttpServletRequest req, @RequestParam String parentIdx) {
        long now = System.currentTimeMillis();
        long[] w = versionRate.merge(req.getRemoteAddr(), new long[] {now, 1}, (o, n) -> now - o[0] > 60_000 ? n : new long[] {o[0], o[1] + 1});
        if (w[1] > 120) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "qua nhanh");
        if (!parentIdx.matches("[0-9a-f]{32}")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "parentIdx sai");
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("n", records.countByParentIdx(parentIdx));
        m.put("last", records.findFirstByParentIdxOrderByCreatedAtDesc(parentIdx).map(r -> r.createdAt.toString()).orElse(""));
        return m;
    }

    /** Chi thiet bi da tao ban ghi moi xoa duoc (may chu khong the kiem tra bang mat ma, nen ghi nhat ky de truy vet). */
    @org.springframework.web.bind.annotation.DeleteMapping("/api/records/{id}")
    public Map<String, Object> delete(HttpServletRequest req, @PathVariable String id) {
        DeviceEntity d = auth.device(req);
        MedicalRecord r = records.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "khong co ban ghi"));
        if (bridge != null) bridge.checkDelete(req, r);        // tac gia theo TAI KHOAN + con quyen ghi muc nay
        else if (!d.deviceId.equals(r.authorDevice)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "chi thiet bi da tao ban ghi moi duoc xoa");
        records.delete(r);
        audit.log(d.name, "record.delete", id + " type=" + r.type);
        return Map.of("ok", true);
    }

    @GetMapping("/api/records/{id}")
    public Map<String, Object> one(HttpServletRequest req, @PathVariable String id) {
        DeviceEntity d = auth.device(req);
        MedicalRecord r = records.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "khong co ban ghi"));
        if (bridge != null) { bridge.checkRead(req, r); bridge.auditPrivilegedRead(req, "fetch id=" + id.substring(0, Math.min(8, id.length()))); }
        audit.log(d.name, "record.fetch", id);
        return view(r);
    }

    /**
     * Cap nhat HEADER (bo lai khoa sau thu hoi). May chu khong biet header moi co dung hay khong, nhung ep rang
     * du lieu (iv, ciphertext) KHONG DOI va giu lai header truoc de khoi phuc neu bi pha.
     */
    @PutMapping("/api/records/{id}/header")
    public Map<String, Object> rewrap(HttpServletRequest req, @PathVariable String id, @RequestBody JsonNode env) {
        DeviceEntity d = auth.device(req);
        validEnvelope(env);
        MedicalRecord r = records.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "khong co ban ghi"));
        if (bridge != null) { bridge.checkRead(req, r); bridge.checkPolicyString(env.path("abe").path("policy").asString(""), r.type, r.khoa, r.authorUserId); }
        JsonNode old = mapper.readTree(r.envelope);
        if (old.path("v").asInt(0) == 3) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "ban ghi dung header chung: dung PUT /api/headers/{id}");
        if (!text(old, "iv").equals(text(env, "iv")) || !text(old, "ciphertext").equals(text(env, "ciphertext")))
            throw new ResponseStatusException(HttpStatus.CONFLICT, "chi duoc doi header, khong duoc doi du lieu da ma hoa");
        r.prevEnvelope = r.envelope;
        r.envelope = mapper.writeValueAsString(env);
        r.updatedAt = Instant.now();
        records.save(r);
        audit.log(d.name, "record.rewrap", id);
        if (bridge != null) audit.log(java.util.Objects.requireNonNullElse(bridge.userIdOf(req), d.name), "v2.record.rewrap", "id=" + id.substring(0, Math.min(8, id.length())) + " thiet-bi=" + d.deviceId);
        return Map.of("ok", true);
    }
}
