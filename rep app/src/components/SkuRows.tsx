"use client";

import { Plus, X } from "lucide-react";
import type { Sku } from "@/lib/types";
import { skuLabel } from "@/lib/format";
import Stepper from "./Stepper";

export interface SkuLine {
  key: number;
  pack_key: string;
  quantity: number;
  batch?: string;
}

/** Group SKUs by molecule for <optgroup>. */
function groups(skus: Sku[]): [string, Sku[]][] {
  const m = new Map<string, Sku[]>();
  for (const s of skus) m.set(s.molecule, [...(m.get(s.molecule) ?? []), s]);
  return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

export default function SkuRows({
  skus,
  lines,
  onChange,
  addLabel,
  withBatch,
}: {
  skus: Sku[];
  lines: SkuLine[];
  onChange: (l: SkuLine[]) => void;
  addLabel: string;
  withBatch?: boolean;
}) {
  const g = groups(skus);
  const patch = (key: number, p: Partial<SkuLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...p } : l)));
  return (
    <div className="space-y-3">
      {lines.map((l) => (
        <div key={l.key} className="card space-y-3">
          <div className="flex items-center gap-2">
            <select
              className="field"
              value={l.pack_key}
              onChange={(e) => patch(l.key, { pack_key: e.target.value })}
            >
              <option value="">Choose a product…</option>
              {g.map(([mol, items]) => (
                <optgroup key={mol} label={mol}>
                  {items.map((s) => (
                    <option key={s.pack_key} value={s.pack_key}>
                      {skuLabel(s)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              aria-label="Remove"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-surface-500 active:scale-95"
              onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
            >
              <X size={20} />
            </button>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Stepper value={l.quantity} onChange={(n) => patch(l.key, { quantity: n })} />
            {withBatch && (
              <input
                className="field !min-h-[44px] max-w-[9rem]"
                placeholder="Batch (opt.)"
                value={l.batch ?? ""}
                onChange={(e) => patch(l.key, { batch: e.target.value })}
              />
            )}
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn-secondary flex items-center justify-center gap-2"
        onClick={() =>
          onChange([...lines, { key: Date.now() + lines.length, pack_key: "", quantity: 1 }])
        }
      >
        <Plus size={18} /> {addLabel}
      </button>
    </div>
  );
}
