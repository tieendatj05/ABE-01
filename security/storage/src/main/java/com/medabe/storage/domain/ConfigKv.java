package com.medabe.storage.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "config_kv")
public class ConfigKv {
    @Id public String k;
    @Column(length = 4000) public String v;
    public ConfigKv() {}
    public ConfigKv(String k, String v) { this.k = k; this.v = v; }
}
