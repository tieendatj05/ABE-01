package com.medabe.storage.research;

import com.medabe.storage.domain.ResearchRepos;
import com.medabe.storage.service.AuditService;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Ve cap khoa ABE. May khach xin VE o backend (PDP: phien + thiet bi + tai khoan + GIO LAM VIEC + thuoc tinh duoc phep theo vai tro/khoa),
 * roi dua ve + chung minh so huu khoa thiet bi cho tung nut cap khoa. Nut goi redeem (token dich vu); backend DANH GIA LAI luc doi,
 * nen khoa tai khoan, thu hoi thiet bi/phien hay het gio lam viec co hieu luc ngay ca voi nut. Nut khong giu danh sach nguoi dung nao.
 */
@RestController
@ConditionalOnProperty(prefix = "medabe.research", name = "enabled", havingValue = "true")
public class ResearchKeyController {
    public record TicketIn(List<String> attrs) {}
    public record RedeemIn(String jti, String org, String sig) {}

    private static final Pattern VERSIONED = Pattern.compile("^(MED:[A-Za-z0-9_.:-]+?)#(\\d{4}W\\d{2})\\.(\\d+)$");
    public static final String POP_DOMAIN = "medabe/ticket/v1|";

    private final ResearchRepos.Tickets tickets;
    private final IdentityService identity;
    private final PolicyService policy;
    private final ScheduleService schedule;
    private final AuditService audit;
    private final Clock clock;
    private final ResearchProps props;

    public ResearchKeyController(ResearchRepos.Tickets tickets, IdentityService identity, PolicyService policy, ScheduleService schedule, AuditService audit, Clock clock, ResearchProps props) {
        this.tickets = tickets; this.identity = identity; this.policy = policy; this.schedule = schedule; this.audit = audit; this.clock = clock; this.props = props;
    }

    @PostMapping("/api/v2/keys/ticket")
    public Map<String, Object> ticket(HttpServletRequest req, @RequestBody TicketIn in) {
        IdentityService.Principal p = ResearchAuthController.who(req);
        Set<String> entitled = policy.attributesOf(ResearchAuthController.subject(p), identity.mfaFresh(p));   // MED:Auth:MFA chi khi phien vua xac thuc TOTP con han
        if (entitled.isEmpty()) {
            audit.log(p.user().userId, "v2.decision", "deny action=key.request reason=DENY_NO_ATTRIBUTES role=" + p.user().role + " zone=" + p.zone() + " policy=" + policy.version());
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "DENY_NO_ATTRIBUTES");
        }
        if (in.attrs() == null || in.attrs().isEmpty() || in.attrs().size() > 32) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "ATTRS_INVALID");
        Set<String> granted = new LinkedHashSet<>();
        Map<String, String> denied = new LinkedHashMap<>();
        for (String a : in.attrs()) {
            Matcher m = a == null ? null : VERSIONED.matcher(a);
            if (m == null || !m.matches()) { denied.put(String.valueOf(a), "ATTR_NOT_VERSIONED"); continue; }
            if (entitled.contains(m.group(1))) granted.add(m.group(1)); else denied.put(a, "DENY_ATTRIBUTE_NOT_ENTITLED");
        }
        if (granted.isEmpty()) {
            audit.log(p.user().userId, "v2.decision", "deny action=key.request reason=DENY_NO_ENTITLED_ATTRIBUTES asked=" + in.attrs().size() + " zone=" + p.zone() + " policy=" + policy.version());
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "DENY_NO_ENTITLED_ATTRIBUTES");
        }
        Instant now = clock.instant();
        // Ve khong song qua gio dong cua: notAfter = min(now + ttl, thoi diem dong cua).
        Instant notAfter = now.plus(Duration.ofSeconds(props.ticketSeconds()));
        Instant close = schedule.closesAt(now).orElse(now);
        if (close.isBefore(notAfter)) notAfter = close;
        KeyTicket t = new KeyTicket();
        t.jti = ResearchCrypto.randomHex(16); t.userId = p.user().userId; t.deviceId = p.device().deviceId; t.sessionId = p.session().sessionId;
        t.gid = p.user().gid; t.attrs = String.join(",", granted); t.notAfter = notAfter; t.createdAt = now; t.redeemedOrgs = "";
        tickets.save(t);
        audit.log(p.user().userId, "v2.key.ticket", "jti=" + t.jti.substring(0, 8) + " attrs=" + t.attrs + " denied=" + denied.size() + " zone=" + p.zone() + " policy=" + policy.version());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("jti", t.jti); out.put("notAfter", notAfter.toString()); out.put("attrs", new ArrayList<>(granted)); out.put("denied", denied);
        out.put("policyVersion", policy.version()); out.put("scheduleVersion", schedule.current().version());
        return out;
    }

    /** Chi nut cap khoa (X-Service-Token) goi. Moi nut doi duoc MOT lan; danh gia lai phien/tai khoan/thiet bi/gio/thuoc tinh luc doi. */
    @PostMapping("/api/v2/internal/tickets/redeem")
    public synchronized Map<String, Object> redeem(@RequestBody RedeemIn in) {
        if (in.jti() == null || !in.jti().matches("[0-9a-f]{32}") || in.org() == null || !in.org().matches("[A-Za-z0-9_-]{1,40}"))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "REDEEM_INVALID");
        KeyTicket t = tickets.findById(in.jti()).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "TICKET_UNKNOWN"));
        Instant now = clock.instant();
        String why = null;
        IdentityService.Principal p = identity.activeBySessionId(t.sessionId).orElse(null);
        if (List.of(t.redeemedOrgs.split(",")).contains(in.org())) why = "TICKET_ALREADY_USED";
        else if (now.isAfter(t.notAfter)) why = "TICKET_EXPIRED";
        else if (!schedule.isOpen(now)) why = "DENY_OUTSIDE_BUSINESS_HOURS";
        else if (p == null || !p.device().deviceId.equals(t.deviceId) || !p.user().userId.equals(t.userId)) why = "SESSION_OR_DEVICE_INVALID";
        else if (!ResearchCrypto.verifyP256(p.device().signPub, POP_DOMAIN + t.jti + "|" + in.org(), in.sig())) why = "POP_INVALID";
        if (why != null) {
            audit.log(t.userId, "v2.key.redeem.deny", "org=" + in.org() + " jti=" + t.jti.substring(0, 8) + " reason=" + why + " policy=" + policy.version());
            throw new ResponseStatusException("DENY_OUTSIDE_BUSINESS_HOURS".equals(why) ? HttpStatus.LOCKED : HttpStatus.FORBIDDEN, why);
        }
        Set<String> entitled = policy.attributesOf(ResearchAuthController.subject(p), identity.mfaFresh(p));   // vai tro/khoa/MFA co the da doi tu luc xin ve
        List<String> attrs = new ArrayList<>();
        for (String a : t.attrs.split(",")) if (entitled.contains(a)) attrs.add(a);
        t.redeemedOrgs = t.redeemedOrgs.isEmpty() ? in.org() : t.redeemedOrgs + "," + in.org();
        tickets.save(t);
        audit.log(t.userId, "v2.key.redeem", "org=" + in.org() + " jti=" + t.jti.substring(0, 8) + " attrs=" + attrs + " policy=" + policy.version());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("userId", t.userId); out.put("gid", t.gid); out.put("deviceId", t.deviceId); out.put("attrs", attrs);
        out.put("indexKey", !entitled.isEmpty()); out.put("policyVersion", policy.version());
        return out;
    }
}
