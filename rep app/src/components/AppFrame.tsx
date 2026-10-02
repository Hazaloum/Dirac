"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarCheck, CalendarDays, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";

const TABS = [
  { href: "/", label: "Today", Icon: CalendarCheck },
  { href: "/accounts", label: "Accounts", Icon: Users },
  { href: "/week", label: "My week", Icon: CalendarDays },
];

export default function AppFrame({ children }: { children: ReactNode }) {
  const { loading, session, rep, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/login";

  useEffect(() => {
    if (!loading && !session && !isLogin) router.replace("/login");
  }, [loading, session, isLogin, router]);

  if (isLogin) return <>{children}</>;

  if (loading || !session) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-surface-500">Loading…</div>
    );
  }

  if (!rep || !rep.active) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 text-center">
        <p className="text-lg font-semibold text-surface-900">
          Your account isn&apos;t set up yet — contact COMIX
        </p>
        <button className="btn-secondary" onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  // The visit form has its own sticky save bar, so hide the tab bar there.
  const hideTabs = pathname.startsWith("/visit/") || pathname === "/accounts/new";

  return (
    <div className="mx-auto min-h-dvh max-w-xl">
      <main className={hideTabs ? "px-4 pb-32 pt-4" : "px-4 pb-28 pt-4"}>{children}</main>
      {!hideTabs && (
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-surface-200 bg-white pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto grid max-w-xl grid-cols-3">
            {TABS.map(({ href, label, Icon }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                    active ? "text-pharma-900" : "text-surface-500"
                  }`}
                >
                  <Icon size={22} />
                  {label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
