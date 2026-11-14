package com.medabe.storage.research;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Cau hinh luong nghien cuu CP-ABE (tat mac dinh: enabled=false => he thong giu hanh vi cu, /api/v2/** khong ton tai).
 * Bien moi truong tuong ung: MEDABE_RESEARCH_*.
 */
@ConfigurationProperties(prefix = "medabe.research")
public record ResearchProps(
        boolean enabled, String zone, int passwordIterations, int sessionHours, int idleMinutes, int ticketSeconds, int maxDevices,
        int maxFailedLogins, int lockMinutes, int loginRatePerMinute, String initialSchedule, boolean legacyBridge, String seedUsers, String baselineKek, String baselineKekFile, boolean evidenceEnabled) {
    public ResearchProps {
        if (zone == null || zone.isBlank()) zone = "Asia/Ho_Chi_Minh";
        if (passwordIterations <= 0) passwordIterations = 600_000;
        if (sessionHours <= 0) sessionHours = 12;
        if (idleMinutes <= 0) idleMinutes = 30;
        if (ticketSeconds <= 0) ticketSeconds = 60;
        if (maxDevices <= 0) maxDevices = 5;
        if (maxFailedLogins <= 0) maxFailedLogins = 5;
        if (lockMinutes <= 0) lockMinutes = 15;
        if (loginRatePerMinute <= 0) loginRatePerMinute = 60;
    }
}
