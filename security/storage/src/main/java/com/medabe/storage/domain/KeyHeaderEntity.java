package com.medabe.storage.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * Header ABE DUNG CHUNG cho nhieu ban ghi cung chinh sach (vd ca lo nhap Excel). May chu chi giu header da ma hoa (cac phan tu nhom
 * cap) va DEK da boc - khong the mo. Boc lai khi doi epoch chi can cap nhat MOT dong nay thay vi tung ban ghi.
 */
@Entity
@Table(name = "key_headers")
public class KeyHeaderEntity {
    @Id public String id;
    @Column(length = 4000) public String policy;
    @JdbcTypeCode(SqlTypes.LONGVARCHAR) @Column(length = 1_000_000) public String abe;
    public String wrapIv;
    @Column(length = 200) public String wrappedDek;
    public String authorDevice;
    public Instant createdAt;
    public Instant updatedAt;
    @JdbcTypeCode(SqlTypes.LONGVARCHAR) @Column(length = 1_000_000) public String prevJson;
    public KeyHeaderEntity() {}
}
