package com.medabe.storage.research;

import com.medabe.storage.domain.MedicalRecord;
import com.medabe.storage.domain.Repos;
import com.medabe.storage.service.AuditService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * KIEM KE xung dot du lieu cu voi mo hinh tac gia (CHI DOC, khong sua gi, khong tra noi dung/ma benh nhan): moi ban ghi da luu
 * duoc doi chieu policy CP-ABE trong phong bi voi policy chuan cua mo hinh moi. Ban ghi tao truoc khi co mo hinh tac gia mang cac nhanh
 * doc rong ("may tao", "moi bac si", "ket luan doc moi khoa", pha-vo-kinh, So Y te) — chung KHONG duoc tu dong doi vi doi policy can
 * mot nguoi giu khoa boc lai (khong co khoa o may chu). Admin dung ket qua nay de len ke hoach chuyen doi (xem tai lieu 03).
 */
@RestController
@ConditionalOnProperty(prefix = "medabe.research", name = "enabled", havingValue = "true")
public class ResearchInventoryController {
    private final Repos.Records records;
    private final Repos.KeyHeaders headers;
    private final PolicyService policy;
    private final AuditService audit;
    private final ObjectMapper mapper;
    private final com.medabe.storage.service.EpochService epochs;
    private static final java.util.regex.Pattern TAG = java.util.regex.Pattern.compile("#(\\d{4}W\\d{2})\\.");

    public ResearchInventoryController(Repos.Records records, Repos.KeyHeaders headers, PolicyService policy, AuditService audit, ObjectMapper mapper, com.medabe.storage.service.EpochService epochs) {
        this.epochs = epochs;
        this.records = records; this.headers = headers; this.policy = policy; this.audit = audit; this.mapper = mapper;
    }

    private static String strip(String pol) { return pol == null ? "" : pol.replaceAll("#\\d{4}W\\d{2}\\.\\d+", ""); }

    @GetMapping("/api/v2/admin/inventory")
    public Map<String, Object> inventory(HttpServletRequest req) {
        IdentityService.Principal p = ResearchAuthController.who(req);
        PolicyService.Decision d = policy.decidePermission(ResearchAuthController.subject(p), "audit.read");
        if (!d.permit()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, d.reason());

        Map<String, String> headerRaw = new HashMap<>();
        headers.findAll().forEach(h -> headerRaw.put(h.id, h.policy));
        var retention = epochs.directory().retention();

        long total = 0, compliant = 0, legacy = 0;
        Map<String, long[]> byType = new LinkedHashMap<>();                    // type -> [total, compliant, legacy]
        Map<String, Long> flags = new LinkedHashMap<>();
        Map<String, List<String>> samples = new LinkedHashMap<>();
        for (int page = 0; ; page++) {
            Page<MedicalRecord> pg = records.findAll(PageRequest.of(page, 500));
            for (MedicalRecord r : pg) {
                total++;
                String pol = null, rawPol = null;
                try {
                    JsonNode env = mapper.readTree(r.envelope);
                    rawPol = env.path("v").asInt(0) == 3 ? headerRaw.get(env.path("headerId").asString("")) : env.path("abe").path("policy").asString("");
                    pol = rawPol == null ? null : strip(rawPol);
                } catch (RuntimeException e) { /* dinh dang la: tinh la xung dot */ }
                boolean expired = false;
                if (rawPol != null) { java.util.regex.Matcher m = TAG.matcher(rawPol); while (m.find()) if (!retention.contains(m.group(1))) expired = true; }
                List<String> why = new ArrayList<>();
                boolean ok = false;
                if (pol == null) why.add("KHONG_DOC_DUOC_POLICY");
                else if (r.authorUserId == null) why.add("CHUA_CO_TAC_GIA_THEO_TAI_KHOAN");
                else if (policy.knownAppType(r.type)) {
                    List<String> ks;
                    try { ks = "none".equals(policy.appKhoaMode(r.type)) ? List.of() : policy.normalizeKhoaList(r.khoa); } catch (IllegalArgumentException e) { ks = List.of(); why.add("KHOA_NGOAI_DANH_MUC"); }
                    ok = why.isEmpty() && policy.policyMatchesApp(pol, r.type, ks, r.authorUserId);
                } else why.add("LOAI_KHONG_CO_TRONG_MO_HINH");
                if (expired) why.add("QUA_HAN_LUU_GIU_EPOCH_KHONG_AI_MO_DUOC");
                if (!ok && pol != null) {
                    if (pol.contains("MED:Device:")) why.add("NHANH_MAY_TAO_BAN_GHI");
                    if (pol.contains("MED:Role:KetLuan")) why.add("NHANH_KET_LUAN_DOC_RONG");
                    if (pol.contains("MED:BG:")) why.add("NHANH_PHA_VO_KINH");
                    if (pol.contains("MED:Org:SoYTe")) why.add("NHANH_SO_Y_TE");
                    if (!"hanhchinh".equals(r.type) && java.util.Arrays.asList(pol.split(" OR ")).contains("MED:Role:BacSi")) why.add("NHANH_MOI_BAC_SI");
                    if (why.isEmpty()) why.add("POLICY_KHAC_MA_TRAN_MOI");
                }
                long[] t = byType.computeIfAbsent(r.type, k -> new long[3]);
                t[0]++;
                if (ok) { compliant++; t[1]++; } else {
                    legacy++; t[2]++;
                    for (String f : why) {
                        flags.merge(f, 1L, Long::sum);
                        List<String> s = samples.computeIfAbsent(f, k -> new ArrayList<>());
                        if (s.size() < 3) s.add(r.id);
                    }
                }
            }
            if (!pg.hasNext()) break;
        }
        Map<String, Object> types = new LinkedHashMap<>();
        byType.forEach((k, v) -> types.put(k, Map.of("total", v[0], "compliant", v[1], "legacy", v[2])));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("policyVersion", policy.version());
        out.put("total", total); out.put("compliant", compliant); out.put("legacy", legacy);
        out.put("byType", types); out.put("legacyFlags", flags); out.put("sampleIds", samples);
        out.put("note", "Chi doc. Ban ghi 'legacy' van doc duoc boi nguoi co khoa hop le; backend ap ABAC theo mo hinh moi. Muon bo cac nhanh doc rong trong ban ma phai boc lai khoa do mot nguoi co quyen doc (xem tai lieu 03).");
        audit.log(p.user().userId, "v2.inventory", "total=" + total + " compliant=" + compliant + " legacy=" + legacy);
        return out;
    }
}
