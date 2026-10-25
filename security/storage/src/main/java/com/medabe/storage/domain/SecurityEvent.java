package com.medabe.storage.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "security_events", indexes = {@Index(columnList = "type,closed"), @Index(columnList = "deviceGid,type,ts")})
public class SecurityEvent {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY) public Long id;
    public Instant ts;
    public String source;
    public String type;
    public String severity;
    @Column(length = 2000) public String detail;
    public String subject;
    public String deviceGid;
    public boolean closed;
    public SecurityEvent() {}
}
