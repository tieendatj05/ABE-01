package com.medabe.storage.service;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Phần chạy ĐỊNH KỲ của agent bảo vệ (các luật còn lại chạy ngay khi có sự kiện, xem SecurityAgentService.onEvent). */
@Component
public class SecurityAgentJob {
    private final SecurityAgentService agent;

    public SecurityAgentJob(SecurityAgentService agent) { this.agent = agent; }

    @Scheduled(fixedDelay = 120_000, initialDelay = 30_000)
    public void run() { agent.checkAuditIntegrity(); }
}
