package com.medabe.storage.research;

import com.medabe.storage.domain.ConfigKv;
import com.medabe.storage.domain.Repos;
import com.medabe.storage.service.AuditService;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Lich gio lam viec theo ngay trong tuan, tinh bang GIO MAY CHU (Clock) o mui gio cau hinh (mac dinh Asia/Ho_Chi_Minh).
 * Mac dinh: T2-T7 07:00 <= t < 21:00; Chu nhat 07:00 <= t < 17:30. Moi lan sua: kiem hop le, tang version, ghi nhat ky chuoi bam.
 * Day la kiem soat TRUY CAP TRUC TUYEN; khong thu hoi khoa/ban ma da sao chep.
 */
@Service
@ConditionalOnProperty(prefix = "medabe.research", name = "enabled", havingValue = "true")
public class ScheduleService {
    public static final List<String> DAYS = List.of("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN");
    private static final Pattern HHMM = Pattern.compile("^([01]\\d|2[0-3]):[0-5]\\d$");
    private static final String KEY = "research.schedule";

    public record Day(boolean closed, LocalTime open, LocalTime close) {}
    public record Schedule(int version, String zone, Map<String, Day> days, String updatedAt, String updatedBy, String reason) {
        public Map<String, Object> view() {
            Map<String, Object> d = new LinkedHashMap<>();
            for (String k : DAYS) {
                Day x = days.get(k);
                d.put(k, x.closed() ? Map.of("closed", true) : Map.of("open", x.open().toString(), "close", x.close().toString()));
            }
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("version", version); m.put("zone", zone); m.put("days", d);
            m.put("updatedAt", updatedAt); m.put("updatedBy", updatedBy); m.put("reason", reason);
            return m;
        }
    }

    private final Repos.Kv kv;
    private final Clock clock;
    private final ObjectMapper mapper;
    private final AuditService audit;
    private final ZoneId zone;
    private final ResearchProps props;
    private volatile Schedule cache;

    public ScheduleService(Repos.Kv kv, Clock clock, ObjectMapper mapper, AuditService audit, ResearchProps props) {
        this.kv = kv; this.clock = clock; this.mapper = mapper; this.audit = audit; this.zone = ZoneId.of(props.zone()); this.props = props;
    }

    public Instant now() { return clock.instant(); }
    public ZoneId zone() { return zone; }

    static Map<String, Day> defaults() {
        Map<String, Day> d = new LinkedHashMap<>();
        for (String k : DAYS) d.put(k, "SUN".equals(k) ? new Day(false, LocalTime.of(7, 0), LocalTime.of(17, 30)) : new Day(false, LocalTime.of(7, 0), LocalTime.of(21, 0)));
        return d;
    }

    public synchronized Schedule current() {
        if (cache != null) return cache;
        Optional<ConfigKv> row = kv.findById(KEY);
        if (row.isEmpty()) {
            if (props.initialSchedule() != null && !props.initialSchedule().isBlank()) {
                Map<String, Map<String, Object>> init = mapper.readValue(props.initialSchedule(), new tools.jackson.core.type.TypeReference<Map<String, Map<String, Object>>>() {});
                return cache = new Schedule(1, zone.getId(), parseDays(init), now().toString(), "system", "lich khoi tao theo cau hinh");
            }
            return cache = new Schedule(1, zone.getId(), defaults(), now().toString(), "system", "lich mac dinh");
        }
        JsonNode n = mapper.readTree(row.get().v);
        Map<String, Day> days = new LinkedHashMap<>();
        for (String k : DAYS) {
            JsonNode x = n.get("days").get(k);
            days.put(k, x.path("closed").asBoolean(false) ? new Day(true, null, null) : new Day(false, LocalTime.parse(x.get("open").stringValue()), LocalTime.parse(x.get("close").stringValue())));
        }
        return cache = new Schedule(n.get("version").asInt(), n.get("zone").stringValue(), days, n.path("updatedAt").asString(""), n.path("updatedBy").asString(""), n.path("reason").asString(""));
    }

    private Day dayOf(Schedule s, ZonedDateTime t) { return s.days().get(DAYS.get(t.getDayOfWeek().getValue() - 1)); }

    public boolean isOpen(Instant at) {
        ZonedDateTime t = at.atZone(zone);
        Day d = dayOf(current(), t);
        if (d.closed()) return false;
        LocalTime lt = t.toLocalTime();
        return !lt.isBefore(d.open()) && lt.isBefore(d.close());
    }
    public boolean isOpenNow() { return isOpen(now()); }

    /** Thoi diem dong cua cua khung gio dang mo (rong neu dang dong). */
    public Optional<Instant> closesAt(Instant at) {
        if (!isOpen(at)) return Optional.empty();
        ZonedDateTime t = at.atZone(zone);
        return Optional.of(t.toLocalDate().atTime(dayOf(current(), t).close()).atZone(zone).toInstant());
    }

    /** Thoi diem mo cua ke tiep (rong neu khong co trong 8 ngay toi). */
    public Optional<Instant> nextOpen(Instant at) {
        ZonedDateTime t = at.atZone(zone);
        Schedule s = current();
        for (int i = 0; i <= 8; i++) {
            ZonedDateTime day = t.plusDays(i);
            Day d = dayOf(s, day);
            if (d.closed()) continue;
            Instant open = day.toLocalDate().atTime(d.open()).atZone(zone).toInstant();
            if (open.isAfter(at)) return Optional.of(open);
        }
        return Optional.empty();
    }

    /** ISO-8601 co offset (2026-11-02T07:00:00+07:00) - JS/TypeScript parse duoc; khong kem [tenMuiGio] nhu ZonedDateTime.toString(). */
    private String iso(Instant i) { return java.time.format.DateTimeFormatter.ISO_OFFSET_DATE_TIME.format(i.atZone(zone)); }

    public Map<String, Object> status() {
        Instant at = now();
        Schedule s = current();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("now", iso(at));
        m.put("zone", zone.getId());
        m.put("businessOpen", isOpen(at));
        m.put("scheduleVersion", s.version());
        m.put("closesAt", closesAt(at).map(this::iso).orElse(null));
        m.put("nextOpenAt", isOpen(at) ? null : nextOpen(at).map(this::iso).orElse(null));
        return m;
    }

    private static LocalTime parse(String field, Object v) {
        if (!(v instanceof String str) || !HHMM.matcher(str).matches()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SCHEDULE_INVALID: " + field + " phai la HH:mm (00:00-23:59)");
        return LocalTime.parse(str);
    }

    /** Sua lich. days: {MON:{open,close}|{closed:true}, ...} du 7 ngay. expectedVersion chong ghi de dong thoi. */
    public synchronized Schedule update(Integer expectedVersion, Map<String, Map<String, Object>> in, String actor, String reason) {
        Schedule old = current();
        if (expectedVersion == null || expectedVersion != old.version())
            throw new ResponseStatusException(HttpStatus.CONFLICT, "SCHEDULE_VERSION_CONFLICT: phien ban hien tai la " + old.version());
        if (reason == null || reason.trim().length() < 5) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SCHEDULE_INVALID: can ly do toi thieu 5 ky tu");
        Map<String, Day> days = parseDays(in);
        Schedule nu = new Schedule(old.version() + 1, zone.getId(), days, now().toString(), actor, reason.trim());
        return persist(old, nu);
    }

    static Map<String, Day> parseDays(Map<String, Map<String, Object>> in) {
        if (in == null || in.size() != 7 || !in.keySet().containsAll(DAYS)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SCHEDULE_INVALID: can du 7 ngay MON..SUN");
        Map<String, Day> days = new LinkedHashMap<>();
        for (String k : DAYS) {
            Map<String, Object> x = in.get(k);
            if (x == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SCHEDULE_INVALID: thieu ngay " + k);
            if (Boolean.TRUE.equals(x.get("closed"))) { days.put(k, new Day(true, null, null)); continue; }
            LocalTime o = parse(k + ".open", x.get("open")), c = parse(k + ".close", x.get("close"));
            if (!o.isBefore(c)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SCHEDULE_INVALID: " + k + " gio mo phai nho hon gio dong");
            if (Duration.between(o, c).toMinutes() < 30) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "SCHEDULE_INVALID: " + k + " khung gio toi thieu 30 phut");
            days.put(k, new Day(false, o, c));
        }
        return days;
    }

    private Schedule persist(Schedule old, Schedule nu) {
        String actor = nu.updatedBy();
        Map<String, Object> store = new LinkedHashMap<>(nu.view());
        kv.save(new ConfigKv(KEY, mapper.writeValueAsString(store)));
        cache = nu;
        audit.log(actor, "v2.schedule.update", "v" + old.version() + "->v" + nu.version() + " ly do=" + nu.reason()
                + " truoc=" + mapper.writeValueAsString(old.view().get("days")) + " sau=" + mapper.writeValueAsString(nu.view().get("days")));
        return nu;
    }

    /** Kiem thu/khoi dong lai: bo bo nho dem de doc lai tu CSDL. */
    public synchronized void reload() { cache = null; }

    public DayOfWeek dayOfWeekNow() { return now().atZone(zone).getDayOfWeek(); }
}
