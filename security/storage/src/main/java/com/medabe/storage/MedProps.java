package com.medabe.storage;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** Cau hinh he thong. Cac token PHAI doi khi trien khai that (dat bang bien moi truong). */
@ConfigurationProperties(prefix = "medabe")
public record MedProps(
        String adminToken, String serviceToken, String siemToken,
        int k, String pkJson, String nodes,
        int retentionWeeks, int failThreshold, int failWindowMinutes, int breakGlassHours,
        String siemFile, boolean openEnrollment, String bytUrl, String bytPk,
        boolean agentEnabled, int agentDeniedThreshold, int agentDeniedWindowMinutes,
        int agentHwBurstCount, int agentHwBurstWindowMinutes,
        int agentBreakglassPatients, int agentBreakglassWindowMinutes,
        String appUpdatesDir,
        // ---- Cam bien mang (phat hien dau hieu ARP spoofing/MITM trong LAN) ----
        int netStaleMinutes,                 // khong co quan sat moi trong X phut => coi cam bien mat ket noi (heartbeat)
        int netFlapThreshold,                // so lan mot IP doi MAC trong cua so => nghi van tan cong lap lai
        // ---- Tich hop Gemini (phan tich canh bao). TAT mac dinh; luat bao ve KHONG phu thuoc AI. ----
        boolean aiEnabled, String geminiApiKey, String aiModel, int aiTimeoutMs, int aiMaxCallsPerHour) {

    /** "BenhVien=http://a,SoYTe=http://b" -> {org: url} giu nguyen thu tu. */
    public Map<String, String> nodeMap() {
        Map<String, String> m = new LinkedHashMap<>();
        if (nodes == null || nodes.isBlank()) return m;
        for (String kv : nodes.split(",")) {
            int i = kv.indexOf('=');
            if (i > 0) m.put(kv.substring(0, i).trim(), kv.substring(i + 1).trim());
        }
        return m;
    }
}
