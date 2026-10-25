package com.medabe.storage.service;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class BreakGlassJob {
    private final EventService events;
    private final EpochService epochs;

    public BreakGlassJob(EventService events, EpochService epochs) { this.events = events; this.epochs = epochs; }

    @Scheduled(fixedDelay = 60_000, initialDelay = 30_000)
    public void run() { events.expireBreakGlass(epochs); }
}
