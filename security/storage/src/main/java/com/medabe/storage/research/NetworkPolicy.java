package com.medabe.storage.research;

import com.medabe.storage.web.LanAccessFilter;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Chinh sach mang cho nhieu VLAN: cho phep dia chi nam trong cac CIDR duoc cap phep (moi phong ban/VLAN mot vung) hoac loopback,
 * va - neu bat - cung subnet voi card vat ly (hanh vi cu). Vung chi la NGU CANH ghi log; KHONG cap hay doi quyen nguoi dung.
 * Luon dung dia chi socket that (khong tin X-Forwarded-For). IPv6 va dia chi khong hop le bi tu choi.
 */
@Component
public class NetworkPolicy {
    public record Zone(String name, long network, int prefix) {
        boolean contains(long ip) {
            long mask = prefix == 0 ? 0 : (0xffffffffL << (32 - prefix)) & 0xffffffffL;
            return (ip & mask) == (network & mask);
        }
    }

    private final List<Zone> zones = new ArrayList<>();
    private final boolean sameSubnetFallback;
    private final String proxyHeader;

    /** Yeu cau nay den qua CONG TIN CAY phia Internet (duong ham/proxy)? Cong nay luon dat header IP khach THAT; khach noi bo truc tiep khong co header nay. */
    public boolean viaProxy(jakarta.servlet.http.HttpServletRequest req) {
        return proxyHeader != null && !proxyHeader.isBlank() && req.getHeader(proxyHeader) != null;
    }

    public NetworkPolicy(NetworkProps props) {
        this.proxyHeader = props == null ? null : props.proxyClientHeader();
        String raw = props == null || props.zones() == null ? "" : props.zones().trim();
        for (String item : raw.isEmpty() ? new String[0] : raw.split(",")) {
            int i = item.indexOf(':');
            if (i <= 0) throw new IllegalArgumentException("medabe.network.zones sai dinh dang (TEN:CIDR): " + item);
            zones.add(parseZone(item.substring(0, i).trim(), item.substring(i + 1).trim()));
        }
        String f = props == null || props.sameSubnetFallback() == null ? "" : props.sameSubnetFallback().trim();
        this.sameSubnetFallback = f.isEmpty() ? zones.isEmpty() : Boolean.parseBoolean(f);
    }

    public static long ipv4(String address) {
        String a = LanAccessFilter.normalizeAddress(address);
        if (!a.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}")) return -1;
        long r = 0;
        for (String p : a.split("\\.")) { int n = Integer.parseInt(p); if (n > 255) return -1; r = (r << 8) | n; }
        return r;
    }

    public static Zone parseZone(String name, String cidr) {
        String[] p = cidr.split("/");
        long net = ipv4(p[0]);
        int prefix = p.length == 2 && p[1].matches("\\d{1,2}") ? Integer.parseInt(p[1]) : -1;
        if (name.isEmpty() || !name.matches("[A-Za-z0-9_-]{1,40}") || net < 0 || prefix < 1 || prefix > 32)
            throw new IllegalArgumentException("vung mang khong hop le: " + name + ":" + cidr);
        return new Zone(name, net, prefix);
    }

    public List<Zone> zones() { return zones; }

    private static boolean loopback(String address) {
        String a = LanAccessFilter.normalizeAddress(address);
        long v = ipv4(a);
        return a.equals("::1") || a.equals("0:0:0:0:0:0:0:1") || (v >= 0x7f000000L && v <= 0x7fffffffL);
    }

    /** Ten vung mang cua dia chi ("LOOPBACK", ten vung cau hinh, "LOCAL-SUBNET") hoac null neu khong duoc phep. */
    public String zoneOf(String address) {
        if (loopback(address)) return "LOOPBACK";
        long v = ipv4(address);
        if (v <= 0 || v >= 0xe0000000L) return null;           // khong hop le, 0.0.0.0, multicast/broadcast
        for (Zone z : zones) if (z.contains(v)) return z.name();
        return sameSubnetFallback && LanAccessFilter.isLanPeer(address) ? "LOCAL-SUBNET" : null;
    }

    public boolean allowed(String address) { return zoneOf(address) != null; }
}
