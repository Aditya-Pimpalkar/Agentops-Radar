"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.9"/>
        <rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.5"/>
        <rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.5"/>
        <rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity="0.9"/>
      </svg>
    ),
    description: "Overview & metrics",
  },
  {
    href: "/runs",
    label: "Runs",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M2 4h12M2 8h8M2 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    description: "Agent run history",
  },
  {
    href: "/alerts",
    label: "Alerts",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 1.5L14 13.5H2L8 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M8 6v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="8" cy="11.5" r="0.75" fill="currentColor"/>
      </svg>
    ),
    description: "Active alerts",
  },
  {
    href: "/playground",
    label: "Playground",
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <polygon points="3,2 13,8 3,14" fill="currentColor" opacity="0.9"/>
      </svg>
    ),
    description: "Live demo",
  },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="fixed left-0 top-0 h-full w-56 flex flex-col" style={{ background: "var(--card)", borderRight: "1px solid var(--border)" }}>
      {/* Brand */}
      <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-indigo-600 flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="2.5" fill="white"/>
              <circle cx="6" cy="6" r="5" stroke="white" strokeWidth="1.2" opacity="0.4"/>
            </svg>
          </div>
          <div>
            <div className="text-white font-semibold text-sm leading-none">AgentOps</div>
            <div className="text-xs leading-none mt-0.5" style={{ color: "var(--muted)" }}>Radar</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-0.5">
        {links.map((l) => {
          const active = pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors group"
              style={{
                background: active ? "var(--accent-soft)" : "transparent",
                color: active ? "var(--accent)" : "var(--muted-bright)",
              }}
            >
              <span className="shrink-0"
                style={{ color: active ? "var(--accent)" : "var(--muted)" }}>
                {l.icon}
              </span>
              <div>
                <div className="text-sm font-medium leading-none"
                  style={{ color: active ? "var(--accent)" : "#c8d0e0" }}>
                  {l.label}
                </div>
                <div className="text-xs leading-none mt-0.5"
                  style={{ color: "var(--muted)" }}>
                  {l.description}
                </div>
              </div>
              {active && (
                <div className="ml-auto w-1 h-4 rounded-full" style={{ background: "var(--accent)" }} />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4" style={{ borderTop: "1px solid var(--border)" }}>
        <a
          href="http://localhost:8000/docs"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 text-xs transition-colors"
          style={{ color: "var(--muted)" }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="1" y="1" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M4 6h4M4 4h4M4 8h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
          </svg>
          API Documentation
        </a>
      </div>
    </aside>
  );
}
