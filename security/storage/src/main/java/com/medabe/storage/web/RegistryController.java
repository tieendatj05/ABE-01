package com.medabe.storage.web;

import com.medabe.storage.MedProps;
import com.medabe.storage.domain.ConfigKv;
import com.medabe.storage.domain.DeviceEntity;
import com.medabe.storage.domain.InviteEntity;
import com.medabe.storage.domain.Repos;
import com.medabe.storage.service.AuditService;
import com.medabe.storage.service.EventService;
import com.medabe.storage.service.RegistryService;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

@RestController
public class RegistryController {
    public record InviteIn(String name) {}
    public record RegisterIn(String code, String devicePub, String hwHash, String name) {}
    public record OpenIn(Boolean open) {}

    private static final SecureRandom RNG = new SecureRandom();
    private final MedProps props;
    private final Repos.Devices devices;
    private final Repos.Invites invites;
    private final RegistryService registry;
    private final AuditService audit;
    private final Auth auth;
    private final ObjectMapper mapper;
    private final EventService events;
    private final Repos.Kv kv;
    // Chong tran dang ky tu do: toi da 30 lan/phut/dia chi.
    private final Map<String, long[]> regRate = new ConcurrentHashMap<>();

    public RegistryController(MedProps props, Repos.Devices devices, Repos.Invites invites, RegistryService registry,
                              AuditService audit, Auth auth, ObjectMapper mapper, EventService events, Repos.Kv kv) {
        this.events = events; this.kv = kv;
        this.props = props; this.devices = devices; this.invites = invites; this.registry = registry;
        this.audit = audit; this.auth = auth; this.mapper = mapper;
    }

    private static String random(int bytes) {
        byte[] b = new byte[bytes];
        RNG.nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    /** Cau hinh cong khai: khoa registry, tham so ABE cong khai, danh sach nut cap khoa va nguong k. */
    @GetMapping("/api/config")
    public Map<String, Object> config() {
        if (props.pkJson() == null || props.pkJson().isBlank())
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "chua cau hinh tham so ABE (medabe.pk-json)");
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("registryPk", registry.publicKeyHex());
        m.put("k", props.k());
        m.put("pk", mapper.readTree(props.pkJson()));
        m.put("nodes", props.nodeMap().entrySet().stream().map(e -> Map.of("org", e.getKey(), "url", e.getValue())).toList());
        if (props.bytUrl() != null && !props.bytUrl().isBlank() && props.bytPk() != null && props.bytPk().matches("[0-9a-f]{64}")) {
            m.put("byt", Map.of("url", props.bytUrl(), "pk", props.bytPk()));
        }
        return m;
    }

    /** Fresh registry proof binds the public config to the actual HTTP socket address, never the Host header. */
    @GetMapping("/api/discovery-proof")
    public Map<String, String> discoveryProof(HttpServletRequest req, @RequestParam String nonce) {
        if (nonce == null || !nonce.matches("[0-9a-f]{64}")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "nonce phai la 64 ky tu hex");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("nonce", nonce);
        body.put("registryPk", registry.publicKeyHex());
        body.put("address", LanAccessFilter.normalizeAddress(req.getLocalAddr()));
        body.put("port", req.getLocalPort());
        body.put("config", config());
        String payload = mapper.writeValueAsString(body);
        return Map.of("payload", payload, "signature", registry.signDiscoveryProof(payload));
    }
    @PostMapping("/api/admin/invites")
    public Map<String, String> invite(HttpServletRequest req, @RequestBody InviteIn in) {
        auth.admin(req);
        if (in.name() == null || in.name().isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "thieu name");
        InviteEntity i = new InviteEntity();
        i.code = random(9);
        i.name = in.name().trim();
        invites.save(i);
        audit.log("admin", "invite.create", i.name);
        return Map.of("code", i.code);
    }

    boolean isOpen() {
        return kv.findById("enrollment.open").map(v -> "true".equals(v.v)).orElse(props.openEnrollment());
    }

    @GetMapping("/api/enrollment")
    public Map<String, Object> enrollment() { return Map.of("open", isOpen()); }

    /** Admin bat/tat dang ky tu do (may moi tu dang ky khong can ma moi). Nen TAT sau khi nhan vien da dang ky xong. */
    @PostMapping("/api/admin/enrollment")
    public Map<String, Object> setEnrollment(HttpServletRequest req, @RequestBody OpenIn in) {
        auth.admin(req);
        if (in.open() == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "thieu open");
        kv.save(new ConfigKv("enrollment.open", String.valueOf(in.open())));
        audit.log("admin", "enrollment.open", String.valueOf(in.open()));
        events.record("admin", in.open() ? "ENROLLMENT_OPENED" : "ENROLLMENT_CLOSED", in.open() ? "WARN" : "INFO",
                in.open() ? "Bat dang ky tu do: may moi vao duoc khong can ma moi" : "Tat dang ky tu do", null, null);
        return Map.of("open", in.open());
    }

    /**
     * Thiet bi dang ky: bang MA MOI (cap quyen theo vai tro) hoac - neu admin bat dang ky tu do - chi can ten. GID duy nhat +
     * chung chi + token luu tru. Khoa rieng cua thiet bi khong roi khoi thiet bi.
     */
    @PostMapping("/api/register")
    public Map<String, String> register(HttpServletRequest req, @RequestBody RegisterIn in) throws Exception {
        InviteEntity inv = null;
        String name;
        if (in.code() != null && !in.code().isBlank()) {
            inv = invites.findById(in.code()).filter(i -> !i.used)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "ma khong hop le hoac da dung"));
            name = inv.name;
        } else {
            if (!isOpen()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "dang ky tu do dang tat: can ma moi do quan tri cap");
            long now = System.currentTimeMillis();
            long[] w = regRate.merge(req.getRemoteAddr(), new long[] {now, 1}, (o, n) -> now - o[0] > 60_000 ? n : new long[] {o[0], o[1] + 1});
            if (w[1] > 30) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "dang ky qua nhanh, thu lai sau");
            name = in.name() == null ? "" : in.name().trim();
            if (!name.matches("[\\p{L}0-9 .,'_-]{1,60}")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "ten khong hop le (1-60 ky tu)");
        }
        String pub = in.devicePub() == null ? "" : in.devicePub().toLowerCase();
        if (!pub.matches("04[0-9a-f]{128}")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "devicePub phai la khoa cong khai P-256 dang tho (130 hex)");
        String deviceId = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(HexFormat.of().parseHex(pub))).substring(0, 16);
        if (devices.existsByDeviceId(deviceId)) throw new ResponseStatusException(HttpStatus.CONFLICT, "thiet bi nay da dang ky");

        String hw = in.hwHash() == null ? null : in.hwHash().toLowerCase();
        if (hw != null && !hw.matches("[0-9a-f]{64}")) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "hwHash phai la SHA-256 (64 hex)");

        if (inv != null) { inv.used = true; invites.save(inv); }
        byte[] g = new byte[16];
        RNG.nextBytes(g);
        DeviceEntity d = new DeviceEntity();
        d.gid = HexFormat.of().formatHex(g);
        d.name = name;
        d.devicePub = pub;
        d.deviceId = deviceId;
        d.hwHash = hw;
        String token = random(24);
        d.tokenHash = Auth.sha256Hex(token);
        d.createdAt = Instant.now();
        devices.save(d);
        audit.log(name, "device.register", "gid=" + d.gid.substring(0, 8) + " device=" + deviceId + (hw != null ? " hw=" + hw.substring(0, 12) : ""));
        // Hai thiet bi dang hoat dong cung mot phan cung = nghi van nhan ban may/chep khoa: canh bao cho giam sat.
        if (hw != null) {
            long dup = devices.findByHwHashAndDisabledFalse(hw).stream().filter(x -> !x.gid.equals(d.gid)).count();
            // subject = ma phan cung (khong phai benh nhan o day): agent bao ve dung no de dem TOC DO dang ky tren cung phan cung.
            if (dup > 0) events.record("registry", "DUPLICATE_HARDWARE", "WARN", d.name + " dang ky tren phan cung da co " + dup + " thiet bi dang hoat dong", hw, d.gid);
        }
        return Map.of("gid", d.gid, "cert", registry.certify(d.gid, pub), "token", token, "name", d.name, "deviceId", deviceId);
    }

    @GetMapping("/api/admin/devices")
    public List<Map<String, Object>> list(HttpServletRequest req) {
        auth.admin(req);
        return devices.findAll().stream().map(d -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("gid", d.gid); m.put("name", d.name); m.put("deviceId", d.deviceId);
            m.put("hw", d.hwHash == null ? null : d.hwHash.substring(0, 12));
            m.put("disabled", d.disabled); m.put("createdAt", d.createdAt.toString());
            return m;
        }).toList();
    }

    @PostMapping("/api/admin/devices/{gid}/disable")
    public Map<String, Object> disable(HttpServletRequest req, @PathVariable String gid) { return setDisabled(req, gid, true); }

    @PostMapping("/api/admin/devices/{gid}/enable")
    public Map<String, Object> enable(HttpServletRequest req, @PathVariable String gid) { return setDisabled(req, gid, false); }

    private Map<String, Object> setDisabled(HttpServletRequest req, String gid, boolean disabled) {
        auth.admin(req);
        DeviceEntity d = devices.findById(gid).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "khong co thiet bi"));
        d.disabled = disabled;
        devices.save(d);
        audit.log("admin", disabled ? "device.disable" : "device.enable", d.name);
        return Map.of("ok", true, "disabled", disabled);
    }
}
