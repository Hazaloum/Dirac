"use client";

import { useEffect, useRef, useState } from "react";
import { api, type RegistryCompany } from "@/lib/api";

/** Text input with suggestions from the master-registry company list. Free text is still allowed. */
export function CompanyPicker({ value, onChange, placeholder, className }: {
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [options, setOptions] = useState<RegistryCompany[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const picked = useRef<string | null>(null);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2 || picked.current === value) { setOptions([]); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      api.searchRegistryCompanies(q)
        .then((rows) => { if (!cancelled) { setOptions(rows); setActive(0); } })
        .catch(() => { if (!cancelled) setOptions([]); });
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [value]);

  const choose = (c: RegistryCompany) => {
    picked.current = c.name;
    onChange(c.name);
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => { picked.current = null; onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !options.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, options.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); choose(options[active]); }
          else if (e.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        className={className}
      />
      {open && options.length > 0 && (
        <ul className="absolute z-30 mt-1 w-full max-h-72 overflow-auto bg-white border border-surface-200 rounded-xl shadow-lg py-1">
          {options.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); choose(c); }}
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
        </ul>
      )}
    </div>
  );
}
