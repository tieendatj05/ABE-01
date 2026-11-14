package com.medabe.storage.research;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/** Phien dang nhap: tach khoi nguoi dung va thiet bi. Token chi luu BAM. */
@Entity
@Table(name = "research_sessions")
public class UserSession {
    @Id public String sessionId;
    public String tokenHash;
    public String userId;
    /** null = phien chua gan thiet bi (chi duoc dang ky thiet bi / dang xuat / xem trang thai). */
    public String deviceId;
    public Instant createdAt;
    public Instant lastSeenAt;
    public Instant expiresAt;
    public Instant revokedAt;
    public String remoteAddr;
    public String zone;
    /** Thoi diem phien nay xac thuc TOTP dung gan nhat (null = chua). Thuoc tinh ABE MED:Auth:MFA chi cap khi con han (mfaFreshMinutes cua vai tro). */
    public Instant mfaVerifiedAt;
    public UserSession() {}
}
