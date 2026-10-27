import type { MoleculeForecast } from "@/lib/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function fmtAed(v: number) {
  if (v >= 1_000_000_000) return `AED ${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000)     return `AED ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)         return `AED ${(v / 1_000).toFixed(0)}K`;
  return `AED ${v.toFixed(0)}`;
}

export function fmtUnits(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(1)}K`;
  return Math.round(v).toLocaleString();
}

// ─── XLSX export ──────────────────────────────────────────────────────────────
function applyFmts(ws: Record<string, any>, colFmts: Record<number, string>, nRows: number, XLSX: any) {
  for (const [col, fmt] of Object.entries(colFmts)) {
    for (let row = 1; row <= nRows; row++) {
      const addr = XLSX.utils.encode_cell({ r: row, c: Number(col) });
      if (ws[addr]) ws[addr].z = fmt;
    }
  }
}

const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);

/** Year columns ("Y1 UNITS" …), one per forecast year. */
function yearCols(label: string, values: number[]) {
  return Object.fromEntries(values.map((v, i) => [`Y${i + 1} ${label}`, Math.round(v)]));
}

/** Column index → format for a run of `n` columns starting at `from`. */
function fmtRun(from: number, n: number, fmt: string) {
  return Object.fromEntries(Array.from({ length: n }, (_, i) => [from + i, fmt]));
}

/** The two-sheet forecast workbook ("Forecast" pack detail + "Summary"). */
async function forecastWorkbook(forecasts: MoleculeForecast[], growthRate: number) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const n = forecasts[0]?.summary.revenue.length ?? 3;

  // Sheet 1 — Pack detail
  const packRows = forecasts.flatMap(f => {
    const topMfr = [...f.packs].sort((a, b) => b.pack_share - a.pack_share)[0]?.manufacturer ?? "";
    return f.packs.map(p => ({
      "MOLECULE":                f.molecule,
      "TOP PRODUCT":             f.product,
      "TOP MANUFACTURER":        topMfr,
      "TOTAL MKT UNITS":         Math.round(f.total_market_units),
      "TOTAL MKT VALUE (AED)":   Math.round(f.total_market_value),
      "MANUFACTURER":            p.manufacturer,
      "PACK":                    p.pack,
      "RETAIL (AED)":            parseFloat(p.retail_price.toFixed(2)),
      "CIF (AED)":               parseFloat(p.cif_price.toFixed(2)),
      "SHARE (%)":               parseFloat((p.pack_share * 100).toFixed(1)),
      ...yearCols("UNITS", p.units),
      ...yearCols("REV (AED)", p.revenue),
    }));
  });
  const packWs = XLSX.utils.json_to_sheet(packRows);
  // col 3=TOTAL MKT UNITS, 4=TOTAL MKT VALUE, 7=RETAIL, 8=CIF, 9=SHARE, then N units + N revenue columns
  applyFmts(packWs, {
    3: '#,##0', 4: '#,##0',
    7: '#,##0.00', 8: '#,##0.00',
    9: '0.0"%"',
    ...fmtRun(10, 2 * n, '#,##0'),
  }, packRows.length, XLSX);
  XLSX.utils.book_append_sheet(wb, packWs, "Forecast");

  // Sheet 2 — Molecule summary
  const summaryRows = forecasts.map(f => ({
    "MOLECULE":           f.molecule,
    "TOP PRODUCT":        f.product,
    "YEAR":               f.analysis_year,
    "COMPETITORS":        f.competitors,
    "PENETRATION (%)":    parseFloat(f.penetration_pct.replace("%", "")),
    "GROWTH RATE (%)":    Math.round(growthRate * 100),
    "MARKET VALUE (AED)": Math.round(f.total_market_value),
    ...yearCols("UNITS", f.summary.units),
    ...yearCols("REV (AED)", f.summary.revenue),
    [`${n}Y TOTAL (AED)`]: Math.round(sum(f.summary.revenue)),
  }));
  const summaryWs = XLSX.utils.json_to_sheet(summaryRows);
  applyFmts(summaryWs, {
    4: '0.0"%"', 5: '0"%"',
    6: '#,##0',
    ...fmtRun(7, 2 * n + 1, '#,##0'),
  }, summaryRows.length, XLSX);
  XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");
  return { XLSX, wb };
}

export function forecastFileName(forecasts: MoleculeForecast[]) {
  const what = forecasts.length === 1 ? forecasts[0].molecule.replace(/[^A-Za-z0-9]+/g, "_") : "Forecast";
  return `COMIX_${what}_${new Date().toISOString().slice(0, 10)}.xlsx`;
}

/** Download the forecast as XLSX. */
export async function exportXlsx(forecasts: MoleculeForecast[], growthRate: number) {
  const { XLSX, wb } = await forecastWorkbook(forecasts, growthRate);
  XLSX.writeFile(wb, forecastFileName(forecasts));
}

/** The same XLSX as a File, e.g. to attach to a deal. */
export async function forecastXlsxFile(forecasts: MoleculeForecast[], growthRate: number): Promise<File> {
  const { XLSX, wb } = await forecastWorkbook(forecasts, growthRate);
  const data = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new File([data], forecastFileName(forecasts),
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

