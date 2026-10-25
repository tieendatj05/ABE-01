package com.medabe.storage.service;

import com.medabe.storage.MedProps;
import com.medabe.storage.domain.ConfigKv;
import com.medabe.storage.domain.Repos;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.springframework.stereotype.Service;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * CAM BIEN MANG: nhan bang neighbor (ARP) do tram quan tri thu thap (Get-NetNeighbor tren Windows, chay o tien trinh chinh
 * Electron - KHONG o renderer), doi chieu voi BASELINE da duoc quan tri vien DUYET, va sinh su kien NET_* khi thay dau hieu
 * ARP spoofing / MITM. Hoan toan dua tren LUAT, khong goi AI - chay doc lap, khong ton phi.
 *
 * GIOI HAN (noi ro trong UI/ban giao):
 *  - Chi phat hien DAU HIEU trong pham vi LAN IPv4 (IP <-> MAC bat thuong). KHONG bao dam phat hien nghe len thu dong,
 *    moi dang MITM, hay tan cong tren IPv6.
 *  - Thieu du lieu (cam bien mat ket noi / thieu quyen thu thap) KHONG duoc coi la "mang an toan".
 *  - Du lieu lan dau quan sat KHONG tu dong an toan: baseline phai do quan tri vien DUYET (co the dang bi dau doc ARP luc do).
 */
@Service
public class NetSensorService {
    private static final String K_BASELINE = "net.baseline";   // {approved, approvedAt, entries:{ "iface|ip": mac }}
    private static final String K_SENSOR = "net.sensor";       // {id, iface, lastSeen}
    private static final String K_CURRENT = "net.current";     // { "iface|ip": {mac, state, locallyAdministered} }
    private static final String K_ALERTED = "net.alerted";     // { "iface|ip": mac } - mapping da canh bao (chong bao trung)

    private final Repos.Kv kv;
    private final EventService events;
    private final AuditService audit;
    private final MedProps props;
    private final ObjectMapper mapper;
    private final Clock clock;

    public NetSensorService(Repos.Kv kv, EventService events, AuditService audit, MedProps props, ObjectMapper mapper, Clock clock) {
        this.kv = kv; this.events = events; this.audit = audit; this.props = props; this.mapper = mapper; this.clock = clock;
    }

    public record Observation(String ip, String mac, String state) {}

    private Map<String, Object> read(String key) {
        return kv.findById(key).map(v -> {
            try { return mapper.readValue(v.v, new TypeReference<Map<String, Object>>() {}); }
            catch (Exception e) { return new LinkedHashMap<String, Object>(); }
        }).orElseGet(LinkedHashMap::new);
    }

    private void write(String key, Map<String, Object> m) {
        try { kv.save(new ConfigKv(key, mapper.writeValueAsString(m))); }
        catch (Exception e) { throw new IllegalStateException("khong ghi duoc " + key, e); }
    }

    private static String normMac(String mac) {
        if (mac == null) return "";
        String m = mac.trim().toLowerCase().replace('-', ':');
        return m.matches("([0-9a-f]{2}:){5}[0-9a-f]{2}") ? m : "";
    }

    /** MAC rac (toan 0) hoac khong hop le => bo qua, khong dung de so khop/canh bao. */
    private static boolean usableMac(String mac) {
        return !mac.isEmpty() && !mac.equals("00:00:00:00:00:00") && !mac.equals("ff:ff:ff:ff:ff:ff");
    }

    /** Bit "locally administered" (MAC ngau nhien/rieng tu, vd iPhone/MacBook) - chi la NGU CANH, khong tu ket luan tan cong. */
    private static boolean locallyAdministered(String mac) {
        try { return (Integer.parseInt(mac.substring(0, 2), 16) & 0x02) != 0; }
        catch (Exception e) { return false; }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object o) {
        return o instanceof Map ? (Map<String, Object>) o : new LinkedHashMap<>();
    }

    /**
     * Nhan mot dot quan sat tu cam bien. Cap nhat heartbeat, snapshot hien tai, roi ap luat phat hien.
     * `state` chi de tham khao: rieng trang thai "Stale" KHONG duoc coi la tan cong (chi so khop MAC moi canh bao).
     */
    public synchronized Map<String, Object> ingest(String sensorId, String iface, List<Observation> obs) {
        Instant now = Instant.now(clock);

        // 1) Heartbeat cam bien
        Map<String, Object> sensor = new LinkedHashMap<>();
        sensor.put("id", sensorId == null ? "?" : sensorId);
        sensor.put("iface", iface == null ? "?" : iface);
        sensor.put("lastSeen", now.toString());
        write(K_SENSOR, sensor);

        // 2) Snapshot hien tai (bo MAC rac)
        Map<String, Object> current = new LinkedHashMap<>();
        for (Observation o : obs) {
            String mac = normMac(o.mac());
            if (o.ip() == null || !usableMac(mac)) continue;
            String key = iface + "|" + o.ip();
            Map<String, Object> cell = new LinkedHashMap<>();
            cell.put("mac", mac);
            cell.put("state", o.state() == null ? "" : o.state());
            cell.put("locallyAdministered", locallyAdministered(mac));
            current.put(key, cell);
        }
        write(K_CURRENT, current);

        // 3) Phat hien - chi khi baseline DA DUOC DUYET
        Map<String, Object> baseline = read(K_BASELINE);
        boolean approved = Boolean.TRUE.equals(baseline.get("approved"));
        Map<String, Object> entries = asMap(baseline.get("entries"));
        List<String> alerts = new ArrayList<>();

        if (!approved) {
            // Chua duyet baseline => KHONG ket luan an toan; nhac mot lan (chong trung bang K_ALERTED).
            if (!current.isEmpty()) alertOnce("baseline-unverified", "", () -> events.record(
                    "net-sensor", "NET_BASELINE_UNVERIFIED", "INFO",
                    "Cam bien mang dang chay nhung BASELINE CHUA DUOC DUYET. Chua the ket luan co bi ARP spoofing hay khong - "
                            + "quan tri vien can xac minh IP<->MAC that (luc mang chac chan sach) roi bam Duyet baseline.", null, null));
            return status();
        }

        Map<String, Object> alerted = read(K_ALERTED);

        // 3a) Mapping da duyet chuyen sang MAC khac
        for (var en : entries.entrySet()) {
            String key = en.getKey();
            String baseMac = String.valueOf(en.getValue());
            Map<String, Object> cell = asMap(current.get(key));
            String nowMac = String.valueOf(cell.getOrDefault("mac", ""));
            if (nowMac.isEmpty()) continue;                       // khong thay = thiet bi ngu, khong ket luan
            if (!nowMac.equals(baseMac)) {
                if (!nowMac.equals(String.valueOf(alerted.get(key)))) {   // chong bao trung cho cung mot MAC moi
                    String ip = key.substring(key.indexOf('|') + 1);
                    events.record("net-sensor", "NET_ARP_SUSPECT", "CRITICAL",
                            "IP " + ip + " da duyet gan voi MAC " + baseMac + " nhung nay dang bao MAC " + nowMac
                                    + " - dau hieu ARP spoofing (ke dung giua mao MAC cua may nay). Giao dien: hay xac minh truoc khi ket luan.",
                            ip, null);
                    alerted.put(key, nowMac);
                    alerts.add(ip);
                }
            }
        }

        // 3b) Nhieu IP quan trong (trong baseline) cung tro ve MOT MAC khong khop baseline => nghi van MITM gom luu luong
        Map<String, List<String>> byMac = new TreeMap<>();
        for (var en : entries.entrySet()) {
            String key = en.getKey();
            Map<String, Object> cell = asMap(current.get(key));
            String nowMac = String.valueOf(cell.getOrDefault("mac", ""));
            String baseMac = String.valueOf(en.getValue());
            if (!nowMac.isEmpty() && !nowMac.equals(baseMac)) byMac.computeIfAbsent(nowMac, k -> new ArrayList<>()).add(key);
        }
        for (var en : byMac.entrySet()) {
            if (en.getValue().size() >= 2) {
                String tag = "mitm|" + en.getKey();
                if (!"done".equals(String.valueOf(alerted.get(tag)))) {
                    List<String> ips = en.getValue().stream().map(k -> k.substring(k.indexOf('|') + 1)).toList();
                    events.record("net-sensor", "NET_MITM_SUSPECT", "CRITICAL",
                            en.getValue().size() + " dia chi IP quan trong (" + String.join(", ", ips) + ") cung tro ve MAC "
                                    + en.getKey() + " - dau hieu mot may dang dung giua nhieu may (MITM). Can xac minh.", null, null);
                    alerted.put(tag, "done");
                }
            }
        }
        write(K_ALERTED, alerted);
        return status();
    }

    private void alertOnce(String tag, String macKey, Runnable rec) {
        Map<String, Object> alerted = read(K_ALERTED);
        if (String.valueOf(macKey).equals(String.valueOf(alerted.get("once:" + tag)))) return;
        rec.run();
        alerted.put("once:" + tag, macKey);
        write(K_ALERTED, alerted);
    }

    /** Quan tri vien DUYET baseline: chot IP<->MAC hien tai lam goc tin cay. Chi lam khi mang chac chan sach. */
    public synchronized Map<String, Object> approveBaseline(String actor) {
        Map<String, Object> current = read(K_CURRENT);
        Map<String, Object> entries = new LinkedHashMap<>();
        for (var en : current.entrySet()) {
            Map<String, Object> cell = asMap(en.getValue());
            String mac = String.valueOf(cell.getOrDefault("mac", ""));
            if (!mac.isEmpty()) entries.put(en.getKey(), mac);
        }
        Map<String, Object> baseline = new LinkedHashMap<>();
        baseline.put("approved", true);
        baseline.put("approvedAt", Instant.now(clock).toString());
        baseline.put("entries", entries);
        write(K_BASELINE, baseline);
        write(K_ALERTED, new LinkedHashMap<>());    // xoa trang thai chong-trung: baseline moi, canh bao lai tu dau
        audit.log(actor == null ? "admin" : actor, "net.baseline.approve", entries.size() + " mapping IP<->MAC");
        events.record("admin", "NET_BASELINE_APPROVED", "INFO",
                "Da duyet baseline mang: " + entries.size() + " anh xa IP<->MAC duoc chot lam goc tin cay.", null, null);
        return status();
    }

    public synchronized Map<String, Object> status() {
        Map<String, Object> sensor = read(K_SENSOR);
        Map<String, Object> baseline = read(K_BASELINE);
        Map<String, Object> current = read(K_CURRENT);
        Instant lastSeen = parse(sensor.get("lastSeen"));
        boolean stale = lastSeen == null || lastSeen.isBefore(Instant.now(clock).minus(props.netStaleMinutes(), ChronoUnit.MINUTES));

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("sensorId", sensor.getOrDefault("id", null));
        m.put("iface", sensor.getOrDefault("iface", null));
        m.put("lastSeen", sensor.getOrDefault("lastSeen", null));
        m.put("online", lastSeen != null && !stale);
        m.put("staleMinutes", props.netStaleMinutes());
        m.put("baselineApproved", Boolean.TRUE.equals(baseline.get("approved")));
        m.put("baselineApprovedAt", baseline.getOrDefault("approvedAt", null));
        m.put("baselineCount", asMap(baseline.get("entries")).size());
        m.put("observedCount", current.size());
        // Bang hien tai cho UI xem/doi chieu (chi la du lieu quan sat, khong phai ket luan).
        List<Map<String, Object>> table = new ArrayList<>();
        Map<String, Object> entries = asMap(baseline.get("entries"));
        for (var en : current.entrySet()) {
            Map<String, Object> cell = asMap(en.getValue());
            String key = en.getKey();
            String baseMac = String.valueOf(entries.getOrDefault(key, ""));
            String nowMac = String.valueOf(cell.getOrDefault("mac", ""));
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("iface", key.substring(0, key.indexOf('|')));
            row.put("ip", key.substring(key.indexOf('|') + 1));
            row.put("mac", nowMac);
            row.put("state", cell.getOrDefault("state", ""));
            row.put("locallyAdministered", cell.getOrDefault("locallyAdministered", false));
            row.put("baselineMac", baseMac);
            row.put("mismatch", !baseMac.isEmpty() && !baseMac.equals(nowMac));
            table.add(row);
        }
        m.put("table", table);
        m.put("note", "Chi phat hien dau hieu ARP trong LAN IPv4. Thieu du lieu KHONG co nghia la an toan.");
        return m;
    }

    private Instant parse(Object iso) {
        try { return iso == null ? null : Instant.parse(String.valueOf(iso)); }
        catch (Exception e) { return null; }
    }
}
