from fastapi import APIRouter, Depends, Query, HTTPException, status
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_write_db, get_read_db
from models import Rating, AuditLog
from metrics import endpoint_times
from leaderboard_store import LeaderboardStore
from stats import percentile
import write_queue
import stress_runner
from pydantic import BaseModel, Field
from datetime import datetime, timezone
from typing import Optional
import statistics

router = APIRouter(tags=["leaderboard"])

store = LeaderboardStore()


async def startup_replay(db: AsyncSession) -> None:
    """Replay all Postgres rows into the in-memory store (WAL replay pattern)."""
    stmt = select(AuditLog).order_by(AuditLog.timestamp.asc())
    result = await db.execute(stmt)
    for row in result.scalars().all():
        if row.operation == "add":
            await store.add(row.player_name, float(row.rating), row.timestamp)
        elif row.operation == "remove":
            await store.remove(row.player_name)


class AddRequest(BaseModel):
    player_name: str = Field(..., min_length=1)
    rating: int = Field(..., ge=0)


class RatingResponse(BaseModel):
    player_name: str
    rating: int
    timestamp: datetime

    model_config = {"from_attributes": True}


class AuditLogResponse(BaseModel):
    player_name: str
    rating: int
    operation: str
    timestamp: datetime

    model_config = {"from_attributes": True}


def _score_distribution(
    scores: list[float], min_val: float, max_val: float, buckets: int = 10
) -> list[dict]:
    if min_val == max_val:
        return [{"range": str(int(min_val)), "count": len(scores)}]
    width = (max_val - min_val) / buckets
    result = []
    for i in range(buckets):
        b_lo = min_val + i * width
        b_hi = min_val + (i + 1) * width
        if i == buckets - 1:
            count = sum(1 for r in scores if b_lo <= r <= b_hi)
        else:
            count = sum(1 for r in scores if b_lo <= r < b_hi)
        result.append({"range": f"{b_lo:.1f}–{b_hi:.1f}", "count": count})
    return result


@router.post("/add", status_code=status.HTTP_201_CREATED, response_model=RatingResponse)
async def add_entry(body: AddRequest):
    ts = datetime.now(timezone.utc)
    await store.add(body.player_name, float(body.rating), ts)
    await write_queue.enqueue(body.player_name, float(body.rating), ts)
    return RatingResponse(player_name=body.player_name, rating=body.rating, timestamp=ts)


@router.delete("/remove", status_code=status.HTTP_200_OK)
async def remove_entry(
    player_name: str = Query(..., description="Player whose entry to remove"),
    rating: Optional[int] = Query(None, description="Specific rating to match; omit to remove the most recent entry"),
    db: AsyncSession = Depends(get_write_db),
):
    # audit_log is the source of truth — find the most recent "add" for this player
    stmt = (
        select(AuditLog)
        .where(AuditLog.player_name == player_name, AuditLog.operation == "add")
    )
    if rating is not None:
        stmt = stmt.where(AuditLog.rating == rating)
    stmt = stmt.order_by(AuditLog.timestamp.desc()).limit(1)

    result = await db.execute(stmt)
    entry = result.scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")

    await store.remove(player_name)
    await write_queue.enqueue(
        player_name,
        float(entry.rating),
        datetime.now(timezone.utc),
        operation="remove",
    )
    return {"message": "Entry removed", "player_name": player_name}


@router.get("/leaderboard", response_model=list[RatingResponse])
async def get_leaderboard():
    entries = await store.get_leaderboard_entries(10)
    return [
        RatingResponse(player_name=p, rating=int(s), timestamp=ts)
        for p, s, ts in entries
    ]


@router.get("/info")
async def get_info():
    stats_snap = await store.get_stats()
    if stats_snap["count"] == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No entries found")

    scores = await store.all_scores()
    n = stats_snap["count"]

    q1 = percentile(scores, 25)
    q2 = percentile(scores, 50)
    q3 = percentile(scores, 75)

    min_val = stats_snap["min"]
    max_val = stats_snap["max"]

    player_ranks = await store.get_player_ranks()
    percentile_ranks = {
        player: round((n - rank + 1) / n * 100, 2)
        for player, rank in player_ranks.items()
        if rank > 0
    }

    return {
        "count": n,
        "mean": stats_snap["mean"],
        "median": round(q2, 4),
        "std_dev": stats_snap["std_dev"],
        "min": min_val,
        "max": max_val,
        "q1": round(q1, 4),
        "q3": round(q3, 4),
        "iqr": round(q3 - q1, 4),
        "score_distribution": _score_distribution(scores, min_val, max_val),
        "percentile_ranks": percentile_ranks,
    }


@router.get("/performance")
async def get_performance():
    if not endpoint_times:
        return {}
    return {
        path: {
            "avg_ms": round(statistics.mean(times), 3),
            "min_ms": round(min(times), 3),
            "max_ms": round(max(times), 3),
            "requests": len(times),
        }
        for path, times in endpoint_times.items()
    }


@router.post("/stress-test")
async def stress_test(
    users: int = 100,
    spawn_rate: int = 10,
    run_time_seconds: int = 30,
):
    # Client must wait run_time_seconds + 30s — this endpoint is intentionally long-running
    if not (1 <= users <= 500):
        raise HTTPException(status_code=400, detail="users must be between 1 and 500")
    if not (1 <= spawn_rate <= 100):
        raise HTTPException(status_code=400, detail="spawn_rate must be between 1 and 100")
    if not (10 <= run_time_seconds <= 120):
        raise HTTPException(status_code=400, detail="run_time_seconds must be between 10 and 120")

    host = "http://localhost:8000"
    return await stress_runner.run_stress_test(host, users, spawn_rate, run_time_seconds)


@router.get("/stress-test/report", response_class=HTMLResponse)
async def stress_test_report():
    try:
        with open("/tmp/locust_report.html", "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="No report available yet. Run /stress-test first.")


@router.get("/history", response_model=list[AuditLogResponse])
async def get_history(
    player_name: Optional[str] = Query(None, description="Filter by player name"),
    from_date: Optional[datetime] = Query(None, description="Filter entries on or after this timestamp (ISO 8601)"),
    to_date: Optional[datetime] = Query(None, description="Filter entries on or before this timestamp (ISO 8601)"),
    db: AsyncSession = Depends(get_read_db),
):
    stmt = select(AuditLog).order_by(AuditLog.timestamp.desc())

    if player_name:
        stmt = stmt.where(AuditLog.player_name == player_name)
    if from_date:
        stmt = stmt.where(AuditLog.timestamp >= from_date)
    if to_date:
        stmt = stmt.where(AuditLog.timestamp <= to_date)

    result = await db.execute(stmt)
    return result.scalars().all()
