"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function GroupNav({ groupId, isAdmin }: { groupId: string; isAdmin: boolean }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/g/${groupId}/picks`, label: "Picks" },
    { href: `/g/${groupId}/leaderboard`, label: "Leaderboard" },
    ...(isAdmin ? [{ href: `/g/${groupId}/admin`, label: "Admin" }] : []),
  ];

  return (
    <nav className="mb-5 flex gap-1 border-b border-edge" aria-label="Sections">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? "border-accent text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
