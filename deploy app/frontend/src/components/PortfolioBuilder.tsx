"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Briefcase, Check, ChevronRight, FileText, Loader2, Plus, Search, Upload, X,
} from "lucide-react";
import { api, type HierarchyClass, type PortfolioHierarchy } from "@/lib/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtAed(v: number) {
  if (v >= 1_000_000_000) return `AED ${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000)     return `AED ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)         return `AED ${(v / 1_000).toFixed(0)}K`;
  return `AED ${v.toFixed(0)}`;
}

type MoleculeIndexEntry = { name: string; value: number; classes: string[] };

/** Every molecule name under each class code, for "N selected" badges and Add all. */
function collectMolecules(nodes: HierarchyClass[], into: Map<string, string[]>): string[] {
  const all: string[] = [];
  for (const node of nodes) {
    const names = node.molecules
      ? node.molecules.map((m) => m.name)
      : collectMolecules(node.children ?? [], into);
    into.set(node.code, names);
    all.push(...names);
  }
  return all;
}

/** Flat molecule → total value + the ATC4 classes it sits in, for search. */
function indexMolecules(nodes: HierarchyClass[], into: Map<string, MoleculeIndexEntry>) {
  for (const node of nodes) {
    if (node.molecules) {
      for (const m of node.molecules) {
        const entry = into.get(m.name) ?? { name: m.name, value: 0, classes: [] };
        entry.value += m.value;
        entry.classes.push(`${node.code} ${node.name}`);
        into.set(m.name, entry);
      }
    } else {
      indexMolecules(node.children ?? [], into);
    }
  }
}

// ─── Add / remove toggle ──────────────────────────────────────────────────────
function AddToggle({ added, onClick }: { added: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={added ? "Remove from portfolio" : "Add to portfolio"}
      className={`flex items-center justify-center w-7 h-7 rounded-lg border shrink-0 transition-colors ${
        added
          ? "bg-pharma-900 border-pharma-900 text-white hover:bg-pharma-800"
          : "bg-white border-surface-300 text-surface-500 hover:border-pharma-300 hover:text-pharma-900"
      }`}
    >
      {added ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function PortfolioBuilder({
  initialMolecules,
  saving,
  error,
  onSave,
  onCancel,
}: {
  initialMolecules: string[];
  saving: boolean;
  error: string;
  onSave: (molecules: string[]) => void;
  onCancel?: () => void;
}) {
  const [hierarchy, setHierarchy] = useState<PortfolioHierarchy | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selected,  setSelected]  = useState<string[]>(initialMolecules);
  const [expanded,  setExpanded]  = useState<Set<string>>(new Set());
  const [query,     setQuery]     = useState("");

  const [importing,  setImporting]  = useState(false);
  const [importNote, setImportNote] = useState("");
  const [dragging,   setDragging]   = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getPortfolioHierarchy()
      .then(setHierarchy)
      .catch(() => setLoadError("The IQVIA hierarchy could not be loaded."));
  }, []);

  const { moleculesByClass, moleculeIndex } = useMemo(() => {
    const byClass = new Map<string, string[]>();
    const index = new Map<string, MoleculeIndexEntry>();
    if (hierarchy) {
      collectMolecules(hierarchy.classes, byClass);
      indexMolecules(hierarchy.classes, index);
    }
    return { moleculesByClass: byClass, moleculeIndex: index };
  }, [hierarchy]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const searchResults = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (q.length < 2) return [];
    return Array.from(moleculeIndex.values())
      .filter((m) => m.name.includes(q))
      .sort((a, b) => (a.name.startsWith(q) === b.name.startsWith(q) ? b.value - a.value : a.name.startsWith(q) ? -1 : 1))
      .slice(0, 60);
  }, [query, moleculeIndex]);

  const toggle = (name: string) =>
    setSelected((prev) => (prev.includes(name) ? prev.filter((m) => m !== name) : [...prev, name]));

  const toggleExpanded = (code: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const setClass = (code: string, add: boolean) => {
    const names = new Set(moleculesByClass.get(code) ?? []);
    setSelected((prev) =>
      add ? [...prev, ...Array.from(names).filter((n) => !prev.includes(n))] : prev.filter((n) => !names.has(n)),
    );
  };

  const importFile = async (file: File) => {
    setImporting(true);
    setImportNote("");
    try {
      const res = await api.uploadCatalogue(file, "My Portfolio");
      const found = res.molecules.filter((m) => m.in_iqvia).map((m) => m.molecule);
      const fresh = found.filter((m) => !selected.includes(m));
      setSelected((prev) => [...prev, ...fresh.filter((m) => !prev.includes(m))]);
      setImportNote(
        found.length
          ? `Found ${found.length} IQVIA molecule${found.length === 1 ? "" : "s"} in ${file.name} — ${fresh.length} added.`
          : `No IQVIA molecules found in ${file.name}.`,
      );
    } catch (e: unknown) {
      setImportNote(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  // ── Tree rendering ──
  const renderClass = (node: HierarchyClass, depth: number) => {
    const open = expanded.has(node.code);
    const names = moleculesByClass.get(node.code) ?? [];
    const count = names.filter((n) => selectedSet.has(n)).length;
    const isAtc4 = Boolean(node.molecules);

    return (
      <div key={node.code}>
        <div
          className="group flex items-center gap-2 py-2 pr-2 rounded-lg hover:bg-surface-50 cursor-pointer"
          style={{ paddingLeft: 8 + depth * 18 }}
          onClick={() => toggleExpanded(node.code)}
        >
          <ChevronRight className={`w-4 h-4 text-surface-400 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
          <span className="font-mono text-[11px] text-surface-400 w-12 shrink-0">{node.code}</span>
          <span className={`flex-1 min-w-0 truncate text-sm ${depth === 0 ? "font-semibold text-surface-900" : "text-surface-700"}`}>
            {node.name}
          </span>
          {count > 0 && (
            <span className="text-[10px] font-semibold text-pharma-900 bg-pharma-50 border border-pharma-200 rounded-full px-2 py-0.5 shrink-0">
              {count} selected
            </span>
          )}
          <span className="text-xs text-surface-500 tabular-nums w-24 text-right shrink-0">{fmtAed(node.value)}</span>
          {isAtc4 && open && (
            <button
              onClick={(e) => { e.stopPropagation(); setClass(node.code, count < names.length); }}
              className="text-[11px] font-medium text-pharma-900 hover:underline shrink-0 w-16 text-right"
            >
              {count < names.length ? "Add all" : "Remove all"}
            </button>
          )}
        </div>

        {open && node.children?.map((child) => renderClass(child, depth + 1))}
        {open && node.molecules?.map((m) => (
          <div
            key={m.name}
            className="flex items-center gap-2 py-1.5 pr-2 rounded-lg hover:bg-surface-50"
            style={{ paddingLeft: 8 + (depth + 1) * 18 + 22 }}
          >
            <span className={`flex-1 min-w-0 truncate text-sm ${selectedSet.has(m.name) ? "text-pharma-900 font-medium" : "text-surface-700"}`}>
              {m.name}
            </span>
            <span className="text-xs text-surface-500 tabular-nums w-24 text-right shrink-0">{fmtAed(m.value)}</span>
            <AddToggle added={selectedSet.has(m.name)} onClick={() => toggle(m.name)} />
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
      {/* ── Left: IQVIA hierarchy ── */}
      <div className="bg-white shadow-sm border border-surface-200 rounded-xl">
        <div className="p-4 border-b border-surface-200 space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-surface-900">IQVIA market</h2>
            {hierarchy && <span className="text-xs text-surface-500">Value = {hierarchy.year} UAE sales</span>}
          </div>
          <div className="flex items-center gap-2 bg-white border border-surface-300 rounded-xl px-3 py-2 focus-within:border-pharma-300">
            <Search className="w-4 h-4 text-surface-500 shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search molecules, or browse the classes below"
              className="flex-1 bg-transparent text-sm text-surface-900 placeholder-surface-400 focus:outline-none"
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Clear search">
                <X className="w-4 h-4 text-surface-500 hover:text-surface-800" />
              </button>
            )}
          </div>
        </div>

        <div className="p-2 max-h-[64vh] overflow-y-auto">
          {!hierarchy && !loadError && (
            <div className="flex items-center gap-2 p-6 text-sm text-surface-500">
              <Loader2 className="w-4 h-4 animate-spin text-pharma-900" /> Loading IQVIA classes...
            </div>
          )}
          {loadError && <p className="p-6 text-sm text-rose-700">{loadError}</p>}

          {hierarchy && query.trim().length >= 2 && (
            searchResults.length ? searchResults.map((m) => (
              <div key={m.name} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-50">
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${selectedSet.has(m.name) ? "text-pharma-900 font-medium" : "text-surface-800"}`}>{m.name}</p>
                  <p className="text-[11px] text-surface-500 truncate">{m.classes.join(" · ")}</p>
                </div>
                <span className="text-xs text-surface-500 tabular-nums shrink-0">{fmtAed(m.value)}</span>
                <AddToggle added={selectedSet.has(m.name)} onClick={() => toggle(m.name)} />
              </div>
            )) : (
              <p className="p-6 text-sm text-surface-500">No molecules match &quot;{query}&quot;.</p>
            )
          )}

          {hierarchy && query.trim().length < 2 && hierarchy.classes.map((node) => renderClass(node, 0))}
        </div>
      </div>

      {/* ── Right: selection + import + save ── */}
      <div className="space-y-4 lg:sticky lg:top-24">
        <div className="bg-white shadow-sm border border-surface-200 rounded-xl">
          <div className="flex items-center justify-between p-4 border-b border-surface-200">
            <h2 className="text-sm font-semibold text-surface-900">
              Your portfolio <span className="text-surface-500 font-normal">({selected.length})</span>
            </h2>
            {selected.length > 0 && (
              <button onClick={() => setSelected([])} className="text-xs text-surface-500 hover:text-rose-700">
                Clear all
              </button>
            )}
          </div>
          <div className="p-2 max-h-[34vh] overflow-y-auto">
            {selected.length === 0 ? (
              <p className="p-4 text-sm text-surface-500">
                Add molecules from the IQVIA classes, search, or import a file.
              </p>
            ) : (
              selected.map((name) => (
                <div key={name} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-50">
                  <span className="flex-1 min-w-0 truncate text-sm text-surface-800">{name}</span>
                  <button onClick={() => toggle(name)} aria-label={`Remove ${name}`}>
                    <X className="w-3.5 h-3.5 text-surface-400 hover:text-rose-700" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Import from file */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) importFile(f);
          }}
          onClick={() => !importing && fileInput.current?.click()}
          className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors ${
            dragging ? "border-pharma-500/70 bg-pharma-900/5" : "border-surface-300 hover:border-pharma-300"
          }`}
        >
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.csv,.xlsx,.xls,.docx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importFile(f);
              e.target.value = "";
            }}
          />
          {importing ? (
            <div className="flex items-center justify-center gap-2 text-sm text-surface-600">
              <Loader2 className="w-4 h-4 animate-spin text-pharma-900" /> Reading file...
            </div>
          ) : (
            <>
              <Upload className="w-6 h-6 text-surface-400 mx-auto mb-2" />
              <p className="text-sm text-surface-700">Import from a file</p>
              <p className="text-xs text-surface-400 mt-0.5">PDF, CSV or Excel — molecules are added to your list</p>
            </>
          )}
        </div>
        {importNote && (
          <p className="flex items-start gap-2 text-xs text-surface-600 bg-surface-50 border border-surface-200 rounded-xl px-3 py-2">
            <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0 text-pharma-900" /> {importNote}
          </p>
        )}

        {error && (
          <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>
        )}

        <div className="flex gap-2">
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-4 py-2.5 rounded-xl border border-surface-300 text-sm text-surface-600 hover:text-surface-900 hover:bg-surface-100 transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            onClick={() => onSave(selected)}
            disabled={saving || selected.length === 0}
            className="flex-1 flex items-center justify-center gap-2 bg-pharma-900 text-white font-medium hover:bg-pharma-800 disabled:opacity-50 py-2.5 px-4 rounded-xl transition-colors text-sm"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Briefcase className="w-4 h-4" />}
            {saving ? "Saving..." : `Save portfolio (${selected.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
