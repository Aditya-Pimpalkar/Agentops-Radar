"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ResolveAlertButton({ alertId }: { alertId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function resolve() {
    setLoading(true);
    const apiKey = process.env.NEXT_PUBLIC_API_KEY ?? "dev-api-key-change-in-production";
    await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/alerts/${alertId}/resolve`,
      { method: "PATCH", headers: { "X-API-Key": apiKey } },
    );
    setLoading(false);
    router.refresh();
  }

  return (
    <button
      onClick={resolve}
      disabled={loading}
      className="text-xs text-radar-muted hover:text-white border border-radar-border hover:border-white/30 px-2 py-1 rounded transition-colors disabled:opacity-50"
    >
      {loading ? "…" : "Resolve"}
    </button>
  );
}
