import logging
import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

import uvicorn
from dotenv import load_dotenv

from .api import create_app
from .database import Database
from .telemetry import TelemetryService

load_dotenv()

# Configure logging level from environment
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
numeric_level = getattr(logging, log_level, logging.INFO)
logging.basicConfig(level=numeric_level, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Configuration
PORT = int(os.getenv("PORT", "8000"))
DATABASE_PATH = os.getenv("DATABASE_PATH", "./data/pissgraph.db")
POLLING_INTERVAL = int(os.getenv("POLLING_INTERVAL", "60"))
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000")
ENABLE_SEED_ENDPOINT = os.getenv("ENABLE_SEED_ENDPOINT", "true").lower() == "true"

# Global services
database = Database(DATABASE_PATH)
telemetry_service = TelemetryService(database, POLLING_INTERVAL)


@asynccontextmanager
async def lifespan(app: Any) -> AsyncGenerator[None, None]:
    """Application lifespan manager"""
    logger.info("Starting pISSgraph backend...")

    # Start telemetry service in background without blocking startup
    try:
        await telemetry_service.start()
        logger.info(
            f"Telemetry service initialization completed "
            f"(running in background with {POLLING_INTERVAL}s polling interval)"
        )
    except Exception as e:
        logger.error(f"Failed to start telemetry service: {e}")
        logger.info("API will still be available, but telemetry data collection is disabled")

    logger.info("Backend startup complete - API endpoints are ready")
    yield

    logger.info("Shutting down pISSgraph backend...")
    try:
        await telemetry_service.stop()
        logger.info("Telemetry service stopped")
    except Exception as e:
        logger.error(f"Error stopping telemetry service: {e}")

    try:
        await database.close()
        logger.info("Database connection closed")
    except Exception as e:
        logger.error(f"Error closing database: {e}")

    logger.info("Backend shutdown complete")


app = create_app(database, CORS_ORIGINS, ENABLE_SEED_ENDPOINT, telemetry_service)
app.router.lifespan_context = lifespan


def run() -> None:
    """Run the application"""
    uvicorn.run("pissgraph.main:app", host="0.0.0.0", port=PORT, reload=False, log_level="info")


if __name__ == "__main__":
    run()
