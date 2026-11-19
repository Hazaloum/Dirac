"use client";

import { useState } from "react";
import type { ExhibitorPortfolio } from "@/lib/api";
import { fmtAed } from "@/lib/forecastExport";

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
const country = (c: string) => (c === "AE" ? "UAE" : c);

/** A registry company's portfolio: molecules grouped by ATC1, with UAE IQVIA market value, countries and UAE status. */
export function RegistryPortfolio({ data }: { data: ExhibitorPortfolio }) {
  const [notInUaeOnly, setNotInUaeOnly] = useState(false);
  const groups = data.groups
    .map((g) => ({ ...g, molecules: g.molecules.filter((m) => !notInUaeOnly || !m.in_uae) }))
    .filter((g) => g.molecules.length > 0);
  const all = data.groups.flatMap((g) => g.molecules);
  const notInUae = all.filter((m) => !m.in_uae).length;
  return (
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
                      <td className="px-2 py-1.5 text-right tabular-nums text-surface-700">{m.market_value_aed == null
                        ? <span className="text-surface-400" title="Not found in UAE IQVIA">—</span>
                        : m.market_value_aed > 0 ? fmtAed(m.market_value_aed)
                        : <span className="text-surface-500" title={`In IQVIA but no UAE sales in ${data.iqvia_year}`}>No sales</span>}</td>
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
        <p className="text-[11px] text-surface-400">From the master registry (EU, US, UAE registers). Market value: UAE IQVIA, combinations divided by their molecule count. — = not in UAE IQVIA; No sales = in IQVIA but nothing sold that year.</p>
      </div>
  );
}
