package com.medabe.storage.research;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * Muc ho so cua luong nghien cuu. mode = BASELINE (backend ma hoa khi luu bang KEK cua may chu) hoac ABE (backend chi giu phong bi,
 * khong co khoa). Moi dong la MOT muc (hanhchinh / lamsang.Nhi / lamsang.Mat); sua = them dong moi tro toi dong cu (supersedes).
 */
@Entity
@Table(name = "research_records", indexes = {@Index(columnList = "mode,patientRef")})
public class ResearchRecord {
    @Id public String id;
    public String mode;
    public String patientRef;
    public String type;
    public String khoa;
    public String supersedes;
    /** Lay tu PHIEN, khong tu client. */
    public String createdByUserId;
    /** Lay tu chung chi cua khoa ky da xac minh. Hien bat buoc == createdByUserId. */
    public String signedByUserId;
    public String signerDeviceId;
    public String policyVersion;
    @JdbcTypeCode(SqlTypes.LONGVARCHAR) @Column(length = 4000) public String manifest;
    @Column(length = 200) public String signature;
    /** ABE: chuoi phong bi (nguyen van, de tinh payloadDigest). BASELINE: null. */
    @JdbcTypeCode(SqlTypes.LONGVARCHAR) @Column(length = 33_554_432) public String payload;
    /** BASELINE: AES-GCM(DEK, noi dung), DEK boc boi KEK cua may chu. ABE: null. */
    @JdbcTypeCode(SqlTypes.LONGVARCHAR) @Column(length = 33_554_432) public String baselineCt;
    public String baselineIv;
    public String baselineWrapIv;
    @Column(length = 200) public String baselineWrappedDek;
    public Instant createdAt;
    public ResearchRecord() {}
}
