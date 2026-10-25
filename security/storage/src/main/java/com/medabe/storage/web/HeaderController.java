package com.medabe.storage.web;

import com.medabe.storage.domain.DeviceEntity;
import com.medabe.storage.domain.KeyHeaderEntity;
import com.medabe.storage.domain.Repos;
import com.medabe.storage.service.AuditService;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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

/** Header ABE dung chung cho nhieu ban ghi cung chinh sach. May chu chi luu/tra, khong the mo. */
@RestController
public class HeaderController {
    public record HeaderIn(String id, String policy, JsonNode abe, String wrapIv, String wrappedDek, String authorDevice) {}

    private final Repos.KeyHeaders headers;
    private final AuditService audit;
    private final Auth auth;
    private final ObjectMapper mapper;

    public HeaderController(Repos.KeyHeaders headers, AuditService audit, Auth auth, ObjectMapper mapper) {
        this.headers = headers; this.audit = audit; this.auth = auth; this.mapper = mapper;
    }

    private static void valid(String id, String policy, JsonNode abe, String wrapIv, String wrappedDek) {
        boolean ok = id != null && id.matches("[0-9a-f-]{36}") && policy != null && policy.length() < 4000
                && abe != null && abe.isObject() && abe.path("rows").isArray() && abe.path("policy").isString()
                && wrapIv != null && wrapIv.matches("[0-9a-f]+") && wrappedDek != null && wrappedDek.matches("[0-9a-f]{1,200}");
        if (!ok) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "header sai dinh dang");
    }

    private Map<String, Object> view(KeyHeaderEntity h) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", h.id); m.put("policy", h.policy); m.put("abe", mapper.readTree(h.abe));
        m.put("wrapIv", h.wrapIv); m.put("wrappedDek", h.wrappedDek);
        return m;
    }

    @PostMapping("/api/headers")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, String> create(HttpServletRequest req, @RequestBody HeaderIn in) {
        DeviceEntity d = auth.device(req);
        valid(in.id(), in.policy(), in.abe(), in.wrapIv(), in.wrappedDek());
        if (!d.deviceId.equals(in.authorDevice())) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "authorDevice phai la thiet bi dang goi");
        if (headers.existsById(in.id())) throw new ResponseStatusException(HttpStatus.CONFLICT, "id da ton tai");
        KeyHeaderEntity h = new KeyHeaderEntity();
        h.id = in.id(); h.policy = in.policy(); h.abe = mapper.writeValueAsString(in.abe());
        h.wrapIv = in.wrapIv(); h.wrappedDek = in.wrappedDek(); h.authorDevice = d.deviceId;
        h.createdAt = Instant.now(); h.updatedAt = h.createdAt;
        headers.save(h);
        audit.log(d.name, "header.create", h.id);
        return Map.of("id", h.id);
    }

    @GetMapping("/api/headers")
    public List<Map<String, Object>> get(HttpServletRequest req, @RequestParam String ids) {
        auth.device(req);
        List<String> list = Arrays.stream(ids.split(",")).map(String::trim).filter(s -> s.matches("[0-9a-f-]{36}")).distinct().limit(200).toList();
        return headers.findAllById(list).stream().map(this::view).toList();
    }

    /** Boc lai header sau doi epoch. May chu khong biet DEK co giu nguyen hay khong, nen giu header truoc de khoi phuc neu bi pha. */
    @PutMapping("/api/headers/{id}")
    public Map<String, Object> rewrap(HttpServletRequest req, @PathVariable String id, @RequestBody HeaderIn in) {
        DeviceEntity d = auth.device(req);
        valid(id, in.policy(), in.abe(), in.wrapIv(), in.wrappedDek());
        KeyHeaderEntity h = headers.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "khong co header"));
        Map<String, Object> prev = view(h);
        h.prevJson = mapper.writeValueAsString(prev);
        h.policy = in.policy(); h.abe = mapper.writeValueAsString(in.abe());
        h.wrapIv = in.wrapIv(); h.wrappedDek = in.wrappedDek(); h.updatedAt = Instant.now();
        headers.save(h);
        audit.log(d.name, "header.rewrap", id);
        return Map.of("ok", true);
    }
}
