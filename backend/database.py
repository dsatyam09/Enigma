from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
import os
from config import load_app_env

load_app_env()

DATABASE_URL = os.getenv("DATABASE_URL")
# Falls back to the primary URL when no read replica is configured.
DATABASE_READ_URL = os.getenv("DATABASE_READ_URL") or DATABASE_URL

write_engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_size=5,
    max_overflow=3,
)
read_engine = create_async_engine(
    DATABASE_READ_URL,
    echo=False,
    pool_size=5,
    max_overflow=3,
)

# Backward-compat alias used by main.py for table creation and auth/user routers.
engine = write_engine

WriteSessionLocal = async_sessionmaker(write_engine, class_=AsyncSession, expire_on_commit=False)
ReadSessionLocal = async_sessionmaker(read_engine, class_=AsyncSession, expire_on_commit=False)

# Backward-compat alias for routers that have not migrated to explicit write/read deps.
AsyncSessionLocal = WriteSessionLocal


class Base(DeclarativeBase):
    pass


async def get_db():
    async with WriteSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def get_write_db():
    async with WriteSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def get_read_db():
    async with ReadSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
