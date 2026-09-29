// Helpers for scheduled rides. No native date-picker dependency: the UI offers
// day chips + a list of 15-minute slots. Keep these limits in sync with
// MIN_LEAD_MIN / MAX_ADVANCE_DAYS in backend/server.py.
import dayjs from "dayjs";

export const MIN_LEAD_MIN = 15;
export const MAX_ADVANCE_DAYS = 7;
const SLOT_MIN = 15;

/** Day options for the picker: today, tomorrow, and the next few days. */
export function dayOptions(count = 4) {
  return Array.from({ length: count }).map((_, i) => {
    const d = dayjs().startOf("day").add(i, "day");
    return {
      date: d,
      label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.format("ddd D MMM"),
    };
  });
}

/** Bookable 15-minute slots on a given day (earliest = now + MIN_LEAD_MIN). */
export function slotsForDay(day: dayjs.Dayjs): dayjs.Dayjs[] {
  const earliest = dayjs().add(MIN_LEAD_MIN, "minute");
  const latest = dayjs().add(MAX_ADVANCE_DAYS, "day");
  const out: dayjs.Dayjs[] = [];
  let t = day.startOf("day");
  const end = day.endOf("day");
  while (t.isBefore(end)) {
    if (!t.isBefore(earliest) && !t.isAfter(latest)) out.push(t);
    t = t.add(SLOT_MIN, "minute");
  }
  return out;
}

/** "Today, 7:30 PM" / "Tomorrow, 8:00 AM" / "Fri 2 Oct, 6:15 PM" */
export function formatDeparture(iso?: string | null): string {
  if (!iso) return "";
  const d = dayjs(iso);
  const today = dayjs().startOf("day");
  const diff = d.startOf("day").diff(today, "day");
  const day = diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : d.format("ddd D MMM");
  return `${day}, ${d.format("h:mm A")}`;
}

/** Scheduled rides start early enough that the driver is "on it" this many minutes before. */
export const DUE_SOON_MIN = 30;

export function isScheduled(r?: { scheduled_for?: string | null } | null): boolean {
  return !!r?.scheduled_for;
}

/** True once a scheduled ride is close enough to depart to count as the active run. */
export function isDueSoon(iso?: string | null): boolean {
  if (!iso) return true; // ride-now
  return dayjs(iso).diff(dayjs(), "minute") <= DUE_SOON_MIN;
}
