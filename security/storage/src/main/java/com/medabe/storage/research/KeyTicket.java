package com.medabe.storage.research;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/** Ve cap khoa ABE: ngan han, gan (nguoi dung, thiet bi, phien); moi nut chi doi duoc mot lan; backend danh gia lai khi doi. */
@Entity
@Table(name = "research_tickets")
public class KeyTicket {
    @Id public String jti;
    public String userId;
    public String deviceId;
    public String sessionId;
    public String gid;
    @Column(length = 2000) public String attrs;
    public Instant notAfter;
    public Instant createdAt;
    @Column(length = 200) public String redeemedOrgs;
    public KeyTicket() {}
}
