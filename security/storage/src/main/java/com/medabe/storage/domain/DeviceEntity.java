package com.medabe.storage.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/** Thiet bi da dang ky. Chi giu khoa CONG KHAI cua thiet bi va BAM cua token - khong co khoa bi mat nao. */
@Entity
@Table(name = "devices")
public class DeviceEntity {
    @Id public String gid;
    public String name;
    public String devicePub;
    public String deviceId;
    public String hwHash;
    public String tokenHash;
    public boolean disabled;
    public Instant createdAt;
    public DeviceEntity() {}
}
