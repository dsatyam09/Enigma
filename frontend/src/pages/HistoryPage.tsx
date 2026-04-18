import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Filter, RefreshCw, Trophy, X } from "lucide-react";
import { Link } from "react-router-dom";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Card, CardContent } from "@/components/ui/card";
import api from "@/lib/api";

interface HistoryEntry {
  player_name: string;
  rating: number;
  timestamp: string;
}

interface HistoryFilters {
  player_name?: string;
  from_date?: string;
  to_date?: string;
}

function fmtNum(value: number) {
  return value.toLocaleString("en-US");
}

function fmtDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getAvatarClass(name: string): string {
  const palette = [
    "bg-violet-500",
    "bg-blue-500",
    "bg-emerald-500",
    "bg-amber-500",
    "bg-rose-500",
    "bg-cyan-600",
    "bg-indigo-500",
    "bg-pink-500",
  ];
  const hash = [...name].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return palette[hash % palette.length];
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="w-0.5 h-5 rounded-full bg-iu-crimson shrink-0" />
      <h2 className="text-sm font-semibold tracking-wide text-foreground">{children}</h2>
    </div>
  );
}

export default function HistoryPage() {
  const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

  const [rows, setRows] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(25);

  const [playerFilter, setPlayerFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const buildFilters = useCallback((): HistoryFilters => {
    const filters: HistoryFilters = {};
    if (playerFilter.trim()) filters.player_name = playerFilter.trim();
    if (fromDate) filters.from_date = fromDate;
    if (toDate) filters.to_date = toDate;
    return filters;
  }, [playerFilter, fromDate, toDate]);

  const fetchHistory = useCallback(
    async (forcedFilters?: HistoryFilters) => {
      setLoading(true);
      setError("");

      try {
        const params = forcedFilters ?? buildFilters();
        const res = await api.get<HistoryEntry[]>("/history", { params });
        setRows(res.data);
        setCurrentPage(1);
        setLastUpdated(new Date());
      } catch (err: unknown) {
        const message =
          (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
          "Failed to load history.";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [buildFilters],
  );

  useEffect(() => {
    void fetchHistory({});
  }, [fetchHistory]);

  const clearFilters = () => {
    setPlayerFilter("");
    setFromDate("");
    setToDate("");
    void fetchHistory({});
  };

  const historyStats = useMemo(() => {
    if (rows.length === 0) return { highest: 0, lowest: 0 };
    return rows.reduce(
      (acc, row) => ({
        highest: Math.max(acc.highest, row.rating),
        lowest: Math.min(acc.lowest, row.rating),
      }),
      { highest: rows[0].rating, lowest: rows[0].rating },
    );
  }, [rows]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(rows.length / pageSize)), [rows.length, pageSize]);
  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, currentPage, pageSize]);
  const pageStart = rows.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(rows.length, currentPage * pageSize);
  const pageButtons = useMemo(() => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, start + 4);
    const adjustedStart = Math.max(1, end - 4);
    return Array.from({ length: end - adjustedStart + 1 }, (_, i) => adjustedStart + i);
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  return (
    <div className="min-h-screen bg-background">
      {/* Ambient gradient overlay */}
      <div
        className="fixed inset-0 -z-10 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 20% -10%, rgba(99,102,241,0.05) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 80% 110%, rgba(153,0,0,0.04) 0%, transparent 60%)",
        }}
      />

      {/* Sticky header */}
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="sticky top-0 z-30 border-b border-border/60 backdrop-blur-xl bg-background/80"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <img src="/logo.png" alt="Indiana University" className="w-9 h-9 object-contain shrink-0" />
          <div>
            <h1 className="text-base font-bold text-foreground leading-none">History</h1>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Loading..."}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-0.5">
            <ThemeToggle />
            <Link
              to="/leaderboard"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Trophy className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Leaderboard</span>
            </Link>
            <button
              onClick={() => void fetchHistory()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>
      </motion.header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-12">
        {/* Filters */}
        <Card className="border-border/60">
          <CardContent className="p-5 sm:p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Player Name</label>
                <input
                  value={playerFilter}
                  onChange={(e) => setPlayerFilter(e.target.value)}
                  className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/60 transition-colors"
                  placeholder="Filter by player name..."
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">From</label>
                <input
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/60 transition-colors"
                  type="datetime-local"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">To</label>
                <input
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/60 transition-colors"
                  type="datetime-local"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void fetchHistory()}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-iu-crimson px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
              >
                <Filter className="w-4 h-4" />
                Apply Filters
              </button>
              <button
                onClick={clearFilters}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4" />
                Clear
              </button>
            </div>
          </CardContent>
        </Card>

        {error ? (
          <p className="text-sm text-destructive border border-destructive/30 rounded-xl px-4 py-3 bg-destructive/5">{error}</p>
        ) : null}

        {!loading && rows.length > 0 ? (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Records", value: fmtNum(rows.length) },
              { label: "Highest Score", value: fmtNum(historyStats.highest) },
              { label: "Lowest Score", value: fmtNum(historyStats.lowest) },
              { label: "Newest Entry", value: rows[0]?.player_name ?? "-", small: true },
            ].map(({ label, value, small }) => (
              <div key={label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <p className={`font-bold text-foreground mt-1 truncate ${small ? "text-sm" : "text-xl"}`}>{value}</p>
              </div>
            ))}
          </motion.div>
        ) : null}

        <section className="space-y-3">
          <SectionHeader>Submission History</SectionHeader>

          <Card className="border-border/60 overflow-hidden">
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span className="text-sm">Loading history...</span>
                </div>
              ) : rows.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
                  <Filter className="w-8 h-8 opacity-25" />
                  <span className="text-sm">No entries found for the selected filters.</span>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="py-3 pl-4 pr-2 text-left font-medium text-muted-foreground w-14">#</th>
                        <th className="py-3 px-3 text-left font-medium text-muted-foreground">Player</th>
                        <th className="py-3 px-3 text-right font-medium text-muted-foreground">Rating</th>
                        <th className="py-3 px-3 text-right font-medium text-muted-foreground">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {pagedRows.map((entry, idx) => (
                        <tr
                          key={`${entry.player_name}-${entry.rating}-${entry.timestamp}-${idx}`}
                          className="hover:bg-muted/25 transition-colors"
                        >
                          <td className="py-2.5 pl-4 pr-2 font-mono text-xs text-muted-foreground">
                            {(currentPage - 1) * pageSize + idx + 1}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 ${getAvatarClass(entry.player_name)}`}>
                                {initials(entry.player_name)}
                              </div>
                              <span className="font-semibold text-foreground truncate">{entry.player_name}</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-foreground tabular-nums">{fmtNum(entry.rating)}</td>
                          <td className="py-2.5 px-3 text-right text-muted-foreground text-xs">{fmtDate(entry.timestamp)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {!loading && rows.length > 0 ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-border px-4 py-3">
                  <p className="text-xs text-muted-foreground">
                    {fmtNum(pageStart)}–{fmtNum(pageEnd)} of {fmtNum(rows.length)} records
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2">
                      <label htmlFor="page-size" className="text-xs text-muted-foreground">
                        Rows
                      </label>
                      <select
                        id="page-size"
                        value={pageSize}
                        onChange={(e) => {
                          setPageSize(Number(e.target.value) as (typeof PAGE_SIZE_OPTIONS)[number]);
                          setCurrentPage(1);
                        }}
                        className="h-8 rounded-lg border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/40"
                      >
                        {PAGE_SIZE_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </div>

                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
                    >
                      Prev
                    </button>

                    {pageButtons.map((page) => (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`h-8 min-w-8 rounded-lg border px-2 text-xs font-medium transition-colors ${
                          currentPage === page
                            ? "border-iu-crimson bg-iu-crimson text-white"
                            : "border-border bg-card text-foreground hover:bg-muted"
                        }`}
                      >
                        {page}
                      </button>
                    ))}

                    <button
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
