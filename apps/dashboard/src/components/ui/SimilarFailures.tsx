"use client";
import { useState } from "react";
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

interface Props {
  runId: string;
}

const STATUS_COLOR: Record<string, string> = {
  failed: "text-red-400",
  error: "text-red-400",
  success: "text-green-400",
  replayed: "text-blue-400",
  running: "text-yellow-400",
};

function SimilarityBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 85 ? "bg-red-500" : pct >= 70 ? "bg-orange-500" : "bg-yellow-500";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-white/70 w-9">{pct}%</span>
    </div>
  );
}

export function SimilarFailures({ runId }: Props) {
  const [results, setResults] = useState<SimilarRun[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [embedStatus, setEmbedStatus] = useState<"idle" | "embedding" | "done" | "error">("idle");

  const apiKey = process.env.NEXT_PUBLIC_API_KEY ?? "dev-api-key-change-in-production";
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  const headers = { "X-API-Key": apiKey, "Content-Type": "application/json" };

  async function search() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${apiUrl}/api/runs/${runId}/similar?limit=5`, { headers });
      if (!res.ok) throw new Error(await res.text());
      const data: SimilarRun[] = await res.json();
      setResults(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function embed() {
    setEmbedStatus("embedding");
    try {
      const res = await fetch(`${apiUrl}/api/runs/${runId}/embed`, {
        method: "POST",
        headers,
      });
      if (!res.ok) throw new Error(await res.text());
      setEmbedStatus("done");
      // Auto-search after embedding
      await search();
    } catch (e: unknown) {
      setEmbedStatus("error");
      setError(e instanceof Error ? e.message : "Embed failed");
    }
  }

  return (
    <div className="space-y-4">
      {/* Header + actions */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="text-xs text-radar-muted uppercase tracking-widest">
            Semantic Similarity Search
          </div>
          <p className="text-white/50 text-xs mt-0.5">
            Find past runs with similar failure patterns using pgvector cosine search
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={embed}
            disabled={embedStatus === "embedding"}
            className="px-3 py-1.5 border border-radar-border text-radar-muted text-xs rounded hover:border-radar-accent hover:text-radar-accent transition-colors disabled:opacity-50"
          >
            {embedStatus === "embedding" ? (
              <><span className="animate-spin inline-block mr-1">↺</span>Embedding…</>
            ) : embedStatus === "done" ? (
              "✓ Embedded"
            ) : (
              "Embed this run"
            )}
          </button>
          <button
            onClick={search}
            disabled={loading}
            className="px-3 py-1.5 bg-radar-accent text-white text-xs rounded hover:bg-radar-accent/80 disabled:opacity-50 transition-colors"
          >
            {loading ? (
              <><span className="animate-spin inline-block mr-1">↺</span>Searching…</>
            ) : (
              "🔍 Find Similar"
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-red-400 text-xs p-3 bg-red-900/20 rounded border border-red-900/40">
          {error}
        </div>
      )}

      {results !== null && results.length === 0 && (
        <div className="text-radar-muted text-xs p-4 text-center border border-radar-border rounded">
          No similar runs found. Try embedding more runs first.
        </div>
      )}

      {results && results.length > 0 && (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_90px_60px_60px] gap-x-3 text-[10px] text-radar-muted uppercase tracking-widest pb-1 border-b border-radar-border/50">
            <div>Run</div>
            <div>Similarity</div>
            <div>Status</div>
            <div>Conf.</div>
          </div>
          {results.map((r) => (
            <div
              key={r.run_id}
              className="grid grid-cols-[1fr_90px_60px_60px] gap-x-3 items-center py-2 border-b border-radar-border/30 last:border-0"
            >
              <div>
                <Link
                  href={`/runs/${r.run_id}`}
                  className="font-mono text-xs text-radar-accent hover:underline"
                >
                  {r.run_id.slice(0, 8)}…
                </Link>
                {r.final_output && (
                  <p className="text-white/40 text-[10px] mt-0.5 line-clamp-1">
                    {r.final_output.slice(0, 80)}
                  </p>
                )}
              </div>
              <SimilarityBar value={r.similarity} />
              <span className={`text-xs font-medium ${STATUS_COLOR[r.status] ?? "text-white/60"}`}>
                {r.status}
              </span>
              <span className="text-xs tabular-nums text-white/60">
                {r.confidence_score !== null ? `${Math.round((r.confidence_score ?? 0) * 100)}%` : "—"}
              </span>
            </div>
          ))}
        </div>
      )}

      {results === null && !loading && (
        <div className="text-radar-muted text-xs p-4 text-center border border-dashed border-radar-border rounded">
          Click <strong className="text-white/60">Find Similar</strong> to search for runs with
          matching failure signatures.
          {" "}If no results appear, click <strong className="text-white/60">Embed this run</strong> first.
        </div>
      )}
    </div>
  );
}
