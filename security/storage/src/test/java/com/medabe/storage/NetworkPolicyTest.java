package com.medabe.storage;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import com.medabe.storage.research.NetworkPolicy;
import com.medabe.storage.research.NetworkProps;
import com.medabe.storage.web.LanAccessFilter;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

/** Nhieu VLAN: cho phep theo CIDR duoc cap phep (khong chi cung subnet); vung chi la ngu canh, khong doi quyen; khong tin header chuyen tiep. */
class NetworkPolicyTest {
    static NetworkPolicy vlans() { return new NetworkPolicy(new NetworkProps("TIEPDON:10.10.10.0/24,NHI:10.10.20.0/24,MAT:10.10.30.0/23", "", "")); }

    @Test
    void phongBanOCacVlanDuocCapPhepKetNoiDuocVaGhiNhanVungMang() {
        NetworkPolicy p = vlans();
        assertEquals("TIEPDON", p.zoneOf("10.10.10.7"));
        assertEquals("NHI", p.zoneOf("10.10.20.254"));
        assertEquals("MAT", p.zoneOf("10.10.31.9"));              // /23 gom 10.10.30.x va 10.10.31.x
        assertEquals("NHI", p.zoneOf("::ffff:10.10.20.8"));
        assertEquals("LOOPBACK", p.zoneOf("127.0.0.1"));
    }

    @Test
    void diaChiNgoaiDanhSachBiTuChoiKeCaKhiGiaLaCungDaiVoiMayChu() {
        NetworkPolicy p = vlans();
        for (String bad : new String[] {"10.10.40.1", "10.11.20.5", "192.168.1.10", "203.0.113.5", "8.8.8.8", "0.0.0.0", "255.255.255.255", "224.0.0.1", "2001:db8::1", "abc", "", "10.10.20.256"})
            assertNull(p.zoneOf(bad), bad);
        assertFalse(p.allowed("10.10.19.255"));
        assertTrue(p.allowed("10.10.20.0"));
    }

    @Test
    void khiCauHinhVungKhongConTuDongChoCungSubnetVatLyNhungVanCoTheBatLai() {
        assertNull(new NetworkPolicy(new NetworkProps("NHI:10.10.20.0/24", "", "")).zoneOf("172.16.5.5"));
        assertEquals("LOOPBACK", new NetworkPolicy(new NetworkProps("", "", "")).zoneOf("127.0.0.1"));          // khong cau hinh => hanh vi cu
    }

    @Test
    void cauHinhSaiBiTuChoiKhiKhoiDong() {
        assertThrows(IllegalArgumentException.class, () -> new NetworkPolicy(new NetworkProps("NHI10.10.20.0/24", "", "")));
        assertThrows(IllegalArgumentException.class, () -> new NetworkPolicy(new NetworkProps("NHI:10.10.20.0/33", "", "")));
        assertThrows(IllegalArgumentException.class, () -> new NetworkPolicy(new NetworkProps("NHI:10.10.20.0", "", "")));
        assertThrows(IllegalArgumentException.class, () -> new NetworkPolicy(new NetworkProps("NHI:10.10.20.0/0", "", "")));
    }

    @Test
    void boLocDungChinhSachVlanVaKhongTinXForwardedFor() throws Exception {
        LanAccessFilter f = new LanAccessFilter();
        ReflectionTestUtils.setField(f, "network", vlans());
        var ok = new MockHttpServletRequest(); ok.setRemoteAddr("10.10.20.9");
        var okRes = new MockHttpServletResponse();
        boolean[] reached = {false};
        f.doFilter(ok, okRes, (q, s) -> reached[0] = true);
        assertTrue(reached[0], "VLAN Nhi duoc cap phep phai toi duoc API");

        var spoof = new MockHttpServletRequest(); spoof.setRemoteAddr("203.0.113.9"); spoof.addHeader("X-Forwarded-For", "10.10.20.9"); spoof.addHeader("X-Real-IP", "127.0.0.1");
        var spoofRes = new MockHttpServletResponse();
        f.doFilter(spoof, spoofRes, (q, s) -> fail("gia mao header chuyen tiep da qua duoc bo loc"));
        assertEquals(403, spoofRes.getStatus());
    }

    @Test
    void truyCapTuXaChiTinHeaderIpKhachKhiDiQuaCongLoopbackVaDatIpThatLamNguon() throws Exception {
        LanAccessFilter f = new LanAccessFilter();
        ReflectionTestUtils.setField(f, "network", vlans());
        ReflectionTestUtils.setField(f, "netProps", new NetworkProps("", "", "X-Medabe-Client-IP"));
        // qua cong tin cay (nguon loopback) + header: duoc phep va getRemoteAddr = IP khach that
        var viaGateway = new MockHttpServletRequest(); viaGateway.setRemoteAddr("127.0.0.1"); viaGateway.addHeader("X-Medabe-Client-IP", "203.0.113.50");
        String[] seen = {null};
        f.doFilter(viaGateway, new MockHttpServletResponse(), (q, r) -> seen[0] = ((jakarta.servlet.http.HttpServletRequest) q).getRemoteAddr());
        assertEquals("203.0.113.50", seen[0]);
        // header gia tu may KHAC (khong phai loopback): bi bo qua -> van 403 nhu cu
        var spoof = new MockHttpServletRequest(); spoof.setRemoteAddr("203.0.113.9"); spoof.addHeader("X-Medabe-Client-IP", "127.0.0.1");
        var res = new MockHttpServletResponse();
        f.doFilter(spoof, res, (q, r) -> fail("header gia tu may ngoai da qua duoc bo loc"));
        assertEquals(403, res.getStatus());
        // header rac tu cong -> khong duoc dung lam dia chi
        var junk = new MockHttpServletRequest(); junk.setRemoteAddr("127.0.0.1"); junk.addHeader("X-Medabe-Client-IP", "<script>");
        String[] seen2 = {null};
        f.doFilter(junk, new MockHttpServletResponse(), (q, r) -> seen2[0] = ((jakarta.servlet.http.HttpServletRequest) q).getRemoteAddr());
        assertEquals("127.0.0.1", seen2[0]);
    }
}
