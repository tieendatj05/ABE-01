package com.medabe.storage.domain;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public final class Repos {
    private Repos() {}

    public interface Devices extends JpaRepository<DeviceEntity, String> {
        Optional<DeviceEntity> findByTokenHash(String tokenHash);
        boolean existsByDeviceId(String deviceId);
        List<DeviceEntity> findByHwHashAndDisabledFalse(String hwHash);
        /** Các thiết bị (kể cả đã khoá) đăng ký cùng một phần cứng trong một khoảng thời gian - dùng để phát hiện ĐĂNG KÝ HÀNG LOẠT. */
        List<DeviceEntity> findByHwHashAndCreatedAtAfter(String hwHash, Instant after);
    }
    public interface Invites extends JpaRepository<InviteEntity, String> {}
    public interface Records extends JpaRepository<MedicalRecord, String> {
        List<MedicalRecord> findByPatientIdxOrderByCreatedAtAsc(String patientIdx);
        List<MedicalRecord> findTop500ByParentIdxOrderByCreatedAtAsc(String parentIdx);
        long countByGroupIdxAndType(String groupIdx, String type);
        java.util.Optional<MedicalRecord> findFirstByGroupIdxAndTypeOrderByCreatedAtDesc(String groupIdx, String type);
        long countByParentIdx(String parentIdx);
        java.util.Optional<MedicalRecord> findFirstByParentIdxOrderByCreatedAtDesc(String parentIdx);
        List<MedicalRecord> findTop2000ByGroupIdxAndTypeOrderByCreatedAtAsc(String groupIdx, String type);
        /** Ban MOI NHAT cua moi benh nhan trong nhom (moi lan cap nhat trang thai/noi dung deu tao them ban ghi, nen khong the lay "2000 ban cu nhat"). */
        @Query("select r from MedicalRecord r where r.groupIdx = :g and r.type = :t and r.createdAt = "
                + "(select max(x.createdAt) from MedicalRecord x where x.patientIdx = r.patientIdx and x.khoa = r.khoa and x.groupIdx = :g and x.type = :t) order by r.createdAt asc")
        List<MedicalRecord> latestByGroupAndType(@Param("g") String groupIdx, @Param("t") String type);
    }
    public interface KeyHeaders extends JpaRepository<KeyHeaderEntity, String> {}
    public interface Epochs extends JpaRepository<EpochCounter, String> {}
    public interface Events extends JpaRepository<SecurityEvent, Long> {
        List<SecurityEvent> findByTypeAndClosedFalse(String type);
        long countByDeviceGidAndTypeAndTsAfter(String deviceGid, String type, Instant after);
        /** Danh sách đầy đủ (không chỉ đếm) - dùng để đếm SỐ BỆNH NHÂN KHÁC NHAU mà một thiết bị đã phá-vỡ-kính trong một khoảng thời gian. */
        List<SecurityEvent> findByDeviceGidAndTypeAndTsAfter(String deviceGid, String type, Instant after);
        List<SecurityEvent> findTop200ByIdGreaterThanOrderByIdAsc(Long id);
        List<SecurityEvent> findTop100ByOrderByIdDesc();
        long countByTypeStartingWith(String prefix);
    }
    public interface Audit extends JpaRepository<AuditLog, Long> {
        Optional<AuditLog> findTopByOrderBySeqDesc();
        List<AuditLog> findAllByOrderBySeqAsc();
    }
    public interface Kv extends JpaRepository<ConfigKv, String> {}
}
