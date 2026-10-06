"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, Handshake, Loader2, Paperclip, Plus, Trash2, X } from "lucide-react";
import {
  api, type Deal, type DealBoard, type DealDetail, type DealField, type DealMah, type DealPortfolioResult, type DealStage, type DealStatus,
} from "@/lib/api";
import { ddmmyy } from "@/lib/dates";

const title = (m: string) => m.charAt(0) + m.slice(1).toLowerCase();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

const STATUS_LABEL: Record<DealStatus, string> = { active: "Active", on_hold: "On hold", dropped: "Dropped" };
const MAH_LABEL: Record<DealMah, string> = { "": "Not decided", comix: "COMIX", partner_agent: "Partner's local agent" };

/** Empty fields left behind in stages before the deal's current one. */
function gapsBefore(deal: Deal, stages: DealStage[]) {
  const at = stages.findIndex((s) => s.key === deal.stage);
  return stages.slice(0, Math.max(at, 0)).reduce((n, s) => n + s.fields.length - (deal.filled[s.key] ?? 0), 0);
}

// ─── Card ─────────────────────────────────────────────────────────────────────
function DealCard({ deal, stage, stages, onOpen }: {
  deal: Deal; stage: DealStage; stages: DealStage[]; onOpen: () => void;
}) {
  const total = stage.fields.length;
  const have = deal.filled[stage.key] ?? 0;
  const gaps = gapsBefore(deal, stages);
  const days = daysSince(deal.stage_entered_at);
  const border = deal.status === "on_hold" ? "border-l-4 border-l-amber-500" : "";
  return (
    <button
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", String(deal.id))}
      onClick={onOpen}
      className={`grid w-full gap-1.5 rounded-lg border border-surface-200 bg-white p-3 text-left shadow-sm transition-colors hover:border-pharma-300 ${border} ${deal.status === "dropped" ? "opacity-60" : ""}`}
    >
      <span className={`text-sm font-semibold text-surface-900 ${deal.status === "dropped" ? "line-through" : ""}`}>{title(deal.molecule)}</span>
      <span className="text-xs text-surface-500">{deal.partner || "No partner yet"}</span>
      <span className="flex flex-wrap gap-1">
        {deal.area && <span className="rounded-full bg-pharma-50 px-2 py-0.5 text-[11px] text-pharma-800">{deal.area.split(" ")[0]}</span>}
        {deal.status !== "active" && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${deal.status === "on_hold" ? "bg-amber-50 text-amber-800" : "bg-rose-50 text-rose-700"}`}>
            {STATUS_LABEL[deal.status]}{deal.status_reason ? ` · ${deal.status_reason}` : ""}
          </span>
        )}
      </span>
      {total > 0 && (
        <span className="flex items-center gap-2 text-[11px] tabular-nums text-surface-500">
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-200">
            <span className="block h-full bg-pharma-700" style={{ width: `${(have / total) * 100}%` }} />
          </span>
          {have}/{total}
        </span>
      )}
      <span className="flex justify-between gap-2 text-[11px] text-surface-500">
        <span>
          {plural(days, "day")} in stage
          {deal.documents > 0 && <> · <Paperclip className="inline h-3 w-3" /> {deal.documents}</>}
        </span>
        {gaps > 0 && <span className="text-amber-700">{gaps} gaps earlier</span>}
      </span>
    </button>
  );
}

// ─── Inputs that save when you leave them ─────────────────────────────────────
const inputCls = "w-full rounded-lg border border-surface-300 bg-white px-2.5 py-1.5 text-sm text-surface-900 focus:border-pharma-500 focus:outline-none";

function FieldInput({ field, value, onSave }: { field: DealField; value: string; onSave: (v: string) => Promise<void> }) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(value), [value]);

  async function save(v: string) {
    if (v.trim() === value) return;
    setSaving(true);
    try { await onSave(v); } finally { setSaving(false); }
  }

  const id = `deal-field-${field.key}`;
  let control: JSX.Element;
  if (field.type.startsWith("choice:")) {
    const options = field.type.slice(7).split("|");
    control = (
      <select id={id} className={inputCls} value={draft} onChange={(e) => { setDraft(e.target.value); save(e.target.value); }}>
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (field.type === "longtext") {
    control = <textarea id={id} rows={3} className={inputCls} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => save(draft)} />;
  } else {
    control = (
      <input id={id} type={field.type === "date" ? "date" : "text"} className={inputCls} value={draft}
        onChange={(e) => setDraft(e.target.value)} onBlur={() => save(draft)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
    );
  }
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="flex items-center gap-1.5 text-xs text-surface-600">
        {field.label}
        {saving && <Loader2 className="h-3 w-3 animate-spin" />}
      </label>
      {control}
    </div>
  );
}

// ─── Drawer ───────────────────────────────────────────────────────────────────
function DealDrawer({ deal, stages, reasons, onChange, onClose, onDeleted }: {
  deal: DealDetail; stages: DealStage[]; reasons: string[];
  onChange: (d: DealDetail) => void; onClose: () => void; onDeleted: (id: number) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [partner, setPartner] = useState(deal.partner);
  const [notes, setNotes] = useState(deal.notes);
  const [open, setOpen] = useState<string>(deal.stage);
  const uploadStage = useRef<string>("");
  const fileInput = useRef<HTMLInputElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => { setPartner(deal.partner); setNotes(deal.notes); }, [deal.id, deal.partner, deal.notes]);
  useEffect(() => { setOpen(deal.stage); setConfirmDelete(false); }, [deal.id, deal.stage]);
  useEffect(() => { closeBtn.current?.focus(); }, [deal.id]);

  async function run(call: () => Promise<DealDetail>) {
    setError("");
    try { onChange(await call()); } catch (e) { setError(errorText(e)); throw e; }
  }
  const update = (body: Parameters<typeof api.updateDeal>[1]) => run(() => api.updateDeal(deal.id, body)).catch(() => {});
  const move = (stage: string) => { setBusy(true); run(() => api.moveDeal(deal.id, stage)).catch(() => {}).finally(() => setBusy(false)); };

  async function upload(file: File) {
    setBusy(true);
    await run(() => api.uploadDealDocument(deal.id, uploadStage.current, file)).catch(() => {});
    setBusy(false);
  }
  async function removeDoc(docId: number) {
    setError("");
    try { await api.deleteDealDocument(docId); onChange(await api.getDeal(deal.id)); } catch (e) { setError(errorText(e)); }
  }
  async function remove() {
    setBusy(true); setError("");
    try { await api.deleteDeal(deal.id); onDeleted(deal.id); } catch (e) { setError(errorText(e)); setBusy(false); }
  }

  const at = stages.findIndex((s) => s.key === deal.stage);
  const stageName = (key: string | null) => stages.find((s) => s.key === key)?.name ?? key ?? "—";

  return (
    <aside className="fixed inset-y-0 right-0 z-40 grid w-full max-w-[480px] content-start gap-5 overflow-y-auto border-l border-surface-200 bg-white px-5 py-6 shadow-xl" aria-label={`${title(deal.molecule)} deal`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-surface-900">{title(deal.molecule)}</h2>
          <p className="text-xs text-surface-500">{deal.area ?? "Not in IQVIA"} · in {stageName(deal.stage)} for {plural(daysSince(deal.stage_entered_at), "day")}</p>
        </div>
        <button ref={closeBtn} onClick={onClose} className="rounded-lg border border-surface-300 p-1.5 text-surface-600 hover:bg-surface-100" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-3 text-sm">
        <div className="grid gap-1">
          <label htmlFor="deal-partner" className="text-xs text-surface-600">Partner (manufacturer)</label>
          <input id="deal-partner" className={inputCls} value={partner} placeholder="Who you're licensing from"
            onChange={(e) => setPartner(e.target.value)}
            onBlur={() => partner.trim() !== deal.partner && update({ partner })}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        </div>
        <div className="grid gap-1">
          <label htmlFor="deal-mah" className="text-xs text-surface-600">Marketing authorisation holder</label>
          <select id="deal-mah" className={inputCls} value={deal.mah} onChange={(e) => update({ mah: e.target.value as DealMah })}>
            {(Object.keys(MAH_LABEL) as DealMah[]).map((k) => <option key={k} value={k}>{MAH_LABEL[k]}</option>)}
          </select>
        </div>
        <div className="grid gap-1">
          <span className="text-xs text-surface-600">Status</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(STATUS_LABEL) as DealStatus[]).map((s) => (
              <button key={s} aria-pressed={deal.status === s}
                onClick={() => deal.status !== s && update({ status: s, ...(s !== "active" && !deal.status_reason ? { status_reason: reasons[0] } : {}) })}
                className={`rounded-lg border px-3 py-1 text-xs font-medium ${deal.status === s ? "border-surface-900 bg-surface-900 text-white" : "border-surface-300 text-surface-700 hover:bg-surface-100"}`}>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        {deal.status !== "active" && (
          <div className="grid gap-1">
            <label htmlFor="deal-reason" className="text-xs text-surface-600">Reason</label>
            <select id="deal-reason" className={inputCls} value={deal.status_reason} onChange={(e) => update({ status_reason: e.target.value })}>
              {[deal.status_reason, ...reasons].filter((r, i, all) => r && all.indexOf(r) === i).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        )}
      </div>

      <input ref={fileInput} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />

      <div className="grid gap-2">
        {stages.map((stage, i) => {
          const done = i < at, current = i === at;
          const have = deal.filled[stage.key] ?? 0, total = stage.fields.length;
          const docs = deal.document_list.filter((d) => d.stage === stage.key);
          const empty = total - have;
          const expanded = open === stage.key;
          return (
            <section key={stage.key} className={`rounded-lg border ${current ? "border-pharma-300" : "border-surface-200"}`}>
              <button onClick={() => setOpen(expanded ? "" : stage.key)} aria-expanded={expanded}
                className="grid w-full grid-cols-[22px_1fr_auto_16px] items-center gap-2 px-3 py-2 text-left text-sm">
                <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 text-[10px] font-semibold ${done ? "border-pharma-700 bg-pharma-700 text-white" : current ? "border-pharma-700 text-pharma-800" : "border-surface-300 text-surface-500"}`}>
                  {done ? "✓" : i + 1}
                </span>
                <span className={current ? "font-semibold text-surface-900" : "text-surface-700"}>{stage.name}</span>
                <span className="text-[11px] tabular-nums text-surface-500">
                  {total > 0 ? `${have}/${total}` : ""}{docs.length ? ` · ${plural(docs.length, "file")}` : ""}
                </span>
                <ChevronDown className={`h-4 w-4 text-surface-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
              </button>
              {expanded && (
                <div className="grid gap-3 px-3 pb-3 pl-[42px] text-sm">
                  {stage.trigger
                    ? <p className="text-xs text-surface-500">Moves on when: <b className="text-surface-800">{stage.trigger}</b></p>
                    : <p className="text-xs text-surface-500">Deal complete.</p>}
                  {stage.fields.map((f) => f.type === "dirac" ? (
                    <div key={f.key} className="grid gap-0.5">
                      <span className="flex items-center gap-1.5 text-xs text-surface-600">
                        {f.label}<span className="rounded-full bg-emerald-50 px-1.5 text-[10px] text-emerald-800">from Dirac</span>
                      </span>
                      <span className={deal.dirac[f.key] ? "text-surface-900" : "text-surface-400"}>{deal.dirac[f.key] ?? "Nothing in Dirac yet"}</span>
                    </div>
                  ) : (
                    <FieldInput key={f.key} field={f} value={deal.info[f.key] ?? ""}
                      onSave={(v) => run(() => api.updateDeal(deal.id, { info: { [f.key]: v } }))} />
                  ))}
                  {stage.trigger && (
                    <div className="grid gap-1.5 rounded-lg border border-dashed border-surface-300 p-2 text-xs">
                      {docs.map((d) => (
                        <div key={d.id} className="flex items-center gap-2">
                          <Paperclip className="h-3.5 w-3.5 shrink-0 text-surface-400" />
                          <a href={api.dealDocumentUrl(d.id)} className="min-w-0 flex-1 break-words text-pharma-800 hover:underline">{d.file_name}</a>
                          <span className="text-surface-400">{ddmmyy(d.uploaded_at)}</span>
                          <a href={api.dealDocumentUrl(d.id)} aria-label={`Download ${d.file_name}`} className="text-surface-500 hover:text-pharma-800"><Download className="h-3.5 w-3.5" /></a>
                          <button onClick={() => removeDoc(d.id)} aria-label={`Remove ${d.file_name}`} className="text-surface-500 hover:text-rose-700"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      ))}
                      <button disabled={busy} onClick={() => { uploadStage.current = stage.key; fileInput.current?.click(); }}
                        className="flex items-center gap-1.5 text-left font-medium text-pharma-800 hover:underline disabled:opacity-60">
                        <Plus className="h-3.5 w-3.5" /> Attach a file{stage.doc ? ` (e.g. ${stage.doc})` : ""}, optional
                      </button>
                    </div>
                  )}
                  {current && i < stages.length - 1 && (
                    <div className="grid gap-1.5">
                      <button disabled={busy} onClick={() => move(stages[i + 1].key)}
                        className="rounded-lg bg-pharma-900 px-4 py-2 text-sm font-medium text-white hover:bg-pharma-800 disabled:opacity-60">
                        Move to {stages[i + 1].name}
                      </button>
                      {empty > 0 && <p className="text-xs text-amber-700">{plural(empty, "item")} still empty. You can fill {empty === 1 ? "it" : "them"} later.</p>}
                    </div>
                  )}
                  {current && i > 0 && (
                    <button disabled={busy} onClick={() => move(stages[i - 1].key)} className="text-left text-xs text-surface-500 underline disabled:opacity-60">
                      Move back to {stages[i - 1].name}
                    </button>
                  )}
                  {!current && (
                    <button disabled={busy} onClick={() => move(stage.key)} className="text-left text-xs text-surface-500 underline disabled:opacity-60">
                      Move the deal to this stage
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="grid gap-1">
        <label htmlFor="deal-notes" className="text-xs text-surface-600">Notes</label>
        <textarea id="deal-notes" rows={3} className={inputCls} value={notes}
          onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== deal.notes && update({ notes })} />
      </div>

      {deal.events.length > 0 && (
        <div className="grid gap-1 text-xs text-surface-600">
          <span className="font-medium text-surface-700">History</span>
          {[...deal.events].reverse().map((e, i) => (
            <span key={i}>
              <span className="tabular-nums text-surface-400">{ddmmyy(e.at)}</span>{" "}
              {e.kind === "portfolio" ? "Added to My Portfolio" : e.kind === "stage"
                ? e.from_value ? `Moved from ${stageName(e.from_value)} to ${stageName(e.to_value)}` : `Created in ${stageName(e.to_value)}`
                : `Status: ${STATUS_LABEL[e.to_value as DealStatus] ?? e.to_value}`}
            </span>
          ))}
        </div>
      )}

      <div className="border-t border-surface-200 pt-4">
        {confirmDelete ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-surface-700">Delete this deal and its files?</span>
            <button disabled={busy} onClick={remove} className="rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-60">Delete</button>
            <button onClick={() => setConfirmDelete(false)} className="rounded-lg border border-surface-300 px-3 py-1.5 text-xs">Keep</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 text-xs text-surface-500 hover:text-rose-700">
            <Trash2 className="h-3.5 w-3.5" /> Delete deal
          </button>
        )}
      </div>
    </aside>
  );
}

// ─── New deal ─────────────────────────────────────────────────────────────────
function NewDeal({ molecules, stages, onCreated, onCancel }: {
  molecules: string[]; stages: DealStage[]; onCreated: (d: DealDetail) => void; onCancel: () => void;
}) {
  const [molecule, setMolecule] = useState("");
  const [partner, setPartner] = useState("");
  const [stage, setStage] = useState(stages[0]?.key ?? "sourced");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!molecule.trim()) return;
    setSaving(true); setError("");
    try { onCreated(await api.createDeal({ molecule, partner, stage })); } catch (err) { setError(errorText(err)); setSaving(false); }
  }

  return (
    <form onSubmit={submit} className="mb-5 grid gap-3 rounded-xl border border-surface-300 bg-white p-4 sm:grid-cols-[1fr_1fr_200px_auto] sm:items-end">
      <div className="grid gap-1">
        <label htmlFor="new-molecule" className="text-xs text-surface-600">Molecule</label>
        <input id="new-molecule" list="deal-molecules" autoFocus className={inputCls} value={molecule} onChange={(e) => setMolecule(e.target.value)} placeholder="e.g. Lacosamide" />
        <datalist id="deal-molecules">{molecules.map((m) => <option key={m} value={m} />)}</datalist>
      </div>
      <div className="grid gap-1">
        <label htmlFor="new-partner" className="text-xs text-surface-600">Partner (optional)</label>
        <input id="new-partner" className={inputCls} value={partner} onChange={(e) => setPartner(e.target.value)} />
      </div>
      <div className="grid gap-1">
        <label htmlFor="new-stage" className="text-xs text-surface-600">Starts in</label>
        <select id="new-stage" className={inputCls} value={stage} onChange={(e) => setStage(e.target.value)}>
          {stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
        </select>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving || !molecule.trim()} className="rounded-lg bg-pharma-900 px-4 py-2 text-sm font-medium text-white hover:bg-pharma-800 disabled:opacity-60">
          {saving ? "Adding…" : "Add deal"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-700">Cancel</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700 sm:col-span-4">{error}</p>}
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
function portfolioNotice(molecule: string, result: string) {
  if (result === "added") return { ok: true, text: `${molecule} is launched and has been added to My Portfolio.` };
  if (result === "already") return { ok: true, text: `${molecule} is launched. It was already in My Portfolio.` };
  if (result === "not_in_iqvia")
    return { ok: false, text: `${molecule} is launched, but My Portfolio only holds IQVIA molecules, so it wasn't added.` };
  return { ok: false, text: `${molecule} is launched, but it couldn't be added to My Portfolio (${result.replace(/^failed: /, "")}).` };
}

type Filter = "all" | DealStatus;

export default function DealTrackerPage() {
  const [board, setBoard] = useState<DealBoard | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);
  const [molecules, setMolecules] = useState<string[]>([]);
  const [detail, setDetail] = useState<DealDetail | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.getDeals().then(setBoard).catch((e) => setError(errorText(e)));
    api.getMolecules().then((r) => setMolecules(r.molecules)).catch(() => {});
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDetail(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Put a deal's latest state on the board (and in the drawer if it's open). */
  function apply(d: DealDetail & { portfolio?: DealPortfolioResult }) {
    if (d.portfolio) setNotice(portfolioNotice(title(d.molecule), d.portfolio));
    setBoard((b) => b && {
      ...b,
      deals: b.deals.some((x) => x.id === d.id) ? b.deals.map((x) => (x.id === d.id ? d : x)) : [...b.deals, d],
    });
    setDetail((cur) => (cur && cur.id === d.id ? d : cur));
  }

  async function open(id: number) {
    setError("");
    try { setDetail(await api.getDeal(id)); } catch (e) { setError(errorText(e)); }
  }

  async function drop(id: number, stage: string) {
    const deal = board?.deals.find((d) => d.id === id);
    if (!deal || deal.stage === stage) return;
    setError("");
    try { apply(await api.moveDeal(id, stage)); } catch (e) { setError(errorText(e)); }
  }

  const counts = useMemo(() => {
    const ds = board?.deals ?? [];
    return { all: ds.length, active: ds.filter((d) => d.status === "active").length,
      on_hold: ds.filter((d) => d.status === "on_hold").length, dropped: ds.filter((d) => d.status === "dropped").length };
  }, [board]);

  const stages = board?.stages ?? [];
  const shown = (board?.deals ?? [])
    .filter((d) => filter === "all" || d.status === filter)
    .sort((a, b) => a.molecule.localeCompare(b.molecule));

  return (
    <main className="px-5 py-10">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Handshake className="h-7 w-7 text-pharma-700" />
        <h1 className="text-3xl font-semibold text-surface-900">Deal Tracker</h1>
        <span className="text-xs text-surface-400">One card per molecule · drag a card to move it</span>
        <button onClick={() => setAdding((a) => !a)}
          className="flex items-center gap-1.5 rounded-lg border border-pharma-700 px-3 py-1.5 text-xs font-medium text-pharma-800 hover:bg-pharma-50">
          <Plus className="h-3.5 w-3.5" /> New deal
        </button>
        <div className="ml-auto flex gap-1 rounded-full bg-surface-100 p-1">
          {(["all", "active", "on_hold", "dropped"] as Filter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${filter === f ? "bg-pharma-700 text-white" : "text-surface-600 hover:text-surface-900"}`}>
              {f === "all" ? "All" : STATUS_LABEL[f]} ({counts[f]})
            </button>
          ))}
        </div>
      </div>

      {error && <div role="alert" className="mb-5 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && (
        <div role="status" className={`mb-5 flex items-start justify-between gap-3 rounded-lg p-3 text-sm ${notice.ok ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss"><X className="h-4 w-4" /></button>
        </div>
      )}
      {adding && board && (
        <NewDeal molecules={molecules} stages={stages} onCancel={() => setAdding(false)}
          onCreated={(d) => { apply(d); setAdding(false); setDetail(d); }} />
      )}
      {!board && !error && <p className="text-surface-500">Loading deals…</p>}
      {board && board.deals.length === 0 && !adding && (
        <div className="mb-5 rounded-xl border border-surface-300 bg-white p-6 text-center text-sm text-surface-600">
          No deals yet. Use <b>New deal</b> to add the first molecule you&apos;re working on.
        </div>
      )}

      {board && (
        <div className="overflow-x-auto pb-3">
          <div className="grid auto-cols-[240px] grid-flow-col gap-2.5">
            {stages.map((stage) => {
              const cards = shown.filter((d) => d.stage === stage.key);
              return (
                <section key={stage.key} aria-label={stage.name}
                  onDragOver={(e) => { e.preventDefault(); setDropOn(stage.key); }}
                  onDragLeave={() => setDropOn((s) => (s === stage.key ? null : s))}
                  onDrop={(e) => { e.preventDefault(); setDropOn(null); drop(Number(e.dataTransfer.getData("text/plain")), stage.key); }}
                  className={`flex min-h-[320px] flex-col gap-2 rounded-xl bg-surface-100 p-2.5 ${dropOn === stage.key ? "outline-dashed outline-2 -outline-offset-2 outline-pharma-500" : ""}`}>
                  <div className="grid gap-0.5 px-1 pb-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-pharma-700">{stage.phase}</span>
                    <span className="flex justify-between text-sm font-semibold text-surface-900">
                      {stage.name}<span className="font-normal tabular-nums text-surface-500">{cards.length}</span>
                    </span>
                    <span className="text-xs text-surface-500">{stage.trigger ? `Moves on: ${stage.trigger}` : "Deal complete"}</span>
                  </div>
                  {cards.map((d) => <DealCard key={d.id} deal={d} stage={stage} stages={stages} onOpen={() => open(d.id)} />)}
                </section>
              );
            })}
          </div>
        </div>
      )}

      {detail && board && (
        <>
          <div className="fixed inset-0 z-30 bg-surface-900/30" onClick={() => setDetail(null)} />
          <DealDrawer deal={detail} stages={stages} reasons={board.reasons} onChange={apply} onClose={() => setDetail(null)}
            onDeleted={(id) => { setBoard((b) => b && { ...b, deals: b.deals.filter((d) => d.id !== id) }); setDetail(null); }} />
        </>
      )}
    </main>
  );
}
