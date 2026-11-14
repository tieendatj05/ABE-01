package com.medabe.storage.research;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/** Tai khoan nguoi dung do backend quan ly: vai tro, khoa, trang thai KHONG lay tu client. */
@Entity
@Table(name = "research_users")
public class UserAccount {
    @Id public String userId;
    @Column(unique = true, nullable = false) public String username;
    public String displayName;
    public String passwordHash;
    public String passwordSalt;
    public int passwordIterations;
    /** TIEP_DON | BAC_SI | QUAN_TRI */
    public String role;
    /** Nhi | Mat (chi dung cho BAC_SI) */
    public String khoa;
    /** ACTIVE | DISABLED | PENDING_APPROVAL (vai tro nhay cam: chua duoc QUAN TRI KHAC duyet thi chua dang nhap duoc) | RESTRICTED (nghi bi chiem: dang nhap duoc nhung CHI con thuoc tinh tac gia, khong ghi, khong quan tri). */
    public String status;
    /** Quan tri vien da yeu cau cap/doi vai tro nhay cam hoac cap lai mat khau; nguoi duyet PHAI KHAC nguoi nay. */
    public String requestedBy;
    /** GID cua ABE: sinh MOT lan cho moi NGUOI (khong phai moi thiet bi), 128 bit ngau nhien. */
    public String gid;
    /** So dien thoai nhan vien cung cap luc vao lam (duy nhat, dang 0xxxxxxxxx). Du lieu nhan vien, khong phai benh nhan. */
    @Column(unique = true) public String phone;
    /** true: mat khau hien tai la mat khau TAM do admin cap; chi duoc doi mat khau/dang xuat cho den khi nhan vien tu doi. */
    @Column(columnDefinition = "boolean default false") public boolean mustChangePassword;
    /** Bi mat TOTP, MA HOA bang KEK may chu (AES-GCM, AAD gan userId): lo CSDL khong lo bi mat. null = chua dang ky. */
    public String totpSecretSealed;
    /** true sau khi nhap dung ma dau tien (xac nhan dang ky). */
    @Column(columnDefinition = "boolean default false") public boolean totpEnabled;
    /** Buoc thoi gian cua ma da dung gan nhat: chan dung lai cung mot ma (phat lai). */
    @Column(columnDefinition = "bigint default 0") public long totpLastStep;
    /** Khi status = RESTRICTED (nghi tài khoản bị chiếm): ai hạn chế, lúc nào, vì sao. Xoá khi khôi phục (lịch sử nằm trong nhật ký). */
    public Instant restrictedAt;
    public String restrictedBy;
    @Column(length = 300) public String restrictReason;
    public int failedCount;
    public Instant lockedUntil;
    public Instant createdAt;
    public Instant passwordChangedAt;
    public UserAccount() {}
}
