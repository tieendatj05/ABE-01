package com.medabe.storage;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.medabe.storage.domain.Repos;
import com.medabe.storage.service.AuditService;
import com.medabe.storage.service.EpochService;
import com.medabe.storage.service.EventService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/** Het han pha-vo-kinh tu dong (job dinh ky) + audit chain + epoch directory. break-glass-hours=0 nen moi lan kich hoat deu da het han. */
@SpringBootTest(properties = {
        "medabe.break-glass-hours=0",
        "medabe.pk-json={\"id\":\"MED\"}",
        "medabe.siem-file=target/test-siem.jsonl",
        "spring.datasource.url=jdbc:h2:mem:bgtest;DB_CLOSE_DELAY=-1",
})
class BreakGlassExpiryTest {
    @Autowired EventService events;
    @Autowired EpochService epochs;
    @Autowired AuditService audit;
    @Autowired Repos.Events eventRepo;

    @Test
    void expiredBreakGlassBumpsEpochOnce() {
        String idx = "a".repeat(32);
        events.record("node:BenhVien", "BREAK_GLASS", "CRITICAL", "bs X pha vo kinh", idx, null);
        events.record("node:SoYTe", "BREAK_GLASS", "CRITICAL", "bs X pha vo kinh", idx, null);
        assertEquals(0, epochs.directory().counters().getOrDefault("MED:BG:" + idx, 0));

        assertEquals(1, events.expireBreakGlass(epochs));                       // mot ho so => dong mot lan, du co 2 canh bao
        assertEquals(1, epochs.directory().counters().get("MED:BG:" + idx));    // bo dem epoch BG tang
        assertTrue(eventRepo.findByTypeAndClosedFalse("BREAK_GLASS").isEmpty()); // moi su kien da dong
        assertEquals(0, events.expireBreakGlass(epochs));                       // goi lai khong bump them

        assertEquals(true, audit.verify().get("ok"));                           // nhat ky chuoi bam toan ven
    }

    @Test
    void directoryHasRetentionWindowWithCurrentWeekFirst() {
        var d = epochs.directory();
        assertEquals(4, d.retention().size());
        assertEquals(d.tag(), d.retention().get(0));
        assertTrue(d.tag().matches("\\d{4}W\\d{2}"));
    }
}
