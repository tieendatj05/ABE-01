package com.medabe.storage.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "invites")
public class InviteEntity {
    @Id public String code;
    public String name;
    public boolean used;
    public InviteEntity() {}
}
