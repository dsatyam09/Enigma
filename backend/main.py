import asyncio
import time
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from config import get_allowed_origins
from database import engine, Base, AsyncSessionLocal, WriteSessionLocal
from routers import leaderboard
from metrics import endpoint_times
import models  # noqa: ensure models are registered
import write_queue


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with AsyncSessionLocal() as db:
        await leaderboard.startup_replay(db)
    flusher_task = asyncio.create_task(write_queue.postgres_flusher(WriteSessionLocal))
    yield
    flusher_task.cancel()
    await write_queue.drain_queue(WriteSessionLocal)


app = FastAPI(title="Enigma Leaderboard API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def track_performance(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - start) * 1000
    endpoint_times[request.url.path].append(elapsed_ms)
    return response

app.include_router(leaderboard.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
