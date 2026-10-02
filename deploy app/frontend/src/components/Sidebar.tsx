"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenText,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  GitCompareArrows,
  Layers3,
  Radar,
  Boxes,
  Search,
  Users,
} from "lucide-react";

const groups = [
  {
    name: "Deals",
    pages: [
      { name: "Just Search", href: "/search", icon: Search },
      { name: "Catalogues", href: "/analysis", icon: BookOpenText },
      { name: "Pipeline", href: "/pipeline", icon: GitCompareArrows },
      { name: "Forecast", href: "/forecast", icon: ChartNoAxesCombined },
      { name: "Market Discovery", href: "/market-discovery", icon: Layers3 },
      { name: "My Portfolio", href: "/portfolio", icon: BriefcaseBusiness },
      { name: "Outreach", href: "/outreach", icon: Radar },
    ],
  },
  {
    name: "Operations",
    pages: [
      { name: "Inventory", href: "/inventory", icon: Boxes },
      { name: "Field Force", href: "/field-force", icon: Users },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const group = groups.find((g) => g.pages.some((p) => pathname.startsWith(p.href))) ?? groups[0];

  return (
    <header className="matthew-header">
      <div className="matthew-header__inner">
        <Link href="/search" className="matthew-brand" aria-label="Dirac home">
          <span className="matthew-mark" aria-hidden="true">
            <span />
          </span>
          <span>
            <strong>Dirac</strong>
            <small>COMIX BD Intelligence</small>
          </span>
        </Link>

        <nav className="matthew-groups" aria-label="Sections">
          {groups.map((g) => (
            <Link key={g.name} href={g.pages[0].href} className={g === group ? "is-active" : ""}>
              {g.name}
            </Link>
          ))}
        </nav>

        <nav className="matthew-nav" aria-label={`${group.name} pages`}>
          {group.pages.map(({ name, href, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link key={name} href={href} className={active ? "is-active" : ""}>
                <Icon aria-hidden="true" />
                <span>{name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="matthew-market">
          <span /> UAE · Private
        </div>
      </div>
    </header>
  );
}
