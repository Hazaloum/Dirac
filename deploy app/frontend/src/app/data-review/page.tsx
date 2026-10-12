"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { ClipboardCheck, Loader2, Play } from "lucide-react";
import { api, type CompanyPair, type RegistryChange, type RegistryReview, type RegistryRun, type UnmatchedIngredient } from "@/lib/api";
import { ddmmyy, ddmmyyTime } from "@/lib/dates";

const COUNTRY: Record<string, string> = {
  AE: "UAE", AT: "Austria", BE: "Belgium", BG: "Bulgaria", CZ: "Czechia", ES: "Spain", FR: "France", HU: "Hungary", IE: "Ireland",
  IT: "Italy", NL: "Netherlands", OM: "Oman", PL: "Poland", RO: "Romania", SE: "Sweden", SK: "Slovakia", US: "United States",
};
const regCountry = (key: string) => COUNTRY[key.slice(0, 2).toUpperCase()] ?? key;
const n = (v: number | null | undefined) => (v ?? 0).toLocaleString();
const countries = (c: string | null) => (c ? c.split(",").map((x) => (x === "AE" ? "UAE" : x)).join(" · ") : "—");

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold text-surface-900">{title}</h2>
      {sub && <p className="mb-3 text-xs text-surface-500">{sub}</p>}
      {children}
    </section>
  );
}

function RunChanges({ run }: { run: RegistryRun }) {
  const [kind, setKind] = useState("new");
  const [rows, setRows] = useState<RegistryChange[] | null>(null);
  useEffect(() => {
    setRows(null);
    api.getRunChanges(run.id, kind).then(setRows).catch(() => setRows([]));
  }, [run.id, kind]);
  const tabs: [string, string, number | null][] = [["new", "New", run.added], ["changed", "Changed", run.changed], ["withdrawn", "Withdrawn", run.withdrawn], ["reactivated", "Back", run.reactivated]];
  return (
    <div className="bg-surface-50 px-4 py-3">
      <div className="mb-2 flex gap-1">
        {tabs.map(([k, label, count]) => (
          <button key={k} onClick={() => setKind(k)}
            className={`rounded-md px-3 py-1 text-xs ${kind === k ? "bg-white font-medium text-surface-900 shadow-sm" : "text-surface-600"}`}>
            {label} ({n(count)})
          </button>
        ))}
      </div>
      {!rows && <p className="text-xs text-surface-500">Loading…</p>}
      {rows && !rows.length && <p className="text-xs text-surface-500">Nothing here.</p>}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-surface-200 text-sm">
          {rows.map((r) => (
            <li key={`${r.registration_id}-${r.kind}`} className="py-1.5">
              <span className="text-surface-900">{r.product_name}</span>
              {r.strength_raw && <span className="text-surface-500"> · {r.strength_raw}</span>}
              <span className="text-surface-600"> · {r.company_raw ?? "—"}</span>
              <span className="capitalize text-surface-500"> · {(r.combo_key ?? r.molecule_raw ?? "").split("+").join(" + ")}</span>
              {r.kind === "changed" && r.changes && (
                <div className="text-xs text-surface-500">
                  {Object.entries(r.changes).map(([field, [from, to]]) => (
                    <span key={field} className="mr-3">{field}: <s>{from ?? "—"}</s> → <b className="text-surface-700">{to ?? "—"}</b></span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {rows && rows.length >= 200 && <p className="mt-1 text-xs text-surface-500">Showing the first 200.</p>}
    </div>
  );
}

function PairRow({ pair, onDone }: { pair: CompanyPair; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const decide = (verdict: "same" | "different") => {
    setBusy(true);
    api.decideCompanyPair(pair.a, pair.b, verdict).then(onDone).catch((e: Error) => { alert(e.message); setBusy(false); });
  };
  const side = (name: string, c: string | null, products: number, ex: string | null) => (
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium text-surface-900">{name}</p>
      <p className="text-xs text-surface-500">{countries(c)} · {n(products)} products</p>
      {ex && <p className="truncate text-xs capitalize text-surface-500">{ex.split("+").join(" + ")}</p>}
    </div>
  );
  return (
    <li className="flex flex-wrap items-center gap-4 py-3">
      {side(pair.a_name, pair.a_countries, pair.a_products, pair.a_examples)}
      <span className="text-xs text-surface-400">vs</span>
      {side(pair.b_name, pair.b_countries, pair.b_products, pair.b_examples)}
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => decide("same")} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 disabled:opacity-50">Same company</button>
        <button disabled={busy} onClick={() => decide("different")} className="rounded-lg border border-surface-300 bg-white px-3 py-1.5 text-xs font-medium text-surface-700 disabled:opacity-50">Different</button>
      </div>
    </li>
  );
}

function IngredientRow({ item, onDone }: { item: UnmatchedIngredient; onDone: () => void }) {
  const [inn, setInn] = useState(item.ai_answer ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = (value: string | null) => {
    setBusy(true); setErr("");
    api.decideMolecule(item.alias, value).then(onDone).catch((e: Error) => { setErr(e.message); setBusy(false); });
  };
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-[220px] flex-1">
        <p className="text-sm font-medium text-surface-900">{item.example}</p>
        <p className="text-xs text-surface-500">{n(item.products)} products · {countries(item.countries)}</p>
      </div>
      <input value={inn} onChange={(e) => setInn(e.target.value)} placeholder="English INN, e.g. amlodipine"
        className="w-56 rounded-lg border border-surface-300 px-3 py-1.5 text-sm focus:border-pharma-300 focus:outline-none" />
      <button disabled={busy || !inn.trim()} onClick={() => save(inn.trim())} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 disabled:opacity-50">Match</button>
      <button disabled={busy} onClick={() => save(null)} className="rounded-lg border border-surface-300 bg-white px-3 py-1.5 text-xs font-medium text-surface-700 disabled:opacity-50">Not a molecule</button>
      {err && <p className="w-full text-xs text-rose-700">{err}</p>}
    </li>
  );
}

export default function DataReviewPage() {
  const [data, setData] = useState<RegistryReview | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(() => {
    api.getRegistryReview().then(setData).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!data?.running) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [data?.running, load]);

  const runNow = () => {
    setStarting(true);
    api.runRegistryReview().then(() => setTimeout(load, 1500)).catch((e: Error) => setError(e.message)).finally(() => setStarting(false));
  };
  const drop = (pred: (d: RegistryReview) => RegistryReview) => setData((d) => (d ? pred(d) : d));
  const last = data?.reviews[0];

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <ClipboardCheck className="h-7 w-7 text-pharma-700" />
        <h1 className="text-3xl font-semibold text-surface-900">Registry review</h1>
        <button onClick={runNow} disabled={starting || data?.running}
          className="ml-auto inline-flex items-center gap-2 rounded-xl bg-pharma-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {data?.running || starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {data?.running ? "Review running…" : "Run review now"}
        </button>
      </div>
      {error && <div role="alert" className="mb-5 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {!data && !error && <p className="text-surface-500">Loading…</p>}

      {data && (
        <>
          <div className="mb-8 grid gap-3 sm:grid-cols-4">
            {[["Company pairs waiting for AI", data.counts.companies_waiting], ["Company pairs for you", data.counts.companies_unsure],
              ["Ingredients waiting for AI", data.counts.molecules_waiting], ["Ingredients for you", data.counts.molecules_unsure]].map(([label, v]) => (
              <div key={label as string} className="rounded-xl border border-surface-200 bg-white p-4">
                <p className="text-2xl font-semibold text-surface-900">{n(v as number)}</p>
                <p className="text-xs text-surface-500">{label}</p>
              </div>
            ))}
          </div>
          <p className="-mt-5 mb-8 text-xs text-surface-500">
            The AI review runs by itself after each monthly registry refresh, until both queues are empty.{" "}
            {last && (last.error
              ? <span className="text-rose-700">Last run {ddmmyyTime(last.started_at)} failed: {last.error}</span>
              : <>Last run {ddmmyyTime(last.started_at)}{last.finished_at ? "" : " (still running)"}: {n(last.companies_judged)} company pairs judged, {n(last.companies_merged)} merged; {n(last.molecules_judged)} ingredients judged, {n(last.molecules_matched)} matched.</>)}
          </p>

          <Section title="Monthly registry updates" sub="Each refresh compares the new file with what's stored: new products, changed details (holder, status, strength), and products that disappeared (marked withdrawn, never deleted). Click a row to see them.">
            {!data.runs.length && <p className="text-sm text-surface-500">No refresh has run yet. The first monthly run fills this in.</p>}
            {data.runs.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-surface-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-surface-50 text-left text-xs text-surface-500">
                    <tr>{["Country", "Run", "File date", "New", "Changed", "Withdrawn", "Back", "New companies", "Status"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-surface-100">
                    {data.runs.map((r) => (
                      <Fragment key={r.id}>
                        <tr onClick={() => setOpen(open === r.id ? null : r.id)} className="cursor-pointer hover:bg-surface-50">
                          <td className="px-3 py-2 text-surface-900">{regCountry(r.registry)}</td>
                          <td className="px-3 py-2 text-surface-600">{ddmmyy(r.started_at)}</td>
                          <td className="px-3 py-2 text-surface-600">{ddmmyy(r.snapshot_date)}</td>
                          <td className="px-3 py-2 text-emerald-700">+{n(r.added)}</td>
                          <td className="px-3 py-2">{n(r.changed)}</td>
                          <td className="px-3 py-2 text-rose-700">{n(r.withdrawn)}</td>
                          <td className="px-3 py-2">{n(r.reactivated)}</td>
                          <td className="px-3 py-2">{n(r.new_companies)}</td>
                          <td className="px-3 py-2">
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${r.status === "applied" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : r.status === "skipped" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-surface-200 bg-surface-50 text-surface-600"}`} title={r.note ?? ""}>
                              {r.status}
                            </span>
                          </td>
                        </tr>
                        {open === r.id && (
                          <tr><td colSpan={9}>{r.status === "skipped" ? <p className="bg-amber-50 px-4 py-3 text-xs text-amber-900">{r.note}</p> : <RunChanges run={r} />}</td></tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Companies to check" sub="Pairs the AI wasn't sure about. Same company merges them (reversible: nothing is deleted); either answer is remembered.">
            {!data.company_pairs.length ? <p className="text-sm text-surface-500">Nothing to check.</p> : (
              <ul className="divide-y divide-surface-200 rounded-xl border border-surface-200 bg-white px-4">
                {data.company_pairs.map((p) => (
                  <PairRow key={`${p.a}-${p.b}`} pair={p}
                    onDone={() => drop((d) => ({ ...d, company_pairs: d.company_pairs.filter((x) => x.a !== p.a || x.b !== p.b) }))} />
                ))}
              </ul>
            )}
          </Section>

          <Section title="Ingredients to check" sub="Ingredient names no rule or AI answer could match to a WHO molecule, most products first. Type the English INN (salt left off) or mark it as not a molecule.">
            {!data.molecules.length ? <p className="text-sm text-surface-500">Nothing to check.</p> : (
              <ul className="divide-y divide-surface-200 rounded-xl border border-surface-200 bg-white px-4">
                {data.molecules.map((m) => (
                  <IngredientRow key={m.alias} item={m}
                    onDone={() => drop((d) => ({ ...d, molecules: d.molecules.filter((x) => x.alias !== m.alias) }))} />
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </main>
  );
}
