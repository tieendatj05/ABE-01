package com.medabe.storage;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.medabe.storage.domain.Repos;
import com.medabe.storage.research.PolicyService;
import com.medabe.storage.research.ResearchCrypto;
import com.medabe.storage.research.ScheduleService;
import com.medabe.storage.service.AuditService;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Luong nghien cuu CP-ABE o muc backend, qua HTTP THAT (di qua bo loc xac thuc + gio lam viec):
 * tai khoan/phien/thiet bi, ma tran ABAC, lich gio (cac moc 06:59/07:00/20:59/21:00, CN 17:29/17:30), ve cap khoa, chu ky, hai che do BASELINE/ABE.
 * Dong ho may chu la MutableClock nen dat duoc gio bat ky; ngoai ra khong co duong nao khac de doi gio.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "medabe.pk-json={\"id\":\"MED\"}",
        "medabe.siem-file=target/research-test-siem.jsonl",
        "spring.datasource.url=jdbc:h2:mem:researchflow;DB_CLOSE_DELAY=-1",
        "medabe.admin-token=adm-test", "medabe.service-token=svc-test",
        "medabe.research.enabled=true", "medabe.research.evidence-enabled=true", "medabe.research.password-iterations=1000", "medabe.research.idle-minutes=720", "medabe.research.login-rate-per-minute=100000", "medabe.research.session-hours=24",
        "medabe.research.baseline-kek=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
        "medabe.research.seed-users=tiepdon01|Passw0rd-TD01|TIEP_DON||Tiep don,bsnhi01|Passw0rd-BN01|BAC_SI|Nhi|BS Nhi,bsmat01|Passw0rd-BM01|BAC_SI|Mat|BS Mat,quantri01|Passw0rd-QT01|QUAN_TRI||Quan tri",
})
class ResearchFlowTest {
    static final ZoneId VN = ZoneId.of("Asia/Ho_Chi_Minh");

    static class MutableClock extends Clock {
        volatile Instant now = Instant.parse("2026-11-02T03:00:00Z");     // Thu hai 10:00 gio VN
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
        void at(String localVn) { now = ZonedDateTime.of(java.time.LocalDateTime.parse(localVn), VN).toInstant(); }
    }

    @TestConfiguration
    static class Cfg {
        @Bean @Primary MutableClock testClock() { return new MutableClock(); }
    }

    @LocalServerPort int port;
    @Autowired MutableClock clock;
    @Autowired ScheduleService schedule;
    @Autowired PolicyService policy;
    @Autowired Repos.Kv kv;
    @Autowired AuditService audit;
    @Autowired ObjectMapper mapper;

    final HttpClient http = HttpClient.newHttpClient();

    // ------------------------------------------------------------------ tien ich HTTP
    record Res(int status, JsonNode body) {
        String error() { return body.path("error").asString(""); }
    }

    Res call(String method, String path, String token, Object body, Map<String, String> headers) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).header("content-type", "application/json");
        if (token != null) b.header("authorization", "Bearer " + token);
        if (headers != null) headers.forEach(b::header);
        b.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)));
        HttpResponse<String> r = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
        return new Res(r.statusCode(), r.body() == null || r.body().isBlank() ? mapper.readTree("{}") : mapper.readTree(r.body()));
    }
    Res get(String path, String token) throws Exception { return call("GET", path, token, null, null); }
    Res post(String path, String token, Object body) throws Exception { return call("POST", path, token, body, null); }

    // ------------------------------------------------------------------ nguoi dung + thiet bi (khoa P-256 sinh o day, nhu WebCrypto)
    class Actor {
        final String username; String password; KeyPair kp; String pub, deviceId, token, userId, gid;
        Res changePassword(String next) throws Exception {
            Res r = post("/api/v2/auth/password", token, Map.of("currentPassword", password, "newPassword", next));
            if (r.status() == 200) password = next;
            return r;
        }
        Actor(String u, String p) throws Exception {
            username = u; password = p; kp = newKey(); pub = rawPub(kp);
        }
        Res loginNoDevice() throws Exception { Res r = post("/api/v2/auth/login", null, Map.of("username", username, "password", password)); if (r.status() == 200) { token = r.body().get("token").stringValue(); userId = r.body().get("userId").stringValue(); gid = r.body().get("gid").stringValue(); } return r; }
        Res enroll() throws Exception {
            loginNoDevice();
            Res r = post("/api/v2/devices", token, Map.of("signPub", pub, "label", "may-thu-nghiem", "password", password));
            if (r.status() == 201) deviceId = r.body().get("deviceId").stringValue();
            return r;
        }
        Res login() throws Exception { return loginWith(deviceId, kp); }
        Res loginWith(String dev, KeyPair signer) throws Exception {
            String nonce = get("/api/v2/auth/challenge", null).body().get("nonce").stringValue();
            Res r = post("/api/v2/auth/login", null, Map.of("username", username, "password", password, "deviceId", dev, "nonce", nonce,
                    "sig", sign(signer, "medabe/login/v1|" + nonce + "|" + username + "|" + dev)));
            if (r.status() == 200) token = r.body().get("token").stringValue();
            return r;
        }
        Res enrollAndLogin() throws Exception { Res e = enroll(); assertEquals(201, e.status(), e.body().toString()); Res l = login(); assertEquals(200, l.status(), l.body().toString()); return l; }
    }

    static KeyPair newKey() throws Exception { KeyPairGenerator g = KeyPairGenerator.getInstance("EC"); g.initialize(new ECGenParameterSpec("secp256r1")); return g.generateKeyPair(); }
    static String pad(java.math.BigInteger v) { String h = v.toString(16); return "0".repeat(64 - h.length()) + h; }
    static String rawPub(KeyPair kp) { var w = ((ECPublicKey) kp.getPublic()).getW(); return "04" + pad(w.getAffineX()) + pad(w.getAffineY()); }
    static String sign(KeyPair kp, String msg) throws Exception {
        Signature s = Signature.getInstance("SHA256withECDSAinP1363Format"); s.initSign(kp.getPrivate()); s.update(msg.getBytes(StandardCharsets.UTF_8));
        return ResearchCrypto.HEX.formatHex(s.sign());
    }

    static Actor tiepDon, bsNhi, bsMat, quanTri;

    @BeforeEach
    void setUp() throws Exception {
        clock.at("2026-11-02T10:00:00");                // Thu hai 10:00 - dang mo cua
        kv.deleteById("research.schedule"); schedule.reload();   // lich mac dinh version 1
        policy.simulatedReadDefect().set(false);
        tiepDon = actorOnce(tiepDon, "tiepdon01", "Passw0rd-TD01"); bsNhi = actorOnce(bsNhi, "bsnhi01", "Passw0rd-BN01");
        bsMat = actorOnce(bsMat, "bsmat01", "Passw0rd-BM01"); quanTri = actorOnce(quanTri, "quantri01", "Passw0rd-QT01");
    }
    Actor actorOnce(Actor a, String u, String p) throws Exception {
        if (a != null && a.deviceId != null) { a.login(); return a; }
        Actor n = new Actor(u, p); n.enrollAndLogin(); return n;
    }

    // ------------------------------------------------------------------ du lieu ban ghi
    static String refOf(String code) { return ResearchCrypto.sha256Hex("ref|" + code).substring(0, 32); }

    Map<String, Object> baselineRecord(Actor who, String patientRef, String type, String khoa, String content) throws Exception {
        String id = UUID.randomUUID().toString();
        String section = "hanhchinh".equals(type) ? "hanhchinh" : "lamsang." + khoa;
        Map<String, Object> man = new LinkedHashMap<>();
        man.put("v", 1); man.put("recordId", id); man.put("patientRef", patientRef); man.put("section", section); man.put("mode", "BASELINE");
        man.put("policyVersion", policy.version()); man.put("payloadDigest", ResearchCrypto.sha256Hex(content));
        man.put("signerUserId", who.userId); man.put("signerDeviceId", who.deviceId); man.put("signedAt", clock.instant().toString());
        String manifest = mapper.writeValueAsString(man);
        Map<String, Object> in = new LinkedHashMap<>();
        in.put("id", id); in.put("patientRef", patientRef); in.put("type", type); in.put("khoa", khoa);
        in.put("manifest", manifest); in.put("signature", sign(who.kp, "medabe/record-sig/v1|" + manifest)); in.put("content", content);
        return in;
    }

    Map<String, Object> abeRecord(Actor who, String patientRef, String type, String khoa, String policyString) throws Exception {
        String id = UUID.randomUUID().toString();
        String section = "hanhchinh".equals(type) ? "hanhchinh" : "lamsang." + khoa;
        String payload = mapper.writeValueAsString(Map.of("v", 2, "abe", Map.of("policy", policyString, "rows", List.of()), "wrapIv", "00", "wrappedDek", "00", "iv", "00", "ciphertext", "00"));
        Map<String, Object> man = new LinkedHashMap<>();
        man.put("v", 1); man.put("recordId", id); man.put("patientRef", patientRef); man.put("section", section); man.put("mode", "ABE");
        man.put("policyVersion", policy.version()); man.put("payloadDigest", ResearchCrypto.sha256Hex(payload));
        man.put("signerUserId", who.userId); man.put("signerDeviceId", who.deviceId); man.put("signedAt", clock.instant().toString());
        String manifest = mapper.writeValueAsString(man);
        Map<String, Object> in = new LinkedHashMap<>();
        in.put("id", id); in.put("patientRef", patientRef); in.put("type", type); in.put("khoa", khoa);
        in.put("manifest", manifest); in.put("signature", sign(who.kp, "medabe/record-sig/v1|" + manifest)); in.put("payload", payload);
        return in;
    }

    // ================================================================== 1. MA TRAN QUYEN (tung o)
    @Test
    void maTranQuyenDungTungO() {
        record Row(String role, String khoa, String section, String action, boolean expect) {}
        List<Row> rows = List.of(
                new Row("TIEP_DON", null, "hanhchinh", "read", true), new Row("TIEP_DON", null, "hanhchinh", "write", true), new Row("TIEP_DON", null, "hanhchinh", "import", true),
                new Row("TIEP_DON", null, "lamsang.Nhi", "read", false), new Row("TIEP_DON", null, "lamsang.Nhi", "write", false),
                new Row("TIEP_DON", null, "lamsang.Mat", "read", false), new Row("TIEP_DON", null, "lamsang.Mat", "write", false),
                new Row("BAC_SI", "Nhi", "hanhchinh", "read", true), new Row("BAC_SI", "Nhi", "hanhchinh", "write", false), new Row("BAC_SI", "Nhi", "hanhchinh", "import", false),
                new Row("BAC_SI", "Nhi", "lamsang.Nhi", "read", true), new Row("BAC_SI", "Nhi", "lamsang.Nhi", "write", true),
                new Row("BAC_SI", "Nhi", "lamsang.Mat", "read", false), new Row("BAC_SI", "Nhi", "lamsang.Mat", "write", false),
                new Row("BAC_SI", "Mat", "hanhchinh", "read", true), new Row("BAC_SI", "Mat", "hanhchinh", "write", false),
                new Row("BAC_SI", "Mat", "lamsang.Mat", "read", true), new Row("BAC_SI", "Mat", "lamsang.Mat", "write", true),
                new Row("BAC_SI", "Mat", "lamsang.Nhi", "read", false), new Row("BAC_SI", "Mat", "lamsang.Nhi", "write", false),
                new Row("QUAN_TRI", null, "hanhchinh", "read", false), new Row("QUAN_TRI", null, "hanhchinh", "write", false), new Row("QUAN_TRI", null, "hanhchinh", "import", false),
                new Row("QUAN_TRI", null, "lamsang.Nhi", "read", false), new Row("QUAN_TRI", null, "lamsang.Nhi", "write", false),
                new Row("QUAN_TRI", null, "lamsang.Mat", "read", false), new Row("QUAN_TRI", null, "lamsang.Mat", "write", false));
        for (Row r : rows) {
            var d = policy.decideRecord(new PolicyService.Subject("u", r.role(), r.khoa(), "ACTIVE"), r.action(), r.section());
            assertEquals(r.expect(), d.permit(), r + " -> " + d);
            assertEquals("2.3.0", d.policyVersion());
            assertFalse(d.reason().isBlank());
        }
        assertEquals("DENY_KHOA_MISMATCH", policy.decideRecord(new PolicyService.Subject("u", "BAC_SI", "Mat", "ACTIVE"), "read", "lamsang.Nhi").reason());
        assertEquals("DENY_ROLE_NOT_ALLOWED", policy.decideRecord(new PolicyService.Subject("u", "QUAN_TRI", null, "ACTIVE"), "read", "hanhchinh").reason());
        assertEquals("DENY_ACCOUNT_DISABLED", policy.decideRecord(new PolicyService.Subject("u", "BAC_SI", "Nhi", "DISABLED"), "read", "hanhchinh").reason());
        assertEquals("DENY_UNKNOWN_RESOURCE", policy.decideRecord(new PolicyService.Subject("u", "BAC_SI", "Nhi", "ACTIVE"), "read", "lamsang.XYZ").reason());
    }

    @Test
    void policyGiaiMaCpAbeSinhTuMaTranVaQuanTriKhongCoThuocTinh() {
        assertEquals("MED:Role:TiepDon OR MED:Role:BacSi OR MED:Role:KetLuan", policy.abePolicy("hanhchinh"));
        assertEquals("MED:Role:BacSi AND MED:Khoa:Nhi OR MED:Role:KetLuan", policy.abePolicy("lamsang.Nhi"));
        assertEquals("MED:Role:BacSi AND MED:Khoa:Mat OR MED:Role:KetLuan", policy.abePolicy("lamsang.Mat"));
        assertTrue(policy.attributesOf(new PolicyService.Subject("u", "QUAN_TRI", null, "ACTIVE")).isEmpty(), "Quan tri khong duoc co thuoc tinh ABE nao");
        assertEquals(java.util.Set.of("MED:Role:BacSi", "MED:Khoa:Nhi", "MED:Author:u"), policy.attributesOf(new PolicyService.Subject("u", "BAC_SI", "Nhi", "ACTIVE")));
        for (String p : policy.abePolicies().values()) assertFalse(p.contains("Device") || p.contains("SoYTe") || p.contains("BG:"), p);
    }

    // ================================================================== 2. GIO LAM VIEC: cac moc bien
    @Test
    void cacMocGioBien() {
        record T(String at, boolean open) {}
        List<T> cases = List.of(
                new T("2026-11-02T06:59:00", false), new T("2026-11-02T07:00:00", true), new T("2026-11-02T20:59:00", true), new T("2026-11-02T21:00:00", false),   // T2
                new T("2026-11-07T06:59:00", false), new T("2026-11-07T07:00:00", true), new T("2026-11-07T20:59:00", true), new T("2026-11-07T21:00:00", false),   // T7
                new T("2026-11-02T20:59:59", true), new T("2026-11-02T06:59:59", false),
                new T("2026-11-08T06:59:00", false), new T("2026-11-08T07:00:00", true), new T("2026-11-08T17:29:00", true), new T("2026-11-08T17:30:00", false),   // Chu nhat
                new T("2026-11-08T17:29:59", true), new T("2026-11-08T20:00:00", false), new T("2026-11-08T00:00:00", false));
        for (T t : cases) {
            clock.at(t.at());
            assertEquals(t.open(), schedule.isOpenNow(), t.at());
        }
    }

    @Test
    void gioMayChuTheoMuiGioVietNamKhongPhaiUtc() {
        // 2026-11-02T23:30Z = 06:30 sang T3 gio VN (chua mo cua) ; 2026-11-03T00:00Z = 07:00 VN (mo cua)
        clock.now = Instant.parse("2026-11-02T23:30:00Z"); assertFalse(schedule.isOpenNow());
        clock.now = Instant.parse("2026-11-03T00:00:00Z"); assertTrue(schedule.isOpenNow());
        clock.now = Instant.parse("2026-11-02T14:00:00Z"); assertFalse(schedule.isOpenNow());   // 21:00 VN
    }

    // ================================================================== 3. NGOAI GIO: API truc tiep + phien da dang nhap + xin khoa
    @Test
    void ngoaiGioChanApiTrucTiepPhienCuVaXinVeNhungChoPhepTrangThaiDangXuatVaQuanTriLich() throws Exception {
        String ref = refOf("BN-NG-01");
        assertEquals(201, post("/api/v2/baseline/records", tiepDon.token, baselineRecord(tiepDon, ref, "hanhchinh", "KSK", "{\"hoTen\":\"A\"}")).status());
        // phien DANG HOAT DONG tu 10:00 -> den 21:00 phai bi chan ngay o yeu cau ke tiep
        clock.at("2026-11-02T21:00:00");
        Res read = get("/api/v2/baseline/records?patientRef=" + ref, tiepDon.token);
        assertEquals(423, read.status()); assertEquals("OUTSIDE_BUSINESS_HOURS", read.error());
        assertEquals(false, read.body().get("businessOpen").asBoolean());
        assertNotNull(read.body().get("nextOpenAt").stringValue());                                // giao dien biet khi nao mo lai
        assertEquals(423, post("/api/v2/baseline/records", tiepDon.token, baselineRecord(tiepDon, refOf("BN-NG-02"), "hanhchinh", "KSK", "{}")).status());
        assertEquals(423, post("/api/v2/abe/records/batch", tiepDon.token, Map.of("records", List.of())).status());     // import
        assertEquals(423, post("/api/v2/keys/ticket", bsNhi.token, Map.of("attrs", List.of("MED:Role:BacSi#2026W45.0"))).status());   // xin khoa moi
        assertEquals(423, get("/api/v2/admin/users", quanTri.token).status());                      // quan ly nguoi dung cung bi chan
        // Chi cac chuc nang toi thieu duoc phep
        Res st = get("/api/v2/status", null);
        assertEquals(200, st.status()); assertFalse(st.body().get("businessOpen").asBoolean());
        assertEquals(200, get("/api/v2/auth/me", tiepDon.token).status());
        assertEquals(200, get("/api/v2/admin/schedule", quanTri.token).status());                  // quan tri lich (quyen rieng)
        assertEquals(403, get("/api/v2/admin/schedule", tiepDon.token).status());                  // ...nhung nguoi khac thi khong
        assertEquals(200, post("/api/v2/auth/logout", tiepDon.token, null).status());
        // dang nhap van duoc (khong phai truy cap nghiep vu) nhung phien moi cung bi chan nghiep vu
        Res again = tiepDon.login(); assertEquals(200, again.status());
        assertEquals(423, get("/api/v2/baseline/records?patientRef=" + ref, tiepDon.token).status());
        // Den gio mo cua: phien moi dung duoc ngay; khong co thao tac ghi nao bi "tu dong tiep tuc" (server khong giu hang doi)
        clock.at("2026-11-03T07:00:00");
        assertEquals(200, get("/api/v2/baseline/records?patientRef=" + ref, tiepDon.token).status());
        assertEquals(0, get("/api/v2/baseline/records?patientRef=" + refOf("BN-NG-02"), tiepDon.token).body().get("sections").size(), "ban ghi bi chan luc 21:00 khong duoc tu luu khi mo cua");
    }

    @Test
    void phienNhanRoiQuaHanBiHetHieuLuc() throws Exception {
        assertEquals(200, get("/api/v2/auth/me", bsNhi.token).status());
        clock.at("2026-11-02T23:30:00");                                  // 13,5 gio khong hoat dong (> 720 phut)
        assertEquals(401, get("/api/v2/auth/me", bsNhi.token).status());
        clock.at("2026-11-02T10:00:00");
    }

    @Test
    void veCapKhoaLayTruocGioDongKhongSongQuaGioDongVaNutDoiVeDuocDanhGiaLai() throws Exception {
        clock.at("2026-11-02T20:59:30");
        Res t = post("/api/v2/keys/ticket", bsNhi.token, Map.of("attrs", List.of("MED:Role:BacSi#" + epochTag() + ".0")));
        assertEquals(200, t.status(), t.body().toString());
        assertEquals("2026-11-02T14:00:00Z", t.body().get("notAfter").stringValue(), "notAfter bi chan o gio dong cua (21:00 VN = 14:00Z)");
        String jti = t.body().get("jti").stringValue();
        clock.at("2026-11-02T21:00:01");                                         // qua gio dong cua truoc khi nut doi ve
        Res r = call("POST", "/api/v2/internal/tickets/redeem", null, Map.of("jti", jti, "org", "BenhVien", "sig", "00".repeat(64)), Map.of("x-service-token", "svc-test"));
        assertEquals(403, r.status()); assertTrue(r.error().equals("TICKET_EXPIRED") || r.error().equals("DENY_OUTSIDE_BUSINESS_HOURS"), r.error());
    }

    // ================================================================== 4. LICH: sua hop le, version, nhat ky, hieu luc ngay
    @Test
    void suaLichKiemHopLeTangVersionGhiNhatKyVaCoHieuLucNgayVoiPhienDangHoatDong() throws Exception {
        Res cur = get("/api/v2/admin/schedule", quanTri.token);
        assertEquals(1, cur.body().get("version").asInt());
        Map<String, Map<String, Object>> days = new LinkedHashMap<>();
        for (String d : ScheduleService.DAYS) days.put(d, Map.of("open", "08:00", "close", "12:00"));
        assertEquals(403, call("PUT", "/api/v2/admin/schedule", bsNhi.token, Map.of("expectedVersion", 1, "days", days, "reason", "thu nghiem"), null).status());   // khong co quyen
        assertEquals(409, call("PUT", "/api/v2/admin/schedule", quanTri.token, Map.of("expectedVersion", 7, "days", days, "reason", "sai version"), null).status());
        Map<String, Map<String, Object>> bad = new LinkedHashMap<>(days); bad.put("MON", Map.of("open", "12:00", "close", "08:00"));
        assertEquals(400, call("PUT", "/api/v2/admin/schedule", quanTri.token, Map.of("expectedVersion", 1, "days", bad, "reason", "mo sau dong"), null).status());
        Map<String, Map<String, Object>> fmt = new LinkedHashMap<>(days); fmt.put("MON", Map.of("open", "7:00", "close", "21:00"));
        assertEquals(400, call("PUT", "/api/v2/admin/schedule", quanTri.token, Map.of("expectedVersion", 1, "days", fmt, "reason", "sai dinh dang"), null).status());
        Map<String, Map<String, Object>> six = new LinkedHashMap<>(days); six.remove("SUN");
        assertEquals(400, call("PUT", "/api/v2/admin/schedule", quanTri.token, Map.of("expectedVersion", 1, "days", six, "reason", "thieu ngay"), null).status());
        assertEquals(400, call("PUT", "/api/v2/admin/schedule", quanTri.token, Map.of("expectedVersion", 1, "days", days, "reason", "x"), null).status());   // thieu ly do
        assertEquals(1, get("/api/v2/admin/schedule", quanTri.token).body().get("version").asInt(), "sua loi khong duoc lam doi lich");

        assertEquals(200, get("/api/v2/baseline/records?patientRef=" + refOf("BN-L-01"), tiepDon.token).status());      // 10:00 dang mo
        Res ok = call("PUT", "/api/v2/admin/schedule", quanTri.token, Map.of("expectedVersion", 1, "days", days, "reason", "kiem thu rut ngan gio"), null);
        assertEquals(200, ok.status(), ok.body().toString());
        assertEquals(2, ok.body().get("version").asInt());
        Res locked = get("/api/v2/baseline/records?patientRef=" + refOf("BN-L-01"), tiepDon.token);                    // 12:00 moi dong, nhung lich moi dong luc 12:00 -> 10:00 van mo
        assertEquals(200, locked.status());
        clock.at("2026-11-02T12:00:00");
        assertEquals(423, get("/api/v2/baseline/records?patientRef=" + refOf("BN-L-01"), tiepDon.token).status(), "phien dang hoat dong phai chiu lich moi");
        String log = audit.all().stream().filter(a -> a.action.equals("v2.schedule.update")).map(a -> a.detail).reduce("", (x, y) -> x + y);
        assertTrue(log.contains("v1->v2") && log.contains("kiem thu rut ngan gio") && log.contains("08:00") && log.contains("07:00"), "nhat ky phai co version, ly do, truoc/sau: " + log);
        assertEquals(true, audit.verify().get("ok"));
    }

    // ================================================================== 5. DANH TINH, PHIEN, THIET BI
    @Test
    void phienPhaiGanThietBiVaChungMinhSoHuuKhoaThietBi() throws Exception {
        Actor fresh = new Actor("bsnhi01", "Passw0rd-BN01");
        assertEquals(200, fresh.loginNoDevice().status());
        assertEquals(403, get("/api/v2/baseline/records?patientRef=" + refOf("x"), fresh.token).status(), "phien khong gan thiet bi khong duoc dung nghiep vu");
        assertEquals("DENY_DEVICE_NOT_BOUND", get("/api/v2/baseline/records?patientRef=" + refOf("x"), fresh.token).error());
        // khong co chung minh khoa -> 401 ; nonce dung lai (replay) -> 401 ; dung khoa cua nguoi khac -> 401
        assertEquals(401, post("/api/v2/auth/login", null, Map.of("username", "bsnhi01", "password", "Passw0rd-BN01", "deviceId", bsNhi.deviceId, "nonce", "00", "sig", "00".repeat(64))).status());
        String nonce = get("/api/v2/auth/challenge", null).body().get("nonce").stringValue();
        String sig = sign(bsNhi.kp, "medabe/login/v1|" + nonce + "|bsnhi01|" + bsNhi.deviceId);
        Map<String, Object> body = Map.of("username", "bsnhi01", "password", "Passw0rd-BN01", "deviceId", bsNhi.deviceId, "nonce", nonce, "sig", sig);
        assertEquals(200, post("/api/v2/auth/login", null, body).status());
        assertEquals(401, post("/api/v2/auth/login", null, body).status(), "nonce chi dung mot lan");
        assertEquals(401, bsNhi.loginWith(bsNhi.deviceId, newKey()).status(), "ky bang khoa la");
        assertEquals(401, bsNhi.loginWith(bsMat.deviceId, bsMat.kp).status(), "dung thiet bi cua nguoi khac");
        assertEquals(200, bsNhi.login().status());
    }

    @Test
    void doiMayHopLeGiuNguyenUserIdGidVaQuyen() throws Exception {
        Actor second = new Actor("bsnhi01", "Passw0rd-BN01");      // may thu hai, khoa ky moi
        Res e = second.enroll(); assertEquals(201, e.status(), e.body().toString());
        assertNotNull(second.deviceId);
        assertTrue(!second.deviceId.equals(bsNhi.deviceId));
        Res l = second.login(); assertEquals(200, l.status());
        assertEquals(bsNhi.userId, l.body().get("userId").stringValue());
        assertEquals(bsNhi.gid, l.body().get("gid").stringValue(), "cung nguoi => cung GID ABE tren moi may");
        assertEquals("Nhi", l.body().get("khoa").stringValue());
        var tk = post("/api/v2/keys/ticket", second.token, Map.of("attrs", List.of("MED:Role:BacSi#" + epochTag() + ".0", "MED:Khoa:Nhi#" + epochTag() + ".0")));
        assertEquals(200, tk.status());
        assertEquals(bsNhi.gid, bsNhi.gid);
        // dang ky thiet bi can nhap lai mat khau
        Actor bad = new Actor("bsnhi01", "sai-mat-khau-1");
        assertEquals(401, bad.loginNoDevice().status());
        assertEquals(401, post("/api/v2/devices", second.token, Map.of("signPub", rawPub(newKey()), "label", "x", "password", "sai-mat-khau-1")).status());
    }

    @Test
    void haiNguoiCungMayCoPhienVaKhoaRiengVaGidKhacNhau() throws Exception {
        assertTrue(!bsNhi.gid.equals(bsMat.gid), "GID la theo NGUOI, khong chung giua hai nguoi");
        assertTrue(!bsNhi.deviceId.equals(bsMat.deviceId));
        assertTrue(!bsNhi.token.equals(bsMat.token));
        // token cua nguoi nay khong the lam viec thay nguoi kia: manifest ky boi bsMat nhung phien la bsNhi
        Map<String, Object> rec = baselineRecord(bsMat, refOf("BN-2N"), "lamsang", "Nhi", "{\"x\":1}");
        Res r = post("/api/v2/baseline/records", bsNhi.token, rec);
        assertEquals(403, r.status()); assertEquals("SIGNER_NOT_SESSION_USER", r.error());
    }

    @Test
    void khoaTaiKhoanVaThuHoiThietBiCoHieuLucNgayVoiPhienDangDung() throws Exception {
        Actor tmp = new Actor("bsmat01", "Passw0rd-BM01"); tmp.enroll(); tmp.login();
        assertEquals(200, get("/api/v2/baseline/records?patientRef=" + refOf("x"), tmp.token).status());
        assertEquals(200, call("POST", "/api/v2/admin/devices/" + tmp.deviceId + "/revoke", quanTri.token, null, null).status());
        assertEquals(401, get("/api/v2/baseline/records?patientRef=" + refOf("x"), tmp.token).status(), "thiet bi bi thu hoi => phien chet ngay");
        assertEquals(401, tmp.login().status());
        // khoa ca tai khoan
        Res c = post("/api/v2/admin/users", quanTri.token, Map.of("username", "tam01", "password", "Passw0rd-TAM1", "role", "TIEP_DON"));
        assertEquals(201, c.status(), c.body().toString());
        Actor t = new Actor("tam01", "Passw0rd-TAM1"); t.loginNoDevice();
        assertEquals(200, t.changePassword("Passw0rd-TAM2").status());                // tai khoan admin tao: mat khau tam, phai doi truoc khi dung
        t.enrollAndLogin();
        assertEquals(200, get("/api/v2/baseline/records?patientRef=" + refOf("x"), t.token).status());
        assertEquals(200, call("PUT", "/api/v2/admin/users/" + t.userId, quanTri.token, Map.of("status", "DISABLED"), null).status());
        assertEquals(401, get("/api/v2/baseline/records?patientRef=" + refOf("x"), t.token).status());
        assertEquals(403, t.loginNoDevice().status());
        // doi vai tro: tiep don -> khong con la tiep don (phien cu bi thu hoi)
        assertEquals(409, call("PUT", "/api/v2/admin/users/" + quanTri.userId, quanTri.token, Map.of("status", "DISABLED"), null).status(), "khong tu khoa chinh minh");
    }

    @Test
    void khoaTaiKhoanSauNhieuLanSaiMatKhau() throws Exception {
        post("/api/v2/admin/users", quanTri.token, Map.of("username", "khoa01", "password", "Passw0rd-KH01", "role", "TIEP_DON"));
        Actor wrong = new Actor("khoa01", "Passw0rd-SAI1");
        for (int i = 0; i < 5; i++) assertEquals(401, wrong.loginNoDevice().status());
        Actor right = new Actor("khoa01", "Passw0rd-KH01");
        assertEquals(429, right.loginNoDevice().status(), "dung mat khau cung bi khoa trong thoi gian khoa");
        clock.at("2026-11-02T10:16:00");
        assertEquals(200, right.loginNoDevice().status());
    }

    @Test
    void matKhauYeuBiTuChoiVaVaiTroKhoaDoBackendQuanLy() throws Exception {
        assertEquals(400, post("/api/v2/admin/users", quanTri.token, Map.of("username", "yeu01", "password", "123", "role", "TIEP_DON")).status());
        assertEquals(400, post("/api/v2/admin/users", quanTri.token, Map.of("username", "yeu02", "password", "Passw0rd-YE02", "role", "BAC_SI")).status(), "bac si bat buoc co khoa");
        assertEquals(400, post("/api/v2/admin/users", quanTri.token, Map.of("username", "yeu03", "password", "Passw0rd-YE03", "role", "BAC_SI", "khoa", "XYZ")).status());
        assertEquals(403, post("/api/v2/admin/users", tiepDon.token, Map.of("username", "yeu04", "password", "Passw0rd-YE04", "role", "QUAN_TRI")).status(), "tu nang quyen bi chan");
        // client khong the tu khai vai tro/khoa: login chi tra ve du lieu tu backend
        Res me = get("/api/v2/auth/me", bsNhi.token);
        assertEquals("BAC_SI", me.body().get("role").stringValue()); assertEquals("Nhi", me.body().get("khoa").stringValue());
    }

    // ================================================================== 6. GHI / DOC / CHU KY / CHE DO
    @Test
    void baselineGhiDocDungQuyenVaBackendTuGiaiMa() throws Exception {
        String ref = refOf("BN-B-01");
        assertEquals(201, post("/api/v2/baseline/records", tiepDon.token, baselineRecord(tiepDon, ref, "hanhchinh", "KSK", "{\"hoTen\":\"Nguyen Van A\"}")).status());
        assertEquals(201, post("/api/v2/baseline/records", bsNhi.token, baselineRecord(bsNhi, ref, "lamsang", "Nhi", "{\"chanDoan\":\"viem hong\"}")).status());
        assertEquals(201, post("/api/v2/baseline/records", bsMat.token, baselineRecord(bsMat, ref, "lamsang", "Mat", "{\"thiLuc\":\"10/10\"}")).status());
        // bac si Mat doc: thay hanh chinh + Mat, KHONG thay Nhi
        JsonNode secs = get("/api/v2/baseline/records?patientRef=" + ref, bsMat.token).body().get("sections");
        Map<String, JsonNode> by = new LinkedHashMap<>(); secs.forEach(s -> by.put(s.get("section").stringValue(), s));
        assertFalse(by.get("hanhchinh").get("denied").asBoolean()); assertTrue(by.get("hanhchinh").get("latest").get("content").stringValue().contains("Nguyen Van A"));
        assertFalse(by.get("lamsang.Mat").get("denied").asBoolean()); assertTrue(by.get("lamsang.Mat").get("latest").get("content").stringValue().contains("10/10"));
        assertTrue(by.get("lamsang.Nhi").get("denied").asBoolean()); assertEquals("DENY_KHOA_MISMATCH", by.get("lamsang.Nhi").get("reason").stringValue());
        assertNull(by.get("lamsang.Nhi").get("latest"));
        // tiep don: chi hanh chinh
        Map<String, JsonNode> td = new LinkedHashMap<>(); get("/api/v2/baseline/records?patientRef=" + ref, tiepDon.token).body().get("sections").forEach(s -> td.put(s.get("section").stringValue(), s));
        assertFalse(td.get("hanhchinh").get("denied").asBoolean()); assertTrue(td.get("lamsang.Nhi").get("denied").asBoolean()); assertTrue(td.get("lamsang.Mat").get("denied").asBoolean());
        // quan tri: khong doc duoc gi
        Map<String, JsonNode> qt = new LinkedHashMap<>(); get("/api/v2/baseline/records?patientRef=" + ref, quanTri.token).body().get("sections").forEach(s -> qt.put(s.get("section").stringValue(), s));
        for (JsonNode s : qt.values()) { assertTrue(s.get("denied").asBoolean()); assertEquals("DENY_ROLE_NOT_ALLOWED", s.get("reason").stringValue()); }
        // doc theo id cung bi PDP chan
        String nhiId = by.get("lamsang.Nhi").get("section").stringValue();
        assertNotNull(nhiId);
        // quyen ghi
        assertEquals("DENY_ROLE_NOT_ALLOWED", post("/api/v2/baseline/records", bsNhi.token, baselineRecord(bsNhi, ref, "hanhchinh", "KSK", "{}")).error());
        assertEquals("DENY_KHOA_MISMATCH", post("/api/v2/baseline/records", bsMat.token, baselineRecord(bsMat, ref, "lamsang", "Nhi", "{}")).error());
        assertEquals("DENY_ROLE_NOT_ALLOWED", post("/api/v2/baseline/records", quanTri.token, baselineRecord(quanTri, ref, "hanhchinh", "KSK", "{}")).error());
        assertEquals("DENY_ROLE_NOT_ALLOWED", post("/api/v2/baseline/records", tiepDon.token, baselineRecord(tiepDon, ref, "lamsang", "Nhi", "{}")).error());
    }

    @Test
    void importChiTiepDonVaTatCaHoacKhongCoChuKyRieng() throws Exception {
        List<Map<String, Object>> ok = List.of(baselineRecord(tiepDon, refOf("IMP1"), "hanhchinh", "KSK", "{\"a\":1}"), baselineRecord(tiepDon, refOf("IMP2"), "hanhchinh", "KSK", "{\"a\":2}"));
        assertEquals(201, post("/api/v2/baseline/records/batch", tiepDon.token, Map.of("records", ok)).status());
        assertEquals(403, post("/api/v2/baseline/records/batch", bsNhi.token, Map.of("records", List.of(baselineRecord(bsNhi, refOf("IMP3"), "hanhchinh", "KSK", "{}")))).status());
        // 1 ban ghi loi (khoa sai muc) => khong luu ban ghi nao
        Map<String, Object> bad = baselineRecord(tiepDon, refOf("IMP5"), "lamsang", "Nhi", "{}");
        Res r = post("/api/v2/baseline/records/batch", tiepDon.token, Map.of("records", List.of(baselineRecord(tiepDon, refOf("IMP4"), "hanhchinh", "KSK", "{}"), bad)));
        assertEquals(403, r.status());
        JsonNode s = get("/api/v2/baseline/records?patientRef=" + refOf("IMP4"), tiepDon.token).body().get("sections");
        assertEquals(0, s.size(), "import tat ca hoac khong");
    }

    @Test
    void chuKyXacDinhNguoiKyVaPhatHienSuaDoi() throws Exception {
        String ref = refOf("BN-S-01");
        Map<String, Object> rec = baselineRecord(tiepDon, ref, "hanhchinh", "KSK", "{\"hoTen\":\"A\"}");
        // sua noi dung sau khi ky -> digest khong khop
        Map<String, Object> tampered = new LinkedHashMap<>(rec); tampered.put("content", "{\"hoTen\":\"B\"}");
        assertEquals("DIGEST_MISMATCH", post("/api/v2/baseline/records", tiepDon.token, tampered).error());
        // sua chu ky
        Map<String, Object> badSig = new LinkedHashMap<>(rec); badSig.put("signature", "0".repeat(128));
        assertEquals("BAD_SIGNATURE", post("/api/v2/baseline/records", tiepDon.token, badSig).error());
        // ky bang khoa khac nhung khai la minh
        Map<String, Object> forged = baselineRecord(tiepDon, ref, "hanhchinh", "KSK", "{\"hoTen\":\"A\"}");
        Map<String, Object> man = new LinkedHashMap<>(mapper.readValue((String) forged.get("manifest"), Map.class));
        man.put("signerUserId", bsNhi.userId);                                  // tu khai la nguoi khac
        String m2 = mapper.writeValueAsString(man);
        forged.put("manifest", m2); forged.put("signature", sign(tiepDon.kp, "medabe/record-sig/v1|" + m2));
        assertEquals("SIGNER_NOT_SESSION_USER", post("/api/v2/baseline/records", tiepDon.token, forged).error());
        // phien cua tiep don + khoa cua nguoi khac -> chu ky khong khop khoa da dang ky
        Map<String, Object> wrongKey = baselineRecord(tiepDon, ref, "hanhchinh", "KSK", "{}");
        wrongKey.put("signature", sign(bsNhi.kp, "medabe/record-sig/v1|" + wrongKey.get("manifest")));
        assertEquals("BAD_SIGNATURE", post("/api/v2/baseline/records", tiepDon.token, wrongKey).error());
        // ban hop le: luu, va moi ban ghi tra ve kem thong tin nguoi ky + chung chi de nguoi nhan kiem chung
        assertEquals(201, post("/api/v2/baseline/records", tiepDon.token, rec).status());
        JsonNode latest = get("/api/v2/baseline/records?patientRef=" + ref, bsNhi.token).body().get("sections").get(0).get("latest");
        assertEquals(tiepDon.userId, latest.get("createdByUserId").stringValue());
        assertEquals(tiepDon.userId, latest.get("signedByUserId").stringValue());
        assertEquals(tiepDon.pub, latest.get("signer").get("signPub").stringValue());
        assertEquals(tiepDon.gid, latest.get("signer").get("gid").stringValue());
        assertTrue(ResearchCrypto.verifyP256(latest.get("signer").get("signPub").stringValue(), "medabe/record-sig/v1|" + latest.get("manifest").stringValue(), latest.get("signature").stringValue()));
    }

    String epochTag() throws Exception { return get("/api/epochs", null).body().get("tag").stringValue(); }

    @Test
    void cheDoAbeBackendTuChoiBanRoVaPolicyYeuHonVaEpochCu() throws Exception {
        String ref = refOf("BN-A-01"), tag = epochTag();
        String hc = "MED:Role:TiepDon#" + tag + ".0 OR MED:Role:BacSi#" + tag + ".0 OR MED:Role:KetLuan#" + tag + ".0";
        String nhi = "MED:Role:BacSi#" + tag + ".0 AND MED:Khoa:Nhi#" + tag + ".0 OR MED:Role:KetLuan#" + tag + ".0";
        assertEquals(201, post("/api/v2/abe/records", tiepDon.token, abeRecord(tiepDon, ref, "hanhchinh", "KSK", hc)).status());
        assertEquals(201, post("/api/v2/abe/records", bsNhi.token, abeRecord(bsNhi, ref, "lamsang", "Nhi", nhi)).status());
        // client gui kem ban ro vao che do ABE -> bi tu choi
        Map<String, Object> plain = new LinkedHashMap<>(abeRecord(bsNhi, ref, "lamsang", "Nhi", nhi)); plain.put("content", "{\"leak\":1}");
        assertEquals("PLAINTEXT_REJECTED_IN_ABE_MODE", post("/api/v2/abe/records", bsNhi.token, plain).error());
        // policy yeu hon (them nhanh cho tiep don / quan tri) -> bi tu choi
        assertEquals("POLICY_MISMATCH", post("/api/v2/abe/records", bsNhi.token, abeRecord(bsNhi, ref, "lamsang", "Nhi", nhi + " OR MED:Role:TiepDon#" + tag + ".0")).error());
        assertEquals("POLICY_MISMATCH", post("/api/v2/abe/records", bsNhi.token, abeRecord(bsNhi, ref, "lamsang", "Nhi", "MED:Role:BacSi#" + tag + ".0")).error());
        assertEquals("POLICY_MISMATCH", post("/api/v2/abe/records", bsNhi.token, abeRecord(bsNhi, ref, "lamsang", "Nhi", "MED:Device:abc#" + tag + ".0 OR " + nhi)).error());
        // epoch cu
        assertEquals("EPOCH_STALE", post("/api/v2/abe/records", bsNhi.token, abeRecord(bsNhi, ref, "lamsang", "Nhi", "MED:Role:BacSi#2020W01.0 AND MED:Khoa:Nhi#2020W01.0")).error());
        // ABE: backend van thuc thi PDP o lop doc -> bac si Mat khong nhan duoc phong bi Nhi
        Map<String, JsonNode> m = new LinkedHashMap<>(); get("/api/v2/abe/records?patientRef=" + ref, bsMat.token).body().get("sections").forEach(s -> m.put(s.get("section").stringValue(), s));
        assertTrue(m.get("lamsang.Nhi").get("denied").asBoolean()); assertNull(m.get("lamsang.Nhi").get("latest"));
        assertFalse(m.get("hanhchinh").get("denied").asBoolean()); assertNotNull(m.get("hanhchinh").get("latest").get("payload"));
        assertNull(m.get("hanhchinh").get("latest").get("content"), "che do ABE khong bao gio co ban ro tren backend");
    }

    @Test
    void loiPhanQuyenBackendGiaLap_baselineLoBanRo_abeChiLoBanMa() throws Exception {
        String ref = refOf("BN-D-01"), tag = epochTag();
        assertEquals(201, post("/api/v2/baseline/records", bsNhi.token, baselineRecord(bsNhi, ref, "lamsang", "Nhi", "{\"bi_mat\":\"ket qua nhi\"}")).status());
        assertEquals(201, post("/api/v2/abe/records", bsNhi.token, abeRecord(bsNhi, ref, "lamsang", "Nhi", "MED:Role:BacSi#" + tag + ".0 AND MED:Khoa:Nhi#" + tag + ".0 OR MED:Role:KetLuan#" + tag + ".0")).status());
        assertEquals(401, call("POST", "/api/v2/evidence/pdp-defect", null, Map.of("enabled", true), null).status(), "endpoint bang chung can token dich vu");
        assertEquals(200, call("POST", "/api/v2/evidence/pdp-defect", null, Map.of("enabled", true), Map.of("x-service-token", "svc-test")).status());
        // bac si MAT (sai khoa) doc muc Nhi khi PDP bi loi
        JsonNode b = get("/api/v2/baseline/records?patientRef=" + ref, bsMat.token).body().get("sections").get(0);
        assertTrue(b.get("latest").get("content").stringValue().contains("ket qua nhi"), "BASELINE: loi phan quyen => backend giai ma va tra BAN RO");
        JsonNode a = get("/api/v2/abe/records?patientRef=" + ref, bsMat.token).body().get("sections").get(0);
        String payload = a.get("latest").get("payload").stringValue();
        assertFalse(payload.contains("ket qua nhi"), "ABE: chi la phong bi, khong co ban ro");
        call("POST", "/api/v2/evidence/pdp-defect", null, Map.of("enabled", false), Map.of("x-service-token", "svc-test"));
        assertTrue(get("/api/v2/baseline/records?patientRef=" + ref, bsMat.token).body().get("sections").get(0).get("denied").asBoolean());
    }

    // ================================================================== 7. VE CAP KHOA
    @Test
    void veCapKhoaChiChoThuocTinhDuocPhepTheoVaiTroKhoaCuaTaiKhoan() throws Exception {
        String tag = epochTag();
        Res r = post("/api/v2/keys/ticket", bsNhi.token, Map.of("attrs", List.of("MED:Role:BacSi#" + tag + ".0", "MED:Khoa:Nhi#" + tag + ".0", "MED:Khoa:Mat#" + tag + ".0", "MED:Role:TiepDon#" + tag + ".0")));
        assertEquals(200, r.status());
        assertEquals(List.of("MED:Role:BacSi", "MED:Khoa:Nhi"), List.of(r.body().get("attrs").get(0).stringValue(), r.body().get("attrs").get(1).stringValue()));
        assertEquals(2, r.body().get("denied").size());
        assertEquals("DENY_NO_ATTRIBUTES", post("/api/v2/keys/ticket", quanTri.token, Map.of("attrs", List.of("MED:Role:BacSi#" + tag + ".0"))).error(), "quan tri khong duoc xin khoa nao");
        assertEquals("DENY_NO_ENTITLED_ATTRIBUTES", post("/api/v2/keys/ticket", tiepDon.token, Map.of("attrs", List.of("MED:Khoa:Nhi#" + tag + ".0"))).error());
        // doi ve: can token dich vu + chung minh so huu khoa thiet bi; moi nut mot lan
        String jti = r.body().get("jti").stringValue();
        assertEquals(401, post("/api/v2/internal/tickets/redeem", null, Map.of("jti", jti, "org", "BenhVien", "sig", "0")).status());
        Map<String, String> svc = Map.of("x-service-token", "svc-test");
        assertEquals("POP_INVALID", call("POST", "/api/v2/internal/tickets/redeem", null, Map.of("jti", jti, "org", "BenhVien", "sig", sign(bsMat.kp, "medabe/ticket/v1|" + jti + "|BenhVien")), svc).error());
        Res ok = call("POST", "/api/v2/internal/tickets/redeem", null, Map.of("jti", jti, "org", "BenhVien", "sig", sign(bsNhi.kp, "medabe/ticket/v1|" + jti + "|BenhVien")), svc);
        assertEquals(200, ok.status(), ok.body().toString());
        assertEquals(bsNhi.gid, ok.body().get("gid").stringValue());
        assertEquals(2, ok.body().get("attrs").size());
        assertEquals("TICKET_ALREADY_USED", call("POST", "/api/v2/internal/tickets/redeem", null, Map.of("jti", jti, "org", "BenhVien", "sig", sign(bsNhi.kp, "medabe/ticket/v1|" + jti + "|BenhVien")), svc).error());
        assertEquals(200, call("POST", "/api/v2/internal/tickets/redeem", null, Map.of("jti", jti, "org", "SoYTe", "sig", sign(bsNhi.kp, "medabe/ticket/v1|" + jti + "|SoYTe")), svc).status());
        // doi vai tro sau khi xin ve: lan doi ke tiep chi con thuoc tinh con hieu luc; khoa tai khoan => khong doi duoc
        Res r2 = post("/api/v2/keys/ticket", bsNhi.token, Map.of("attrs", List.of("MED:Role:BacSi#" + tag + ".0")));
        String jti2 = r2.body().get("jti").stringValue();
        call("PUT", "/api/v2/admin/users/" + bsNhi.userId, quanTri.token, Map.of("status", "DISABLED"), null);
        assertEquals("SESSION_OR_DEVICE_INVALID", call("POST", "/api/v2/internal/tickets/redeem", null, Map.of("jti", jti2, "org", "BenhVien", "sig", sign(bsNhi.kp, "medabe/ticket/v1|" + jti2 + "|BenhVien")), svc).error());
        call("PUT", "/api/v2/admin/users/" + bsNhi.userId, quanTri.token, Map.of("status", "ACTIVE"), null);
        bsNhi.login();
    }

    // ================================================================== 8. DONG DUONG VONG CU + NHAT KY
    @Test
    void luongCuBiDongKhiBatNghienCuuVaNhatKyChuoiBamToanVen() throws Exception {
        assertEquals(410, get("/api/records?patientIdx=" + "a".repeat(32), null).status());
        assertEquals(410, get("/api/headers?ids=x", null).status());
        assertEquals(410, call("POST", "/api/records", null, Map.of(), null).status());
        assertEquals(410, get("/api/public/parent-records?parentIdx=" + "a".repeat(32), null).status());
        assertEquals(200, get("/api/epochs", null).status(), "thu muc epoch cong khai van dung duoc");
        assertEquals(404, get("/api/v2/khong-co", null).status());
        Res a = get("/api/v2/admin/audit", quanTri.token);
        assertEquals(200, a.status()); assertTrue(a.body().get("chain").get("ok").asBoolean());
        assertEquals(403, get("/api/v2/admin/audit", bsNhi.token).status());
    }

    // ================================================================== 9. CAP TAI KHOAN THEO SO DIEN THOAI + MAT KHAU TAM
    @Test
    void adminCapTaiKhoanTheoSoDienThoaiMatKhauTamBatBuocDoiVaAdminKhongBietMatKhauSauDo() throws Exception {
        Res c = post("/api/v2/admin/users", quanTri.token, Map.of("phone", "0901 234 567", "displayName", "Nguyen Van Gia", "role", "BAC_SI", "khoa", "Nhi"));
        assertEquals(201, c.status(), c.body().toString());
        String temp = c.body().get("temporaryPassword").stringValue();
        assertEquals("0901234567", c.body().get("username").stringValue(), "mac dinh ten dang nhap = so dien thoai");
        assertEquals("0901234567", c.body().get("phone").stringValue());
        assertTrue(c.body().get("mustChangePassword").asBoolean());
        assertTrue(temp.length() >= 12 && temp.matches(".*[A-Za-z].*") && temp.matches(".*[0-9].*"));
        // so dien thoai trung (ke ca viet dang +84) / sai dinh dang / khong phai admin
        assertEquals("PHONE_EXISTS", post("/api/v2/admin/users", quanTri.token, Map.of("phone", "+84901234567", "username", "khac01", "role", "TIEP_DON")).error());
        assertEquals("PHONE_INVALID", post("/api/v2/admin/users", quanTri.token, Map.of("phone", "12345", "role", "TIEP_DON")).error());
        assertEquals(403, post("/api/v2/admin/users", tiepDon.token, Map.of("phone", "0912345678", "role", "TIEP_DON")).status());

        // nhan vien dang nhap bang mat khau tam: duoc vao nhung CHI duoc xem ban than / doi mat khau / dang xuat
        Actor nv = new Actor("0901234567", temp);
        Res l = nv.loginNoDevice(); assertEquals(200, l.status());
        assertTrue(l.body().get("mustChangePassword").asBoolean());
        assertEquals(200, get("/api/v2/auth/me", nv.token).status());
        for (String path : new String[] {"/api/v2/policy", "/api/v2/devices", "/api/v2/baseline/records?patientRef=" + refOf("x")})
            assertEquals("PASSWORD_CHANGE_REQUIRED", get(path, nv.token).error(), path);
        assertEquals("PASSWORD_CHANGE_REQUIRED", post("/api/v2/devices", nv.token, Map.of("signPub", nv.pub, "label", "x", "password", temp)).error(), "chua doi mat khau thi chua dang ky duoc thiet bi");
        // doi mat khau: sai mat khau hien tai / mat khau yeu / trung mat khau cu
        assertEquals(401, post("/api/v2/auth/password", nv.token, Map.of("currentPassword", "sai-mat-khau-1", "newPassword", "Passw0rd-MOI1")).status());
        assertTrue(nv.changePassword("abc").error().startsWith("PASSWORD_WEAK"));
        assertEquals("PASSWORD_REUSED", nv.changePassword(temp).error());
        assertEquals(200, nv.changePassword("Passw0rd-NV01").status());
        assertEquals(200, get("/api/v2/status", null).status());
        // sau khi doi: dung duoc binh thuong; mat khau tam het hieu luc => admin (biet mat khau tam) khong dang nhap thay nhan vien duoc
        nv.enrollAndLogin();
        assertEquals(200, get("/api/v2/baseline/records?patientRef=" + refOf("x"), nv.token).status());
        Res adminTries = post("/api/v2/auth/login", null, Map.of("username", "0901234567", "password", temp));
        assertEquals(401, adminTries.status()); assertEquals("BAD_CREDENTIALS", adminTries.error());
        // vai tro/khoa do admin chon luc tao, khong do nhan vien tu khai
        Res me = get("/api/v2/auth/me", nv.token);
        assertEquals("BAC_SI", me.body().get("role").stringValue()); assertEquals("Nhi", me.body().get("khoa").stringValue());
        assertEquals("Nguyen Van Gia", me.body().get("displayName").stringValue());

        // quen mat khau: admin cap lai mat khau tam -> moi phien chet ngay, mat khau cu het hieu luc, phai doi lai
        Res reset = post("/api/v2/admin/users/" + nv.userId + "/reset-password", quanTri.token, Map.of());
        assertEquals(200, reset.status());
        String temp2 = reset.body().get("temporaryPassword").stringValue();
        assertEquals(401, get("/api/v2/auth/me", nv.token).status(), "phien cu bi thu hoi khi cap lai mat khau");
        assertEquals(401, post("/api/v2/auth/login", null, Map.of("username", "0901234567", "password", "Passw0rd-NV01")).status());
        Res again = post("/api/v2/auth/login", null, Map.of("username", "0901234567", "password", temp2));
        assertEquals(200, again.status()); assertTrue(again.body().get("mustChangePassword").asBoolean());
        // nhat ky: ghi vao, KHONG chua so dien thoai day du
        String log = get("/api/v2/admin/audit?limit=300", quanTri.token).body().get("records").toString();
        assertTrue(log.contains("v2.user.create") && log.contains("phone=***567") && log.contains("mat-khau-tam"), log);
        assertFalse(log.contains("0901234567 ") || log.contains("phone=0901"), "nhat ky khong duoc chua so dien thoai day du");
        assertTrue(log.contains("v2.user.password-change") && log.contains("v2.user.password-reset"));
        // admin tu cap mat khau thu cong cung la mat khau tam
        Res manual = post("/api/v2/admin/users", quanTri.token, Map.of("phone", "0987654321", "password", "TamThoi-12345", "role", "TIEP_DON"));
        assertEquals(201, manual.status()); assertTrue(manual.body().get("mustChangePassword").asBoolean()); assertNull(manual.body().get("temporaryPassword"));
    }

    @Test
    void sauKhiChanTruyCapTruyVetDuocGhiNhatKyKemLyDoVaPhienBanPolicy() throws Exception {
        post("/api/v2/baseline/records", bsMat.token, baselineRecord(bsMat, refOf("BN-LOG"), "lamsang", "Nhi", "{}"));
        String log = get("/api/v2/admin/audit?limit=50", quanTri.token).body().get("records").toString();
        assertTrue(log.contains("deny action=record.write section=lamsang.Nhi reason=DENY_KHOA_MISMATCH"), log);
        assertTrue(log.contains("policy=2.3.0"));
    }
}
