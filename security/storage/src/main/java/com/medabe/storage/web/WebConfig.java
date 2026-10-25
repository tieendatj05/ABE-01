package com.medabe.storage.web;

import java.time.Clock;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Bean
    Clock clock() { return Clock.systemUTC(); }

    /** Token la bearer (khong cookie) nen cho phep goi cheo nguon: giao dien va cac nut noi chuyen truc tiep. */
    @Override
    public void addCorsMappings(CorsRegistry r) {
        r.addMapping("/**").allowedOrigins("*").allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS").allowedHeaders("*");
    }

    /** Loi tra ve dang {"error": "..."} de client TypeScript doc thong nhat. */
    @RestControllerAdvice
    static class Errors {
        @ExceptionHandler(ResponseStatusException.class)
        ResponseEntity<Map<String, String>> status(ResponseStatusException e) {
            return ResponseEntity.status(e.getStatusCode()).body(Map.of("error", String.valueOf(e.getReason())));
        }

        @ExceptionHandler(IllegalArgumentException.class)
        ResponseEntity<Map<String, String>> bad(IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", String.valueOf(e.getMessage())));
        }
    }
}
