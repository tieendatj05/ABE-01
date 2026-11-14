package com.medabe.storage.research;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Khi bat luong nghien cuu, DONG cac endpoint ban ghi/header/tra cuu phu huynh CU (chi xac thuc theo thiet bi, khong qua PDP):
 * neu de mo chung se la duong vong qua phan quyen backend. Tat nghien cuu (mac dinh) => khong filter nao ton tai, hanh vi cu giu nguyen.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 5)
@ConditionalOnProperty(prefix = "medabe.research", name = "enabled", havingValue = "true")
public class LegacyDataPlaneGuard extends OncePerRequestFilter {
    private final boolean bridge;
    public LegacyDataPlaneGuard(ResearchProps props) { this.bridge = props.legacyBridge(); }

    boolean blocked(String path) {
        // Cau noi bat: du lieu cu di qua PHIEN TAI KHOAN + PDP, chi con dong DANG KY THIET BI CU (danh tinh = tai khoan, khong con "nhap ten").
        return bridge ? path.equals("/api/register") : legacyDataPlane(path);
    }

    static boolean legacyDataPlane(String path) {
        return path.equals("/api/records") || path.startsWith("/api/records/") || path.equals("/api/headers") || path.startsWith("/api/headers/")
                || path.startsWith("/api/public/parent-");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
        if (blocked(req.getRequestURI())) {
            res.setStatus(410); res.setContentType("application/json"); res.setCharacterEncoding("UTF-8");
            res.getWriter().write("{\"error\":\"LEGACY_DISABLED_IN_RESEARCH_MODE\"}");
            return;
        }
        chain.doFilter(req, res);
    }
}
