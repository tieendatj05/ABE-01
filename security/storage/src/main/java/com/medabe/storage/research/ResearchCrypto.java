package com.medabe.storage.research;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.AlgorithmParameters;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.spec.ECFieldFp;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPublicKeySpec;
import java.util.Arrays;
import java.util.HexFormat;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** Tien ich mat ma dung chung cua luong nghien cuu. Khong chua khoa nao. */
public final class ResearchCrypto {
    private ResearchCrypto() {}

    public static final HexFormat HEX = HexFormat.of();
    private static final SecureRandom RNG = new SecureRandom();

    public static byte[] random(int n) { byte[] b = new byte[n]; RNG.nextBytes(b); return b; }
    public static String randomHex(int n) { return HEX.formatHex(random(n)); }
    public static byte[] sha256(byte[] in) {
        try { return MessageDigest.getInstance("SHA-256").digest(in); } catch (Exception e) { throw new IllegalStateException(e); }
    }
    public static String sha256Hex(String s) { return HEX.formatHex(sha256(s.getBytes(StandardCharsets.UTF_8))); }

    /** deviceId = SHA-256(khoa cong khai tho)[:16 hex] - khop deviceIdOf() phia TypeScript. */
    public static String deviceIdOf(String pubHex) { return HEX.formatHex(sha256(HEX.parseHex(pubHex))).substring(0, 16); }

    private static ECParameterSpec p256() throws Exception {
        AlgorithmParameters ap = AlgorithmParameters.getInstance("EC");
        ap.init(new ECGenParameterSpec("secp256r1"));
        return ap.getParameterSpec(ECParameterSpec.class);
    }

    /** Khoa cong khai P-256 dang tho (04||X||Y, 130 hex) co hop le va nam tren duong cong khong. */
    public static boolean validP256Pub(String pubHex) {
        try {
            if (pubHex == null || !pubHex.matches("04[0-9a-f]{128}")) return false;
            return point(pubHex) != null;
        } catch (Exception e) { return false; }
    }

    private static ECPoint point(String pubHex) throws Exception {
        byte[] b = HEX.parseHex(pubHex);
        BigInteger x = new BigInteger(1, Arrays.copyOfRange(b, 1, 33)), y = new BigInteger(1, Arrays.copyOfRange(b, 33, 65));
        ECParameterSpec spec = p256();
        BigInteger p = ((ECFieldFp) spec.getCurve().getField()).getP();
        BigInteger lhs = y.multiply(y).mod(p);
        BigInteger rhs = x.pow(3).add(spec.getCurve().getA().multiply(x)).add(spec.getCurve().getB()).mod(p);
        return lhs.equals(rhs) && x.compareTo(p) < 0 && y.compareTo(p) < 0 ? new ECPoint(x, y) : null;
    }

    /** Kiem chu ky ECDSA P-256/SHA-256 o dang IEEE P1363 (r||s, 64 byte) - dang WebCrypto tra ve. */
    public static boolean verifyP256(String pubHex, String message, String sigHex) {
        try {
            if (sigHex == null || !sigHex.matches("[0-9a-f]{128}") || !validP256Pub(pubHex)) return false;
            PublicKey pk = KeyFactory.getInstance("EC").generatePublic(new ECPublicKeySpec(point(pubHex), p256()));
            Signature s = Signature.getInstance("SHA256withECDSAinP1363Format");
            s.initVerify(pk);
            s.update(message.getBytes(StandardCharsets.UTF_8));
            return s.verify(HEX.parseHex(sigHex));
        } catch (Exception e) { return false; }
    }

    public record Sealed(String iv, String ct) {}

    public static Sealed gcmSeal(byte[] key, byte[] plaintext, String aad) {
        try {
            byte[] iv = random(12);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
            c.updateAAD(aad.getBytes(StandardCharsets.UTF_8));
            return new Sealed(HEX.formatHex(iv), HEX.formatHex(c.doFinal(plaintext)));
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    public static byte[] gcmOpen(byte[] key, String ivHex, String ctHex, String aad) {
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, HEX.parseHex(ivHex)));
            c.updateAAD(aad.getBytes(StandardCharsets.UTF_8));
            return c.doFinal(HEX.parseHex(ctHex));
        } catch (Exception e) { throw new IllegalStateException("giai ma that bai (sai khoa hoac du lieu bi sua)", e); }
    }
}
