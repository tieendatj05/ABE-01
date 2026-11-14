package com.medabe.storage.web;

import com.medabe.storage.domain.KeyHeaderEntity;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Lich su (toi da {@value #MAX} phien ban gan nhat) cua header khoa chung. May chu KHONG co DEK nen khong the kiem tra khoa boc trong header moi co dung hay khong:
 * mot nguoi doc hop le co the ghi de bang khoa boc rac va lam ca lo khong mo duoc voi nguoi doc khac. Lich su + khoi phuc boi quan tri (co ly do, co nhat ky)
 * la cach khac phuc duoc (khong ngan duoc). Luu trong cot prevJson (khong doi cau truc CSDL); gia tri cu la MOT doi tuong duoc xem nhu mot phan tu.
 */
@Service
public class KeyHeaderHistory {
    public static final int MAX = 5;
    private final ObjectMapper mapper;

    public KeyHeaderHistory(ObjectMapper mapper) { this.mapper = mapper; }

    public Map<String, Object> view(KeyHeaderEntity h) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", h.id); m.put("policy", h.policy); m.put("abe", mapper.readTree(h.abe));
        m.put("wrapIv", h.wrapIv); m.put("wrappedDek", h.wrappedDek);
        return m;
    }

    /** Dua phien ban HIEN TAI vao dau lich su (goi TRUOC khi ghi de). `by` = tai khoan thuc hien viec ghi de. Tra ve chuoi JSON de gan vao prevJson. */
    public String push(KeyHeaderEntity h, String by) {
        ArrayNode arr = mapper.createArrayNode();
        ObjectNode cur = mapper.createObjectNode();
        cur.put("at", Instant.now().toString()); cur.put("by", by == null ? "" : by); cur.set("version", mapper.valueToTree(view(h)));
        arr.add(cur);
        for (JsonNode n : list(h)) { if (arr.size() >= MAX) break; arr.add(n); }
        return mapper.writeValueAsString(arr);
    }

    /** Cac phien ban truoc, moi nhat dau. Moi phan tu: at (luc bi thay), by (tai khoan lam viec thay), version. */
    public List<JsonNode> list(KeyHeaderEntity h) {
        List<JsonNode> out = new ArrayList<>();
        if (h.prevJson == null || h.prevJson.isBlank()) return out;
        JsonNode old = mapper.readTree(h.prevJson);
        if (old.isArray()) { for (JsonNode n : old) out.add(n); }
        else if (old.isObject()) { ObjectNode legacy = mapper.createObjectNode(); legacy.put("at", ""); legacy.put("by", ""); legacy.set("version", old); out.add(legacy); }
        return out;
    }

    /** Khoi phuc phien ban `index` cua lich su. Phien ban hien tai duoc dua vao lich su nen viec khoi phuc cung hoan tac duoc. */
    public void restore(KeyHeaderEntity h, int index, String by) {
        List<JsonNode> hist = list(h);
        if (index < 0 || index >= hist.size()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "KHONG_CO_PHIEN_BAN");
        JsonNode v = hist.get(index).path("version");
        if (!v.path("abe").isObject() || !v.path("wrapIv").isString() || !v.path("wrappedDek").isString() || !v.path("policy").isString())
            throw new ResponseStatusException(HttpStatus.CONFLICT, "PHIEN_BAN_HONG");
        String newHist = push(h, by);
        h.policy = v.path("policy").asString(); h.abe = mapper.writeValueAsString(v.path("abe"));
        h.wrapIv = v.path("wrapIv").asString(); h.wrappedDek = v.path("wrappedDek").asString();
        h.updatedAt = Instant.now(); h.prevJson = newHist;
    }
}
