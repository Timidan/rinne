import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import BrandMark from "./BrandMark";
import ThemeToggle from "./ThemeToggle";
import InkField from "./InkField";

// Shared chrome for the hosted guard dashboard: sticky header with brand, the
// dashboard nav, and the theme toggle.
const NAV = [
  { to: "/app/dashboard", label: "Overview" },
  { to: "/app/agents", label: "Agents" },
];

export default function DashboardShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <>
      <InkField calm />
      <main className="min-h-screen text-ink">
      <header className="sticky top-0 z-40 border-b border-line bg-[color-mix(in_srgb,var(--color-bg)_82%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-3 font-display text-xl font-extrabold tracking-tight">
              <BrandMark className="size-9" />
              Rinne
            </Link>
            <nav className="hidden items-center gap-1 sm:flex">
              {NAV.map((item) => {
                const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    aria-current={active ? "page" : undefined}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                      active ? "bg-blue text-white" : "text-ink hover:bg-card"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-10">{children}</div>
    </main>
    </>
  );
}
