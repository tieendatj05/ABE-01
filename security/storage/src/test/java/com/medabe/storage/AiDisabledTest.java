package com.medabe.storage;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.medabe.storage.domain.SecurityEvent;
import com.medabe.storage.service.AiAnalysisService;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/** AI TAT mac dinh: analyze tra ve state "disabled" va KHONG lam gi them (luat bao ve van chay doc lap). */
@SpringBootTest(properties = {
        "medabe.pk-json={\"id\":\"MED\"}",
        "medabe.siem-file=target/test-siem-aioff.jsonl",
        "spring.datasource.url=jdbc:h2:mem:aiofftest;DB_CLOSE_DELAY=-1",
})
class AiDisabledTest {
    @Autowired AiAnalysisService ai;

    @Test
    void aiTatThiTraVeDisabled() {
        SecurityEvent e = new SecurityEvent();
        e.id = 1L; e.ts = Instant.now(); e.type = "NET_ARP_SUSPECT"; e.severity = "CRITICAL"; e.detail = "x";
        Map<String, Object> r = ai.analyze(List.of(e));
        assertEquals("disabled", r.get("state"));
        assertEquals("disabled", ai.status().get("state"));
    }
}
