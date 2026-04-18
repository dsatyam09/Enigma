from datetime import datetime, timezone
from sqlalchemy import BigInteger, Column, DateTime, Integer, String, func

from database import Base

class Rating(Base):
    __tablename__ = "ratings"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    player_name = Column(String, nullable=False)
    rating = Column(Integer, nullable=False, index=True)
    timestamp = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
        nullable=False,
    )


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    player_name = Column(String, nullable=False, index=True)
    rating = Column(Integer, nullable=False)
    operation = Column(String, nullable=False)
    timestamp = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
