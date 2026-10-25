package com.medabe.storage.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "epoch_counters")
public class EpochCounter {
    @Id public String base;
    public int counter;
    public EpochCounter() {}
    public EpochCounter(String base, int counter) { this.base = base; this.counter = counter; }
}
