"use client";
import { useState, useEffect } from "react";
import Link from "next/link";

interface SimilarRun {
  run_id: string;
  similarity: number;
  status: string;
  confidence_score: number | null;
  final_output: string | null;
  started_at: string | null;
  total_latency_ms: number | null;
}

interface Props { runId: string }

const STATUS_COLOR: Record<string, string> = {
  failed: "#f87171",
  error: "#f87171",
  success: "#4ade80",
  replayed: "#818cf8",
  running: "#fbbf24",
};

function SimilarityBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const barColor = pct >= 85 ? "#ef4444" : pct >= 70 ? "#f97316" : "#eab308";
  const textColor = pct >= 85 ? "#f87171" : pct >= 70 ? "#fb923c" : "#fbbf24";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border-bright)" }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: barColor }} />
      </div>
      <span className="mono text-xs w-8 text-right shrink-0" style={{ color: textColor }}>{pct}%</span>
    </div>
  );
}

export function SimilarFailures({ runId }: Props) {
  const [results, setResults] = useState<SimilarRun[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [embedding, setEmbedding] = useState(false);
  const [embedded, setEmbedded] = useState(false);

  const apiKey = process.env.NEXT_PUBLIC_API_KEY ?? "dev-api-key-change-in-production";
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  const headers = { "X-API-Key": apiKey, "Content-Type": "application/json" };

  async function search() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiUrl}/api/runs/${runId}/similar?limit=5`, { headers });
      if (!res.ok) throw new Error(await res.text());
      setResults(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  async function embed() {
    setEmbedding(true);
    setError("");
    try {
      const res = await fetch(`${apiUrl}/api/runs/${runId}/embed`, { method: "POST", headers });
      if (!res.ok) throw new Error(await res.text());
      setEmbedded(true);
      await search();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Embed failed");
      setEmbedding(false);
    }
  }

  // Auto-search on mount
  useEffect(() => { search(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm" style={{ color: "var(--muted)" }}>
        <span className="w-3 h-3 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
        Searching for similar failures…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div
          className="text-xs p-3 rounded-lg"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#fca5a5" }}
        >
          {error}
        </div>
      )}

      {/* Results */}
      {results && results.length > 0 ? (
        <div className="space-y-2">
          <div
            className="grid gap-x-4 text-xs pb-2"
            style={{
              gridTemplateColumns: "1fr 120px 70px 50px",
              color: "var(--muted)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div className="section-label">Run</div>
            <div className="section-label">Similarity</div>
            <div className="section-label">Status</div>
            <div className="section-label">Conf.</div>
          </div>
          {results.map((r) => (
            <div
              key={r.run_id}
              className="grid gap-x-4 items-center py-2.5 rounded-lg px-2 -mx-2 transition-colors"
              style={{
                gridTemplateColumns: "1fr 120px 70px 50px",
              }}
            >
              <div>
                <Link
                  href={`/runs/${r.run_id}`}
                  className="mono text-xs font-medium hover:underline"
                  style={{ color: "var(--accent)" }}
                >
                  {r.run_id.slice(0, 8)}…
                </Link>
                {r.final_output && (
                  <p className="text-xs mt-0.5 line-clamp-1" style={{ color: "var(--muted)" }}>
                    {r.final_output.slice(0, 70)}
                  </p>
                )}
              </div>
              <SimilarityBar value={r.similarity} />
              <span className="text-xs font-medium" style={{ color: STATUS_COLOR[r.status] ?? "rgba(255,255,255,0.6)" }}>
                {r.status}
              </span>
              <span className="mono text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
                {r.confidence_score != null ? `${Math.round(r.confidence_score * 100)}%` : "—"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div
          className="py-6 text-center space-y-3"
        >
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            No similar failures found.
          </div>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            This run hasn&apos;t been embedded yet. Generate an embedding to enable similarity search.
          </p>
          <button
            onClick={embed}
            disabled={embedding || embedded}
            className="btn-secondary mx-auto"
          >
            {embedding ? (
              <>
                <span className="w-3 h-3 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
                Generating embedding…
              </>
            ) : embedded ? (
              "✓ Embedded — searching…"
            ) : (
              "Generate embedding & search"
            )}
          </button>
        </div>
      )}

      {/* Refresh / re-embed actions */}
      {results !== null && results.length > 0 && (
        <div className="flex items-center gap-3 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
          <button onClick={search} className="btn-secondary text-xs py-1.5 px-3">
            Refresh
          </button>
          <button
            onClick={embed}
            disabled={embedding}
            className="btn-secondary text-xs py-1.5 px-3"
          >
            {embedding ? "Embedding…" : embedded ? "Re-embed" : "Re-embed this run"}
          </button>
          <span className="text-xs ml-auto" style={{ color: "var(--muted)" }}>
            pgvector · cosine similarity · text-embedding-3-small
          </span>
        </div>
      )}
    </div>
  );
}
