package com.medabe.storage.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.Inet4Address;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.util.Collections;
import java.util.Locale;
import java.util.regex.Pattern;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** LAN-only boundary uses the socket peer, never forwarding headers. Interfaces are read on every request. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class LanAccessFilter extends OncePerRequestFilter {
    private static final Pattern VIRTUAL = Pattern.compile("vmware|virtual|vethernet|vbox|hyper-v|wsl|docker|vpn|tailscale|zerotier|loopback|bluetooth|wireguard|tunnel|tap-|tun[0-9]", Pattern.CASE_INSENSITIVE);

    public static String normalizeAddress(String address) {
        return address == null ? "" : address.toLowerCase(Locale.ROOT).replaceFirst("^::ffff:", "");
    }
    private static long ipv4(String address) {
        String normalized = normalizeAddress(address);
        if (!normalized.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}")) return -1;
        long result = 0;
        for (String part : normalized.split("\\.")) {
            int n = Integer.parseInt(part);
            if (n > 255) return -1;
            result = (result << 8) | n;
        }
        return result;
    }
    static boolean sameSubnet(String peer, String local, int prefix) {
        long p = ipv4(peer), l = ipv4(local);
        if (p < 0 || l < 0 || prefix < 1 || prefix > 32) return false;
        long mask = (0xffffffffL << (32 - prefix)) & 0xffffffffL;
        return (p & mask) == (l & mask);
    }
    public static boolean isLanPeer(String address) {
        String peer = normalizeAddress(address);
        long value = ipv4(peer);
        if (peer.equals("::1") || peer.equals("0:0:0:0:0:0:0:1") || (value >= 0x7f000000L && value <= 0x7fffffffL)) return true;
        if (value <= 0 || value >= 0xe0000000L) return false;
        try {
            var interfaces = NetworkInterface.getNetworkInterfaces();
            if (interfaces == null) return false;
            for (NetworkInterface network : Collections.list(interfaces)) {
                if (!network.isUp() || network.isLoopback() || network.isVirtual()
                        || VIRTUAL.matcher(network.getName() + " " + network.getDisplayName()).find()) continue;
                for (var local : network.getInterfaceAddresses()) {
                    if (local.getAddress() instanceof Inet4Address && sameSubnet(peer, local.getAddress().getHostAddress(), local.getNetworkPrefixLength())) return true;
                }
            }
        } catch (SocketException ignored) { /* fail closed if interface enumeration fails */ }
        return false;
    }
    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        if (!isLanPeer(request.getRemoteAddr())) {
            response.setStatus(403); response.setContentType("application/json"); response.setCharacterEncoding("UTF-8");
            response.getWriter().write("{\"error\":\"LAN_ONLY: chi cho phep thiet bi cung mang noi bo\"}");
            return;
        }
        chain.doFilter(request, response);
    }
}
