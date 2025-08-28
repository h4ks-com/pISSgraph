from datetime import datetime, timedelta
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .database import Database


class TelemetryDataPoint(BaseModel):
    timestamp: datetime
    urine_tank_level: float


class TelemetryResponse(BaseModel):
    data: list[TelemetryDataPoint]
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    total_points: int


class LatestReadingResponse(BaseModel):
    timestamp: datetime
    urine_tank_level: float
    status: str = "active"


def create_app(database: Database, cors_origins: str = "http://localhost:3000") -> FastAPI:
    app = FastAPI(
        title="pISSgraph API",
        description="ISS Urine Tank Telemetry Data API",
        version="1.0.0"
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins.split(","),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/telemetry", response_model=TelemetryResponse)
    async def get_telemetry(
        start_time: Optional[datetime] = Query(None, description="Start time for data range"),
        end_time: Optional[datetime] = Query(None, description="End time for data range"),
        hours: Optional[int] = Query(None, description="Number of hours from now", ge=1, le=168),
        limit: int = Query(1000, description="Maximum number of data points", ge=1, le=10000)
    ) -> TelemetryResponse:
        """Get ISS urine tank telemetry data"""
        
        # If hours is specified, use it to set start_time
        if hours is not None:
            end_time = datetime.utcnow()
            start_time = end_time - timedelta(hours=hours)
        
        readings = await database.get_readings(start_time, end_time, limit)
        
        data_points = [
            TelemetryDataPoint(
                timestamp=reading.timestamp,
                urine_tank_level=reading.urine_tank_level
            )
            for reading in reversed(readings)  # Reverse to get chronological order
        ]
        
        return TelemetryResponse(
            data=data_points,
            start_time=start_time,
            end_time=end_time,
            total_points=len(data_points)
        )

    @app.get("/telemetry/latest", response_model=LatestReadingResponse)
    async def get_latest_telemetry() -> LatestReadingResponse:
        """Get the latest ISS urine tank reading"""
        reading = await database.get_latest_reading()
        
        if not reading:
            raise HTTPException(status_code=404, detail="No telemetry data available")
        
        # Consider data stale if older than 10 minutes
        is_stale = (datetime.utcnow() - reading.timestamp).total_seconds() > 600
        
        return LatestReadingResponse(
            timestamp=reading.timestamp,
            urine_tank_level=reading.urine_tank_level,
            status="stale" if is_stale else "active"
        )

    @app.get("/health")
    async def health_check() -> dict[str, str]:
        """Health check endpoint"""
        return {"status": "healthy"}

    return app