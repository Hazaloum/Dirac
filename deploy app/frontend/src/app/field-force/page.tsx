"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Plus, Search, Trash2, Upload, X } from "lucide-react";
import {
  api,
  type FieldAccount,
  type FieldDashboard,
  type FieldForceSetup,
  type RepRole,
} from "@/lib/api";

type Tab = "dashboard" | "setup";

function daysAgo(iso: string | null) {
  if (!iso) return "Never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days === 0 ? "Today" : `${days}d ago`;
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="matthew-panel">
      <div className="flex items-center justify-between gap-3 border-b border-surface-200 px-5 py-3">
        <h2 className="text-sm font-semibold text-surface-900">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

const REASON_LABEL: Record<string, string> = {
  price: "Price", efficacy: "Efficacy", side_effects: "Side effects", competitor: "Uses competitor", not_stocked: "Not stocked nearby",
};

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-surface-500">{children}</p>;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ data }: { data: FieldDashboard }) {
  const t = data.totals;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="matthew-stat"><small>Clients on track</small><strong>{t.on_track}<span className="text-base text-surface-400"> / {t.accounts}</span></strong></div>
        <div className="matthew-stat"><small>Visits · {data.days}d</small><strong>{t.visits}</strong>{t.visits > 0 && <span className="text-xs text-surface-500">{Math.round(t.reached / t.visits * 100)}% reached the client</span>}</div>
        <div className="matthew-stat"><small>Samples · {data.days}d</small><strong>{t.samples}</strong></div>
        <div className="matthew-stat"><small>Orders · {data.days}d</small><strong>{t.orders}</strong></div>
        <div className="matthew-stat"><small>Shelf alerts</small><strong className={t.stock_alerts ? "!text-rose-700" : ""}>{t.stock_alerts}</strong></div>
      </div>

      <Panel title="Reps">
        {data.reps.length === 0 ? <Empty>No active reps yet — add them under Setup.</Empty> : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-surface-500"><tr>
              <th className="pb-2 font-medium">Rep</th><th className="pb-2 font-medium">Coverage</th>
              <th className="pb-2 font-medium">Visits 7d</th><th className="pb-2 font-medium">Visits {data.days}d</th><th className="pb-2 font-medium">Reached</th>
              <th className="pb-2 font-medium">Samples</th><th className="pb-2 font-medium">Orders</th>
            </tr></thead>
            <tbody>{data.reps.map((r) => (
              <tr key={r.rep_id} className="border-t border-surface-100">
                <td className="py-2.5 font-medium text-surface-900">{r.name}</td>
                <td className="py-2.5">
                  {r.coverage_pct == null ? <span className="text-surface-400">No clients</span> : (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 rounded-full bg-surface-100">
                        <div className="h-1.5 rounded-full bg-pharma-700" style={{ width: `${r.coverage_pct}%` }} />
                      </div>
                      <span className="text-xs text-surface-600">{r.on_track}/{r.accounts}</span>
                    </div>
                  )}
                </td>
                <td className="py-2.5">{r.visits_7d}</td><td className="py-2.5">{r.visits}</td>
                <td className="py-2.5">{r.visits ? `${r.reached} (${Math.round(r.reached / r.visits * 100)}%)` : "—"}</td>
                <td className="py-2.5">{r.samples}</td><td className="py-2.5">{r.orders}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Panel>

      <Panel title={`Doctor feedback · ${data.days}d`}>
        {data.feedback.length === 0 ? <Empty>No doctor stances logged yet.</Empty> : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-surface-500"><tr>
              <th className="pb-2 font-medium">Molecule</th><th className="pb-2 font-medium">Doctors</th>
              <th className="pb-2 font-medium">Why not</th>
            </tr></thead>
            <tbody>{data.feedback.map((f) => {
              const total = f.prescribing + f.will_try + f.not_interested;
              return (
                <tr key={f.molecule} className="border-t border-surface-100 align-top">
                  <td className="py-2.5 font-medium text-surface-900">{f.molecule}</td>
                  <td className="py-2.5">
                    <div className="flex h-2 w-40 overflow-hidden rounded-full bg-surface-100">
                      <div className="bg-emerald-600" style={{ width: `${f.prescribing / total * 100}%` }} />
                      <div className="bg-amber-400" style={{ width: `${f.will_try / total * 100}%` }} />
                      <div className="bg-rose-600" style={{ width: `${f.not_interested / total * 100}%` }} />
                    </div>
                    <span className="mt-1 block text-xs text-surface-600">
                      {f.prescribing} prescribing · {f.will_try} will try · {f.not_interested} not interested
                    </span>
                  </td>
                  <td className="py-2.5 text-xs text-surface-600">
                    {f.reasons.length ? f.reasons.map((r) => `${REASON_LABEL[r.reason] ?? r.reason} (${r.count})`).join(" · ") : "—"}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Shelf alerts">
          {data.stock_alerts.length === 0 ? <Empty>No pharmacy reports a low or missing SKU.</Empty> : (
            <ul className="divide-y divide-surface-100">{data.stock_alerts.map((a, i) => (
              <li key={i} className="flex items-center gap-3 py-2 text-sm">
                <span className={`matthew-pill ${a.status === "out" ? "matthew-pill--no" : "matthew-pill--maybe"}`}>{a.status === "out" ? "Out" : "Low"}</span>
                <span className="flex-1"><span className="font-medium text-surface-900">{a.account}</span><span className="block text-xs text-surface-500">{a.sku}</span></span>
                <span className="text-xs text-surface-400">{daysAgo(a.checked_at)}</span>
              </li>
            ))}</ul>
          )}
        </Panel>
        <Panel title="Overdue clients">
          {data.overdue.length === 0 ? <Empty>Every client is within its visit cadence.</Empty> : (
            <ul className="divide-y divide-surface-100">{data.overdue.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span><span className="font-medium text-surface-900">{a.name}</span><span className="block text-xs text-surface-500 capitalize">{a.type}{a.area ? ` · ${a.area}` : ""}</span></span>
                <span className="text-xs text-amber-700">{a.last_visited_at ? `Last seen ${daysAgo(a.last_visited_at)}` : "Never visited"}</span>
              </li>
            ))}</ul>
          )}
        </Panel>
        <Panel title={`Samples by SKU · ${data.days}d`}>
          {data.samples_by_sku.length === 0 ? <Empty>No samples handed out yet.</Empty> : (
            <ul className="divide-y divide-surface-100">{data.samples_by_sku.map((s) => (
              <li key={s.sku} className="flex justify-between py-2 text-sm"><span>{s.sku}</span><span className="font-semibold">{s.quantity}</span></li>
            ))}</ul>
          )}
        </Panel>
        <Panel title={`Orders by SKU · ${data.days}d`}>
          {data.orders_by_sku.length === 0 ? <Empty>No orders taken by reps yet.</Empty> : (
            <ul className="divide-y divide-surface-100">{data.orders_by_sku.map((s) => (
              <li key={s.sku} className="flex justify-between py-2 text-sm"><span>{s.sku}</span><span className="font-semibold">{s.quantity} packs</span></li>
            ))}</ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ─── Setup ────────────────────────────────────────────────────────────────────
function Setup({ setup, accounts, onChange, onError }: {
  setup: FieldForceSetup;
  accounts: FieldAccount[];
  onChange: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [repForm, setRepForm] = useState({ name: "", email: "", password: "", role: "rep" as RepRole, area_ids: [] as number[] });
  const [addingRep, setAddingRep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [areaName, setAreaName] = useState("");
  const [importNote, setImportNote] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try { await work(); await onChange(); }
    catch (e) { onError(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy(false); }
  };

  const areaName_ = (id: number) => setup.areas.find((a) => a.id === id)?.name ?? "?";
  const visibleAccounts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? accounts.filter((a) => `${a.name} ${a.specialty ?? ""} ${a.area_name ?? ""}`.toLowerCase().includes(q)) : accounts;
  }, [accounts, query]);

  const toggleArea = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <div className="space-y-6">
      <Panel title={`Reps (${setup.reps.length})`} action={
        <button onClick={() => setAddingRep((v) => !v)} className="flex items-center gap-1.5 text-xs font-semibold text-pharma-800">
          {addingRep ? <><X className="h-3.5 w-3.5" /> Cancel</> : <><Plus className="h-3.5 w-3.5" /> Add rep</>}
        </button>
      }>
        {addingRep && (
          <form className="mb-5 grid gap-3 rounded-lg border border-surface-200 bg-surface-50 p-4 md:grid-cols-2"
            onSubmit={(e) => { e.preventDefault(); run(async () => { await api.createRep(repForm); setRepForm({ name: "", email: "", password: "", role: "rep", area_ids: [] }); setAddingRep(false); }); }}>
            <input required placeholder="Full name" value={repForm.name} onChange={(e) => setRepForm({ ...repForm, name: e.target.value })} className="rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            <input required type="email" placeholder="Email (their login)" value={repForm.email} onChange={(e) => setRepForm({ ...repForm, email: e.target.value })} className="rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            <input required minLength={8} placeholder="Starting password (8+ characters)" value={repForm.password} onChange={(e) => setRepForm({ ...repForm, password: e.target.value })} className="rounded-lg border border-surface-300 px-3 py-2 text-sm" />
            <select value={repForm.role} onChange={(e) => setRepForm({ ...repForm, role: e.target.value as RepRole })} className="rounded-lg border border-surface-300 px-3 py-2 text-sm">
              <option value="rep">Rep</option><option value="manager">Manager (sees all clients)</option>
            </select>
            <div className="md:col-span-2">
              <p className="mb-1.5 text-xs text-surface-500">Areas</p>
              <div className="flex flex-wrap gap-1.5">{setup.areas.length === 0 ? <span className="text-xs text-surface-400">Add areas below first</span> : setup.areas.map((a) => (
                <button type="button" key={a.id} onClick={() => setRepForm({ ...repForm, area_ids: toggleArea(repForm.area_ids, a.id) })}
                  className={`rounded-full border px-2.5 py-1 text-xs ${repForm.area_ids.includes(a.id) ? "border-pharma-700 bg-pharma-50 text-pharma-900" : "border-surface-300 text-surface-600"}`}>{a.name}</button>
              ))}</div>
            </div>
            <button disabled={busy} className="rounded-lg bg-pharma-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 md:col-span-2">Create rep login</button>
          </form>
        )}
        {setup.reps.length === 0 ? <Empty>No reps yet. Each rep gets their own login for the rep app.</Empty> : (
          <ul className="divide-y divide-surface-100">{setup.reps.map((rep) => (
            <li key={rep.id} className={`flex flex-wrap items-center gap-3 py-3 ${rep.active ? "" : "opacity-50"}`}>
              <div className="min-w-[200px] flex-1">
                <p className="text-sm font-medium text-surface-900">{rep.name} {rep.role === "manager" && <span className="ml-1 text-xs text-pharma-700">Manager</span>}</p>
                <p className="text-xs text-surface-500">{rep.email}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">{setup.areas.map((a) => (
                <button key={a.id} disabled={busy} onClick={() => run(() => api.updateRep(rep.id, { area_ids: toggleArea(rep.area_ids, a.id) }))}
                  className={`rounded-full border px-2.5 py-1 text-xs ${rep.area_ids.includes(a.id) ? "border-pharma-700 bg-pharma-50 text-pharma-900" : "border-surface-200 text-surface-400"}`}>{a.name}</button>
              ))}</div>
              <button disabled={busy} onClick={() => run(() => api.updateRep(rep.id, { active: !rep.active }))} className="text-xs text-surface-500 hover:text-surface-900">
                {rep.active ? "Deactivate" : "Reactivate"}
              </button>
            </li>
          ))}</ul>
        )}
      </Panel>

      <Panel title={`Areas (${setup.areas.length})`}>
        <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (areaName.trim()) run(async () => { await api.createArea(areaName); setAreaName(""); }); }}>
          <input placeholder="e.g. Dubai South" value={areaName} onChange={(e) => setAreaName(e.target.value)} className="flex-1 rounded-lg border border-surface-300 px-3 py-2 text-sm" />
          <button disabled={busy || !areaName.trim()} className="rounded-lg bg-pharma-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Add area</button>
        </form>
        <div className="flex flex-wrap gap-2">{setup.areas.map((a) => (
          <span key={a.id} className="flex items-center gap-1.5 rounded-full border border-surface-300 px-3 py-1 text-xs text-surface-700">
            {a.name}
            <button aria-label={`Delete ${a.name}`} disabled={busy} onClick={() => confirm(`Delete area ${a.name}? Its clients become area-less.`) && run(() => api.deleteArea(a.id))}>
              <Trash2 className="h-3 w-3 text-surface-400 hover:text-rose-700" />
            </button>
          </span>
        ))}</div>
      </Panel>

      <Panel title={`Clients (${accounts.length})`} action={
        <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-pharma-800">
          <Upload className="h-3.5 w-3.5" /> Import list
          <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) run(async () => {
              const r = await api.importFieldAccounts(file);
              setImportNote([`Imported ${r.created} client${r.created === 1 ? "" : "s"}${r.skipped ? `, skipped ${r.skipped} already there` : ""}.`, ...r.errors]);
            });
          }} />
        </label>
      }>
        <p className="mb-3 text-xs text-surface-500">
          Import a CSV or Excel file with columns <code>type</code> (doctor / pharmacy / hospital) and <code>name</code>, plus optional
          {" "}<code>specialty</code>, <code>area</code>, <code>phone</code>, <code>address</code>, <code>rep</code> (rep&apos;s email) and <code>hospital</code>.
        </p>
        {importNote.length > 0 && (
          <div className="mb-4 rounded-lg border border-surface-200 bg-surface-50 p-3 text-xs text-surface-700">
            {importNote.map((line, i) => <p key={i} className={i ? "text-amber-700" : ""}>{line}</p>)}
          </div>
        )}
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-surface-300 px-3 py-2">
          <Search className="h-4 w-4 text-surface-400" />
          <input placeholder="Search clients" value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1 bg-transparent text-sm focus:outline-none" />
        </div>
        {accounts.length === 0 ? <Empty>No clients yet — import your list.</Empty> : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-surface-500"><tr>
              <th className="pb-2 font-medium">Client</th><th className="pb-2 font-medium">Area</th>
              <th className="pb-2 font-medium">Covered by</th><th className="pb-2 font-medium">Last visit</th>
            </tr></thead>
            <tbody>{visibleAccounts.slice(0, 300).map((a) => (
              <tr key={a.id} className="border-t border-surface-100">
                <td className="py-2"><span className="font-medium text-surface-900">{a.name}</span>
                  <span className="block text-xs capitalize text-surface-500">{a.type}{a.specialty ? ` · ${a.specialty}` : ""}{a.created_by_name ? ` · added by ${a.created_by_name}` : ""}</span></td>
                <td className="py-2">
                  <select value={a.area_id ?? ""} disabled={busy} onChange={(e) => run(() => api.updateFieldAccount(a.id, { area_id: e.target.value ? Number(e.target.value) : null }))}
                    className="rounded-md border border-surface-200 bg-white px-2 py-1 text-xs">
                    <option value="">No area</option>
                    {setup.areas.map((ar) => <option key={ar.id} value={ar.id}>{areaName_(ar.id)}</option>)}
                  </select>
                </td>
                <td className="py-2">
                  <select value={a.assigned_rep_id ?? ""} disabled={busy} onChange={(e) => run(() => api.updateFieldAccount(a.id, { assigned_rep_id: e.target.value || null }))}
                    className="rounded-md border border-surface-200 bg-white px-2 py-1 text-xs">
                    <option value="">Rep covering the area</option>
                    {setup.reps.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </td>
                <td className="py-2 text-xs text-surface-500">{daysAgo(a.last_visited_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {visibleAccounts.length > 300 && <p className="mt-2 text-xs text-surface-400">Showing 300 of {visibleAccounts.length} — search to narrow down.</p>}
      </Panel>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function FieldForcePage() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [dashboard, setDashboard] = useState<FieldDashboard | null>(null);
  const [setup, setSetup] = useState<FieldForceSetup | null>(null);
  const [accounts, setAccounts] = useState<FieldAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const [d, s, a] = await Promise.all([api.getFieldDashboard(30), api.getFieldForceSetup(), api.getFieldAccounts()]);
    setDashboard(d);
    setSetup(s);
    setAccounts(a.accounts);
  }, []);

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
  }, [refresh]);

  return (
    <div className="min-h-screen p-8 lg:p-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="matthew-eyebrow mb-3">Medical reps</p>
          <h1 className="matthew-page-title">Field force</h1>
          <p className="matthew-lede mt-3">What the reps are seeing in clinics and pharmacies, and who covers which clients.</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-surface-100 p-1">
          {(["dashboard", "setup"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-md px-4 py-1.5 text-xs font-semibold capitalize ${tab === t ? "bg-white text-pharma-900 shadow-sm" : "text-surface-500"}`}>{t}</button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-6 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError("")} aria-label="Dismiss"><X className="h-4 w-4" /></button>
        </div>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-surface-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading field force…</p>
      ) : tab === "dashboard" ? (
        dashboard && <Dashboard data={dashboard} />
      ) : (
        setup && <Setup setup={setup} accounts={accounts} onChange={refresh} onError={setError} />
      )}
    </div>
  );
}
