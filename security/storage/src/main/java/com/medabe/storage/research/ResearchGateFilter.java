package com.medabe.storage.research;

import com.medabe.storage.service.AuditService;
import com.medabe.storage.web.Auth;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.ObjectMapper;

/**
 * CONG kiem soat cua MOI yeu cau /api/v2/**: (1) xac thuc phien (2) thiet bi da gan (3) GIO LAM VIEC theo gio may chu.
 * Danh gia lai o TUNG yeu cau nen phien dang hoat dong cung chiu lich moi; doi dong ho may khach hay goi API truc tiep khong vuot duoc.
 * Chi nhung hanh dong liet ke trong research-policy.json (afterHoursAllowed) moi duoc phep ngoai gio - khong co ngoai le ngam dinh.
 * Quyet dinh theo vai tro/khoa/muc nam o PolicyService (goi tu controller).
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
@ConditionalOnProperty(prefix = "medabe.research", name = "enabled", havingValue = "true")
public class ResearchGateFilter extends OncePerRequestFilter {
    public static final String ATTR = "medabe.principal";
    public static final String ACTION = "medabe.action";
    enum Kind { PUBLIC, SESSION, SERVICE }
    record Route(String method, String pattern, String action, Kind kind, boolean deviceRequired) {}

    private static final List<Route> ROUTES = List.of(
            new Route("GET", "/api/v2/status", "status.read", Kind.PUBLIC, false),
            new Route("GET", "/api/v2/auth/challenge", "auth.challenge", Kind.PUBLIC, false),
            new Route("POST", "/api/v2/auth/login", "auth.login", Kind.PUBLIC, false),
            new Route("POST", "/api/v2/auth/forgot", "auth.forgot", Kind.PUBLIC, false),
            new Route("POST", "/api/v2/auth/logout", "auth.logout", Kind.SESSION, false),
            new Route("GET", "/api/v2/auth/me", "auth.me", Kind.SESSION, false),
            new Route("POST", "/api/v2/auth/password", "auth.password", Kind.SESSION, false),
            new Route("GET", "/api/v2/policy", "policy.read", Kind.SESSION, false),
            new Route("POST", "/api/v2/devices", "device.enroll", Kind.SESSION, false),
            new Route("GET", "/api/v2/devices", "device.list", Kind.SESSION, false),
            new Route("POST", "/api/v2/keys/ticket", "key.request", Kind.SESSION, true),
            new Route("POST", "/api/v2/internal/tickets/redeem", "key.redeem", Kind.SERVICE, false),
            new Route("GET", "/api/v2/*/records", "record.read", Kind.SESSION, true),
            new Route("GET", "/api/v2/*/records/*", "record.read", Kind.SESSION, true),
            new Route("POST", "/api/v2/*/records", "record.write", Kind.SESSION, true),
            new Route("POST", "/api/v2/*/records/batch", "record.import", Kind.SESSION, true),
            new Route("GET", "/api/v2/admin/schedule", "schedule.manage", Kind.SESSION, true),
            new Route("PUT", "/api/v2/admin/schedule", "schedule.manage", Kind.SESSION, true),
            new Route("GET", "/api/v2/admin/users", "user.manage", Kind.SESSION, false),
            new Route("POST", "/api/v2/admin/users", "user.manage", Kind.SESSION, false),
            new Route("PUT", "/api/v2/admin/users/*", "user.manage", Kind.SESSION, false),
            new Route("POST", "/api/v2/admin/users/*/reset-password", "user.manage", Kind.SESSION, false),
            new Route("GET", "/api/v2/admin/password-requests", "user.manage", Kind.SESSION, false),
            new Route("POST", "/api/v2/admin/password-requests/*/fulfill", "user.manage", Kind.SESSION, false),
            new Route("POST", "/api/v2/admin/password-requests/*/reject", "user.manage", Kind.SESSION, false),
            new Route("POST", "/api/v2/admin/users/*/approve", "user.manage", Kind.SESSION, false),
            new Route("POST", "/api/v2/admin/users/*/mfa-reset", "user.manage", Kind.SESSION, false),
            new Route("POST", "/api/v2/admin/users/*/restrict", "user.manage", Kind.SESSION, false),
            new Route("POST", "/api/v2/admin/users/*/restore", "user.manage", Kind.SESSION, false),
            new Route("POST", "/api/v2/admin/users/*/risk-signal", "user.manage", Kind.SESSION, false),
            new Route("GET", "/api/v2/admin/headers/*/history", "user.manage", Kind.SESSION, false),
            new Route("POST", "/api/v2/admin/headers/*/restore", "user.manage", Kind.SESSION, false),
            new Route("POST", "/api/v2/admin/records/*/restore-envelope", "user.manage", Kind.SESSION, false),
            new Route("GET", "/api/v2/auth/mfa", "auth.mfa", Kind.SESSION, false),
            new Route("POST", "/api/v2/auth/mfa/enroll", "auth.mfa", Kind.SESSION, false),
            new Route("POST", "/api/v2/auth/mfa/verify", "auth.mfa", Kind.SESSION, false),
            new Route("GET", "/api/v2/admin/devices", "user.manage", Kind.SESSION, false),
            new Route("POST", "/api/v2/admin/devices/*/revoke", "user.manage", Kind.SESSION, false),
            new Route("GET", "/api/v2/admin/audit", "audit.read", Kind.SESSION, false),
            new Route("GET", "/api/v2/admin/inventory", "audit.read", Kind.SESSION, false),
            new Route("GET", "/api/v2/admin/remote", "user.manage", Kind.SESSION, false),
            new Route("PUT", "/api/v2/admin/remote", "user.manage", Kind.SESSION, false),
            new Route("GET", "/api/v2/internal/remote", "remote.internal", Kind.SERVICE, false),
            new Route("POST", "/api/v2/internal/remote/url", "remote.internal", Kind.SERVICE, false),
            new Route("GET", "/api/v2/evidence/raw", "evidence", Kind.SERVICE, false),
            new Route("POST", "/api/v2/evidence/pdp-defect", "evidence", Kind.SERVICE, false));

    /** Phien cua tai khoan dang dung mat khau TAM chi duoc: xem ban than, doi mat khau, dang xuat. Moi thu khac (ke ca dang ky thiet bi) bi chan cho den khi tu doi mat khau. */
    /** Hanh dong quan tri bi chan khi QUAN_TRI chua xac thuc MFA (khi bat admin-mfa). */
    private static final java.util.Set<String> MFA_GATED = java.util.Set.of("user.manage", "schedule.manage", "audit.read");
    private static final java.util.Set<String> WHILE_TEMP_PASSWORD = java.util.Set.of("auth.me", "auth.password", "auth.logout");
    /** Tuyen CU (app nhan vien) khi bat cau noi: cung cong xac thuc/gio lam viec, chu the la tai khoan. */
    private static final List<Route> LEGACY = List.of(
            new Route("GET", "/api/records", "record.read", Kind.SESSION, true),
            new Route("GET", "/api/records/version", "record.read", Kind.SESSION, true),
            new Route("GET", "/api/records/*", "record.read", Kind.SESSION, true),
            new Route("POST", "/api/records", "record.write", Kind.SESSION, true),
            new Route("POST", "/api/records/batch", "record.import", Kind.SESSION, true),
            new Route("PUT", "/api/records/parent-wraps", "record.write", Kind.SESSION, true),
            new Route("PUT", "/api/records/*/header", "record.write", Kind.SESSION, true),
            new Route("DELETE", "/api/records/*", "record.write", Kind.SESSION, true),
            new Route("GET", "/api/headers", "record.read", Kind.SESSION, true),
            new Route("POST", "/api/headers", "record.write", Kind.SESSION, true),
            new Route("PUT", "/api/headers/*", "record.write", Kind.SESSION, true),
            new Route("POST", "/api/events", "event.report", Kind.SESSION, true));
    private final boolean legacyBridge;
    private final AntPathMatcher matcher = new AntPathMatcher();
    private final IdentityService identity;
    private final ScheduleService schedule;
    private final PolicyService policy;
    private final NetworkPolicy network;
    private final Auth auth;
    private final AuditService audit;
    private final ObjectMapper mapper;

    public ResearchGateFilter(IdentityService identity, ScheduleService schedule, PolicyService policy, NetworkPolicy network, Auth auth,
                              AuditService audit, ObjectMapper mapper, ResearchProps props) {
        this.legacyBridge = props.legacyBridge();
        this.identity = identity; this.schedule = schedule; this.policy = policy; this.network = network; this.auth = auth; this.audit = audit; this.mapper = mapper;
    }

    private void reply(HttpServletResponse res, int status, Map<String, Object> body) throws IOException {
        res.setStatus(status); res.setContentType("application/json"); res.setCharacterEncoding("UTF-8");
        res.getWriter().write(mapper.writeValueAsString(body));
    }
    private static Map<String, Object> err(String code) { Map<String, Object> m = new LinkedHashMap<>(); m.put("error", code); return m; }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
        String path = req.getRequestURI();
        boolean v2 = path.startsWith("/api/v2/");
        if ((!v2 && !legacyBridge) || "OPTIONS".equals(req.getMethod())) { chain.doFilter(req, res); return; }   // OPTIONS: CORS preflight do Spring xu ly, khong mang du lieu
        Route route = ROUTES.stream().filter(r -> r.method().equals(req.getMethod()) && matcher.match(r.pattern(), path)).findFirst().orElse(null);
        if (route == null && legacyBridge && !v2) route = LEGACY.stream().filter(r -> r.method().equals(req.getMethod()) && matcher.match(r.pattern(), path)).findFirst().orElse(null);
        if (route == null) { if (!v2) { chain.doFilter(req, res); return; } reply(res, 404, err("NOT_FOUND")); return; }
        if ("event.report".equals(route.action()) && auth.isService(req)) { chain.doFilter(req, res); return; }      // nut cap khoa bao canh bao bang token dich vu
        String ip = req.getRemoteAddr();
        String zone = network.zoneOf(ip);
        req.setAttribute(ACTION, route.action());

        IdentityService.Principal principal = null;
        if (route.kind() == Kind.SERVICE) {
            if (!auth.isService(req)) { reply(res, 401, err("SERVICE_TOKEN_REQUIRED")); return; }
            chain.doFilter(req, res);                        // dich vu noi bo: tu kiem gio trong service (redeem) hoac bang chung
            return;
        }
        if (route.kind() == Kind.SESSION) {
            String h = req.getHeader("Authorization");
            principal = identity.authenticate(h != null && h.startsWith("Bearer ") ? h.substring(7) : null, ip, zone).orElse(null);
            if (principal == null) { reply(res, 401, err("SESSION_INVALID")); return; }
            req.setAttribute(ATTR, principal);
            if (principal.user().mustChangePassword && !WHILE_TEMP_PASSWORD.contains(route.action())) { reply(res, 403, err("PASSWORD_CHANGE_REQUIRED")); return; }
            if (route.deviceRequired() && principal.device() == null) { reply(res, 403, err("DENY_DEVICE_NOT_BOUND")); return; }
            // MFA cho thao tac QUAN TRI (khi bat admin-mfa): chua xac thuc TOTP con han thi chan moi viec quan tri. Dang nhap, dang ky thiet bi, doi mat khau, MFA van di qua duoc de nguoi dung tu xac thuc.
            if (policy.mfaGatesActions(principal.user().role) && MFA_GATED.contains(route.action()) && !identity.mfaFresh(principal)) {
                audit.log(principal.user().userId, "v2.decision", "deny action=" + route.action() + " reason=MFA_REQUIRED role=" + principal.user().role + " policy=" + policy.version());
                Map<String, Object> b = err("MFA_REQUIRED"); b.put("enrolled", principal.user().totpEnabled);
                reply(res, 428, b); return;
            }
            // Vai tro nhay cam (Giam sat) KHONG duoc dung qua duong ham Internet: yeu cau di qua cong tin cay (co header IP khach) bi chan o MOI yeu cau.
            if (!policy.roleFlag(principal.user().role, "remoteAllowed", true) && network.viaProxy(req)) {
                audit.log(principal.user().userId, "v2.decision", "deny action=" + route.action() + " reason=DENY_REMOTE_ACCESS role=" + principal.user().role + " policy=" + policy.version());
                reply(res, 403, err("DENY_REMOTE_ACCESS")); return;
            }
        }
        // Cong gio lam viec: moi hanh dong khong nam trong danh sach ngoai gio deu bi chan, ke ca phien da dang nhap.
        if (!policy.afterHoursAllowed().contains(route.action()) && !schedule.isOpenNow()) {
            Map<String, Object> body = err("OUTSIDE_BUSINESS_HOURS");
            body.put("reason", "DENY_OUTSIDE_BUSINESS_HOURS");
            body.putAll(schedule.status());
            body.put("policyVersion", policy.version());
            if (principal != null) audit.log(principal.user().userId, "v2.decision", "deny action=" + route.action() + " reason=DENY_OUTSIDE_BUSINESS_HOURS zone=" + zone + " policy=" + policy.version() + " schedule=v" + schedule.current().version());
            reply(res, 423, body);
            return;
        }
        chain.doFilter(req, res);
    }
}
