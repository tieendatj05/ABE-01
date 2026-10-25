package com.medabe.storage;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.medabe.storage.domain.SecurityEvent;
import com.medabe.storage.service.AiAnalysisService;
import com.medabe.storage.service.GeminiClient;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/**
 * Lop phan tich Gemini: dung GeminiClient GIA (khong goi mang that). Kiem: loc bo bi mat truoc khi gui, JSON hop le => ok,
 * JSON sai => error, 429 => quota, va cache. Khong kiem API that (se huong dan cau hinh khoa rieng).
 */
@SpringBootTest(properties = {
        "medabe.pk-json={\"id\":\"MED\"}",
        "medabe.siem-file=target/test-siem-ai.jsonl",
        "spring.datasource.url=jdbc:h2:mem:aitest;DB_CLOSE_DELAY=-1",
        "medabe.ai-enabled=true",
        "medabe.gemini-api-key=test-key",
        "medabe.ai-max-calls-per-hour=100",
})
class AiAnalysisTest {
    @Autowired AiAnalysisService ai;
    @Autowired FakeGemini fake;

    @TestConfiguration
    static class Cfg {
        @Bean @Primary FakeGemini fakeGemini() { return new FakeGemini(); }
    }

    /** Gemini gia: ghi lai prompt da nhan, tra ve theo "mode" test dat. */
    static class FakeGemini implements GeminiClient {
        volatile String lastPrompt;
        volatile int mode;   // 0=JSON hop le, 1=JSON sai, 2=429
        @Override public Result generate(String model, String apiKey, String prompt, int timeoutMs) {
            lastPrompt = prompt;
            if (mode == 2) return new Result(429, null, "quota");
            if (mode == 1) return new Result(200, "khong phai json", null);
            return new Result(200, "{\"summary\":\"Nghi van ARP spoofing\",\"evidence\":[1],\"alternatives\":[\"DHCP\"],"
                    + "\"missing\":[\"xac nhan tay\"],\"recommendation\":[\"xac minh\"],\"limits\":\"chi la dau hieu\",\"confidence\":\"medium\"}", null);
        }
    }

    private SecurityEvent ev(long id, String detail) {
        SecurityEvent e = new SecurityEvent();
        e.id = id; e.ts = Instant.now(); e.type = "NET_ARP_SUSPECT"; e.severity = "CRITICAL"; e.detail = detail;
        return e;
    }

    @BeforeEach void reset() { fake.mode = 0; fake.lastPrompt = null; ai.resetState(); }

    @Test
    void jsonHopLeThiTraVeOk() {
        Map<String, Object> r = ai.analyze(List.of(ev(1, "IP 10.0.0.39 doi MAC")));
        assertEquals("ok", r.get("state"));
        assertNotNull(r.get("analysis"));
    }

    @Test
    void khongGuiBiMatRaNgoai() {
        String secretGid = "a4fc586c5ec9deadbeef0011223344aa";   // 32 hex giong GID/khoa
        ai.analyze(List.of(ev(2, "Bearer SECRETTOKEN123 cua thiet bi " + secretGid)));
        assertNotNull(fake.lastPrompt);
        assertFalse(fake.lastPrompt.contains("SECRETTOKEN123"), "khong duoc gui Bearer token");
        assertFalse(fake.lastPrompt.contains(secretGid), "khong duoc gui chuoi giong GID/khoa");
        assertTrue(fake.lastPrompt.contains("<redacted>"));
    }

    @Test
    void jsonSaiThiBaoLoiKhongBiaKetQua() {
        fake.mode = 1;
        Map<String, Object> r = ai.analyze(List.of(ev(3, "x")));
        assertEquals("error", r.get("state"));
    }

    @Test
    void quota429ThiBaoQuotaKhongGayLoiHeThong() {
        fake.mode = 2;
        Map<String, Object> r = ai.analyze(List.of(ev(4, "x")));
        assertEquals("quota", r.get("state"));
    }
}
