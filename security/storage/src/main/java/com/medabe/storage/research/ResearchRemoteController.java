package com.medabe.storage.research;

import com.medabe.storage.domain.ConfigKv;
import com.medabe.storage.domain.Repos;
import com.medabe.storage.service.AuditService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Cong tat TRUY CAP TU XA (Internet qua duong ham). Mac dinh TAT. Chi Quan tri (user.manage) bat/tat; tien trinh may chu (token dich vu) doc cong tat
 * de mo/dong duong ham va bao lai dia chi cong khai. Moi lan doi deu ghi nhat ky chuoi bam.
 */
@RestController
@ConditionalOnProperty(prefix = "medabe.research", name = "enabled", havingValue = "true")
public class ResearchRemoteController {
    public record RemoteIn(Boolean enabled) {}
    public record UrlIn(String url) {}
    private static final String K_ON = "research.remote.enabled", K_URL = "research.remote.url";

    private final Repos.Kv kv;
    private final PolicyService policy;
    private final AuditService audit;

    public ResearchRemoteController(Repos.Kv kv, PolicyService policy, AuditService audit) { this.kv = kv; this.policy = policy; this.audit = audit; }

    private Map<String, Object> state() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("enabled", kv.findById(K_ON).map(v -> "true".equals(v.v)).orElse(false));
        m.put("publicUrl", kv.findById(K_URL).map(v -> v.v).filter(v -> !v.isBlank()).orElse(null));
        return m;
    }

    private IdentityService.Principal admin(HttpServletRequest req) {
        IdentityService.Principal p = ResearchAuthController.who(req);
        PolicyService.Decision d = policy.decidePermission(ResearchAuthController.subject(p), "user.manage");
        if (!d.permit()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, d.reason());
        return p;
    }

    @GetMapping("/api/v2/admin/remote")
    public Map<String, Object> get(HttpServletRequest req) { admin(req); return state(); }

    @PutMapping("/api/v2/admin/remote")
    public Map<String, Object> put(HttpServletRequest req, @RequestBody RemoteIn in) {
        IdentityService.Principal p = admin(req);
        if (in.enabled() == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "ENABLED_REQUIRED");
        kv.save(new ConfigKv(K_ON, String.valueOf(in.enabled())));
        if (!in.enabled()) kv.save(new ConfigKv(K_URL, ""));
        audit.log(p.user().userId, "v2.remote.set", (in.enabled() ? "BAT" : "TAT") + " truy cap tu xa (Internet) zone=" + p.zone());
        return state();
    }

    /** Tien trinh may chu hoi cong tat (token dich vu). */
    @GetMapping("/api/v2/internal/remote")
    public Map<String, Object> internalGet() { return state(); }

    @PostMapping("/api/v2/internal/remote/url")
    public Map<String, Object> internalUrl(@RequestBody UrlIn in) {
        String u = in.url() == null ? "" : in.url().trim();
        if (!u.isEmpty() && !u.matches("https://[a-zA-Z0-9.-]{3,200}(:[0-9]{1,5})?")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "URL_INVALID");
        kv.save(new ConfigKv(K_URL, u));
        if (!u.isEmpty()) audit.log("system", "v2.remote.url", "duong ham da mo: " + u);
        return state();
    }
}
