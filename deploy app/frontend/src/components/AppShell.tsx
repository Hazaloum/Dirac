"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login";

  if (isLogin) return <main>{children}</main>;

  return (
    <div className="matthew-app">
      <Sidebar />
      <main className="matthew-main">{children}</main>
    </div>
  );
}
