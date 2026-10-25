package com.medabe.storage.service;

import com.medabe.storage.domain.AuditLog;
import com.medabe.storage.domain.Repos;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
public class AuditService {
    private static final String ZERO = "0".repeat(64);
    private final Repos.Audit repo;

    public AuditService(Repos.Audit repo) { this.repo = repo; }

    static String hash(String prev, long seq, Instant ts, String actor, String action, String detail) {
        try {
            String s = prev + "|" + seq + "|" + ts + "|" + actor + "|" + action + "|" + detail;
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** Ghi tuan tu: seq phu thuoc ban ghi truoc nen phai dong bo. */
    public synchronized void log(String actor, String action, String detail) {
        String prev = repo.findTopByOrderBySeqDesc().map(a -> a.hash).orElse(ZERO);
        AuditLog a = new AuditLog();
        a.ts = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        a.actor = actor;
        a.action = action;
        a.detail = detail == null ? "" : detail;
        a.prev = prev;
        a.hash = "pending";
        a = repo.save(a);
        a.hash = hash(prev, a.seq, a.ts, actor, action, a.detail);
        repo.save(a);
    }

    public Map<String, Object> verify() {
        String prev = ZERO;
        for (AuditLog a : repo.findAllByOrderBySeqAsc()) {
            if (!prev.equals(a.prev) || !hash(prev, a.seq, a.ts, a.actor, a.action, a.detail).equals(a.hash)) {
                return Map.of("ok", false, "brokenAt", a.seq);
            }
            prev = a.hash;
        }
        return Map.of("ok", true);
    }

    public List<AuditLog> all() { return repo.findAllByOrderBySeqAsc(); }
}
