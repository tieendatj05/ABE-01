package com.medabe.storage.research;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Cau hinh mang. zones = "TIEPDON:10.10.10.0/24,NHI:10.10.20.0/24" (ten vung:CIDR). Vung chi la NGU CANH mang (ghi log), khong cap quyen.
 * sameSubnetFallback: "" = tu dong (bat khi KHONG cau hinh zones, de giu hanh vi cu); "true"/"false" = ep.
 */
@ConfigurationProperties(prefix = "medabe.network")
/** proxyClientHeader: ten header chua dia chi khach THAT do cong tin cay (loopback) dat khi truy cap tu xa; trong = khong tin header nao. */
public record NetworkProps(String zones, String sameSubnetFallback, String proxyClientHeader) {}
