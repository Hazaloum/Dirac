import { Minus, Plus } from "lucide-react";

export default function Stepper({
  value,
  onChange,
  min = 1,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
}) {
  const b = "flex h-11 w-11 items-center justify-center rounded-xl border border-surface-300 bg-white active:scale-95";
  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label="Less" className={b} onClick={() => onChange(Math.max(min, value - 1))}>
        <Minus size={18} />
      </button>
      <span className="w-8 text-center text-base font-semibold tabular-nums">{value}</span>
      <button type="button" aria-label="More" className={b} onClick={() => onChange(value + 1)}>
        <Plus size={18} />
      </button>
    </div>
  );
}
