package com.medabe.storage.research;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * TOTP (RFC 6238): HMAC-SHA1, buoc 30 giay, 6 chu so - tuong thich Google/Microsoft Authenticator. Chap nhan lech +-1 buoc (dong ho may lech nhe).
 * Chi la nhan to xac thuc thu hai; KHONG thay mat khau. Ma moi buoc chi duoc dung MOT lan (chong phat lai) - kiem o IdentityService.
 */
public final class Totp {
    private Totp() {}
    public static final int STEP_SECONDS = 30, DIGITS = 6;
    private static final String B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    public static String newSecretBase32() { return base32(ResearchCrypto.random(20)); }

    public static String base32(byte[] in) {
        StringBuilder out = new StringBuilder();
        int buf = 0, bits = 0;
        for (byte b : in) {
            buf = (buf << 8) | (b & 0xff); bits += 8;
            while (bits >= 5) { out.append(B32.charAt((buf >> (bits - 5)) & 31)); bits -= 5; }
        }
        if (bits > 0) out.append(B32.charAt((buf << (5 - bits)) & 31));
        return out.toString();
    }

    public static byte[] unbase32(String s) {
        String t = s.replace(" ", "").replace("=", "").toUpperCase();
        ByteBuffer out = ByteBuffer.allocate(t.length() * 5 / 8 + 1);
        int buf = 0, bits = 0;
        for (char c : t.toCharArray()) {
            int v = B32.indexOf(c);
            if (v < 0) throw new IllegalArgumentException("base32 sai");
            buf = (buf << 5) | v; bits += 5;
            if (bits >= 8) { out.put((byte) ((buf >> (bits - 8)) & 0xff)); bits -= 8; }
        }
        byte[] r = new byte[out.position()];
        out.flip(); out.get(r);
        return r;
    }

    /** Ma 6 so cua mot buoc thoi gian (counter = giay / 30). */
    public static String code(byte[] key, long counter) {
        try {
            Mac mac = Mac.getInstance("HmacSHA1");
            mac.init(new SecretKeySpec(key, "HmacSHA1"));
            byte[] h = mac.doFinal(ByteBuffer.allocate(8).putLong(counter).array());
            int o = h[h.length - 1] & 0x0f;
            int bin = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
            return String.format("%0" + DIGITS + "d", bin % 1_000_000);
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    /** Buoc thoi gian khop ma (trong cua so +-1) hoac -1. So sanh thoi gian hang dinh de khong lo ma dung tung chu so. */
    public static long verify(byte[] key, String code, long epochSeconds) {
        if (code == null || !code.matches("\\d{6}")) return -1;
        long cur = epochSeconds / STEP_SECONDS;
        long hit = -1;
        for (long d = -1; d <= 1; d++) {
            if (MessageDigest.isEqual(code(key, cur + d).getBytes(StandardCharsets.US_ASCII), code.getBytes(StandardCharsets.US_ASCII))) hit = cur + d;
        }
        return hit;
    }

    public static String otpauthUri(String issuer, String account, String secretBase32) {
        // Nhan "Issuer:tai-khoan": dau hai cham giu NGUYEN (chuan Key URI Format), hai phan duoc ma hoa rieng.
        String enc = java.net.URLEncoder.encode(issuer, StandardCharsets.UTF_8).replace("+", "%20") + ":" + java.net.URLEncoder.encode(account, StandardCharsets.UTF_8).replace("+", "%20");
        return "otpauth://totp/" + enc + "?secret=" + secretBase32 + "&issuer=" + java.net.URLEncoder.encode(issuer, StandardCharsets.UTF_8)
                + "&algorithm=SHA1&digits=" + DIGITS + "&period=" + STEP_SECONDS;
    }
}
