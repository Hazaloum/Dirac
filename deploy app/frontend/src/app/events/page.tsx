"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronDown, ExternalLink, Loader2, Pill, Search, X } from "lucide-react";
import { api, type EventDetail, type EventExhibitor, type EventSummary, type ExhibitorPortfolio } from "@/lib/api";
import { ddmmyy } from "@/lib/dates";
import { fmtAed } from "@/lib/forecastExport";

const MIDDLE_EAST = "Middle East Region (e.g. UAE)";
const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

const country = (c: string) => (c === "AE" ? "UAE" : c);

/** Pop-up: what a matched exhibitor holds in the master registry, grouped by ATC1, with UAE IQVIA market value. */
function PortfolioModal({ exhibitor, onClose }: { exhibitor: EventExhibitor; onClose: () => void }) {
  const [data, setData] = useState<ExhibitorPortfolio | null>(null);
  const [error, setError] = useState("");
  const [notInUaeOnly, setNotInUaeOnly] = useState(false);
  useEffect(() => {
    api.getExhibitorPortfolio(exhibitor.id).then(setData).catch((err: Error) => setError(err.message));
  }, [exhibitor.id]);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = (data?.groups ?? [])
    .map((g) => ({ ...g, molecules: g.molecules.filter((m) => !notInUaeOnly || !m.in_uae) }))
    .filter((g) => g.molecules.length > 0);
  const all = data?.groups.flatMap((g) => g.molecules) ?? [];
  const notInUae = all.filter((m) => !m.in_uae).length;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-12" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${exhibitor.name} portfolio`} onClick={(ev) => ev.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-surface-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-surface-900">{exhibitor.name}</h2>
            {data?.company && (
              <p className="text-xs text-surface-500">
                Registry company <b className="text-surface-700">{data.company.name}</b> · {data.company.products.toLocaleString()} products ·{" "}
                {plural(data.company.molecules, "molecule")} · registered in {data.company.countries.map(country).join(", ")}
              </p>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-surface-500 hover:bg-surface-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {!data && !error && <p className="flex items-center gap-2 text-sm text-surface-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading portfolio…</p>}
          {data && !data.matched && <p className="text-sm text-surface-500">This exhibitor isn&apos;t matched to a registry company.</p>}
          {data?.matched && (
            <div className="grid gap-5">
              <label className="flex items-center gap-2 text-sm text-surface-700">
                <input type="checkbox" checked={notInUaeOnly} onChange={(ev) => setNotInUaeOnly(ev.target.checked)} className="accent-pharma-700" />
                Not registered in the UAE only ({notInUae} of {all.length})
              </label>
              {groups.map((g) => (
                <section key={g.atc1 ?? "none"} className="grid gap-2">
                  <h3 className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-surface-900">
                    {g.atc1 && <span className="rounded bg-pharma-50 px-1.5 text-xs font-semibold text-pharma-800">{g.atc1}</span>}
                    {g.name}
                    <span className="text-xs font-normal text-surface-500">
                      {plural(g.molecules.length, "molecule")}{g.market_value_aed > 0 ? ` · UAE market ${fmtAed(g.market_value_aed)}` : ""}
                    </span>
                  </h3>
                  <div className="overflow-x-auto rounded-lg border border-surface-200">
                    <table className="w-full text-xs">
                      <thead className="bg-surface-50 text-left text-[11px] uppercase tracking-wider text-surface-500">
                        <tr>
                          <th className="px-2 py-1.5">Molecule</th>
                          <th className="px-2 py-1.5 text-right">UAE market{data.iqvia_year ? ` (IQVIA ${data.iqvia_year})` : ""}</th>
                          <th className="px-2 py-1.5">Registered in</th>
                          <th className="px-2 py-1.5">UAE</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-100">
                        {g.molecules.map((m) => (
                          <tr key={m.molecule}>
                            <td className={`px-2 py-1.5 ${m.matched ? "font-medium text-surface-800" : "text-surface-500"}`}>{m.molecule.replace(/\+/g, " + ")}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-surface-700">{m.market_value_aed ? fmtAed(m.market_value_aed) : <span className="text-surface-400">—</span>}</td>
                            <td className="px-2 py-1.5 text-surface-600">{m.countries.map(country).join(" · ")}</td>
                            <td className="px-2 py-1.5">{m.in_uae
                              ? <span className="rounded-full bg-surface-100 px-1.5 text-[10px] text-surface-600">Registered</span>
                              : <span className="rounded-full bg-emerald-50 px-1.5 text-[10px] font-medium text-emerald-800">Not in UAE</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
              <p className="text-[11px] text-surface-400">From the master registry (EU, US, UAE registers). Market value: UAE IQVIA, combinations divided by their molecule count; — = not sold in the UAE per IQVIA.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ExhibitorRow({ e }: { e: EventExhibitor }) {
  const [open, setOpen] = useState(false);
  const [showPortfolio, setShowPortfolio] = useState(false);
  const inMiddleEast = e.markets.includes(MIDDLE_EAST);
  return (
    <li className="border-b border-surface-100 last:border-b-0">
      <div className="flex items-start gap-2 pr-4 hover:bg-surface-50">
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="grid min-w-0 flex-1 grid-cols-[1fr_auto] items-start gap-3 py-2.5 pl-4 text-left">
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
        {e.company_id && (
          <button onClick={() => setShowPortfolio(true)}
            className="mt-2 flex shrink-0 items-center gap-1 rounded-lg border border-pharma-700 bg-white px-2.5 py-1 text-xs font-medium text-pharma-800 hover:bg-pharma-50">
            <Pill className="h-3.5 w-3.5" /> Portfolio
          </button>
        )}
      </div>
      {showPortfolio && <PortfolioModal exhibitor={e} onClose={() => setShowPortfolio(false)} />}
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
  const [portfolioOnly, setPortfolioOnly] = useState(false);
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
        (!portfolioOnly || e.company_id != null) &&
        (!q || e.name.toLowerCase().includes(q) || e.country.toLowerCase().includes(q) ||
          e.categories.some((c) => c.toLowerCase().includes(q)) || e.description.toLowerCase().includes(q))),
      total: z.exhibitors.length,
    })).filter((z) => z.exhibitors.length > 0);
  }, [event, query, middleEastOnly, portfolioOnly]);
  const filtering = query.trim() !== "" || middleEastOnly || portfolioOnly;
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
            <label className="flex items-center gap-2 text-sm text-surface-700">
              <input type="checkbox" checked={portfolioOnly} onChange={(e) => setPortfolioOnly(e.target.checked)} className="accent-pharma-700" />
              With a registry portfolio only
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
