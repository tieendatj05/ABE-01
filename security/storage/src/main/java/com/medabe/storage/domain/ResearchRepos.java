package com.medabe.storage.domain;

import com.medabe.storage.research.KeyTicket;
import com.medabe.storage.research.PasswordResetRequest;
import com.medabe.storage.research.ResearchRecord;
import com.medabe.storage.research.UserAccount;
import com.medabe.storage.research.UserDevice;
import com.medabe.storage.research.UserSession;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/** Repository cua luong nghien cuu (phai nam trong package domain vi StorageApplication chi quet package nay). */
public final class ResearchRepos {
    private ResearchRepos() {}

    public interface Users extends JpaRepository<UserAccount, String> {
        Optional<UserAccount> findByUsername(String username);
        Optional<UserAccount> findByPhone(String phone);
    }
    public interface Devices extends JpaRepository<UserDevice, String> {
        List<UserDevice> findByUserId(String userId);
        long countByUserIdAndStatus(String userId, String status);
    }
    public interface Sessions extends JpaRepository<UserSession, String> {
        Optional<UserSession> findByTokenHash(String tokenHash);
        List<UserSession> findByUserIdAndRevokedAtIsNull(String userId);
        List<UserSession> findByDeviceIdAndRevokedAtIsNull(String deviceId);
    }
    public interface Tickets extends JpaRepository<KeyTicket, String> {}
    public interface PasswordRequests extends JpaRepository<PasswordResetRequest, String> {
        List<PasswordResetRequest> findByStatusOrderByCreatedAtAsc(String status);
        Optional<PasswordResetRequest> findFirstByUserIdAndStatus(String userId, String status);
        long countByStatus(String status);
    }
    public interface Records extends JpaRepository<ResearchRecord, String> {
        List<ResearchRecord> findByModeAndPatientRefOrderByCreatedAtAsc(String mode, String patientRef);
        List<ResearchRecord> findByModeOrderByCreatedAtAsc(String mode);
    }
}
