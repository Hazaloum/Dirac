"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api, type RegistryCompany } from "@/lib/api";

/** Pick a company from the master-registry company list. Shows the pick as a chip; typing only searches. */
export function CompanyPicker({ value, onChange, placeholder, className }: {
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<RegistryCompany[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setOptions([]); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      api.searchRegistryCompanies(q)
        .then((rows) => { if (!cancelled) { setOptions(rows); setActive(0); } })
        .catch(() => { if (!cancelled) setOptions([]); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  const choose = (name: string) => {
    onChange(name);
    setQuery("");
    setOptions([]);
    setOpen(false);
  };

  if (value) {
    return (
      <div className={`${className ?? ""} flex items-center justify-between`}>
        <span className="text-surface-900 truncate">{value}</span>
        <button type="button" onClick={() => onChange("")} title="Change company"
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
          else if (e.key === "Enter") { e.preventDefault(); choose(active < options.length ? options[active].name : typed); }
          else if (e.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        className={className}
      />
      {open && rows > 0 && (
        <ul className="absolute z-30 mt-1 w-full max-h-72 overflow-auto bg-white border border-surface-200 rounded-xl shadow-lg py-1">
          {options.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); choose(c.name); }}
                onMouseEnter={() => setActive(i)}
                className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between gap-3 ${i === active ? "bg-pharma-50" : ""}`}
              >
                <span className="text-surface-900 truncate">{c.name}</span>
                <span className="text-xs text-surface-500 shrink-0">
                  {c.products.toLocaleString()} products · {c.countries.length} {c.countries.length === 1 ? "country" : "countries"}
                </span>
              </button>
            </li>
          ))}
          <li className="border-t border-surface-100 mt-1 pt-1">
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); choose(typed); }}
              onMouseEnter={() => setActive(options.length)}
              className={`w-full text-left px-4 py-2 text-xs text-surface-500 ${active === options.length ? "bg-pharma-50" : ""}`}
            >
              {options.length ? "Not in the list?" : "No registered company found."} Use &ldquo;{typed}&rdquo; as a new company
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
