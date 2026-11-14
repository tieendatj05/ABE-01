package com.medabe.storage.web;

import com.medabe.storage.MedProps;
import com.medabe.storage.domain.DeviceEntity;
import com.medabe.storage.domain.Repos;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Xac thuc dung token (khong cookie): thiet bi = Bearer, quan tri/dich vu/SIEM = header rieng. So sanh thoi gian hang so. */
@Component
public class Auth {
    private final MedProps props;
    private final Repos.Devices devices;
    // Chong do token quan tri: sai >= 5 lan trong 60 giay tu cung mot dia chi thi khoa dia chi do 60 giay.
    private record Fails(int n, long start, long blockedUntil) {}
    private final Map<String, Fails> fails = new ConcurrentHashMap<>();

    public Auth(MedProps props, Repos.Devices devices) { this.props = props; this.devices = devices; }

    public static String sha256Hex(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static boolean same(String a, String b) {
        return a != null && b != null && !b.isBlank()   // token cau hinh de trong = khoa, khong khop voi bat ky gia tri nao
                && MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }

    public DeviceEntity device(HttpServletRequest req) {
        // Luong tai khoan: ResearchGateFilter da xac thuc PHIEN (nguoi dung + thiet bi) va gan chu the vao yeu cau; khong con tra token thiet bi cu.
        if (req.getAttribute(com.medabe.storage.research.ResearchGateFilter.ATTR) instanceof com.medabe.storage.research.IdentityService.Principal p && p.device() != null) {
            DeviceEntity d = new DeviceEntity();
            d.gid = p.user().gid; d.name = p.user().displayName; d.deviceId = p.device().deviceId; d.devicePub = p.device().signPub; d.disabled = false;
            return d;
        }
        String h = req.getHeader("Authorization");
        String token = h != null && h.startsWith("Bearer ") ? h.substring(7) : "";
        return devices.findByTokenHash(sha256Hex(token)).filter(d -> !d.disabled)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "unauthorized"));
    }

    public void admin(HttpServletRequest req) {
        String ip = req.getRemoteAddr();
        long now = System.currentTimeMillis();
        Fails f = fails.get(ip);
        if (f != null && f.blockedUntil() > now) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "qua nhieu lan thu sai, thu lai sau");
        if (!same(req.getHeader("X-Admin-Token"), props.adminToken())) {
            fails.merge(ip, new Fails(1, now, 0), (old, nu) -> {
                if (now - old.start() > 60_000) return nu;
                int n = old.n() + 1;
                return new Fails(n, old.start(), n >= 5 ? now + 60_000 : 0);
            });
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "admin only");
        }
        fails.remove(ip);
    }

    public boolean isService(HttpServletRequest req) { return same(req.getHeader("X-Service-Token"), props.serviceToken()); }

    public void siem(HttpServletRequest req) {
        if (!same(req.getHeader("X-Siem-Token"), props.siemToken()) && !same(req.getHeader("X-Admin-Token"), props.adminToken()))
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "siem only");
    }
}
