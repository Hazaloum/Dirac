import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { AccountStatus } from "@/lib/types";
import { lastSeen, typeLabel } from "@/lib/format";

export default function AccountRow({
  a,
  href,
  overdue,
}: {
  a: AccountStatus;
  href: string;
  overdue?: boolean;
}) {
  const sub = [typeLabel(a.type), a.specialty, a.area_name].filter(Boolean).join(" · ");
  return (
    <Link
      href={href}
      className={`flex min-h-[72px] items-center gap-3 rounded-2xl border p-4 active:scale-[0.99] ${
        overdue ? "border-amber-300 bg-amber-50" : "border-surface-200 bg-white"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold text-surface-900">{a.name}</div>
        <div className="truncate text-sm text-surface-600">{sub}</div>
        <div className={`text-xs ${overdue ? "font-semibold text-amber-700" : "text-surface-500"}`}>
          {lastSeen(a.last_visited_at)}
        </div>
      </div>
      <ChevronRight size={20} className="shrink-0 text-surface-400" />
    </Link>
  );
}
