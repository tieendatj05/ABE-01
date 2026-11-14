package com.medabe.storage.research;

import com.medabe.storage.domain.ResearchRepos;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** Tao tai khoan mau tu medabe.research.seed-users (username|password|ROLE|KHOA|Ten , ...). Chi tao neu chua ton tai; mat khau khong bao gio duoc ghi log. */
@Component
@ConditionalOnProperty(prefix = "medabe.research", name = "enabled", havingValue = "true")
public class ResearchSeeder implements SmartInitializingSingleton {
    private static final Logger log = LoggerFactory.getLogger(ResearchSeeder.class);
    private final ResearchProps props;
    private final IdentityService identity;
    private final ResearchRepos.Users users;

    /** "ten-dang-nhap|mat-khau-tam": KHOI PHUC CUC BO tai khoan Quan tri (chi khi nguoi van hanh dat bien moi truong luc khoi dong; xem Khoi-Phuc-Mat-Khau-Quan-Tri.cmd). */
    private final String recoverAdmin;

    public ResearchSeeder(ResearchProps props, IdentityService identity, ResearchRepos.Users users,
                          @org.springframework.beans.factory.annotation.Value("${medabe.research.recover-admin:}") String recoverAdmin) {
        this.props = props; this.identity = identity; this.users = users; this.recoverAdmin = recoverAdmin;
    }

    /** Chay TRUOC khi may chu web nhan ket noi (khong co khoang thoi gian dang nhap duoc ma tai khoan chua duoc tao). */
    @Override
    public void afterSingletonsInstantiated() {
        seed();
        recover();
    }

    private void recover() {
        if (recoverAdmin == null || recoverAdmin.isBlank()) return;
        int i = recoverAdmin.indexOf('|');
        if (i <= 0) throw new IllegalStateException("recover-admin sai dinh dang: ten-dang-nhap|mat-khau-tam");
        identity.recoverLocalAdmin(recoverAdmin.substring(0, i), recoverAdmin.substring(i + 1));
        log.warn("KHOI PHUC CUC BO: da dat lai mat khau tam cho tai khoan quan tri {} (bat buoc doi o lan dang nhap dau).", recoverAdmin.substring(0, i));
    }

    private void seed() {
        String raw = props.seedUsers();
        if (raw == null || raw.isBlank()) return;
        for (String item : raw.split(",")) {
            String[] f = item.split("\\|", -1);
            if (f.length < 3) throw new IllegalStateException("seed-users sai dinh dang: username|password|ROLE|KHOA|Ten");
            String username = f[0].trim();
            if (users.findByUsername(username).isPresent()) continue;
            boolean temp = f.length > 5 && "TAM".equalsIgnoreCase(f[5].trim());      // 6 truong: ...|TAM => mat khau tam, bat buoc doi o lan dang nhap dau
            identity.createUser(username, f[1], f[2].trim(), f.length > 3 && !f[3].isBlank() ? f[3].trim().replace("+", ",") : null, f.length > 4 ? f[4] : username, null, temp, "system");
            log.info("Da tao tai khoan nghien cuu {} ({})", username, f[2].trim());
        }
    }
}
