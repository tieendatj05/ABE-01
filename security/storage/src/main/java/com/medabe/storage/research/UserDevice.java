package com.medabe.storage.research;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/** Thiet bi dang ky cua MOT nguoi: khoa ky ca nhan (P-256) tren mot may + chung chi do registry ky. Hai nguoi cung may => hai ban ghi rieng. */
@Entity
@Table(name = "research_devices")
public class UserDevice {
    @Id public String deviceId;
    public String userId;
    @Column(length = 200) public String signPub;
    public String label;
    @Column(length = 200) public String cert;
    /** ACTIVE | REVOKED */
    public String status;
    public Instant createdAt;
    public Instant revokedAt;
    public UserDevice() {}
}
