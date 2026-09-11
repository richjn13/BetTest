"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function GroupNav({ groupId, isAdmin }: { groupId: string; isAdmin: boolean }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/g/${groupId}/picks`, label: "Picks" },
    { href: `/g/${groupId}/leaderboard`, label: "Leaderboard" },
    { href: `/g/${groupId}/profile`, label: "Profile" },
    ...(isAdmin ? [{ href: `/g/${groupId}/admin`, label: "Admin" }] : []),
  ];

  return (
    <nav
      className="-mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-edge px-4 sm:mx-0 sm:px-0
                 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="Sections"
    >
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm
              font-medium transition-colors ${
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
