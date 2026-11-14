package com.medabe.storage.research;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/**
 * Che do BASELINE: ma hoa khi luu (at-rest) o backend. Moi ban ghi mot DEK ngau nhien: ct = AES-256-GCM(DEK, noi dung, AAD=id|patientRef|section);
 * wrappedDek = AES-256-GCM(KEK, DEK, AAD="kek|id"). KEK cua MAY CHU nam trong bien moi truong hoac tep rieng, TACH khoi CSDL.
 * Backend tu giai ma khi doc (sau khi PDP cho phep) => ai chiem duoc tien trinh/KEK deu doc duoc ban ro. Day la thuoc tinh cua thiet ke nen,
 * khong phai loi; muc nen tot hon se dat KEK trong KMS/HSM (khong co o day).
 */
@Service
@ConditionalOnProperty(prefix = "medabe.research", name = "enabled", havingValue = "true")
public class BaselineVault {
    private static final Logger log = LoggerFactory.getLogger(BaselineVault.class);
    private final byte[] kek;

    public BaselineVault(ResearchProps props) throws Exception {
        String hex = props.baselineKek();
        if (hex != null && !hex.isBlank()) {
            if (!hex.matches("[0-9a-fA-F]{64}")) throw new IllegalStateException("MEDABE_BASELINE_KEK phai la 64 ky tu hex");
            kek = ResearchCrypto.HEX.parseHex(hex);
        } else {
            Path f = Path.of(props.baselineKekFile());
            if (Files.exists(f)) kek = ResearchCrypto.HEX.parseHex(Files.readString(f, StandardCharsets.UTF_8).trim());
            else {
                kek = ResearchCrypto.random(32);
                if (f.getParent() != null) Files.createDirectories(f.getParent());
                Files.writeString(f, ResearchCrypto.HEX.formatHex(kek), StandardCharsets.UTF_8);
                f.toFile().setReadable(false, false); f.toFile().setReadable(true, true);
                f.toFile().setWritable(false, false); f.toFile().setWritable(true, true);
                log.warn("Da tao KEK BASELINE moi tai {} (chi cho nghien cuu; san xuat phai dung KMS/HSM)", f.toAbsolutePath());
            }
        }
    }

    /** Niem phong bi mat nho (TOTP) bang KEK may chu: "iv:ct" (hex). AAD gan userId nen khong tra doi duoc giua nguoi dung. */
    public String sealSecret(String userId, String secret) {
        ResearchCrypto.Sealed s = ResearchCrypto.gcmSeal(kek, secret.getBytes(StandardCharsets.UTF_8), "totp|" + userId);
        return s.iv() + ":" + s.ct();
    }
    public String openSecret(String userId, String sealed) {
        String[] p = sealed.split(":", 2);
        return new String(ResearchCrypto.gcmOpen(kek, p[0], p[1], "totp|" + userId), StandardCharsets.UTF_8);
    }

    public static String aad(ResearchRecord r, String sectionKey) { return r.id + "|" + r.patientRef + "|" + sectionKey; }

    public void seal(ResearchRecord r, String sectionKey, String content) {
        byte[] dek = ResearchCrypto.random(32);
        ResearchCrypto.Sealed data = ResearchCrypto.gcmSeal(dek, content.getBytes(StandardCharsets.UTF_8), aad(r, sectionKey));
        ResearchCrypto.Sealed wrapped = ResearchCrypto.gcmSeal(kek, dek, "kek|" + r.id);
        r.baselineIv = data.iv(); r.baselineCt = data.ct();
        r.baselineWrapIv = wrapped.iv(); r.baselineWrappedDek = wrapped.ct();
        java.util.Arrays.fill(dek, (byte) 0);
    }

    public String open(ResearchRecord r, String sectionKey) {
        byte[] dek = ResearchCrypto.gcmOpen(kek, r.baselineWrapIv, r.baselineWrappedDek, "kek|" + r.id);
        try { return new String(ResearchCrypto.gcmOpen(dek, r.baselineIv, r.baselineCt, aad(r, sectionKey)), StandardCharsets.UTF_8); }
        finally { java.util.Arrays.fill(dek, (byte) 0); }
    }
}
