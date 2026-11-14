package com.medabe.storage.research;

import com.medabe.storage.domain.KeyHeaderEntity;
import com.medabe.storage.domain.MedicalRecord;
import com.medabe.storage.domain.Repos;
import com.medabe.storage.service.AuditService;
import com.medabe.storage.web.KeyHeaderHistory;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;

/**
 * Khoi phuc header khoa chung / phong bi mot ban ghi sau khi bi ghi de bang khoa boc RAC. May chu khong co DEK nen KHONG phat hien duoc luc ghi:
 * mot nguoi doc hop le co the lam ca lo khong mo duoc voi nguoi doc khac. Quan tri (khong doc duoc benh an) xem LICH SU + TAI KHOAN da ghi de roi khoi phuc
 * mot phien ban truoc. Bat buoc ly do (>= 8 ky tu), ghi nhat ky `v2.header.restore` / `v2.record.restore`. Chi hoan tac duoc nhung gi con trong lich su (toi da 5 phien ban).
 */
@RestController
@ConditionalOnProperty(prefix = "medabe.research", name = "enabled", havingValue = "true")
public class ResearchHeaderAdminController {
    public record RestoreIn(Integer index, String reason) {}

    private final Repos.KeyHeaders headers;
    private final Repos.Records records;
    private final KeyHeaderHistory history;
    private final PolicyService policy;
    private final AuditService audit;

    public ResearchHeaderAdminController(Repos.KeyHeaders headers, Repos.Records records, KeyHeaderHistory history, PolicyService policy, AuditService audit) {
        this.headers = headers; this.records = records; this.history = history; this.policy = policy; this.audit = audit;
    }

    private IdentityService.Principal require(HttpServletRequest req) {
        IdentityService.Principal p = ResearchAuthController.who(req);
        PolicyService.Decision d = policy.decidePermission(ResearchAuthController.subject(p), "user.manage");
        if (!d.permit()) {
            audit.log(p.user().userId, "v2.decision", "deny action=user.manage reason=" + d.reason() + " zone=" + p.zone() + " policy=" + d.policyVersion());
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, d.reason());
        }
        return p;
    }

    private static String reasonOf(String reason) {
        String r = reason == null ? "" : reason.strip();
        if (r.length() < 8) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "REASON_REQUIRED");
        return r.length() > 300 ? r.substring(0, 300) : r;
    }

    private static String shortId(String id) { return id.substring(0, Math.min(8, id.length())); }

    /** Lich su header: chi tra metadata (khong tra khoa boc/hang ABE). `by` = tai khoan da thay phien ban do bang phien ban sau no. */
    @GetMapping("/api/v2/admin/headers/{id}/history")
    public Map<String, Object> historyOf(HttpServletRequest req, @PathVariable String id) {
        require(req);
        KeyHeaderEntity h = headers.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "khong co header"));
        List<Map<String, Object>> rows = new ArrayList<>();
        List<JsonNode> hist = history.list(h);
        for (int i = 0; i < hist.size(); i++) {
            JsonNode n = hist.get(i);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("index", i); m.put("thayLuc", n.path("at").asString("")); m.put("thayBoi", n.path("by").asString("")); m.put("policy", n.path("version").path("policy").asString(""));
            rows.add(m);
        }
        return Map.of("id", id, "policyHienTai", h.policy, "capNhatLuc", h.updatedAt == null ? "" : h.updatedAt.toString(), "lichSu", rows);
    }

    @PostMapping("/api/v2/admin/headers/{id}/restore")
    public Map<String, Object> restoreHeader(HttpServletRequest req, @PathVariable String id, @RequestBody RestoreIn in) {
        IdentityService.Principal p = require(req);
        String why = reasonOf(in.reason());
        KeyHeaderEntity h = headers.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "khong co header"));
        int index = in.index() == null ? 0 : in.index();
        history.restore(h, index, p.user().userId);
        headers.save(h);
        audit.log(p.user().userId, "v2.header.restore", "id=" + shortId(id) + " phien-ban=" + index + " ly-do=\"" + why + "\"");
        return Map.of("ok", true, "policy", h.policy);
    }

    /** Hoan tac lan boc lai gan nhat cua MOT ban ghi (phong bi v2): doi envelope <-> prevEnvelope. Khong dung cho ban ghi dung header chung. */
    @PostMapping("/api/v2/admin/records/{id}/restore-envelope")
    public Map<String, Object> restoreEnvelope(HttpServletRequest req, @PathVariable String id, @RequestBody RestoreIn in) {
        IdentityService.Principal p = require(req);
        String why = reasonOf(in.reason());
        MedicalRecord r = records.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "khong co ban ghi"));
        if (r.prevEnvelope == null || r.prevEnvelope.isBlank()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "KHONG_CO_PHIEN_BAN");
        String cur = r.envelope;
        r.envelope = r.prevEnvelope; r.prevEnvelope = cur; r.updatedAt = Instant.now();
        records.save(r);
        audit.log(p.user().userId, "v2.record.restore", "id=" + shortId(id) + " ly-do=\"" + why + "\"");
        return Map.of("ok", true);
    }
}
