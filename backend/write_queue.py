import asyncio
from dataclasses import dataclass, field
from datetime import datetime

from models import AuditLog

FLUSH_INTERVAL = 0.1  # seconds
BATCH_SIZE = 50

_queue: asyncio.Queue = asyncio.Queue()


@dataclass
class WriteItem:
    player: str
    score: float
    ts: datetime
    operation: str = field(default="add")


async def enqueue(player: str, score: float, ts: datetime, operation: str = "add") -> None:
    await _queue.put(WriteItem(player=player, score=score, ts=ts, operation=operation))


async def postgres_flusher(session_factory) -> None:
    while True:
        batch: list[WriteItem] = []
        try:
            first = await _queue.get()
            batch.append(first)
            while len(batch) < BATCH_SIZE:
                try:
                    item = await asyncio.wait_for(_queue.get(), timeout=FLUSH_INTERVAL)
                    batch.append(item)
                except asyncio.TimeoutError:
                    break
        except asyncio.CancelledError:
            break

        if not batch:
            continue

        try:
            async with session_factory() as db:
                objects = [
                    AuditLog(
                        player_name=item.player,
                        rating=int(item.score),
                        operation=item.operation,
                        timestamp=item.ts,
                    )
                    for item in batch
                ]
                db.add_all(objects)
                await db.commit()
        except Exception as exc:
            print(f"[write_queue] flush error: {exc}")
        finally:
            for _ in batch:
                _queue.task_done()


async def drain_queue(session_factory) -> None:
    batch: list[WriteItem] = []
    while not _queue.empty():
        try:
            item = _queue.get_nowait()
            batch.append(item)
        except asyncio.QueueEmpty:
            break

    if not batch:
        return

    try:
        async with session_factory() as db:
            objects = [
                AuditLog(
                    player_name=item.player,
                    rating=int(item.score),
                    operation=item.operation,
                    timestamp=item.ts,
                )
                for item in batch
            ]
            db.add_all(objects)
            await db.commit()
    except Exception as exc:
        print(f"[write_queue] drain error: {exc}")
    finally:
        for _ in batch:
            _queue.task_done()
