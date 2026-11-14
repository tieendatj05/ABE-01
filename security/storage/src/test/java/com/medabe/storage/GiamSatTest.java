package com.medabe.storage;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.medabe.storage.research.IdentityService;
import com.medabe.storage.research.PolicyService;
import com.medabe.storage.research.PolicyService.Subject;
import com.medabe.storage.research.UserAccount;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

/**
 * VAI TRO GIAM SAT (doc tat ca, khong ghi): (1) co nhanh doc trong policy MOI loai, khong co quyen ghi/xoa, khong nhan khoa; Quan tri van khong doc duoc;
 * (2) han che nang cao: mat khau dai, 1 thiet bi, phien ngan; (3) cap/doi vai tro/cap lai mat khau/mo khoa can QUAN TRI KHAC duyet.
 */
@SpringBootTest(properties = {
        "medabe.pk-json={\"id\":\"MED\"}", "medabe.siem-file=target/giamsat-test-siem.jsonl",
        "spring.datasource.url=jdbc:h2:mem:giamsat;DB_CLOSE_DELAY=-1",
        "medabe.admin-token=adm-test", "medabe.service-token=svc-test",
        "medabe.research.enabled=true", "medabe.research.password-iterations=1000",
        "medabe.research.baseline-kek=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
})
class GiamSatTest {
    @Autowired PolicyService policy;
    @Autowired IdentityService identity;

    static final String PW14 = "Giam-sat-Demo-2026";                 // 18 ky tu
    static Subject sub(String uid, String role, String khoa) { return new Subject(uid, role, khoa, "ACTIVE"); }
    static String code(Runnable r) { try { r.run(); return "OK"; } catch (ResponseStatusException e) { return e.getReason(); } }

    @Test
    void giamSatCoNhanhDocTrongMoiLoaiVaKhongCoQuyenGhi() {
        for (String t : policy.appTypes()) {
            String p = policy.appPolicy(t, "none".equals(policy.appKhoaMode(t)) ? List.of() : List.of("Mat"), "u-1");
            assertTrue(List.of(p.split(" OR ")).contains("(MED:Role:GiamSat AND MED:Auth:MFA)"), t + ": " + p);
        }
        assertEquals("MED:Author:u-1 OR (MED:Role:GiamSat AND MED:Auth:MFA)", policy.appPolicy("anh", List.of(), "u-1"));
        var gs = sub("u-gs", "GIAM_SAT", null);
        assertEquals(Set.of("MED:Role:GiamSat", "MED:Author:u-gs"), policy.attributesOf(gs), "chua xac thuc MFA: KHONG co MED:Auth:MFA");
        assertEquals(Set.of("MED:Role:GiamSat", "MED:Author:u-gs", "MED:Auth:MFA"), policy.attributesOf(gs, true));
        for (String t : policy.appTypes())
            for (String k : new String[] {"", "Nhi", "Mat,TMH", "ThanKinh", "XetNghiem"}) {
                assertTrue(policy.canReadApp(gs, t, k, "u-khac", true), t + "/" + k);
                assertTrue(policy.canReadApp(gs, t, k, null, true), "ban ghi cu khong co tac gia van co nhanh Giam sat: " + t);
                assertFalse(policy.canReadApp(gs, t, k, "u-khac"), "CHUA xac thuc MFA thi KHONG doc duoc: " + t + "/" + k);
                assertFalse(policy.canReadApp(gs, t, k, "u-khac", false), t);
            }
        for (String t : policy.appTypes()) {
            assertFalse(policy.decideAppWrite(gs, "write", t, "Mat").permit(), "Giam sat khong duoc ghi " + t);
            assertEquals("DENY_ROLE_NOT_ALLOWED", policy.decideAppWrite(gs, "write", t, "Mat").reason());
        }
        // Quan tri van KHONG doc duoc gi; bac si khoa khac van khong doc muc khoa nay
        assertTrue(policy.attributesOf(sub("u-qt", "QUAN_TRI", null)).isEmpty());
        assertFalse(policy.canReadApp(sub("u-qt", "QUAN_TRI", null), "hanhchinh", "", "u-1"));
        assertFalse(policy.canReadApp(sub("u-bs", "BAC_SI", "Mat"), "lamsang", "Nhi", "u-1"));
    }

    @Test
    void totpDungVectorChuanRfc6238VaMfaLaThuocTinhAbe() {
        byte[] key = "12345678901234567890".getBytes(java.nio.charset.StandardCharsets.US_ASCII);          // khoa mau cua RFC 6238 (SHA-1)
        assertEquals("287082", com.medabe.storage.research.Totp.code(key, 59 / 30));                      // T=59 -> 94287082 (8 so) -> 6 so cuoi
        assertEquals("081804", com.medabe.storage.research.Totp.code(key, 1111111109L / 30));
        assertEquals("005924", com.medabe.storage.research.Totp.code(key, 1234567890L / 30));
        assertEquals(1111111109L / 30, com.medabe.storage.research.Totp.verify(key, "081804", 1111111109L));
        assertEquals(1111111109L / 30, com.medabe.storage.research.Totp.verify(key, "081804", 1111111109L + 29), "lech +1 buoc van chap nhan");
        assertEquals(-1, com.medabe.storage.research.Totp.verify(key, "081804", 1111111109L + 95), "qua 1 buoc: tu choi");
        assertEquals(-1, com.medabe.storage.research.Totp.verify(key, "12345", 1111111109L));
        assertEquals(-1, com.medabe.storage.research.Totp.verify(key, "abcdef", 1111111109L));
        String b32 = com.medabe.storage.research.Totp.base32(key);
        assertEquals("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", b32);
        assertTrue(java.util.Arrays.equals(key, com.medabe.storage.research.Totp.unbase32(b32)));
        assertTrue(policy.requiresMfa("GIAM_SAT"));
        assertFalse(policy.requiresMfa("BAC_SI"), "vai tro thuong khong bi bat buoc MFA");
        assertEquals(10, policy.mfaFreshMinutes("GIAM_SAT"));
        // vai tro thuong KHONG nhan MED:Auth:MFA du phien co xac thuc; Quan tri van khong co thuoc tinh nao
        assertFalse(policy.attributesOf(sub("u-b", "BAC_SI", "Mat"), true).contains("MED:Auth:MFA"));
        assertTrue(policy.attributesOf(sub("u-qt", "QUAN_TRI", null), true).isEmpty());
    }

    @Test
    void thamSoBaoMatRiengCuaVaiTro() {
        assertEquals(1, policy.roleInt("GIAM_SAT", "maxDevices", 5));
        assertEquals(10, policy.roleInt("GIAM_SAT", "idleMinutes", 30));
        assertEquals(14, policy.roleInt("GIAM_SAT", "minPasswordLength", 10));
        assertFalse(policy.roleFlag("GIAM_SAT", "remoteAllowed", true));
        assertTrue(policy.roleFlag("GIAM_SAT", "readReasonRequired", false));
        assertEquals(5, policy.roleInt("BAC_SI", "maxDevices", 5), "vai tro thuong khong bi han che");
        assertTrue(policy.roleFlag("BAC_SI", "remoteAllowed", true));
    }

    @Test
    void matKhauGiamSatPhaiDaiVaMatKhauTamDaiHon() {
        assertEquals("PASSWORD_WEAK: toi thieu 14 ky tu, co chu va so", code(() -> identity.createUser("gs.weak@congty.vn", "Abc12345678", "GIAM_SAT", null, "GS yeu", null, true, "qt-a")));
        assertEquals("OK", code(() -> identity.createUser("bs.ok@congty.vn", "Abc12345678", "BAC_SI", "Mat", "BS", null, true, "qt-a")), "vai tro thuong van chi can 10 ky tu");
        assertTrue(identity.temporaryPasswordFor("GIAM_SAT").length() >= 16);
        assertEquals(12, identity.temporaryPasswordFor("BAC_SI").length());
    }

    @Test
    void capTaiKhoanGiamSatCanQuanTriKhacDuyet() {
        UserAccount u = identity.createUser("gs.duyet@congty.vn", PW14, "GIAM_SAT", null, "GS", null, true, "qt-a");
        assertEquals("PENDING_APPROVAL", u.status);
        assertEquals("qt-a", u.requestedBy);
        assertEquals("USE_APPROVAL", code(() -> identity.updateUser(u.userId, null, null, "ACTIVE", "qt-a")), "khong 'mo khoa' de lach duyet");
        assertEquals("DENY_SELF_APPROVAL", code(() -> identity.approve(u.userId, "qt-a")), "nguoi yeu cau khong tu duyet");
        assertEquals("DENY_SELF_APPROVAL", code(() -> identity.approve(u.userId, u.userId)));
        UserAccount ok = identity.approve(u.userId, "qt-b");
        assertEquals("ACTIVE", ok.status); assertNull(ok.requestedBy);
        assertEquals("NOT_PENDING", code(() -> identity.approve(u.userId, "qt-c")), "da duyet roi");
    }

    @Test
    void capLaiMatKhauMoKhoaVaDoiVaiTroSangGiamSatDeuCanDuyetLai() {
        UserAccount u = identity.createUser("gs.reset@congty.vn", PW14, "GIAM_SAT", null, "GS", null, true, "system");   // nap luc khoi dong: dung duoc ngay
        assertEquals("ACTIVE", u.status);
        // admin cap lai mat khau (admin nhin thay mat khau tam) => phai co admin khac duyet truoc khi dung duoc
        String temp = identity.resetPassword(u.userId, "qt-a");
        assertTrue(temp.length() >= 16);
        assertEquals("PENDING_APPROVAL", identity.user(u.userId).orElseThrow().status);
        assertEquals("DENY_SELF_APPROVAL", code(() -> identity.approve(u.userId, "qt-a")));
        identity.approve(u.userId, "qt-b");
        // khoa roi mo khoa => cung phai duyet lai
        identity.updateUser(u.userId, null, null, "DISABLED", "qt-a");
        assertEquals("DISABLED", identity.user(u.userId).orElseThrow().status);
        identity.updateUser(u.userId, null, null, "ACTIVE", "qt-a");
        assertEquals("PENDING_APPROVAL", identity.user(u.userId).orElseThrow().status);
        // bac si thuong doi SANG vai tro Giam sat => cho duyet
        UserAccount bs = identity.createUser("bs.len@congty.vn", "Abc12345678", "BAC_SI", "Nhi", "BS", null, true, "qt-a");
        assertEquals("ACTIVE", bs.status);
        UserAccount up = identity.updateUser(bs.userId, "GIAM_SAT", null, null, "qt-a");
        assertEquals("PENDING_APPROVAL", up.status); assertEquals("qt-a", up.requestedBy);
        // doi vai tro THUONG khong bi anh huong
        UserAccount other = identity.createUser("bs.doi@congty.vn", "Abc12345678", "BAC_SI", "Nhi", "BS2", null, true, "qt-a");
        assertEquals("ACTIVE", identity.updateUser(other.userId, "TIEP_DON", null, null, "qt-a").status);
    }
}
