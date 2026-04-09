"use client";

import { useState, useRef, useEffect } from "react";
import {
  Users, Play, Loader2, ChevronDown, Globe,
  CheckCircle2, XCircle, Mail, Linkedin,
  Clock, ChevronRight, FlaskConical, ChevronUp, TrendingUp, TrendingDown,
  MessageSquarePlus, Copy, Check, Trash2,
} from "lucide-react";
import { api, streamOutreach, type OutreachEvent, type OutreachRun, type OutreachRunDetail, type MoleculeCard as MolCardType } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────
interface CompanyResult {
  company: string;
  website: string;
  overview: string;
  uae_presence: {
    mohap: string | null;
    upp: string | null;
    mohap_agents: string[];
    upp_agents: string[];
  };
  contacts: { name: string; title: string; email?: string; linkedin_url?: string }[];
}

const MODELS = [
  { id: "haiku",       label: "Haiku (fast, cheap)" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini" },
  { id: "sonnet",      label: "Claude Sonnet" },
];

// ─── Molecule mini-card ───────────────────────────────────────────────────────
function MolMiniCard({ mol }: { mol: MolCardType }) {
  const fmt = (v?: number | null) => v != null ? `${(v / 1_000_000).toFixed(1)}M` : "—";
  const pct = (v?: number | null) => v != null ? `${v.toFixed(1)}%` : "—";

  return (
    <div className="bg-white/60 border border-surface-200 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-surface-900 truncate">{mol.molecule}</p>
        {mol.in_iqvia
          ? <span className="text-[10px] bg-pharma-50 text-pharma-900 font-semibold border border-pharma-200 px-1.5 py-0.5 rounded-full shrink-0">IQVIA matched</span>
          : <span className="text-[10px] bg-surface-100 text-surface-500 border border-surface-300 px-1.5 py-0.5 rounded-full shrink-0">No IQVIA data</span>
        }
      </div>
      {mol.in_iqvia && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div>
            <p className="text-surface-400">Market value</p>
            <p className="text-surface-800 font-medium">AED {fmt(mol.market_value_aed)}</p>
          </div>
          <div>
            <p className="text-surface-400">Competitors</p>
            <p className="text-surface-800 font-medium">{mol.num_competitors ?? "—"}</p>
          </div>
          <div>
            <p className="text-surface-400">Value CAGR</p>
            <p className={`font-medium flex items-center gap-0.5 ${(mol.value_cagr_pct ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
              {(mol.value_cagr_pct ?? 0) >= 0
                ? <TrendingUp className="w-3 h-3" />
                : <TrendingDown className="w-3 h-3" />}
              {pct(mol.value_cagr_pct)}
            </p>
          </div>
          <div>
            <p className="text-surface-400">Private %</p>
            <p className="text-surface-800 font-medium">{pct(mol.private_pct)}</p>
          </div>
          {mol.market_leader && (
            <div className="col-span-2">
              <p className="text-surface-400">Leader</p>
              <p className="text-surface-700 truncate">{mol.market_leader} ({pct(mol.leader_share_pct)})</p>
            </div>
          )}
          {mol.atc3_class && (
            <div className="col-span-2">
              <p className="text-surface-400">ATC3</p>
              <p className="text-surface-600 text-[11px] truncate">{mol.atc3_class}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Contact row with draft message ──────────────────────────────────────────
function ContactRow({ contact, companyName, companyOverview }: {
  contact: { name: string; title: string; email?: string; linkedin_url?: string };
  companyName: string;
  companyOverview: string;
}) {
  const [drafting, setDrafting]   = useState(false);
  const [message,  setMessage]    = useState("");
  const [copied,   setCopied]     = useState(false);
  const [open,     setOpen]       = useState(false);

  const draft = async () => {
    if (message) { setOpen((v) => !v); return; }
    setDrafting(true);
    setOpen(true);
    try {
      const data = await api.draftLinkedInMessage({
        contact_name:     contact.name,
        contact_title:    contact.title,
        company_name:     companyName,
        company_overview: companyOverview,
      });
      setMessage(data.message);
    } catch {
      setMessage("Failed to draft message. Please try again.");
    } finally {
      setDrafting(false);
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-white/40 rounded-xl overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-3 py-2.5">
        <div>
          <p className="text-sm font-medium text-surface-800">{contact.name || "—"}</p>
          <p className="text-xs text-surface-500 mt-0.5">{contact.title || "—"}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {contact.email && (
            <a href={`mailto:${contact.email}`} title={contact.email}
              className="p-1.5 rounded-lg text-surface-500 hover:text-pharma-900 hover:bg-pharma-50 transition-colors">
              <Mail className="w-4 h-4" />
            </a>
          )}
          {contact.linkedin_url && (
            <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer"
              className="p-1.5 rounded-lg text-surface-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors">
              <Linkedin className="w-4 h-4" />
            </a>
          )}
          <button onClick={draft} title="Draft LinkedIn message"
            className={`p-1.5 rounded-lg transition-colors ${
              open
                ? "text-pharma-900 bg-pharma-50"
                : "text-surface-500 hover:text-pharma-900 hover:bg-pharma-50"
            }`}>
            {drafting ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquarePlus className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-surface-200 px-3 py-3 space-y-2">
          {drafting ? (
            <p className="text-xs text-surface-500 italic">Drafting personalised message...</p>
          ) : (
            <>
              <p className="text-xs text-surface-600 leading-relaxed whitespace-pre-wrap">{message}</p>
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-surface-400">{message.length} / 300 chars</p>
                <button onClick={copy}
                  className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg transition-colors ${
                    copied
                      ? "text-emerald-700 bg-emerald-50"
                      : "text-surface-600 hover:text-surface-800 bg-surface-100 hover:bg-zinc-700"
                  }`}>
                  {copied ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy</>}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Company result card ──────────────────────────────────────────────────────
function CompanyCard({ company }: { company: CompanyResult }) {
  const hasUae = company.uae_presence.mohap || company.uae_presence.upp;
  const allAgents = [
    ...company.uae_presence.mohap_agents,
    ...company.uae_presence.upp_agents,
  ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);

  const [showProducts, setShowProducts] = useState(false);
  const [products, setProducts]         = useState<MolCardType[] | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(false);

  const loadProducts = async () => {
    if (products !== null) { setShowProducts((v) => !v); return; }
    setShowProducts(true);
    setLoadingProducts(true);
    try {
      const mohapName = company.uae_presence.mohap!;
      const data = await api.getCompanyProducts(mohapName);
      setProducts(data.molecules);
    } catch {
      setProducts([]);
    } finally {
      setLoadingProducts(false);
    }
  };

  return (
    <div className="bg-surface-50 border-surface-200 border border-surface-200 rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold text-surface-900">{company.company}</h3>
            {company.website && (
              <a href={`https://${company.website}`} target="_blank" rel="noopener noreferrer"
                className="text-xs text-pharma-900 hover:underline flex items-center gap-1">
                <Globe className="w-3 h-3" />{company.website}
              </a>
            )}
          </div>
          {company.overview && (
            <p className="text-sm text-surface-600 mt-1 leading-relaxed">{company.overview}</p>
          )}
        </div>

        {/* UAE badge */}
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium shrink-0 ${
          hasUae
            ? "bg-emerald-500/15 text-emerald-700 border border-emerald-200"
            : "bg-surface-100 text-surface-500 border border-surface-300"
        }`}>
          {hasUae
            ? <><CheckCircle2 className="w-3.5 h-3.5" /> UAE Present</>
            : <><XCircle className="w-3.5 h-3.5" /> Not in UAE</>
          }
        </div>
      </div>

      {/* UAE presence detail */}
      {hasUae && (
        <div className="bg-white shadow-sm border-surface-200 rounded-xl p-3 space-y-1.5 text-xs">
          {company.uae_presence.mohap && (
            <div className="flex gap-2">
              <span className="text-surface-400 w-14 shrink-0">MOHAP</span>
              <span className="text-surface-700">{company.uae_presence.mohap}</span>
            </div>
          )}
          {company.uae_presence.upp && (
            <div className="flex gap-2">
              <span className="text-surface-400 w-14 shrink-0">UPP</span>
              <span className="text-surface-700">{company.uae_presence.upp}</span>
            </div>
          )}
          {allAgents.length > 0 && (
            <div className="flex gap-2 pt-1 border-t border-surface-200">
              <span className="text-surface-400 w-14 shrink-0 mt-0.5">Agents</span>
              <div className="flex flex-wrap gap-1">
                {allAgents.map((a) => (
                  <span key={a} className="bg-surface-100 border border-surface-300 text-surface-600 px-2 py-0.5 rounded-full">
                    {a}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Contacts */}
      <div>
        <p className="text-xs font-medium text-surface-500 uppercase tracking-wider mb-2">
          BD Contacts
        </p>
        {company.contacts.length === 0 ? (
          <p className="text-xs text-surface-400 italic">No contacts found</p>
        ) : (
          <div className="space-y-3">
            {company.contacts.map((c, i) => (
              <ContactRow
                key={i}
                contact={c}
                companyName={company.company}
                companyOverview={company.overview}
              />
            ))}
          </div>
        )}
      </div>

      {/* Registered products — only if MOHAP match exists */}
      {company.uae_presence.mohap && (
        <div>
          <button onClick={loadProducts}
            className="flex items-center gap-2 text-xs font-medium text-pharma-900 hover:text-pharma-800 bg-pharma-50 hover:bg-pharma-50 border border-pharma-200 px-3 py-2 rounded-xl transition-colors w-full justify-center">
            <FlaskConical className="w-3.5 h-3.5" />
            {loadingProducts
              ? "Loading registered products..."
              : showProducts
                ? <><ChevronUp className="w-3.5 h-3.5" /> Hide registered products</>
                : `View registered products in UAE (MOHAP)`
            }
          </button>

          {showProducts && !loadingProducts && products !== null && (
            <div className="mt-3 space-y-2">
              {products.length === 0 ? (
                <p className="text-xs text-surface-400 italic text-center py-2">No molecules found for this company</p>
              ) : (
                <>
                  <p className="text-xs text-surface-500">{products.length} molecule{products.length !== 1 ? "s" : ""} registered under <span className="text-surface-700">{company.uae_presence.mohap}</span></p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-96 overflow-y-auto pr-1">
                    {products.map((mol) => <MolMiniCard key={mol.molecule} mol={mol} />)}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function OutreachPage() {
  const [country,     setCountry]     = useState("");
  const [model,       setModel]       = useState("haiku");
  const [running,     setRunning]     = useState(false);
  const [statusLog,   setStatusLog]   = useState<string[]>([]);
  const [companies,   setCompanies]   = useState<CompanyResult[]>([]);
  const [runComplete, setRunComplete] = useState(false);
  const [error,       setError]       = useState("");

  // History
  const [prevRuns,       setPrevRuns]       = useState<OutreachRun[]>([]);
  const [selectedRun,    setSelectedRun]    = useState<OutreachRunDetail | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingRun,     setLoadingRun]     = useState(false);

  const abortRef  = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [statusLog]);

  // Load run list on mount + after each completed run
  useEffect(() => {
    setLoadingHistory(true);
    api.getOutreachRuns()
      .then((d) => setPrevRuns(d.runs))
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, [runComplete]);

  const viewRun = async (run: OutreachRun) => {
    setLoadingRun(true);
    setSelectedRun(null);
    try {
      const detail = await api.getOutreachRun(run.run_id);
      setSelectedRun(detail);
      setCompanies([]);   // clear live results when browsing history
    } catch {
      setError("Failed to load run.");
    } finally {
      setLoadingRun(false);
    }
  };

  const deleteRun = async (runId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await api.deleteOutreachRun(runId).catch(() => {});
    setPrevRuns((prev) => prev.filter((r) => r.run_id !== runId));
    if (selectedRun?.run_id === runId) setSelectedRun(null);
  };

  const startRun = () => {
    if (!country.trim()) return;
    setRunning(true);
    setRunComplete(false);
    setStatusLog([]);
    setCompanies([]);
    setSelectedRun(null);
    setError("");

    abortRef.current = streamOutreach(
      country.trim(),
      model,
      (event: OutreachEvent) => {
        if (event.type === "status" && event.message) {
          setStatusLog((prev) => [...prev, event.message!]);
        }
        if (event.type === "company" && event.data) {
          setCompanies((prev) => [...prev, event.data as CompanyResult]);
        }
        if (event.type === "complete") {
          setRunComplete(true);
        }
        if (event.type === "error" && event.message) {
          setError(event.message);
        }
      },
      () => setRunning(false),
      (e) => { setError(e); setRunning(false); },
    );
  };

  const stopRun = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  // Displayed companies: live run OR historical run
  const displayedCompanies: CompanyResult[] =
    selectedRun ? selectedRun.companies as CompanyResult[] : companies;

  return (
    <div className="min-h-screen p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 flex items-center gap-3">
            <Users className="w-6 h-6 text-pharma-900" />
            Outreach Agent
          </h1>
          <p className="text-sm text-surface-500 mt-1">
            Find top CDMOs by country, check UAE presence, discover BD contacts
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* ── Left panel: run form + history ── */}
        <div className="space-y-6">
          {/* Run form */}
          <div className="bg-white shadow-sm border-surface-200 border border-surface-200 rounded-xl p-6 space-y-4">
            <h2 className="text-sm font-semibold text-surface-700">New Run</h2>

            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1.5">Country</label>
              <input
                type="text"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !running && startRun()}
                placeholder="e.g. Portugal, India, Germany..."
                className="w-full bg-white border border-surface-300 rounded-xl px-4 py-2.5 text-sm text-surface-900 placeholder-zinc-600 focus:outline-none focus:border-pharma-300 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1.5">Model</label>
              <div className="relative">
                <select value={model} onChange={(e) => setModel(e.target.value)}
                  className="w-full appearance-none bg-white border border-surface-300 rounded-xl px-4 py-2.5 text-sm text-surface-900 focus:outline-none focus:border-pharma-300 transition-colors">
                  {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-500 pointer-events-none" />
              </div>
            </div>

            {error && (
              <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                {error}
              </p>
            )}

            {running ? (
              <button onClick={stopRun}
                className="w-full flex items-center justify-center gap-2 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-medium py-2.5 px-4 rounded-xl transition-colors text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Stop Run
              </button>
            ) : (
              <button onClick={startRun} disabled={!country.trim()}
                className="w-full flex items-center justify-center gap-2 bg-pharma-900 text-white font-medium hover:bg-pharma-800 text-white disabled:bg-zinc-700 disabled:text-surface-500 text-white font-medium py-2.5 px-4 rounded-xl transition-colors text-sm">
                <Play className="w-4 h-4" /> Run Outreach
              </button>
            )}
          </div>

          {/* Status log */}
          {statusLog.length > 0 && (
            <div className="bg-white shadow-sm border-surface-200 border border-surface-200 rounded-xl p-4 space-y-1 max-h-48 overflow-y-auto">
              <p className="text-xs font-medium text-surface-500 uppercase tracking-wider mb-2">Progress</p>
              {statusLog.map((msg, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <div className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${
                    i === statusLog.length - 1 && running ? "bg-pharma-400 animate-pulse" : "bg-zinc-700"
                  }`} />
                  <span className="text-surface-600">{msg}</span>
                </div>
              ))}
              <div ref={logEndRef} />
              {runComplete && !running && (
                <div className="flex items-center gap-2 pt-1 border-t border-surface-200">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                  <span className="text-xs text-emerald-700 font-medium">Run complete · Saved</span>
                </div>
              )}
            </div>
          )}

          {/* Previous runs */}
          <div className="bg-white shadow-sm border-surface-200 border border-surface-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-surface-200">
              <h2 className="text-sm font-semibold text-surface-700 flex items-center gap-2">
                <Clock className="w-4 h-4 text-surface-500" /> Previous Runs
              </h2>
              {loadingHistory && <Loader2 className="w-3.5 h-3.5 animate-spin text-surface-400" />}
            </div>
            {prevRuns.length === 0 ? (
              <p className="text-xs text-surface-400 p-4">
                {loadingHistory ? "Loading..." : "No saved runs yet."}
              </p>
            ) : (
              <div className="divide-y divide-zinc-800/50 max-h-72 overflow-y-auto">
                {prevRuns.map((run) => (
                  <button key={run.run_id} onClick={() => viewRun(run)}
                    className={`w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-100 transition-colors group ${
                      selectedRun?.run_id === run.run_id ? "bg-pharma-900 text-white font-medium/5 border-l-2 border-pharma-500" : ""
                    }`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-surface-800">{run.country}</p>
                      <p className="text-xs text-surface-500 mt-0.5">
                        {run.run_date} · {run.companies_found} companies · {run.contacts_found} contacts
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={(e) => deleteRun(run.run_id, e)}
                        className="p-1 rounded text-surface-300 hover:text-rose-700 opacity-0 group-hover:opacity-100 transition-all">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <ChevronRight className="w-4 h-4 text-surface-400" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right panel: results ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Header — shows context of what's displayed */}
          {(displayedCompanies.length > 0 || loadingRun) && (
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-surface-700">
                {selectedRun
                  ? <>{selectedRun.country} <span className="text-surface-500 font-normal">· {selectedRun.run_date}</span></>
                  : <>{country} <span className="text-surface-500 font-normal">· live run</span></>
                }
              </h2>
              {selectedRun && (
                <button onClick={() => { setSelectedRun(null); }}
                  className="text-xs text-surface-500 hover:text-surface-800 transition-colors">
                  ← Clear
                </button>
              )}
            </div>
          )}

          {/* Loading a historical run */}
          {loadingRun && (
            <div className="flex items-center gap-3 text-surface-500 text-sm py-8 justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-pharma-900" />
              Loading run...
            </div>
          )}

          {/* Company cards — identical for live and historical runs */}
          {!loadingRun && displayedCompanies.map((c) => (
            <CompanyCard key={c.company} company={c} />
          ))}

          {/* Empty state */}
          {!loadingRun && displayedCompanies.length === 0 && !running && (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Users className="w-12 h-12 text-surface-300 mb-4" />
              <p className="text-surface-500 text-sm">Enter a country and run the agent</p>
              <p className="text-surface-400 text-xs mt-1">
                Finds top 5 CDMOs · checks UAE presence · discovers BD contacts
              </p>
            </div>
          )}

          {/* Running skeleton */}
          {running && displayedCompanies.length === 0 && (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-surface-50 border-surface-200 border border-surface-200 rounded-xl p-5 space-y-3">
                  <div className="skeleton h-5 w-48 rounded" />
                  <div className="skeleton h-3 w-full rounded" />
                  <div className="skeleton h-3 w-3/4 rounded" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
