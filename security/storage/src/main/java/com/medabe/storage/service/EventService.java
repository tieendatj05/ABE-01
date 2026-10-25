package com.medabe.storage.service;

import com.medabe.storage.MedProps;
import com.medabe.storage.domain.Repos;
import com.medabe.storage.domain.SecurityEvent;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/**
 * Su kien an ninh: ghi DB + xuat JSON-lines cho SIEM (Wazuh doc file nay bang localfile log_format json).
 * Sau khi luu, PHAT ra SecurityEventRecorded de SecurityAgentService (agent bao ve, xem goi service) tu quyet dinh co
 * hanh dong gi khong - dung Spring event thay vi goi truc tiep de tranh phu thuoc vong (agent cung can goi lai record()
 * de ghi canh bao cua chinh no).
 */
@Service
public class EventService {
    private static final Logger LOG = LoggerFactory.getLogger("medabe.security");
    private final Repos.Events events;
    private final AuditService audit;
    private final MedProps props;
    private final ObjectMapper mapper;
    private final Clock clock;
    private final ApplicationEventPublisher publisher;

    public EventService(Repos.Events events, AuditService audit, MedProps props, ObjectMapper mapper, Clock clock, ApplicationEventPublisher publisher) {
        this.events = events; this.audit = audit; this.props = props; this.mapper = mapper; this.clock = clock; this.publisher = publisher;
    }

    /** Su kien Spring noi bo (khong ra HTTP) de SecurityAgentService lang nghe sau moi lan ghi. */
    public record SecurityEventRecorded(SecurityEvent event) {}

    public SecurityEvent record(String source, String type, String severity, String detail, String subject, String deviceGid) {
        SecurityEvent e = new SecurityEvent();
        e.ts = Instant.now(clock).truncatedTo(ChronoUnit.MILLIS);
        e.source = source; e.type = type; e.severity = severity; e.subject = subject; e.deviceGid = deviceGid;
        e.detail = detail == null ? "" : detail.substring(0, Math.min(detail.length(), 1900));
        e = events.save(e);
        export(e);
        if ("CRITICAL".equals(severity)) LOG.error("[SECURITY] {} {} {}", type, source, e.detail);
        publisher.publishEvent(new SecurityEventRecorded(e));
        return e;
    }

    public Map<String, Object> toMap(SecurityEvent e) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", e.id); m.put("ts", e.ts.toString()); m.put("source", e.source); m.put("type", e.type);
        m.put("severity", e.severity); m.put("detail", e.detail); m.put("subject", e.subject); m.put("deviceGid", e.deviceGid);
        return m;
    }

    private void export(SecurityEvent e) {
        try {
            Path p = Path.of(props.siemFile());
            if (p.getParent() != null) Files.createDirectories(p.getParent());
            Files.writeString(p, mapper.writeValueAsString(toMap(e)) + "\n", StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException ex) {
            LOG.warn("Khong ghi duoc file SIEM: {}", ex.getMessage());
        }
    }

    /** Dinh dang CEF cho cac SIEM/IDS khong doc duoc JSON. */
    public String toCef(SecurityEvent e) {
        int sev = switch (e.severity) { case "CRITICAL" -> 9; case "WARN" -> 5; default -> 2; };
        return "CEF:0|MedABE|Storage|1.0|" + e.type + "|" + e.type + "|" + sev + "|rt=" + e.ts.toEpochMilli()
                + " src=" + e.source + " msg=" + e.detail.replace("=", "\\=").replace("\n", " ")
                + (e.deviceGid != null ? " duid=" + e.deviceGid : "");
    }

    public List<SecurityEvent> after(long id) { return events.findTop200ByIdGreaterThanOrderByIdAsc(id); }
    public List<SecurityEvent> latest() { return events.findTop100ByOrderByIdDesc(); }

    /** Het han pha-vo-kinh: tang bo dem epoch cua BG:<benh nhan> de ban ghi duoc boc lai khong con mo bang khoa BG cu. */
    public int expireBreakGlass(EpochService epochs) {
        Instant limit = Instant.now(clock).minus(props.breakGlassHours(), ChronoUnit.HOURS);
        Map<String, List<SecurityEvent>> bySubject = new LinkedHashMap<>();
        for (SecurityEvent e : events.findByTypeAndClosedFalse("BREAK_GLASS")) {
            if (e.subject != null) bySubject.computeIfAbsent(e.subject, k -> new ArrayList<>()).add(e);
        }
        int closed = 0;
        for (var en : bySubject.entrySet()) {
            Instant latest = en.getValue().stream().map(e -> e.ts).max(Instant::compareTo).orElseThrow();
            if (latest.isAfter(limit)) continue; // lan kich hoat gan nhat van con hieu luc
            closeBreakGlass(en.getKey(), "system", "break-glass.expire", epochs);
            closed++;
        }
        return closed;
    }

    /** Dong pha-vo-kinh cua mot ho so (het han hoac quan tri dong som): tang bo dem epoch BG va dong moi su kien dang mo. */
    public int closeBreakGlass(String subject, String actor, String action, EpochService epochs) {
        int counter = epochs.bump("MED:BG:" + subject);
        for (SecurityEvent e : events.findByTypeAndClosedFalse("BREAK_GLASS")) {
            if (subject.equals(e.subject)) { e.closed = true; events.save(e); }
        }
        audit.log(actor, action, subject + " -> epoch " + counter);
        record(actor, "BREAK_GLASS_CLOSED", "INFO",
                "Dong pha-vo-kinh ho so " + subject.substring(0, Math.min(8, subject.length())) + "..., bo dem epoch=" + counter, subject, null);
        return counter;
    }
}
