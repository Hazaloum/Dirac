"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { api, type CompanyPick, type RegistryCompany } from "@/lib/api";

/** Pick a company from the master-registry company directory. Results are company groups (Pfizer = all its
 *  subsidiaries); ▸ shows a group's companies, each pickable too. Shows the pick as a chip; typing only searches.
 *  onChange also gets the registry company (null for "Use … as a new company"). */
export function CompanyPicker({ value, onChange, placeholder, className }: {
  value: string;
  onChange: (name: string, pick: CompanyPick | null) => void;
  placeholder?: string;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<RegistryCompany[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setOptions([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api.searchRegistryCompanies(q)
        .then((rows) => { if (!cancelled) { setOptions(rows); setActive(0); setExpanded(null); } })
        .catch(() => { if (!cancelled) setOptions([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  // A group is filed under its biggest company; members are sorted by products.
  const chooseGroup = (c: RegistryCompany) =>
    choose(c.name, c.members.length ? { company_id: c.members[0].id, whole_group: true } : null);

  const choose = (name: string, pick: CompanyPick | null) => {
    onChange(name, pick);
    setQuery("");
    setOptions([]);
    setOpen(false);
  };

  if (value) {
    return (
      <div className={`${className ?? ""} flex items-center justify-between`}>
        <span className="text-surface-900 truncate">{value}</span>
        <button type="button" onClick={() => onChange("", null)} title="Change company"
          className="text-surface-400 hover:text-surface-700 shrink-0 ml-2">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  const typed = query.trim();
  // The last row lets a company that isn't in any registry yet still be used.
  const rows = options.length + (typed.length >= 2 ? 1 : 0);

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !rows) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, rows - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); if (active < options.length) chooseGroup(options[active]); else choose(typed, null); }
          else if (e.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        className={className}
      />
      {open && rows > 0 && (
        <ul className="absolute z-30 mt-1 w-full max-h-72 overflow-auto bg-white border border-surface-200 rounded-xl shadow-lg py-1">
          {loading && (
            <li className="px-4 py-2 text-xs text-surface-500 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching the company directory…
            </li>
          )}
          {options.map((c, i) => (
            <li key={c.group_key}>
              <div className={`flex items-center ${i === active ? "bg-pharma-50" : ""}`} onMouseEnter={() => setActive(i)}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); chooseGroup(c); }}
                  className="flex-1 min-w-0 text-left px-4 py-2 text-sm flex items-center justify-between gap-3"
                >
                  <span className="text-surface-900 truncate">{c.name}</span>
                  <span className="text-xs text-surface-500 shrink-0">
                    {c.products.toLocaleString()} products · {c.countries.length} {c.countries.length === 1 ? "country" : "countries"}
                  </span>
                </button>
                {c.members.length > 1 && (
                  <button type="button" title="Show the companies in this group"
                    onMouseDown={(e) => { e.preventDefault(); setExpanded(expanded === c.group_key ? null : c.group_key); }}
                    className="shrink-0 px-3 py-2 text-xs text-pharma-900 font-medium">
                    {c.members.length} {expanded === c.group_key ? "▾" : "▸"}
                  </button>
                )}
              </div>
              {expanded === c.group_key && (
                <ul className="bg-surface-50 border-y border-surface-100">
                  {c.members.map((m) => (
                    <li key={m.id}>
                      <button type="button" onMouseDown={(e) => { e.preventDefault(); choose(m.name, { company_id: m.id, whole_group: false }); }}
                        className="w-full text-left pl-8 pr-4 py-1.5 text-xs flex justify-between gap-3 hover:bg-pharma-50">
                        <span className="text-surface-700 truncate">{m.name}</span>
                        <span className="text-surface-500 shrink-0">{m.products} · {m.countries.join(" ")}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          <li className="border-t border-surface-100 mt-1 pt-1">
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); choose(typed, null); }}
              onMouseEnter={() => setActive(options.length)}
              className={`w-full text-left px-4 py-2 text-xs text-surface-500 ${active === options.length ? "bg-pharma-50" : ""}`}
            >
              {options.length || loading ? "Not in the list?" : "No registered company found."} Use &ldquo;{typed}&rdquo; as a new company
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
