"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenText,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  GitCompareArrows,
  Radar,
} from "lucide-react";

const navigation = [
  { name: "Catalogues", href: "/analysis", icon: BookOpenText },
  { name: "Pipeline", href: "/pipeline", icon: GitCompareArrows },
  { name: "Forecast", href: "/forecast", icon: ChartNoAxesCombined },
  { name: "My Portfolio", href: "/portfolio", icon: BriefcaseBusiness },
  { name: "Outreach", href: "/outreach", icon: Radar },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <header className="matthew-header">
      <div className="matthew-header__inner">
        <Link href="/analysis" className="matthew-brand" aria-label="Dirac home">
          <span className="matthew-mark" aria-hidden="true">
            <span />
          </span>
          <span>
            <strong>Dirac</strong>
            <small>COMIX BD Intelligence</small>
          </span>
        </Link>

        <nav className="matthew-nav" aria-label="Primary navigation">
          {navigation.map(({ name, href, icon: Icon }) => {
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
