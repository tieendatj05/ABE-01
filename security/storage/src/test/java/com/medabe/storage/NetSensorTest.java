package com.medabe.storage;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.medabe.storage.domain.Repos;
import com.medabe.storage.service.EventService;
import com.medabe.storage.service.NetSensorService;
import com.medabe.storage.service.NetSensorService.Observation;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * Cam bien mang: dua tren LUAT, khong goi AI. Kiem: binh thuong khong bao, baseline chua duyet khong ket luan an toan,
 * dau hieu ARP spoofing bi phat hien, MAC rac (toan 0) bi bo qua, nhieu IP cung MAC => nghi van MITM.
 */
@SpringBootTest(properties = {
        "medabe.pk-json={\"id\":\"MED\"}",
        "medabe.siem-file=target/test-siem-net.jsonl",
        "spring.datasource.url=jdbc:h2:mem:nettest;DB_CLOSE_DELAY=-1",
})
class NetSensorTest {
    @Autowired NetSensorService net;
    @Autowired EventService events;
    @Autowired Repos.Kv kv;
    @Autowired Repos.Events eventRepo;

    @BeforeEach void reset() { eventRepo.deleteAll(); kv.deleteAll(); }   // moi test doc lap: xoa su kien + baseline/snapshot

    private Observation o(String ip, String mac) { return new Observation(ip, mac, "Reachable"); }

    private long countType(String type) {
        return events.latest().stream().filter(e -> type.equals(e.type)).count();
    }

    @Test
    void chuaDuyetBaselineThiKhongKetLuanAnToan() {
        net.ingest("s1", "Wi-Fi", List.of(o("192.168.1.39", "a4:fc:58:6c:5e:c9")));
        // Chua duyet => sinh su kien NHAC "chua xac minh", KHONG sinh canh bao tan cong.
        assertTrue(countType("NET_BASELINE_UNVERIFIED") >= 1);
        assertEquals(0, countType("NET_ARP_SUSPECT"));
        assertFalse((Boolean) net.status().get("baselineApproved"));
    }

    @Test
    void duyetBaselineRoiMangBinhThuongThiKhongBao() {
        net.ingest("s1", "Wi-Fi", List.of(o("192.168.1.39", "aa:bb:cc:dd:ee:01"), o("192.168.1.15", "aa:bb:cc:dd:ee:02")));
        net.approveBaseline("admin");
        long before = countType("NET_ARP_SUSPECT");
        net.ingest("s1", "Wi-Fi", List.of(o("192.168.1.39", "aa:bb:cc:dd:ee:01"), o("192.168.1.15", "aa:bb:cc:dd:ee:02")));
        assertEquals(before, countType("NET_ARP_SUSPECT"));   // dung MAC => khong canh bao
        assertTrue((Boolean) net.status().get("baselineApproved"));
    }

    @Test
    void mayChuDoiSangMacLaThiBaoArpSpoofing() {
        net.ingest("s2", "Wi-Fi", List.of(o("10.0.0.39", "aa:bb:cc:00:00:39"), o("10.0.0.15", "aa:bb:cc:00:00:15")));
        net.approveBaseline("admin");
        // Ke tan cong (Kali) mao MAC cua minh cho IP may chu:
        net.ingest("s2", "Wi-Fi", List.of(o("10.0.0.39", "de:ad:be:ef:00:99"), o("10.0.0.15", "aa:bb:cc:00:00:15")));
        assertTrue(countType("NET_ARP_SUSPECT") >= 1);
        assertTrue(events.latest().stream().anyMatch(e -> "NET_ARP_SUSPECT".equals(e.type) && "CRITICAL".equals(e.severity)));
    }

    @Test
    void nhieuIpVeCungMotMacThiNghiVanMitm() {
        net.ingest("s3", "Wi-Fi", List.of(o("10.1.0.39", "aa:00:00:00:00:39"), o("10.1.0.15", "aa:00:00:00:00:15")));
        net.approveBaseline("admin");
        // Ca hai IP quan trong deu tro ve MAC cua Kali:
        net.ingest("s3", "Wi-Fi", List.of(o("10.1.0.39", "ca:11:00:00:00:99"), o("10.1.0.15", "ca:11:00:00:00:99")));
        assertTrue(countType("NET_MITM_SUSPECT") >= 1);
    }

    @Test
    void macRacToanSoKhongBiDungDeCanhBao() {
        net.ingest("s4", "Wi-Fi", List.of(o("10.2.0.39", "aa:00:00:00:02:39")));
        net.approveBaseline("admin");
        long before = countType("NET_ARP_SUSPECT");
        // MAC toan 0 (khong phan giai duoc) => bo qua, khong coi la doi MAC.
        net.ingest("s4", "Wi-Fi", List.of(o("10.2.0.39", "00:00:00:00:00:00")));
        assertEquals(before, countType("NET_ARP_SUSPECT"));
    }

    @Test
    void khongBaoTrungChoCungMotMacMoi() {
        net.ingest("s5", "Wi-Fi", List.of(o("10.3.0.39", "aa:00:00:00:03:39")));
        net.approveBaseline("admin");
        net.ingest("s5", "Wi-Fi", List.of(o("10.3.0.39", "ba:ad:00:00:00:99")));
        long after1 = countType("NET_ARP_SUSPECT");
        net.ingest("s5", "Wi-Fi", List.of(o("10.3.0.39", "ba:ad:00:00:00:99")));   // cung MAC gia => khong bao them
        assertEquals(after1, countType("NET_ARP_SUSPECT"));
    }
}
