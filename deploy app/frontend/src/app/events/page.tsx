"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronDown, ExternalLink, Search } from "lucide-react";
import { api, type EventDetail, type EventExhibitor, type EventSummary } from "@/lib/api";
import { ddmmyy } from "@/lib/dates";

const MIDDLE_EAST = "Middle East Region (e.g. UAE)";
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

function ExhibitorRow({ e }: { e: EventExhibitor }) {
  const [open, setOpen] = useState(false);
  const inMiddleEast = e.markets.includes(MIDDLE_EAST);
  return (
    <li className="border-b border-surface-100 last:border-b-0">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="grid w-full grid-cols-[1fr_auto] items-start gap-3 px-4 py-2.5 text-left hover:bg-surface-50">
        <span className="min-w-0">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-medium text-surface-900">{e.name}</span>
            <span className="text-xs text-surface-500">{e.country}</span>
            {e.is_new && <span className="rounded-full bg-sky-50 px-1.5 text-[10px] font-medium text-sky-800">New</span>}
            {inMiddleEast && <span className="rounded-full bg-emerald-50 px-1.5 text-[10px] font-medium text-emerald-800">Active in Middle East</span>}
          </span>
          {e.org_types.length > 0 && <span className="mt-0.5 block truncate text-xs text-surface-500">{e.org_types.join(" · ")}</span>}
        </span>
        <span className="flex items-center gap-2 text-xs tabular-nums text-surface-600">
          {e.booth && <span className="rounded bg-surface-100 px-1.5 py-0.5 font-medium">Booth {e.booth}</span>}
          <ChevronDown className={`h-4 w-4 text-surface-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open && (
        <div className="grid gap-2 px-4 pb-3 text-sm">
          {e.description && <p className="max-w-3xl whitespace-pre-line text-surface-700">{e.description}</p>}
          <dl className="grid gap-1 text-xs text-surface-600 sm:grid-cols-[140px_1fr]">
            {e.categories.length > 0 && <><dt className="text-surface-400">Categories</dt><dd>{e.categories.join(" · ")}</dd></>}
            {e.business_activities.length > 0 && <><dt className="text-surface-400">Business activity</dt><dd>{e.business_activities.join(" · ")}</dd></>}
            {e.markets.length > 0 && <><dt className="text-surface-400">Markets active in</dt><dd>{e.markets.join(" · ")}</dd></>}
            {e.certifications.length > 0 && <><dt className="text-surface-400">Certifications</dt><dd>{e.certifications.join(" · ")}</dd></>}
            {e.employees && <><dt className="text-surface-400">Employees</dt><dd>{e.employees}</dd></>}
            {e.years_exhibiting != null && <><dt className="text-surface-400">Years exhibiting</dt><dd>{e.years_exhibiting}</dd></>}
          </dl>
          {e.profile_url && (
            <a href={e.profile_url} target="_blank" rel="noreferrer"
              className="flex items-center gap-1 justify-self-start text-xs font-medium text-pharma-800 hover:underline">
              CPHI Online profile <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
    </li>
  );
}

export default function EventsPage() {
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [middleEastOnly, setMiddleEastOnly] = useState(false);
  const [openZones, setOpenZones] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.getEvents().then((r) => setEvents(r.events)).catch((e: Error) => setError(e.message));
  }, []);

  async function choose(key: string) {
    setSelected(key); setEvent(null); setLoading(true); setError(""); setQuery("");
    try {
      const ev = await api.getEvent(key);
      setEvent(ev);
      setOpenZones(new Set(ev.zones.slice(0, 1).map((z) => z.zone)));   // first zone (finished dosage) open
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the event");
    } finally {
      setLoading(false);
    }
  }

  const zones = useMemo(() => {
    if (!event) return [];
    const q = query.trim().toLowerCase();
    return event.zones.map((z) => ({
      zone: z.zone,
      exhibitors: z.exhibitors.filter((e) =>
        (!middleEastOnly || e.markets.includes(MIDDLE_EAST)) &&
        (!q || e.name.toLowerCase().includes(q) || e.country.toLowerCase().includes(q) ||
          e.categories.some((c) => c.toLowerCase().includes(q)) || e.description.toLowerCase().includes(q))),
      total: z.exhibitors.length,
    })).filter((z) => z.exhibitors.length > 0);
  }, [event, query, middleEastOnly]);
  const filtering = query.trim() !== "" || middleEastOnly;
  const shown = zones.reduce((n, z) => n + z.exhibitors.length, 0);

  const toggleZone = (zone: string) => setOpenZones((s) => {
    const next = new Set(s);
    if (next.has(zone)) next.delete(zone); else next.add(zone);
    return next;
  });

  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <CalendarDays className="h-7 w-7 text-pharma-700" />
        <h1 className="text-3xl font-semibold text-surface-900">Events</h1>
      </div>

      {error && <div role="alert" className="mb-5 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {!events && !error && <p className="text-surface-500">Loading events…</p>}

      <div className="mb-6 flex flex-wrap gap-3">
        {events?.map((ev) => (
          <button key={ev.key} onClick={() => choose(ev.key)} aria-pressed={selected === ev.key}
            className={`grid gap-0.5 rounded-xl border px-5 py-3 text-left transition-colors ${selected === ev.key ? "border-pharma-700 bg-pharma-50" : "border-surface-300 bg-white hover:border-pharma-300"}`}>
            <span className="text-base font-semibold text-surface-900">{ev.name}</span>
            <span className="text-xs text-surface-500">
              {ev.venue}{ev.venue && ev.city ? ", " : ""}{ev.city} · {ddmmyy(ev.starts_on)}–{ddmmyy(ev.ends_on)}
            </span>
            <span className="text-xs text-surface-500">{plural(ev.exhibitor_count, "exhibitor")}</span>
          </button>
        ))}
      </div>

      {loading && <p className="text-surface-500">Loading exhibitors…</p>}

      {event && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label className="relative min-w-[240px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, country, category or description"
                aria-label="Search exhibitors"
                className="w-full rounded-lg border border-surface-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-pharma-500 focus:outline-none" />
            </label>
            <label className="flex items-center gap-2 text-sm text-surface-700">
              <input type="checkbox" checked={middleEastOnly} onChange={(e) => setMiddleEastOnly(e.target.checked)} className="accent-pharma-700" />
              Active in the Middle East only
            </label>
            <span className="text-xs text-surface-500">
              {plural(shown, "exhibitor")}{filtering ? ` of ${event.exhibitor_count.toLocaleString()}` : ""}
            </span>
          </div>

          <div className="space-y-3">
            {zones.map((z) => {
              const open = filtering || openZones.has(z.zone);
              return (
                <section key={z.zone} className="overflow-hidden rounded-xl border border-surface-300 bg-white">
                  <button onClick={() => toggleZone(z.zone)} aria-expanded={open}
                    className="flex w-full items-center justify-between gap-3 bg-surface-50 px-4 py-3 text-left">
                    <span className="text-sm font-semibold text-surface-900">{z.zone}</span>
                    <span className="flex items-center gap-2 text-xs tabular-nums text-surface-500">
                      {filtering ? `${z.exhibitors.length} of ${z.total}` : z.total}
                      <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
                    </span>
                  </button>
                  {open && <ul>{z.exhibitors.map((e) => <ExhibitorRow key={e.id} e={e} />)}</ul>}
                </section>
              );
            })}
            {zones.length === 0 && <p className="text-sm text-surface-500">No exhibitors match.</p>}
          </div>
          <p className="mt-4 text-xs text-surface-400">
            From the organiser&apos;s exhibitor directory · loaded {ddmmyy(event.synced_at)}
          </p>
        </>
      )}
    </main>
  );
}
