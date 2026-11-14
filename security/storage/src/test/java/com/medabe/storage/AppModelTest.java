package com.medabe.storage;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.medabe.storage.research.PolicyService;
import com.medabe.storage.research.PolicyService.Subject;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * MO HINH TAC GIA (app dang dung): policy = Nguoi nhap HOAC (Bac si VA Chuyen khoa); danh muc khoa co ma on dinh; quyen doc backend
 * = thuoc tinh cua tai khoan THOA policy (cung nguon voi policy ma hoa). Khong can dung HTTP: thuan logic PDP + danh muc.
 */
@SpringBootTest(properties = {
        "medabe.pk-json={\"id\":\"MED\"}", "medabe.siem-file=target/appmodel-test-siem.jsonl",
        "spring.datasource.url=jdbc:h2:mem:appmodel;DB_CLOSE_DELAY=-1",
        "medabe.admin-token=adm-test", "medabe.service-token=svc-test",
        "medabe.research.enabled=true", "medabe.research.password-iterations=1000",
        "medabe.research.baseline-kek=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
})
class AppModelTest {
    @Autowired PolicyService policy;

    static Subject sub(String uid, String role, String khoa) { return new Subject(uid, role, khoa, "ACTIVE"); }

    @Test
    void danhMucKhoaChuanHoaTenHienThiVeCungMa() {
        for (String s : new String[] {"Mắt", "MẮT", "mắt", "  mắt  ", "Mat", "mat", "Nhãn khoa", "Khoa Mắt", "Mắt" /* a + breve + acute, dang to hop roi */})
            assertEquals("Mat", policy.normalizeKhoa(s).orElse("?"), s);
        assertEquals("TMH", policy.normalizeKhoa("Tai Mũi  Họng").orElse("?"));
        assertEquals("TMH", policy.normalizeKhoa("tmh").orElse("?"));
        assertEquals("Nhi", policy.normalizeKhoa("NHI KHOA").orElse("?"));
        for (String bad : new String[] {"", "  ", "Mất", "Mat;Nhi", "MED:Role:BacSi", "Khoa:Mat", "Mắt Nhi", "Tim mạch", "../Mat", "Mat\u0000"})
            assertTrue(policy.normalizeKhoa(bad).isEmpty(), "phai tu choi: " + bad);
        assertEquals(List.of("Nhi", "Mat"), policy.normalizeKhoaList("mắt, NHI, mat"));            // theo thu tu danh muc, khong trung
        assertThrows(IllegalArgumentException.class, () -> policy.normalizeKhoaList("Mat,Tim mach"));
    }

    @Test
    void khoaThanKinhCoMaOnDinhVaChiBacSiThanKinhDocVung() {
        for (String s : new String[] {"Thần kinh", "THẦN KINH", "than kinh", "ThanKinh", "Khoa Thần kinh", "  thần   kinh  "})
            assertEquals("ThanKinh", policy.normalizeKhoa(s).orElse("?"), s);
        assertTrue(policy.normalizeKhoa("Thần kinh sọ").isEmpty(), "ten gan giong nhung khong thuoc danh muc phai bi tu choi");
        // vung anh nao: chinh sach sinh tu danh muc, chi tac gia + bac si khoa Than kinh
        assertEquals("MED:Author:u-1 OR (MED:Role:BacSi AND MED:Khoa:ThanKinh) OR (MED:Role:GiamSat AND MED:Auth:MFA)", policy.appPolicy("vung", List.of("ThanKinh"), "u-1"));
        var tk = sub("u-tk", "BAC_SI", "ThanKinh");
        var mat = sub("u-m", "BAC_SI", "Mat");
        var tkMat = sub("u-tkm", "BAC_SI", "ThanKinh,Mat");
        assertTrue(policy.decideAppWrite(tk, "write", "lamsang", "ThanKinh").permit());
        assertFalse(policy.decideAppWrite(mat, "write", "lamsang", "ThanKinh").permit(), "bac si Mat khong ghi/doc muc Than kinh");
        assertTrue(policy.attributesOf(tkMat).containsAll(Set.of("MED:Role:BacSi", "MED:Khoa:ThanKinh", "MED:Khoa:Mat")));
        assertFalse(policy.attributesOf(mat).contains("MED:Khoa:ThanKinh"));
        assertTrue(policy.policyMatchesApp("MED:Author:u-1 OR (MED:Role:BacSi AND MED:Khoa:ThanKinh) OR (MED:Role:BacSi AND MED:Khoa:Mat) OR (MED:Role:GiamSat AND MED:Auth:MFA)", "vung", List.of("ThanKinh", "Mat"), "u-1"));
        assertFalse(policy.policyMatchesApp("MED:Author:u-1 OR (MED:Role:BacSi AND MED:Khoa:ThanKinh) OR (MED:Role:BacSi AND MED:Khoa:Mat) OR (MED:Role:GiamSat AND MED:Auth:MFA)", "vung", List.of("ThanKinh"), "u-1"), "them nhanh doc khoa Mat khi vung chi gan Than kinh phai bi tu choi");
    }

    @Test
    void policyChuanLaTacGiaHoacBacSiVaKhoa() {
        assertEquals("MED:Author:u-1 OR (MED:Role:BacSi AND MED:Khoa:Mat) OR (MED:Role:GiamSat AND MED:Auth:MFA)", policy.appPolicy("lamsang", List.of("Mat"), "u-1"));
        assertEquals("MED:Author:u-1 OR (MED:Role:BacSi AND MED:Khoa:Nhi) OR (MED:Role:BacSi AND MED:Khoa:TMH) OR (MED:Role:GiamSat AND MED:Auth:MFA)", policy.appPolicy("vung", List.of("Nhi", "TMH"), "u-1"));
        assertEquals("MED:Author:u-1 OR (MED:Role:GiamSat AND MED:Auth:MFA)", policy.appPolicy("anh", List.of(), "u-1"));                    // anh goc: tac gia + Giam sat (doc tat ca)
        assertEquals("MED:Author:u-1 OR MED:Role:TiepDon OR MED:Role:BacSi OR (MED:Role:GiamSat AND MED:Auth:MFA)", policy.appPolicy("hanhchinh", List.of(), "u-1"));
        // khong co nhanh "moi bac si" cho muc lam sang, khong co "ket luan doc moi khoa", khong may tao, khong pha-vo-kinh, khong So Y te
        for (String t : policy.appTypes()) {
            String p = policy.appPolicy(t, List.of("Mat"), "u-1");
            assertFalse(p.contains("KetLuan") || p.contains("Device") || p.contains("BG:") || p.contains("SoYTe"), t + ": " + p);
            if (!"hanhchinh".equals(t)) assertFalse(List.of(p.split(" OR ")).contains("MED:Role:BacSi"), t + " khong duoc co nhanh 'moi bac si': " + p);
        }
    }

    @Test
    void chiPolicyDungMoiDuocNhanKhongYeuHonKhongMangTacGiaNguoiKhac() {
        var ks = List.of("Mat");
        assertTrue(policy.policyMatchesApp("MED:Author:u-1 OR (MED:Role:BacSi AND MED:Khoa:Mat) OR (MED:Role:GiamSat AND MED:Auth:MFA)", "lamsang", ks, "u-1"));
        assertTrue(policy.policyMatchesApp("(MED:Role:BacSi AND MED:Khoa:Mat) OR (MED:Role:GiamSat AND MED:Auth:MFA) OR MED:Author:u-1", "lamsang", ks, "u-1"), "thu tu nhanh khong quan trong");
        assertTrue(policy.policyMatchesApp("MED:Author:u-1 OR (MED:Khoa:Mat AND MED:Role:BacSi) OR (MED:Role:GiamSat AND MED:Auth:MFA)", "lamsang", ks, "u-1"), "thu tu thuoc tinh khong quan trong");
        for (String forged : new String[] {
                "MED:Author:u-2 OR (MED:Role:BacSi AND MED:Khoa:Mat)",                       // gia mao tac gia
                "MED:Author:u-1 OR MED:Role:BacSi",                                          // yeu hon: moi bac si
                "MED:Author:u-1 OR (MED:Role:BacSi AND MED:Khoa:Nhi)",                       // sai khoa
                "MED:Author:u-1 OR (MED:Role:BacSi AND MED:Khoa:Mat) OR MED:Role:KetLuan",   // them nhanh doc rong
                "MED:Author:u-1 OR (MED:Role:BacSi AND MED:Khoa:Mat) OR MED:Author:u-9",     // them nguoi doc
                "MED:Author:u-1 OR (MED:Role:BacSi AND MED:Khoa:Mat)",                       // thieu nhanh Giam sat (khong phai chuan hien hanh)
                "MED:Author:u-1 OR (MED:Role:BacSi AND MED:Khoa:Mat) OR (MED:Role:GiamSat AND MED:Auth:MFA) OR MED:Role:KetLuan",
                "MED:Author:u-1 OR MED:Role:BacSi AND MED:Khoa:Mat",                         // thieu ngoac: dang khong chuan
                "(MED:Role:BacSi AND MED:Khoa:Mat)",                                         // mat nhanh tac gia
                "MED:Author:u-1 OR (MED:Role:BacSi AND MED:Khoa:Mat) OR (MED:Role:BacSi AND MED:Khoa:Mat)",
                "MED:Author:u-1 OR (MED:Role:BacSi AND MED:Khoa:Mat) OR 1 of (MED:A, MED:B)",
                ""})
            assertFalse(policy.policyMatchesApp(forged, "lamsang", ks, "u-1"), forged);
        assertFalse(policy.policyMatchesApp("MED:Author:u-1", "lamsang", ks, "u-1"));
        assertTrue(policy.policyMatchesApp("(MED:Role:BacSi AND MED:Khoa:Mat) OR (MED:Role:GiamSat AND MED:Auth:MFA)", "lamsang", ks, null), "ban ghi cu khong co tac gia theo tai khoan");
    }

    @Test
    void quyenGhiTheoVaiTroVaKhoa() {
        var nhi = sub("u-n", "BAC_SI", "Nhi");
        var nhiMat = sub("u-nm", "BAC_SI", "Nhi,Mat");
        var nl = sub("u-nl", "NHAP_LIEU", null);
        var td = sub("u-td", "TIEP_DON", null);
        var qt = sub("u-qt", "QUAN_TRI", null);
        assertTrue(policy.decideAppWrite(nhi, "write", "lamsang", "Nhi").permit());
        assertTrue(policy.decideAppWrite(nhi, "write", "lamsang", "nhi khoa").permit(), "ten hien thi cung ma");
        assertEquals("DENY_KHOA_MISMATCH", policy.decideAppWrite(nhi, "write", "lamsang", "Mắt").reason());
        assertTrue(policy.decideAppWrite(nhiMat, "write", "lamsang", "MẮT").permit(), "bac si nhieu khoa");
        assertEquals("DENY_KHOA_INVALID", policy.decideAppWrite(nhiMat, "write", "lamsang", "Nhi,Mat").reason(), "muc lam sang chi 1 khoa");
        assertEquals("DENY_KHOA_INVALID", policy.decideAppWrite(nhi, "write", "lamsang", "Tim mach").reason());
        assertEquals("DENY_KHOA_INVALID", policy.decideAppWrite(nhi, "write", "lamsang", "MED:Role:BacSi").reason());
        // nguoi nhap lieu: moi khoa trong danh muc, ke ca anh/vung nhieu khoa
        assertTrue(policy.decideAppWrite(nl, "write", "lamsang", "TMH").permit());
        assertTrue(policy.decideAppWrite(nl, "import", "lankham", "KSK").permit());
        assertTrue(policy.decideAppWrite(nl, "write", "vung", "Mat, Nhi").permit());
        assertTrue(policy.decideAppWrite(nl, "write", "anh", "KSK").permit());
        assertEquals("DENY_ROLE_NOT_ALLOWED", policy.decideAppWrite(nhi, "write", "anh", "KSK").reason());
        assertEquals("DENY_ROLE_NOT_ALLOWED", policy.decideAppWrite(td, "write", "lamsang", "Nhi").reason());
        assertTrue(policy.decideAppWrite(td, "write", "hanhchinh", "KSK").permit());
        assertEquals("DENY_ROLE_NOT_ALLOWED", policy.decideAppWrite(qt, "write", "hanhchinh", "KSK").reason());
        assertEquals("DENY_ROLE_NOT_ALLOWED", policy.decideAppWrite(qt, "write", "lamsang", "Nhi").reason());
        assertEquals("DENY_ACCOUNT_DISABLED", policy.decideAppWrite(new Subject("u", "BAC_SI", "Nhi", "DISABLED"), "write", "lamsang", "Nhi").reason());
        assertTrue(policy.decideAppWrite(sub("u-kt", "KTV", null), "write", "canlamsang", "XetNghiem").permit());
        assertEquals("DENY_KHOA_MISMATCH", policy.decideAppWrite(sub("u-kt", "KTV", null), "write", "canlamsang", "Nhi").reason());
    }

    @Test
    void quyenDocBackendBangThuocTinhThoaPolicy() {
        var nhi = sub("u-n", "BAC_SI", "Nhi");
        var mat = sub("u-m", "BAC_SI", "Mat");
        var nhiMat = sub("u-nm", "BAC_SI", "Nhi,Mat");
        var tmh = sub("u-t", "BAC_SI", "TMH");
        var nl1 = sub("u-nl1", "NHAP_LIEU", null);
        var nl2 = sub("u-nl2", "NHAP_LIEU", null);
        var qt = sub("u-qt", "QUAN_TRI", null);
        var kl = sub("u-kl", "KET_LUAN", "KSK");
        var klNoKhoa = sub("u-kl2", "KET_LUAN", null);
        // lam sang Mat do nl1 nhap
        assertTrue(policy.canReadApp(nl1, "lamsang", "Mat", "u-nl1"), "tac gia doc lai du lieu minh nhap");
        assertFalse(policy.canReadApp(nl2, "lamsang", "Mat", "u-nl1"), "nguoi nhap KHAC khong doc duoc");
        assertTrue(policy.canReadApp(mat, "lamsang", "Mat", "u-nl1"));
        assertTrue(policy.canReadApp(nhiMat, "lamsang", "Mat", "u-nl1"));
        assertFalse(policy.canReadApp(nhi, "lamsang", "Mat", "u-nl1"), "bac si Nhi khong doc Mat (biet CCCD khong tang quyen)");
        assertFalse(policy.canReadApp(tmh, "lamsang", "Mat", "u-nl1"));
        assertFalse(policy.canReadApp(qt, "lamsang", "Mat", "u-nl1"), "quan tri khong doc benh an");
        assertFalse(policy.canReadApp(kl, "lamsang", "Mat", "u-nl1"), "ket luan KHONG doc moi khoa");
        assertFalse(policy.canReadApp(klNoKhoa, "lamsang", "Mat", "u-nl1"));
        assertTrue(policy.canReadApp(kl, "ketluan", "KSK", "u-x"), "ket luan co khoa KSK doc muc ket luan KSK");
        // anh goc: chi tac gia; vung nhieu khoa: tac gia + bac si tung khoa
        assertTrue(policy.canReadApp(nl1, "anh", "KSK", "u-nl1"));
        for (var s : List.of(nhi, mat, nhiMat, tmh, kl, qt, nl2)) assertFalse(policy.canReadApp(s, "anh", "KSK", "u-nl1"));
        assertTrue(policy.canReadApp(mat, "vung", "Mat,Nhi", "u-nl1"));
        assertTrue(policy.canReadApp(nhi, "vung", "Mat,Nhi", "u-nl1"));
        assertFalse(policy.canReadApp(tmh, "vung", "Mat,Nhi", "u-nl1"));
        // hanh chinh (dinh danh toi thieu): tiep don + moi bac si + tac gia
        assertTrue(policy.canReadApp(sub("u-td", "TIEP_DON", null), "hanhchinh", "KSK", "u-x"));
        assertTrue(policy.canReadApp(tmh, "hanhchinh", "KSK", "u-x"));
        assertFalse(policy.canReadApp(qt, "hanhchinh", "KSK", "u-x"));
        assertFalse(policy.canReadApp(nl2, "hanhchinh", "KSK", "u-x"), "nhap lieu khong phai tac gia thi khong doc hanh chinh nguoi khac nhap");
        // ban ghi cu (khong co tac gia theo tai khoan): chi nhanh vai tro/khoa
        assertFalse(policy.canReadApp(nl1, "lamsang", "Mat", null));
        assertTrue(policy.canReadApp(mat, "lamsang", "Mat", null));
        // tai khoan bi khoa
        assertFalse(policy.canReadApp(new Subject("u-m", "BAC_SI", "Mat", "DISABLED"), "lamsang", "Mat", null));
    }

    @Test
    void thuocTinhCapChoTaiKhoanChiCoTacGiaCuaChinhNo() {
        Set<String> a = policy.attributesOf(sub("u-nhimat", "BAC_SI", "Mat,Nhi"));
        assertEquals(Set.of("MED:Role:BacSi", "MED:Khoa:Nhi", "MED:Khoa:Mat", "MED:Author:u-nhimat"), a);
        assertEquals(Set.of("MED:Role:NhapLieu", "MED:Author:u-nl"), policy.attributesOf(sub("u-nl", "NHAP_LIEU", null)));
        assertTrue(policy.attributesOf(sub("u-qt", "QUAN_TRI", null)).isEmpty(), "quan tri khong co thuoc tinh nao ke ca Author");
        assertNotNull(policy.signedDocument().get("signature"));
        assertTrue(policy.signedDocument().get("payload").toString().contains("khoaCatalog"));
    }
}
