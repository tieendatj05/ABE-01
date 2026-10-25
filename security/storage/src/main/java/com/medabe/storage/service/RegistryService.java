package com.medabe.storage.service;

import com.medabe.storage.domain.ConfigKv;
import com.medabe.storage.domain.Repos;
import jakarta.annotation.PostConstruct;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.HexFormat;
import org.springframework.stereotype.Service;

/**
 * Co quan DINH DANH: cap GID duy nhat cho moi thiet bi va ky chung chi (Ed25519) rang buoc GID <-> khoa cong khai cua
 * thiet bi. Cac nut cap khoa kiem tra chung chi nay, nen hai nguoi khong the tu chon chung mot GID de ghep khoa.
 * Registry KHONG cap duoc thuoc tinh va khong thay khoa nao cua ABE.
 */
@Service
public class RegistryService {
    private static final HexFormat HEX = HexFormat.of();
    private final Repos.Kv kv;
    private PrivateKey priv;
    private String pubRawHex;

    public RegistryService(Repos.Kv kv) { this.kv = kv; }

    @PostConstruct
    void init() throws Exception {
        var p8 = kv.findById("registry.priv");
        var pub = kv.findById("registry.pub");
        if (p8.isEmpty() || pub.isEmpty()) {
            KeyPair kp = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
            kv.save(new ConfigKv("registry.priv", HEX.formatHex(kp.getPrivate().getEncoded())));
            kv.save(new ConfigKv("registry.pub", rawPub(kp.getPublic().getEncoded())));
            p8 = kv.findById("registry.priv");
            pub = kv.findById("registry.pub");
        }
        priv = KeyFactory.getInstance("Ed25519").generatePrivate(new PKCS8EncodedKeySpec(HEX.parseHex(p8.get().v)));
        pubRawHex = pub.get().v;
    }

    private static String rawPub(byte[] x509) {
        // Ed25519 X.509 SubjectPublicKeyInfo = 12 byte tien to + 32 byte khoa tho.
        return HEX.formatHex(x509, x509.length - 32, x509.length);
    }

    public String publicKeyHex() { return pubRawHex; }

    /** Domain-separated signature for a server discovery challenge; the private key never leaves this service. */
    public String signDiscoveryProof(String payload) {
        try {
            Signature signature = Signature.getInstance("Ed25519");
            signature.initSign(priv);
            signature.update(("medabe/discovery/v1|" + payload).getBytes(StandardCharsets.UTF_8));
            return HEX.formatHex(signature.sign());
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
    /** Thong diep ky PHAI khop voi gidMessage() phia TypeScript. */
    public String certify(String gid, String devicePubHex) {
        try {
            Signature s = Signature.getInstance("Ed25519");
            s.initSign(priv);
            s.update(("medabe/gid/" + gid + "|" + devicePubHex).getBytes(StandardCharsets.UTF_8));
            return HEX.formatHex(s.sign());
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
