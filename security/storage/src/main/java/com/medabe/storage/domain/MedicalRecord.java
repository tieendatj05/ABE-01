package com.medabe.storage.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * Ban ghi benh an DA MA HOA. Tang JPA chi thay "phong bi" (envelope JSON: header ABE + DEK da boc + ciphertext AES-GCM);
 * khong co cot nao chua noi dung lam sang. patientIdx la HMAC (chi muc mu), khong phai ma benh nhan.
 */
@Entity
@Table(name = "medical_records", indexes = {@Index(columnList = "patientIdx"), @Index(columnList = "groupIdx,type"), @Index(columnList = "parentIdx")})
public class MedicalRecord {
    @Id public String id;
    public String patientIdx;
    public String groupIdx;
    public String type;
    public String khoa;
    public String authorDevice;
    /** TAC GIA THEO TAI KHOAN: backend gan tu PHIEN da xac thuc (khong lay tu client). null = ban ghi tao truoc khi co tai khoan. */
    public String authorUserId;
    /** Ma anh goc cua cac VUNG anh (type=vung); null voi ban ghi khac. Chi la dinh danh ngau nhien. */
    public String refId;
    /** Chi muc tra cuu cua phu huynh (bam mot chieu cua ma tra cuu) va ban boc khoa noi dung bang khoa gia dinh. May chu khong giai ma duoc. */
    public String parentIdx;
    @JdbcTypeCode(SqlTypes.LONGVARCHAR) @Column(length = 4096) public String parentWrap;
    @JdbcTypeCode(SqlTypes.LONGVARCHAR) @Column(length = 33_554_432) public String envelope;
    @JdbcTypeCode(SqlTypes.LONGVARCHAR) @Column(length = 33_554_432) public String prevEnvelope;
    public Instant createdAt;
    public Instant updatedAt;
    public MedicalRecord() {}
}
