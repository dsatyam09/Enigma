import asyncio
import json
import os
from typing import Any, Callable, Optional

import redis.asyncio as aioredis

_client: Optional[aioredis.Redis] = None
_locks: dict[str, asyncio.Lock] = {}

_REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
_DEFAULT_TTL = int(os.getenv("CACHE_TTL_SECONDS", "30"))


async def _connect() -> Optional[aioredis.Redis]:
    global _client
    if _client is not None:
        return _client
    try:
        client = aioredis.from_url(_REDIS_URL, socket_connect_timeout=1, decode_responses=True)
        await client.ping()
        _client = client
    except Exception:
        _client = None
    return _client


async def cache_get(key: str) -> Optional[str]:
    r = await _connect()
    if r is None:
        return None
    try:
        return await r.get(key)
    except Exception:
        return None


async def cache_set(key: str, value: str, ttl: int = None) -> None:
    r = await _connect()
    if r is None:
        return
    try:
        await r.set(key, value, ex=ttl if ttl is not None else _DEFAULT_TTL)
    except Exception:
        pass


async def cache_delete(*keys: str) -> None:
    r = await _connect()
    if r is None:
        return
    try:
        await r.delete(*keys)
    except Exception:
        pass


async def cache_get_or_set(key: str, fetcher: Callable, ttl: int = None) -> Any:
    raw = await cache_get(key)
    if raw is not None:
        return json.loads(raw)

    if key not in _locks:
        _locks[key] = asyncio.Lock()
    lock = _locks[key]

    async with lock:
        # Re-check after acquiring lock — another coroutine may have populated it
        raw = await cache_get(key)
        if raw is not None:
            return json.loads(raw)

        value = await fetcher()
        await cache_set(key, json.dumps(value), ttl=ttl)
        return value
