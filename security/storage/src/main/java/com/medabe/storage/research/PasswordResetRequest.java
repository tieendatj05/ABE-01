package com.medabe.storage.research;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * Yeu cau "quen mat khau" do nhan vien gui tu man hinh dang nhap (chua dang nhap). KHONG chua mat khau hay bi mat nao: chi bao cho quan tri biet ai can duoc
 * cap lai. Quan tri xac minh danh tinh nguoi do (goi lai so da dang ky, gap truc tiep) roi moi cap mat khau tam; xem IdentityService.fulfillPasswordRequest.
 */
@Entity
@Table(name = "research_password_requests")
public class PasswordResetRequest {
    @Id public String id;
    @Column(nullable = false) public String userId;
    /** OPEN | DONE | REJECTED | EXPIRED */
    @Column(nullable = false) public String status;
    public Instant createdAt;
    /** Dia chi may gui yeu cau (de quan tri doi chieu; khong dung de xac thuc). */
    public String fromIp;
    public String handledBy;
    public Instant handledAt;
    public PasswordResetRequest() {}
}
