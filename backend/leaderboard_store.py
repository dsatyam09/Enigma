import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import AsyncGenerator

from skiplist import SkipList
from stats import RunningStats


class _RWLock:
    """
    Asyncio reader-writer lock.
    Concurrent reads are allowed; writes are exclusive.
    Uses the readers-first strategy.
    """

    def __init__(self) -> None:
        self._read_count = 0
        self._write_lock = asyncio.Lock()
        self._count_lock = asyncio.Lock()

    @asynccontextmanager
    async def read(self) -> AsyncGenerator[None, None]:
        async with self._count_lock:
            self._read_count += 1
            if self._read_count == 1:
                await self._write_lock.acquire()
        try:
            yield
        finally:
            async with self._count_lock:
                self._read_count -= 1
                if self._read_count == 0:
                    self._write_lock.release()

    @asynccontextmanager
    async def write(self) -> AsyncGenerator[None, None]:
        async with self._write_lock:
            yield


class LeaderboardStore:
    """
    In-memory leaderboard index backed by a skip list + hash maps.
    Postgres is the durable write-ahead log; this is the live query index.

    All public methods are async and protected by a reader-writer lock:
    reads are concurrent, writes are exclusive.
    """

    def __init__(self) -> None:
        self._sl = SkipList()
        self._scores: dict[str, float] = {}
        self._timestamps: dict[str, datetime] = {}
        self._stats = RunningStats()
        self._lock = _RWLock()

    async def add(self, player: str, score: float, ts: datetime | None = None) -> None:
        if ts is None:
            ts = datetime.now(timezone.utc)
        async with self._lock.write():
            if player in self._scores:
                self._sl.delete(player, self._scores[player])
            self._scores[player] = score
            self._timestamps[player] = ts
            self._sl.insert(player, score)
            self._stats.update(score)

    async def remove(self, player: str) -> None:
        async with self._lock.write():
            if player not in self._scores:
                return
            self._sl.delete(player, self._scores[player])
            del self._scores[player]
            self._timestamps.pop(player, None)

    async def top_k(self, k: int) -> list[tuple[str, float]]:
        async with self._lock.read():
            return self._sl.top_k(k)

    async def get_rank(self, player: str) -> int:
        async with self._lock.read():
            if player not in self._scores:
                return -1
            return self._sl.get_rank(player, self._scores[player])

    async def get_stats(self) -> dict:
        async with self._lock.read():
            return self._stats.snapshot()

    async def all_scores(self) -> list[float]:
        async with self._lock.read():
            return list(self._scores.values())

    async def get_player_ranks(self) -> dict[str, int]:
        """Returns {player: rank_from_top} for all players under a single read lock."""
        async with self._lock.read():
            return {
                player: self._sl.get_rank(player, score)
                for player, score in self._scores.items()
            }

    async def get_leaderboard_entries(self, k: int) -> list[tuple[str, float, datetime]]:
        """Top K entries with timestamps, under a single read lock."""
        async with self._lock.read():
            pairs = self._sl.top_k(k)
            return [
                (p, s, self._timestamps.get(p, datetime.now(timezone.utc)))
                for p, s in pairs
            ]

    @property
    def size(self) -> int:
        return self._sl.length
