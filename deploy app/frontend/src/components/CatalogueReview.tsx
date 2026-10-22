"use client";

import { useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { api, type AnalysisResult, type CatalogueInfo, type MoleculeCard } from "@/lib/api";

/** "Approved" / "Submitted" badge for a catalogue product. */
export function CatalogueStatusBadge({ status }: { status?: CatalogueInfo["status"] }) {
  if (status === "approved")
    return <span className="text-[10px] bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 rounded shrink-0">Approved</span>;
  if (status === "submitted")
    return <span title="Filed, not yet approved" className="text-[10px] bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded shrink-0">Submitted</span>;
  return null;
}

/** One strength: highlighted when the supplier has it (green = also sold in the UAE, dashed = a strength the UAE
 *  doesn't have yet); plain grey when only the UAE market has it. */
function StrengthPill({ label, in_uae, offered = true }: { label: string; in_uae: boolean | null; offered?: boolean }) {
  const [style, title] = !offered
    ? ["border-surface-200 text-surface-400", "Sold in the UAE · this supplier doesn't offer it"]
    : in_uae == null
      ? ["border-pharma-300 bg-pharma-50 text-pharma-900 font-semibold", "This supplier has it"]
      : in_uae
        ? ["border-pharma-500 bg-pharma-100 text-pharma-900 font-semibold", "This supplier has it · also sold in the UAE"]
        : ["border-dashed border-amber-500 bg-amber-50 text-amber-900 font-semibold", "This supplier has it · not sold in the UAE yet"];
  return <span title={title} className={`px-1.5 py-px rounded border tabular-nums ${style}`}>{label}</span>;
}

/** On a molecule card: the catalogue's status, forms, strengths vs the UAE market, expected date. */
export function CatalogueLine({ info }: { info: CatalogueInfo }) {
  const products = info.products;
  const expected = products.map((p) => p.expected_date).filter(Boolean);
  const imagePages = products.every((p) => p.from_image) ? Array.from(new Set(products.flatMap((p) => p.pages))) : [];
  return (
    <div className="mt-1.5 pl-9 space-y-1 text-[11px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <CatalogueStatusBadge status={info.status} />
        {expected.length > 0 && <span className="text-surface-600">Expected {expected[0]}</span>}
        {imagePages.length > 0 && (
          <span title="Read from a page image: check it against the catalogue" className="text-surface-500 italic">
            Read from image p.{imagePages.join(", ")}
          </span>
        )}
      </div>
      {products.map((p, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1">
          {p.dosage_form && <span className="text-surface-600 mr-0.5">{p.dosage_form}:</span>}
          {p.strengths.map((s) => <StrengthPill key={s.label} {...s} />)}
        </div>
      ))}
      {(info.other_forms ?? []).map((f) => (
        <div key={f.form} className="flex flex-wrap items-center gap-1" title="Sold in the UAE in a form this catalogue doesn't offer">
          <span className="text-surface-400 mr-0.5">UAE {f.form.toLowerCase()}:</span>
          {f.strengths.map((label) => <StrengthPill key={label} label={label} in_uae offered={false} />)}
        </div>
      ))}
      {!info.other_forms && (info.uae_only ?? []).length > 0 && (
        <div className="flex flex-wrap items-center gap-1" title="Strengths the UAE market sells that this catalogue doesn't offer">
          <span className="text-surface-400 mr-0.5">UAE also sells:</span>
          {info.uae_only!.map((label) => <StrengthPill key={label} label={label} in_uae offered={false} />)}
        </div>
      )}
    </div>
  );
}

/** Why keyword matching ran instead of the AI read. */
export function ExtractionNote({ result }: { result: AnalysisResult }) {
  const x = result.extraction;
  if (!x) return null;
  if (x.method === "keyword")
    return x.reason ? (
      <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2">
        The AI couldn&apos;t read this catalogue ({x.reason}), so molecules were found by keyword matching:
        combinations may be split and strengths aren&apos;t shown.
      </p>
    ) : null;
  return (
    <p className="text-xs text-surface-500">
      Read by AI: {x.products} product{x.products === 1 ? "" : "s"} from {x.pages} page{x.pages === 1 ? "" : "s"}
      {x.image_pages ? ` (${x.image_pages} read as images)` : ""}
      {x.dropped ? ` · ${x.dropped} dropped (not found on the page)` : ""}
      <span className="ml-3 inline-flex flex-wrap items-center gap-1.5 align-middle">
        Strengths:
        <StrengthPill label="supplier has · in UAE" in_uae />
        <StrengthPill label="supplier has · not in UAE" in_uae={false} />
        <StrengthPill label="UAE only" in_uae offered={false} />
      </span>
    </p>
  );
}

const forms = (c: MoleculeCard) => Array.from(new Set((c.catalogue?.products ?? []).map((p) => p.dosage_form).filter(Boolean))).join("; ");
const strengths = (c: MoleculeCard) => Array.from(new Set((c.catalogue?.products ?? []).flatMap((p) => p.strengths.filter((s) => s.offered !== false).map((s) => s.label)))).join(", ");

/** Review before writing: the catalogue's molecules not in the company's registries, ticked to add.
 *  Submitted (not yet approved) and unmatched names start unticked; after a keyword fallback, all do. */
export function RegistryReview({ result, company, source, onAdded }: {
  result: AnalysisResult;
  company: string;
  source: string;
  onAdded: (names: string[]) => void;
}) {
  const check = result.registry_check;
  const rows = useMemo(
    () => result.molecules.filter((m) => m.registry_status === "new" || m.registry_status === "unmatched"),
    [result.molecules],
  );
  // Keyword matching (the AI fallback) can split combinations, so then nothing starts ticked.
  const [picked, setPicked] = useState<Set<string>>(() => new Set(result.extraction?.method === "keyword" ? [] :
    rows.filter((m) => m.registry_status === "new" && m.catalogue?.status !== "submitted").map((m) => m.molecule)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<number | null>(null);

  if (!check?.company_id) return null;
  const selected = rows.filter((m) => picked.has(m.molecule));

  const add = async () => {
    const items = selected;
    if (!items.length) return;
    setSaving(true);
    setError("");
    try {
      const res = await api.addToRegistry({
        company_id: check.company_id!,
        source,
        items: items.map((m) => ({ name: m.registry_name ?? m.molecule, form: forms(m), strengths: strengths(m),
                                   catalogue_status: m.catalogue?.status })),
      });
      setDone(res.added + res.updated);
      onAdded(items.map((m) => m.molecule));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Couldn't add to the registries");
    } finally {
      setSaving(false);
    }
  };

  const toggle = (name: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  return (
    <div className="rounded-xl border border-surface-200 bg-white shadow-sm p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-surface-900">Add to {company}&apos;s registries</h3>
        <p className="text-xs text-surface-500">
          {check.in_registry ?? 0} already in its registries · {check.already_uploaded ?? 0} added from earlier catalogues · {rows.length} not yet
        </p>
      </div>
      {done != null && (
        <p className="text-xs text-emerald-800 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Added {done} to the Uploaded registry.</p>
      )}
      {rows.length === 0 ? (
        done == null && <p className="text-xs text-surface-500">Nothing new: every molecule in this catalogue is already in {company}&apos;s registries.</p>
      ) : (
        <>
          <ul className="divide-y divide-surface-100 border border-surface-100 rounded-lg">
            {rows.map((m) => (
              <li key={m.molecule}>
                <label className="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-surface-50">
                  <input type="checkbox" checked={picked.has(m.molecule)} onChange={() => toggle(m.molecule)}
                    className="mt-0.5 accent-pharma-700" />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm text-surface-900">{m.registry_name ?? m.molecule}</span>
                      <CatalogueStatusBadge status={m.catalogue?.status} />
                      {m.registry_status === "unmatched" && (
                        <span title="No registry molecule matches this name: check the spelling before adding"
                          className="text-[10px] bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded">Unmatched</span>
                      )}
                      {m.catalogue?.products.every((p) => p.from_image) && (
                        <span className="text-[10px] text-surface-500 italic">read from image</span>
                      )}
                    </div>
                    {(forms(m) || strengths(m)) && (
                      <p className="text-[11px] text-surface-500 truncate">{[forms(m), strengths(m)].filter(Boolean).join(" · ")}</p>
                    )}
                    {m.catalogue?.status === "submitted" && (
                      <p className="text-[11px] text-amber-800">Submitted, not registered yet: once added, {company} shows as holding it.</p>
                    )}
                  </div>
                </label>
              </li>
            ))}
          </ul>
          {error && <p className="text-xs text-rose-700">{error}</p>}
          <button onClick={add} disabled={saving || selected.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-pharma-900 text-white text-sm font-medium hover:bg-pharma-800 disabled:opacity-50 transition-colors">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Add {selected.length} to registries
          </button>
        </>
      )}
    </div>
  );
}
