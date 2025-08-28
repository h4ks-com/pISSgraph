import asyncio
import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy import DateTime, Float, Integer, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class TelemetryReading(Base):
    __tablename__ = "telemetry_readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    urine_tank_level: Mapped[float] = mapped_column(Float, nullable=False)


class Database:
    def __init__(self, database_path: str):
        # Ensure directory exists
        Path(database_path).parent.mkdir(parents=True, exist_ok=True)
        
        self.engine = create_async_engine(
            f"sqlite+aiosqlite:///{database_path}",
            echo=False
        )
        self.session_maker = async_sessionmaker(
            self.engine, 
            class_=AsyncSession,
            expire_on_commit=False
        )

    async def init(self) -> None:
        """Initialize database tables"""
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    async def add_reading(self, reading: TelemetryReading) -> None:
        """Add a new telemetry reading"""
        async with self.session_maker() as session:
            session.add(reading)
            await session.commit()

    async def get_readings(
        self, 
        start_time: Optional[datetime] = None, 
        end_time: Optional[datetime] = None,
        limit: int = 1000
    ) -> list[TelemetryReading]:
        """Get telemetry readings within time range"""
        async with self.session_maker() as session:
            query = select(TelemetryReading)
            
            if start_time:
                query = query.where(TelemetryReading.timestamp >= start_time)
            if end_time:
                query = query.where(TelemetryReading.timestamp <= end_time)
                
            query = query.order_by(TelemetryReading.timestamp.desc()).limit(limit)
            
            result = await session.execute(query)
            return list(result.scalars().all())

    async def get_latest_reading(self) -> Optional[TelemetryReading]:
        """Get the most recent telemetry reading"""
        async with self.session_maker() as session:
            query = select(TelemetryReading).order_by(TelemetryReading.timestamp.desc()).limit(1)
            result = await session.execute(query)
            return result.scalar_one_or_none()

    async def close(self) -> None:
        """Close database connection"""
        await self.engine.dispose()