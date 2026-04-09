"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FlaskConical, Users } from "lucide-react";

const navigation = [
  { name: "Analysis Agent", href: "/analysis", icon: FlaskConical },
  { name: "Outreach Agent", href: "/outreach", icon: Users },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-50 w-64 bg-white/80 backdrop-blur-xl border-r border-surface-200 flex flex-col shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 px-6 border-b border-surface-200">
        <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-pharma-800 to-pharma-900 shadow-lg shadow-pharma-900/20">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
          </svg>
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            <span className="gradient-text">COMIX BD</span>
          </h1>
          <p className="text-[10px] text-surface-500 uppercase tracking-widest">Intelligence Platform</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-6 space-y-1">
        {navigation.map(({ name, href, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link key={name} href={href}
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                active
                  ? "bg-pharma-50 text-pharma-900 border border-pharma-200 shadow-sm"
                  : "text-surface-600 hover:text-surface-900 hover:bg-surface-50"
              }`}>
              <Icon className={`w-5 h-5 transition-colors ${active ? "text-pharma-900" : "text-surface-400 group-hover:text-surface-600"}`} />
              <span className="flex-1">{name}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-surface-200">
        <div className="px-3 py-3 rounded-xl bg-surface-50 border border-surface-200 shadow-sm">
          <p className="text-xs text-surface-500 mb-1 font-medium">API Status</p>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-surface-700 font-medium">Connected</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
