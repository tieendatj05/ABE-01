package com.medabe.storage.service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/**
 * Cong goi Gemini (tach interface de TEST bang fake, khong goi mang that). Chi backend goi - KHONG bao gio tu React.
 * Khoa API doc tu cau hinh (bien moi truong), khong ghi vao log/React/Git.
 */
public interface GeminiClient {

    /** Ket qua tho tu Gemini: text (JSON model sinh ra) + httpStatus de phan biet 429 (het quota) voi loi khac. */
    record Result(int httpStatus, String text, String error) {}

    Result generate(String model, String apiKey, String prompt, int timeoutMs);

    /** Trien khai that: goi REST generateContent cua Google Generative Language API. */
    @Component
    class Http implements GeminiClient {
        private final ObjectMapper mapper;
        private final HttpClient http = HttpClient.newHttpClient();

        public Http(ObjectMapper mapper) { this.mapper = mapper; }

        @Override
        public Result generate(String model, String apiKey, String prompt, int timeoutMs) {
            try {
                String url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + apiKey;
                String body = mapper.writeValueAsString(java.util.Map.of(
                        "contents", java.util.List.of(java.util.Map.of("parts", java.util.List.of(java.util.Map.of("text", prompt)))),
                        "generationConfig", java.util.Map.of("responseMimeType", "application/json", "temperature", 0.2)));
                HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                        .timeout(Duration.ofMillis(timeoutMs))
                        .header("content-type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(body)).build();
                HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
                if (res.statusCode() != 200) return new Result(res.statusCode(), null, "HTTP " + res.statusCode());
                // candidates[0].content.parts[0].text
                var tree = mapper.readTree(res.body());
                var text = tree.path("candidates").path(0).path("content").path("parts").path(0).path("text").asString("");
                if (text.isBlank()) return new Result(200, null, "phan hoi rong");
                return new Result(200, text, null);
            } catch (Exception e) {
                return new Result(0, null, e.getClass().getSimpleName() + ": " + e.getMessage());
            }
        }
    }
}
