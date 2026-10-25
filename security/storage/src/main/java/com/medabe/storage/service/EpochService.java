package com.medabe.storage.service;

import com.medabe.storage.MedProps;
import com.medabe.storage.domain.EpochCounter;
import com.medabe.storage.domain.Repos;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.temporal.IsoFields;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Thu muc epoch CONG KHAI (khong chua bi mat): tuan hien hanh + bo dem thu hoi theo thuoc tinh.
 * Sua thu muc nay chi gay tu choi dich vu, khong tao ra quyen truy cap nao.
 */
@Service
public class EpochService {
    public record Directory(String tag, List<String> retention, Map<String, Integer> counters) {}

    private final Repos.Epochs repo;
    private final MedProps props;
    private final Clock clock;

    public EpochService(Repos.Epochs repo, MedProps props, Clock clock) {
        this.repo = repo; this.props = props; this.clock = clock;
    }

    static String tag(LocalDate d) {
        return String.format("%04dW%02d", d.get(IsoFields.WEEK_BASED_YEAR), d.get(IsoFields.WEEK_OF_WEEK_BASED_YEAR));
    }

    public Directory directory() {
        LocalDate today = LocalDate.now(clock.withZone(ZoneOffset.UTC));
        List<String> retention = new ArrayList<>();
        for (int i = 0; i < Math.max(1, props.retentionWeeks()); i++) retention.add(tag(today.minusWeeks(i)));
        Map<String, Integer> counters = new HashMap<>();
        repo.findAll().forEach(c -> counters.put(c.base, c.counter));
        return new Directory(retention.get(0), retention, counters);
    }

    public int bump(String base) {
        EpochCounter c = repo.findById(base).orElseGet(() -> new EpochCounter(base, 0));
        c.counter++;
        repo.save(c);
        return c.counter;
    }
}
