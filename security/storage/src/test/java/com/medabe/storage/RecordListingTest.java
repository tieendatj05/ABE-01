package com.medabe.storage;

import static org.junit.jupiter.api.Assertions.assertEquals;
import com.medabe.storage.domain.MedicalRecord;
import com.medabe.storage.domain.Repos;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest(properties = {
    "medabe.pk-json={\"id\":\"MED\"}",
    "medabe.siem-file=target/listing-test-siem.jsonl",
    "spring.datasource.url=jdbc:h2:mem:listingtest;DB_CLOSE_DELAY=-1"
})
class RecordListingTest {
    @Autowired Repos.Records records;
    private MedicalRecord row(String khoa, int second) {
        MedicalRecord r = new MedicalRecord();
        r.id = UUID.randomUUID().toString(); r.patientIdx = "a".repeat(32); r.groupIdx = "b".repeat(32);
        r.type = "lamsang"; r.khoa = khoa; r.authorDevice = "fake-device"; r.envelope = "{}";
        r.createdAt = Instant.parse("2026-01-01T00:00:00Z").plusSeconds(second); r.updatedAt = r.createdAt;
        return records.save(r);
    }
    @Test @Transactional
    void latestListKeepsEverySpecialtyAndOnlyTheNewestVersion() {
        row("Nhi", 1); var mat = row("Mat", 2); var nhi = row("Nhi", 3);
        var out = records.latestByGroupAndType("b".repeat(32), "lamsang");
        assertEquals(2, out.size());
        assertEquals(java.util.Set.of(mat.id, nhi.id), out.stream().map(r -> r.id).collect(java.util.stream.Collectors.toSet()));
    }
}
