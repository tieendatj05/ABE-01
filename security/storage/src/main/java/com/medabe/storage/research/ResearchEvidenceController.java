package com.medabe.storage.research;

import com.medabe.storage.domain.ResearchRepos;
import com.medabe.storage.service.AuditService;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * CHI DE KIEM THU/DO LUONG, mac dinh KHONG ton tai (medabe.research.evidence-enabled=false), moi endpoint can X-Service-Token.
 *  - /raw: tra cac dong tho trong kho, mo phong ke tan cong co quyen DOC kho luu tru (sao luu/DBA) ma khong qua phan quyen.
 *  - /pdp-defect: gia lap LOI PHAN QUYEN o backend (PDP cho moi nguoi doc muc nao cung duoc) de do lop bao ve thu hai (CP-ABE).
 */
@RestController
@ConditionalOnExpression("${medabe.research.enabled:false} && ${medabe.research.evidence-enabled:false}")
public class ResearchEvidenceController {
    public record DefectIn(Boolean enabled) {}

    private final ResearchRepos.Records records;
    private final PolicyService policy;
    private final AuditService audit;

    public ResearchEvidenceController(ResearchRepos.Records records, PolicyService policy, AuditService audit) {
        this.records = records; this.policy = policy; this.audit = audit;
    }

    @GetMapping("/api/v2/evidence/raw")
    public List<Map<String, Object>> raw(@RequestParam String mode) {
        return records.findByModeOrderByCreatedAtAsc(mode.toUpperCase()).stream().map(r -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", r.id); m.put("patientRef", r.patientRef); m.put("type", r.type); m.put("khoa", r.khoa);
            m.put("payload", r.payload); m.put("baselineCt", r.baselineCt); m.put("baselineIv", r.baselineIv);
            m.put("baselineWrapIv", r.baselineWrapIv); m.put("baselineWrappedDek", r.baselineWrappedDek); m.put("manifest", r.manifest);
            return m;
        }).toList();
    }

    @PostMapping("/api/v2/evidence/pdp-defect")
    public Map<String, Object> defect(@RequestBody DefectIn in) {
        policy.simulatedReadDefect().set(Boolean.TRUE.equals(in.enabled()));
        audit.log("evidence", "v2.evidence.pdp-defect", "gia lap loi PDP doc = " + in.enabled());
        return Map.of("pdpReadDefect", policy.simulatedReadDefect().get());
    }
}
