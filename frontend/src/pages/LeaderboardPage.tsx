import { useCallback, useEffect, useMemo, useRef, useState, type ElementType, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BarChart3,
  ExternalLink,
  FlaskConical,
  History as HistoryIcon,
  Plus,
  RefreshCw,
  Target,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import api from "@/lib/api";

interface RatingEntry {
  player_name: string;
  rating: number;
  timestamp: string;
}

interface InfoStats {
  count: number;
  mean: number;
  median: number;
  std_dev: number;
  min: number;
  max: number;
  q1: number;
  q3: number;
  iqr: number;
}

interface EndpointMetrics {
  avg_ms: number;
  min_ms: number;
  max_ms: number;
  requests: number;
}

type PerformanceData = Record<string, EndpointMetrics>;
type RankMovementDirection = "up" | "down";

interface RankMovement {
  direction: RankMovementDirection;
  expiresAt: number;
}

const DISPLAY_PERFORMANCE_ENDPOINTS = new Set([
  "/add",
  "/remove",
  "/leaderboard",
  "/info",
  "/performance",
  "/history",
]);
const LIVE_POLL_INTERVAL_MS = 500;
const RANK_MOVEMENT_TTL_MS = 1800;
const STRESS_REPORT_POLL_INTERVAL_MS = 2000;

function fmtNum(value: number) {
  return value.toLocaleString("en-US");
}

function fmtStat(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtMs(value: number) {
  return `${value.toFixed(1)} ms`;
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

function getEntryKey(entry: RatingEntry) {
  return `${entry.player_name}|${entry.rating}|${entry.timestamp}`;
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
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

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <div className="flex items-center gap-1">
        <span className="text-sm leading-none">👑</span>
        <span className="text-sm font-bold text-amber-500">#1</span>
      </div>
    );
  if (rank === 2) return <span className="text-sm font-bold text-slate-400">#2</span>;
  if (rank === 3) return <span className="text-sm font-bold text-orange-500">#3</span>;
  return <span className="font-mono text-sm text-muted-foreground">{rank}</span>;
}

function StatPill({
  icon: Icon,
  label,
  value,
  sub,
  iconClass = "bg-primary/10 text-primary",
}: {
  icon: ElementType;
  label: string;
  value: string | number;
  sub?: string;
  iconClass?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm hover:shadow-md transition-all duration-200">
      <div className={`p-2.5 rounded-xl shrink-0 ${iconClass}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground leading-none mb-1">{label}</p>
        <p className="text-xl font-bold text-foreground leading-none">{value}</p>
        {sub ? <p className="text-[10px] text-muted-foreground mt-1 truncate">{sub}</p> : null}
      </div>
    </div>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-4 min-h-[108px] flex flex-col justify-between">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-[1.75rem] leading-none font-bold text-foreground tabular-nums">{value}</p>
    </div>
  );
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="w-0.5 h-5 rounded-full bg-iu-crimson shrink-0" />
      <h2 className="text-sm font-semibold tracking-wide text-foreground">{children}</h2>
    </div>
  );
}

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<RatingEntry[]>([]);
  const [info, setInfo] = useState<InfoStats | null>(null);
  const [performance, setPerformance] = useState<PerformanceData>({});
  const [selectedEntry, setSelectedEntry] = useState<RatingEntry | null>(null);
  const [addDrawerOpen, setAddDrawerOpen] = useState(false);
  const [stressDrawerOpen, setStressDrawerOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [formLoading, setFormLoading] = useState(false);
  const [stressLoading, setStressLoading] = useState(false);
  const [stressRunning, setStressRunning] = useState(false);
  const [stressReportReady, setStressReportReady] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState("");
  const [stressError, setStressError] = useState("");
  const [isTabVisible, setIsTabVisible] = useState(
    typeof document === "undefined" ? true : !document.hidden,
  );
  const [rankMovements, setRankMovements] = useState<Record<string, RankMovement>>({});

  const [playerName, setPlayerName] = useState("");
  const [ratingValue, setRatingValue] = useState("");
  const [stressUsers, setStressUsers] = useState("100");
  const [stressSpawnRate, setStressSpawnRate] = useState("20");
  const [stressRunTimeSeconds, setStressRunTimeSeconds] = useState("20");
  const fetchInFlightRef = useRef(false);
  const prevRankMapRef = useRef<Record<string, number>>({});
  const stressReportPollRef = useRef<number | null>(null);
  const stressReportCheckInFlightRef = useRef(false);
  const stressReportUrl = useMemo(() => {
    const baseUrl = (api.defaults.baseURL ?? "").toString().trim();
    if (!baseUrl || baseUrl === "/") return "/stress-test/report";
    const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    return `${normalizedBase}/stress-test/report`;
  }, []);

  const fetchAll = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (fetchInFlightRef.current) return;
    fetchInFlightRef.current = true;

    if (!silent) {
      setLoading(true);
      setError("");
    }

    try {
      const [leaderboardRes, infoRes, performanceRes] = await Promise.allSettled([
        api.get<RatingEntry[]>("/leaderboard"),
        api.get<InfoStats>("/info"),
        api.get<PerformanceData>("/performance"),
      ]);

      if (leaderboardRes.status === "fulfilled") {
        const nextEntries = leaderboardRes.value.data;
        const now = Date.now();
        const nextRankMap: Record<string, number> = {};
        const nextRankMovements: Record<string, RankMovement> = {};

        nextEntries.forEach((entry, index) => {
          const key = getEntryKey(entry);
          nextRankMap[key] = index;

          const prevIndex = prevRankMapRef.current[key];
          if (prevIndex === undefined || prevIndex === index) return;
          nextRankMovements[key] = {
            direction: prevIndex > index ? "up" : "down",
            expiresAt: now + RANK_MOVEMENT_TTL_MS,
          };
        });

        prevRankMapRef.current = nextRankMap;
        setEntries(nextEntries);
        setRankMovements((prev) => {
          const activeEntries = Object.entries(prev).filter(([, movement]) => movement.expiresAt > now);
          const activeMap = Object.fromEntries(activeEntries);
          return { ...activeMap, ...nextRankMovements };
        });
      } else {
        throw leaderboardRes.reason;
      }

      if (infoRes.status === "fulfilled") {
        setInfo(infoRes.value.data);
      } else {
        setInfo(null);
      }

      if (performanceRes.status === "fulfilled") {
        setPerformance(performanceRes.value.data);
      } else {
        setPerformance({});
      }

    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        "Failed to load leaderboard data.";
      setError(message);
    } finally {
      fetchInFlightRef.current = false;
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  const stopStressReportPolling = useCallback(() => {
    if (stressReportPollRef.current !== null) {
      window.clearInterval(stressReportPollRef.current);
      stressReportPollRef.current = null;
    }
  }, []);

  const checkStressReportReady = useCallback(async () => {
    if (stressReportCheckInFlightRef.current) return;
    stressReportCheckInFlightRef.current = true;

    try {
      const reportRes = await api.get<string>("/stress-test/report", {
        responseType: "text",
        validateStatus: () => true,
      });

      if (reportRes.status === 200) {
        stopStressReportPolling();
        setStressRunning(false);
        setStressReportReady(true);
        void fetchAll({ silent: true });
      }
    } finally {
      stressReportCheckInFlightRef.current = false;
    }
  }, [fetchAll, stopStressReportPolling]);

  const startStressReportPolling = useCallback(() => {
    stopStressReportPolling();
    void checkStressReportReady();
    stressReportPollRef.current = window.setInterval(() => {
      void checkStressReportReady();
    }, STRESS_REPORT_POLL_INTERVAL_MS);
  }, [checkStressReportReady, stopStressReportPolling]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const onVisibilityChange = () => setIsTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    if (!isTabVisible) return;
    const interval = window.setInterval(() => {
      void fetchAll({ silent: true });
    }, LIVE_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [fetchAll, isTabVisible]);

  useEffect(() => {
    const prune = window.setInterval(() => {
      const now = Date.now();
      setRankMovements((prev) => {
        const keptEntries = Object.entries(prev).filter(([, movement]) => movement.expiresAt > now);
        if (keptEntries.length === Object.keys(prev).length) return prev;
        return Object.fromEntries(keptEntries);
      });
    }, 500);
    return () => window.clearInterval(prune);
  }, []);

  useEffect(() => {
    return () => {
      stopStressReportPolling();
    };
  }, [stopStressReportPolling]);

  const topScore = entries[0]?.rating ?? 0;
  const avgScore = entries.length
    ? Math.round(entries.reduce((sum, item) => sum + item.rating, 0) / entries.length)
    : 0;
  const leaderboardAvgLatency = useMemo(() => {
    const leaderboardMetric = Object.entries(performance).find(
      ([endpoint]) => endpoint.split("?")[0] === "/leaderboard",
    )?.[1];
    if (!leaderboardMetric) return 0;
    return Math.round(leaderboardMetric.avg_ms * 10) / 10;
  }, [performance]);
  const performanceRows = useMemo(
    () =>
      Object.entries(performance)
        .filter(([endpoint]) => DISPLAY_PERFORMANCE_ENDPOINTS.has(endpoint.split("?")[0]))
        .sort(([a], [b]) => a.localeCompare(b)),
    [performance],
  );
  const totalPerformanceRequests = useMemo(
    () => performanceRows.reduce((sum, [, metric]) => sum + metric.requests, 0),
    [performanceRows],
  );

  const selectedDetails = useMemo(() => {
    if (!selectedEntry) return null;

    const index = entries.findIndex(
      (item) =>
        item.player_name === selectedEntry.player_name &&
        item.rating === selectedEntry.rating &&
        item.timestamp === selectedEntry.timestamp,
    );
    const rank = index >= 0 ? index + 1 : null;
    const gapToTop = Math.max((entries[0]?.rating ?? selectedEntry.rating) - selectedEntry.rating, 0);
    const percentile =
      rank && entries.length > 0 ? Math.round(((entries.length - rank + 1) / entries.length) * 100) : null;
    const aboveMedian = info ? selectedEntry.rating - info.median : null;

    return { rank, gapToTop, percentile, aboveMedian };
  }, [entries, info, selectedEntry]);
  const selectedEntryKey = selectedEntry ? getEntryKey(selectedEntry) : null;

  const createEntry = async (): Promise<boolean> => {
    const trimmed = playerName.trim();
    const parsedRating = Number.parseInt(ratingValue, 10);

    if (!trimmed) {
      setError("Player name is required.");
      return false;
    }

    if (Number.isNaN(parsedRating)) {
      setError("Rating must be a valid number.");
      return false;
    }

    setFormLoading(true);
    setError("");

    try {
      await api.post("/add", { player_name: trimmed, rating: parsedRating });
      setPlayerName("");
      setRatingValue("");
      await fetchAll();
      return true;
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (err as { message?: string })?.message ||
        "Failed to add leaderboard entry.";
      setError(message);
      return false;
    } finally {
      setFormLoading(false);
    }
  };

  const runStressTest = useCallback(async (): Promise<boolean> => {
    const users = Number.parseInt(stressUsers, 10);
    const spawnRate = Number.parseInt(stressSpawnRate, 10);
    const runTimeSeconds = Number.parseInt(stressRunTimeSeconds, 10);

    if (!Number.isInteger(users) || users <= 0) {
      setStressError("Users must be a positive whole number.");
      return false;
    }
    if (!Number.isInteger(spawnRate) || spawnRate <= 0) {
      setStressError("Spawn rate must be a positive whole number.");
      return false;
    }
    if (!Number.isInteger(runTimeSeconds) || runTimeSeconds <= 0) {
      setStressError("Run time must be a positive whole number.");
      return false;
    }

    const payload = {
      users,
      spawn_rate: spawnRate,
      run_time_seconds: runTimeSeconds,
    };

    setStressLoading(true);
    setStressError("");
    setStressDrawerOpen(false);
    setStressRunning(true);
    setStressReportReady(false);

    try {
      try {
        await api.post("/stress-test", undefined, { params: payload });
      } catch (queryErr: unknown) {
        const status = (queryErr as { response?: { status?: number } })?.response?.status;
        const shouldTryBody = status === undefined || [400, 404, 405, 415, 422].includes(status);
        if (!shouldTryBody) throw queryErr;
        await api.post("/stress-test", payload);
      }

      startStressReportPolling();
      void fetchAll({ silent: true });
      return true;
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (err as { message?: string })?.message ||
        "Failed to start stress test.";
      setStressError(message);
      setStressRunning(false);
      setStressDrawerOpen(true);
      return false;
    } finally {
      setStressLoading(false);
    }
  }, [fetchAll, startStressReportPolling, stressRunTimeSeconds, stressSpawnRate, stressUsers]);

  const removeEntry = async (entry: RatingEntry) => {
    setFormLoading(true);
    setError("");

    try {
      await api.delete("/remove", {
        params: { player_name: entry.player_name, rating: entry.rating },
      });
      setSelectedEntry(null);
      setConfirmRemove(false);
      await fetchAll();
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        "Failed to remove leaderboard entry.";
      setError(message);
    } finally {
      setFormLoading(false);
    }
  };

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

      {/* Player details drawer */}
      <AnimatePresence>
        {selectedEntry ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px]"
              onClick={() => { setSelectedEntry(null); setConfirmRemove(false); }}
            />
            <motion.aside
              initial={{ x: 420, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 420, opacity: 0 }}
              transition={{ type: "spring", stiffness: 340, damping: 32 }}
              className="fixed right-0 top-0 h-full w-full sm:max-w-lg z-50 border-l border-border bg-white dark:bg-[hsl(var(--card))] shadow-2xl"
            >
              <div className="h-full flex flex-col">
                <header className="px-6 py-5 border-b border-border bg-white dark:bg-[hsl(var(--card))]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl leading-none font-semibold text-foreground">Player Details</h2>
                      {selectedDetails?.rank ? (
                        <Badge variant="secondary" className="mt-2 text-xs">
                          Rank #{selectedDetails.rank}
                        </Badge>
                      ) : null}
                    </div>
                    <button
                      onClick={() => { setSelectedEntry(null); setConfirmRemove(false); }}
                      className="p-1.5 rounded-lg hover:bg-muted transition-colors cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </header>

                <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
                  <div className="rounded-2xl border border-border bg-card px-4 py-4">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-white text-sm shrink-0 ${getAvatarClass(selectedEntry.player_name)}`}>
                        {initials(selectedEntry.player_name)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-2xl leading-none font-bold text-foreground truncate">{selectedEntry.player_name}</p>
                        <p className="text-xs text-muted-foreground mt-2">Recorded {fmtDate(selectedEntry.timestamp)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <DetailMetric label="Score" value={fmtNum(selectedEntry.rating)} />
                    <DetailMetric label="Rank" value={selectedDetails?.rank ? `#${selectedDetails.rank}` : "-"} />
                    <DetailMetric label="Gap To #1" value={fmtNum(selectedDetails?.gapToTop ?? 0)} />
                    <DetailMetric
                      label="Percentile"
                      value={
                        selectedDetails?.percentile !== null && selectedDetails?.percentile !== undefined
                          ? `${selectedDetails.percentile}%`
                          : "-"
                      }
                    />
                  </div>

                  <Card className="border-border">
                    <CardContent className="px-4 py-4">
                      <p className="text-xs font-semibold text-foreground uppercase tracking-wide">Score Context</p>
                      <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                        {selectedDetails?.aboveMedian !== null && selectedDetails?.aboveMedian !== undefined ? (
                          selectedDetails.aboveMedian >= 0
                            ? `${fmtNum(selectedEntry.rating)} is ${fmtNum(Math.round(selectedDetails.aboveMedian))} above the median`
                            : `${fmtNum(selectedEntry.rating)} is ${fmtNum(Math.abs(Math.round(selectedDetails.aboveMedian)))} below the median`
                        ) : (
                          "Median is not available yet"
                        )}
                      </p>
                    </CardContent>
                  </Card>

                  {!confirmRemove ? (
                    <button
                      onClick={() => setConfirmRemove(true)}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800/50 text-red-700 dark:text-red-400 px-4 py-2.5 text-sm font-semibold hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      Remove Entry
                    </button>
                  ) : (
                    <div className="rounded-xl border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-950/30 p-4 space-y-3">
                      <p className="text-sm text-red-700 dark:text-red-400 font-medium">Remove this exact entry?</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setConfirmRemove(false)}
                          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => void removeEntry(selectedEntry)}
                          disabled={formLoading}
                          className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                          Confirm
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      onClick={() => { setSelectedEntry(null); setConfirmRemove(false); }}
                      className="rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted transition-colors"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>

      {/* Add entry drawer */}
      <AnimatePresence>
        {addDrawerOpen ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px]"
              onClick={() => setAddDrawerOpen(false)}
            />
            <motion.aside
              initial={{ x: 420, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 420, opacity: 0 }}
              transition={{ type: "spring", stiffness: 340, damping: 32 }}
              className="fixed right-0 top-0 h-full w-full sm:max-w-md z-50 border-l border-border bg-white dark:bg-[hsl(var(--card))] shadow-2xl"
            >
              <div className="h-full flex flex-col">
                <header className="px-6 py-5 border-b border-border bg-white dark:bg-[hsl(var(--card))]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold text-foreground leading-none">Add New Entry</h2>
                      <p className="text-sm text-muted-foreground mt-1.5">Submit a score to the leaderboard</p>
                    </div>
                    <button
                      onClick={() => setAddDrawerOpen(false)}
                      className="p-1.5 rounded-lg hover:bg-muted transition-colors cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </header>

                <div className="flex-1 overflow-y-auto px-6 py-8 space-y-6">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">Player Name</label>
                    <input
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                      className="h-12 w-full rounded-xl border border-border bg-muted/30 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all"
                      placeholder="e.g. Jane Smith"
                      autoFocus
                      disabled={formLoading}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">Rating</label>
                    <input
                      value={ratingValue}
                      onChange={(e) => setRatingValue(e.target.value)}
                      className="h-12 w-full rounded-xl border border-border bg-muted/30 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all"
                      placeholder="e.g. 1500"
                      type="number"
                      disabled={formLoading}
                    />
                  </div>
                </div>

                <div className="px-6 py-5 border-t border-border bg-muted/20 flex gap-3">
                  <button
                    onClick={() => setAddDrawerOpen(false)}
                    disabled={formLoading}
                    className="flex-1 rounded-xl border border-border bg-white dark:bg-[hsl(var(--card))] px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      const created = await createEntry();
                      if (created) setAddDrawerOpen(false);
                    }}
                    disabled={formLoading}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-iu-crimson px-4 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity shadow-sm cursor-pointer"
                  >
                    {formLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    {formLoading ? "Adding..." : "Add Entry"}
                  </button>
                </div>
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>

      {/* Stress test drawer */}
      <AnimatePresence>
        {stressDrawerOpen ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px]"
              onClick={() => setStressDrawerOpen(false)}
            />
            <motion.aside
              initial={{ x: 420, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 420, opacity: 0 }}
              transition={{ type: "spring", stiffness: 340, damping: 32 }}
              className="fixed right-0 top-0 h-full w-full sm:max-w-md z-50 border-l border-border bg-white dark:bg-[hsl(var(--card))] shadow-2xl"
            >
              <div className="h-full flex flex-col">
                <header className="px-6 py-5 border-b border-border bg-white dark:bg-[hsl(var(--card))]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold text-foreground leading-none">Run Stress Test</h2>
                      <p className="text-sm text-muted-foreground mt-1.5">Start backend load simulation from the UI</p>
                    </div>
                    <button
                      onClick={() => setStressDrawerOpen(false)}
                      className="p-1.5 rounded-lg hover:bg-muted transition-colors cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </header>

                <div className="flex-1 overflow-y-auto px-6 py-8 space-y-6">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">Users</label>
                    <input
                      value={stressUsers}
                      onChange={(e) => setStressUsers(e.target.value)}
                      className="h-12 w-full rounded-xl border border-border bg-muted/30 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all"
                      placeholder="e.g. 100"
                      type="number"
                      min={1}
                      disabled={stressLoading}
                    />
                    <p className="text-[11px] text-muted-foreground">Total concurrent virtual users hitting the API at peak.</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">Spawn Rate</label>
                    <input
                      value={stressSpawnRate}
                      onChange={(e) => setStressSpawnRate(e.target.value)}
                      className="h-12 w-full rounded-xl border border-border bg-muted/30 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all"
                      placeholder="e.g. 20"
                      type="number"
                      min={1}
                      disabled={stressLoading}
                    />
                    <p className="text-[11px] text-muted-foreground">How many users are added per second until target users is reached.</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">Run Time (seconds)</label>
                    <input
                      value={stressRunTimeSeconds}
                      onChange={(e) => setStressRunTimeSeconds(e.target.value)}
                      className="h-12 w-full rounded-xl border border-border bg-muted/30 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all"
                      placeholder="e.g. 20"
                      type="number"
                      min={1}
                      disabled={stressLoading}
                    />
                    <p className="text-[11px] text-muted-foreground">Duration of the run after all users are active.</p>
                  </div>

                  {stressError ? (
                    <p className="text-sm text-destructive border border-destructive/30 rounded-xl px-4 py-3 bg-destructive/5">{stressError}</p>
                  ) : null}

                </div>

                <div className="px-6 py-5 border-t border-border bg-muted/20 flex gap-3">
                  <button
                    onClick={() => setStressDrawerOpen(false)}
                    disabled={stressLoading}
                    className="flex-1 rounded-xl border border-border bg-white dark:bg-[hsl(var(--card))] px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      await runStressTest();
                    }}
                    disabled={stressLoading}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-iu-crimson px-4 py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity shadow-sm cursor-pointer"
                  >
                    {stressLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
                    {stressLoading ? "Starting..." : "Start Test"}
                  </button>
                </div>
              </div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>

      {/* Sticky header */}
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="sticky top-0 z-30 border-b border-border/60 backdrop-blur-xl bg-background/80"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <img src="/logo.png" alt="Indiana University" className="w-9 h-9 object-contain shrink-0" />
          <div>
            <h1 className="text-base font-bold text-foreground leading-none">Leaderboard</h1>
            <div className="mt-0.5 flex items-center">
              <span className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/12 px-2 py-0.5 text-[11px] font-semibold leading-none text-emerald-600 dark:text-emerald-400">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-80 [animation-duration:1.8s]" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Live
              </span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-0.5">
            <ThemeToggle />
            <Link
              to="/history"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <HistoryIcon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">History</span>
            </Link>
            <button
              onClick={() => { setSelectedEntry(null); setConfirmRemove(false); setAddDrawerOpen(true); }}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Add</span>
            </button>
            <button
              onClick={() => void fetchAll()}
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
        {error ? (
          <p className="text-sm text-destructive border border-destructive/30 rounded-xl px-4 py-3 bg-destructive/5">{error}</p>
        ) : null}

        {!loading && entries.length > 0 ? (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatPill
              icon={Trophy}
              label="Top Rating"
              value={fmtNum(topScore)}
              sub={entries[0]?.player_name}
              iconClass="bg-amber-100 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400"
            />
            <StatPill
              icon={BarChart3}
              label="Average"
              value={fmtNum(avgScore)}
              sub={`Top ${entries.length}`}
              iconClass="bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400"
            />
            <StatPill
              icon={Target}
              label="Total Entries"
              value={info?.count ?? entries.length}
              sub="All records"
              iconClass="bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400"
            />
            <StatPill
              icon={Activity}
              label="Avg Leaderboard ms"
              value={leaderboardAvgLatency}
              sub="/leaderboard"
              iconClass="bg-violet-100 dark:bg-violet-950/50 text-violet-600 dark:text-violet-400"
            />
          </motion.div>
        ) : null}

        <section className="space-y-3">
          {!loading && entries.length > 0 ? (
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-0.5 h-5 rounded-full bg-iu-crimson shrink-0" />
                <h2 className="text-sm font-semibold tracking-wide text-foreground">Top 10</h2>
              </div>
              <div className="flex items-center gap-2">
                {stressReportReady ? (
                  <button
                    type="button"
                    onClick={() => window.open(stressReportUrl, "_blank", "noopener,noreferrer")}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs sm:text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>View Results</span>
                  </button>
                ) : null}

                <button
                  onClick={() => {
                    if (stressRunning || stressLoading) return;
                    setSelectedEntry(null);
                    setConfirmRemove(false);
                    setAddDrawerOpen(false);
                    setStressError("");
                    setStressDrawerOpen(true);
                  }}
                  disabled={stressRunning || stressLoading}
                  className="inline-flex items-center gap-1.5 rounded-full border border-iu-crimson bg-iu-crimson px-3 py-1.5 text-xs sm:text-sm font-medium text-white hover:opacity-90 disabled:opacity-85 transition-opacity cursor-pointer"
                >
                  {stressRunning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
                  <span>{stressRunning ? "Loading..." : "Stress Test"}</span>
                </button>
              </div>
            </div>
          ) : null}

          <Card className="border-border/60 overflow-hidden">
            <CardContent className="p-0">
              {loading && !formLoading ? (
                <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span className="text-sm">Loading leaderboard...</span>
                </div>
              ) : entries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
                  <Trophy className="w-8 h-8 opacity-25" />
                  <span className="text-sm">No entries yet. Add your first score.</span>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="py-3 pl-4 pr-2 text-left font-medium text-muted-foreground w-16">#</th>
                        <th className="py-3 px-3 text-left font-medium text-muted-foreground">Player</th>
                        <th className="py-3 px-3 text-right font-medium text-muted-foreground">Rating</th>
                        <th className="py-3 px-3 text-right font-medium text-muted-foreground hidden md:table-cell">Created</th>
                        <th className="py-3 pr-4 pl-2 text-center font-medium text-muted-foreground">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {entries.map((entry, idx) => {
                        const entryKey = getEntryKey(entry);
                        const movement = rankMovements[entryKey];
                        const MovementIcon = movement?.direction === "down" ? ArrowDown : ArrowUp;
                        const active = selectedEntryKey === entryKey;
                        const rowBg = !active
                          ? idx === 0
                            ? "bg-amber-50/50 dark:bg-amber-500/[0.06]"
                            : idx === 1
                            ? "bg-slate-50/40 dark:bg-white/[0.02]"
                            : idx === 2
                            ? "bg-orange-50/40 dark:bg-orange-500/[0.05]"
                            : ""
                          : "";
                        const rowHover = active
                          ? ""
                          : idx === 0
                          ? "hover:bg-amber-100/60 dark:hover:bg-amber-500/10"
                          : idx === 1
                          ? "hover:bg-slate-100/50 dark:hover:bg-white/[0.04]"
                          : idx === 2
                          ? "hover:bg-orange-100/60 dark:hover:bg-orange-500/10"
                          : "hover:bg-muted/30";
                        const movementBg = movement
                          ? movement.direction === "up"
                            ? "bg-emerald-50/80 dark:bg-emerald-500/[0.14]"
                            : "bg-rose-50/80 dark:bg-rose-500/[0.14]"
                          : "";
                        const resolvedBg = active ? "bg-primary/10" : movementBg || rowBg;
                        return (
                          <motion.tr
                            layout
                            transition={{ type: "spring", stiffness: 360, damping: 34 }}
                            key={entryKey}
                            className={`transition-colors cursor-pointer select-none ${resolvedBg} ${rowHover}`}
                            onClick={() => {
                              setSelectedEntry(active ? null : entry);
                              setConfirmRemove(false);
                            }}
                          >
                            <td className="py-3 pl-4 pr-2">
                              <div className="flex items-center gap-1">
                                <RankBadge rank={idx + 1} />
                                <span
                                  className={`inline-flex h-4 w-4 shrink-0 items-center justify-center transition-opacity ${
                                    movement
                                      ? movement.direction === "up"
                                        ? "text-emerald-600 dark:text-emerald-400 opacity-100"
                                        : "text-rose-600 dark:text-rose-400 opacity-100"
                                      : "opacity-0"
                                  }`}
                                  aria-hidden="true"
                                >
                                  <MovementIcon className="h-3.5 w-3.5" />
                                </span>
                              </div>
                            </td>
                            <td className="py-3 px-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 ${getAvatarClass(entry.player_name)}`}>
                                  {initials(entry.player_name)}
                                </div>
                                <span className="font-semibold text-foreground truncate">{entry.player_name}</span>
                              </div>
                            </td>
                            <td className="py-3 px-3 text-right font-bold text-foreground tabular-nums">{fmtNum(entry.rating)}</td>
                            <td className="py-3 px-3 text-right text-muted-foreground hidden md:table-cell">{fmtDate(entry.timestamp)}</td>
                            <td className="py-3 pr-4 pl-2 text-center">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedEntry(entry);
                                  setConfirmRemove(false);
                                }}
                                className="inline-flex items-center justify-center rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-muted transition-colors"
                              >
                                View
                              </button>
                            </td>
                          </motion.tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4 pt-2">
          <SectionHeader>Entry Statistics</SectionHeader>
          {!info ? (
            <p className="text-sm text-muted-foreground px-1">Statistics are not available yet.</p>
          ) : (
            <div className="space-y-3">
              {/* Primary stats — tinted background cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Mean", value: fmtStat(info.mean), sub: "Average score", bg: "bg-violet-50 dark:bg-violet-950/30", labelCls: "text-violet-600 dark:text-violet-400", borderCls: "border-violet-200/80 dark:border-violet-800/40" },
                  { label: "Median", value: fmtStat(info.median), sub: "Middle value", bg: "bg-sky-50 dark:bg-sky-950/30", labelCls: "text-sky-600 dark:text-sky-400", borderCls: "border-sky-200/80 dark:border-sky-800/40" },
                  { label: "IQR", value: fmtStat(info.iqr), sub: "Middle 50% spread", bg: "bg-emerald-50 dark:bg-emerald-950/30", labelCls: "text-emerald-600 dark:text-emerald-400", borderCls: "border-emerald-200/80 dark:border-emerald-800/40" },
                  { label: "Count", value: fmtNum(info.count), sub: "Total entries", bg: "bg-amber-50 dark:bg-amber-950/30", labelCls: "text-amber-600 dark:text-amber-400", borderCls: "border-amber-200/80 dark:border-amber-800/40" },
                ].map(({ label, value, sub, bg, labelCls, borderCls }) => (
                  <div key={label} className={`rounded-2xl border p-5 ${bg} ${borderCls}`}>
                    <p className={`text-xs font-semibold uppercase tracking-wider ${labelCls}`}>{label}</p>
                    <p className="mt-3 text-[1.85rem] font-bold tabular-nums text-foreground leading-none">{value}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{sub}</p>
                  </div>
                ))}
              </div>

              {/* Secondary stats — single card with dividers */}
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="flex flex-col sm:flex-row divide-y sm:divide-y-0 sm:divide-x divide-border">
                  {[
                    { label: "Q1", value: fmtStat(info.q1), sub: "25th percentile" },
                    { label: "Q3", value: fmtStat(info.q3), sub: "75th percentile" },
                    { label: "Std Dev", value: fmtStat(info.std_dev), sub: "Score spread" },
                    { label: "Min", value: fmtNum(info.min), sub: "Lowest score" },
                    { label: "Max", value: fmtNum(info.max), sub: "Highest score" },
                  ].map(({ label, value, sub }) => (
                    <div key={label} className="flex-1 px-5 py-4">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
                      <p className="mt-1.5 text-xl font-bold tabular-nums text-foreground">{value}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="pt-2">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-0.5 h-5 rounded-full bg-iu-crimson shrink-0" />
              <h2 className="text-sm font-semibold tracking-wide text-foreground">Endpoint Performance</h2>
            </div>
            {performanceRows.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {performanceRows.length} endpoint{performanceRows.length !== 1 ? "s" : ""} · {fmtNum(totalPerformanceRequests)} requests
              </p>
            )}
          </div>

          {performanceRows.length === 0 ? (
            <p className="text-sm text-muted-foreground px-1">No performance data yet.</p>
          ) : (
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-border bg-muted">
                    <th className="py-3.5 px-4 text-left text-sm font-medium text-muted-foreground">Endpoint</th>
                    <th className="py-3.5 px-4 text-right text-sm font-semibold text-foreground bg-primary/8">Avg</th>
                    <th className="py-3.5 px-4 text-right text-sm font-medium text-muted-foreground hidden sm:table-cell">Min</th>
                    <th className="py-3.5 px-4 text-right text-sm font-medium text-muted-foreground hidden sm:table-cell">Max</th>
                    <th className="py-3.5 px-4 text-right text-sm font-medium text-muted-foreground">Requests</th>
                  </tr>
                </thead>
                <tbody>
                  {performanceRows.map(([endpoint, metric], idx) => (
                    <tr
                      key={endpoint}
                      className={`border-b border-border last:border-0 hover:bg-muted/60 transition-colors ${idx % 2 !== 0 ? "bg-muted/35" : ""}`}
                    >
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center rounded-md border border-border bg-muted px-2.5 py-1 font-mono text-sm text-foreground">
                          {endpoint}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right text-sm font-bold tabular-nums text-foreground bg-primary/5">{fmtMs(metric.avg_ms)}</td>
                      <td className="py-3.5 px-4 text-right text-sm tabular-nums text-muted-foreground hidden sm:table-cell">{fmtMs(metric.min_ms)}</td>
                      <td className="py-3.5 px-4 text-right text-sm tabular-nums text-muted-foreground hidden sm:table-cell">{fmtMs(metric.max_ms)}</td>
                      <td className="py-3.5 px-4 text-right text-sm tabular-nums text-foreground">{fmtNum(metric.requests)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
