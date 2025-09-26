from datetime import UTC
from datetime import datetime
from datetime import timedelta

from fastapi import FastAPI
from fastapi import HTTPException
from fastapi import Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .database import Database


class TelemetryDataPoint(BaseModel):
    timestamp: datetime
    urine_tank_level: float


class TelemetryResponse(BaseModel):
    data: list[TelemetryDataPoint]
    start_time: datetime | None = None
    end_time: datetime | None = None
    total_points: int


class LatestReadingResponse(BaseModel):
    timestamp: datetime
    urine_tank_level: float
    status: str = "active"  # active, stale, or live


def create_app(
    database: Database,
    cors_origins: str = "http://localhost:3000",
    enable_seed_endpoint: bool = True,
    telemetry_service=None,
) -> FastAPI:
    app = FastAPI(title="pISSgraph API", description="ISS Urine Tank Telemetry Data API", version="1.0.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins.split(","),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/telemetry", response_model=TelemetryResponse)
    async def get_telemetry(
        start_time: datetime | None = Query(None, description="Start time for data range"),
        end_time: datetime | None = Query(None, description="End time for data range"),
        hours: int | None = Query(None, description="Number of hours from now", ge=1, le=720),
        limit: int = Query(1000, description="Maximum number of data points", ge=1, le=10000),
    ) -> TelemetryResponse:
        """Get ISS urine tank telemetry data"""

        # If hours is specified, use it to set start_time
        if hours is not None:
            end_time = datetime.now(UTC)
            start_time = end_time - timedelta(hours=hours)

        readings = await database.get_readings(start_time, end_time, limit)

        data_points = [
            TelemetryDataPoint(timestamp=reading.timestamp, urine_tank_level=reading.urine_tank_level)
            for reading in reversed(readings)  # Reverse to get chronological order
        ]

        # Add current timestamp with latest value to show horizontal line to "now"
        # This shows that the urine level is constant until the next change
        if data_points:
            last_reading = data_points[-1]  # Most recent reading
            current_time = datetime.now(UTC)

            # Only add current timestamp if it's significantly newer than last reading
            # and if we have a time range that includes "now"
            # Ensure timestamp from database is timezone-aware
            last_timestamp = (
                last_reading.timestamp.replace(tzinfo=UTC)
                if last_reading.timestamp.tzinfo is None
                else last_reading.timestamp
            )
            time_diff = (current_time - last_timestamp).total_seconds()
            # Ensure both datetimes are timezone-aware for comparison
            end_time_aware = end_time.replace(tzinfo=UTC) if end_time and end_time.tzinfo is None else end_time
            includes_now = (
                not end_time_aware or (end_time_aware - current_time).total_seconds() >= -10
            )  # Allow 10 second buffer

            if includes_now and time_diff > 60:  # More than 1 minute old
                # Use live telemetry value if available, otherwise use last database value
                current_value = last_reading.urine_tank_level
                if telemetry_service and telemetry_service.current_value is not None:
                    current_value = telemetry_service.current_value

                data_points.append(TelemetryDataPoint(timestamp=current_time, urine_tank_level=current_value))

        return TelemetryResponse(
            data=data_points,
            start_time=start_time,
            end_time=end_time,
            total_points=len(data_points),
        )

    @app.get("/telemetry/latest", response_model=LatestReadingResponse)
    async def get_latest_telemetry() -> LatestReadingResponse:
        """Get the latest ISS urine tank reading"""
        reading = await database.get_latest_reading()

        # If no database reading exists, try to get real-time data from telemetry service
        if not reading and telemetry_service:
            current_value = telemetry_service.current_value
            if current_value is not None:
                return LatestReadingResponse(timestamp=datetime.now(UTC), urine_tank_level=current_value, status="live")

        if not reading:
            raise HTTPException(status_code=404, detail="No telemetry data available")

        # Consider data stale if older than 10 minutes
        current_time = datetime.now(UTC)
        reading_time = reading.timestamp.replace(tzinfo=UTC) if reading.timestamp.tzinfo is None else reading.timestamp
        is_stale = (current_time - reading_time).total_seconds() > 600

        return LatestReadingResponse(
            timestamp=reading.timestamp,
            urine_tank_level=reading.urine_tank_level,
            status="stale" if is_stale else "active",
        )

    @app.get("/health")
    async def health_check() -> dict[str, str]:
        """Health check endpoint"""
        return {"status": "healthy"}

    if enable_seed_endpoint:

        @app.post("/telemetry/seed")
        async def seed_telemetry() -> dict[str, str]:
            """Seed database with sample telemetry data for testing"""
            import random
            from datetime import datetime
            from datetime import timedelta

            # Only allow seeding if database is empty
            latest = await database.get_latest_reading()
            if latest:
                return {"message": "Database already contains data"}

            # Create some sample data points over the last hour
            now = datetime.now(UTC)
            base_level = 45.0  # Start at 45%

            for i in range(12):  # 12 data points over the last hour
                timestamp = now - timedelta(minutes=60 - (i * 5))  # Every 5 minutes
                # Add some random variation to make it realistic
                level = base_level + random.uniform(-2.0, 2.0)
                level = max(0, min(100, level))  # Clamp between 0-100%

                from .database import TelemetryReading

                reading = TelemetryReading(timestamp=timestamp, urine_tank_level=level)
                await database.add_reading(reading)

            return {"message": "Sample telemetry data added"}

        @app.delete("/telemetry/clear")
        async def clear_telemetry() -> dict[str, str]:
            """Clear all telemetry data from the database"""
            deleted_count = await database.clear_all_readings()
            return {"message": f"Cleared {deleted_count} telemetry readings"}

    return app
