package com.medabe.storage.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/** Nhat ky quan tri dang chuoi bam: sua/xoa mot dong thi moi hash phia sau lech. */
@Entity
@Table(name = "audit_log")
public class AuditLog {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) public Long seq;
    public Instant ts;
    public String actor;
    public String action;
    @Column(length = 2000) public String detail;
    public String prev;
    public String hash;
    public AuditLog() {}
}
