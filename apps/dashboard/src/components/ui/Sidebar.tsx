"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/dashboard", label: "Dashboard", icon: "◈" },
  { href: "/runs", label: "Runs", icon: "⟐" },
  { href: "/alerts", label: "Alerts", icon: "⚠" },
  { href: "/playground", label: "Playground", icon: "▷" },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="fixed left-0 top-0 h-full w-56 border-r border-radar-border bg-radar-card flex flex-col">
      <div className="p-5 border-b border-radar-border">
        <div className="text-radar-accent font-bold text-lg tracking-tight">AgentOps</div>
        <div className="text-radar-muted text-xs mt-0.5">Radar · v1.0</div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={[
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
              pathname.startsWith(l.href)
                ? "bg-radar-accent/20 text-radar-accent"
                : "text-radar-muted hover:text-white hover:bg-white/5",
            ].join(" ")}
          >
            <span className="text-base">{l.icon}</span>
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="p-4 border-t border-radar-border text-xs text-radar-muted">
        <a href="http://localhost:8000/docs" target="_blank" rel="noreferrer" className="hover:text-white">
          API Docs →
        </a>
      </div>
    </aside>
  );
}
