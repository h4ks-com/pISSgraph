import asyncio
import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from dotenv import load_dotenv

from .api import create_app
from .database import Database
from .telemetry import TelemetryService

load_dotenv()

logging.basicConfig(level=logging.INFO)
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
async def lifespan(app):
    """Application lifespan manager"""
    logger.info("Starting pISSgraph backend...")
    await telemetry_service.start()
    logger.info(f"Telemetry service started with {POLLING_INTERVAL}s polling interval")
    
    yield
    
    logger.info("Shutting down pISSgraph backend...")
    await telemetry_service.stop()
    await database.close()


app = create_app(database, CORS_ORIGINS, ENABLE_SEED_ENDPOINT, telemetry_service)
app.router.lifespan_context = lifespan


def run() -> None:
    """Run the application"""
    uvicorn.run(
        "pissgraph.main:app",
        host="0.0.0.0",
        port=PORT,
        reload=False,
        log_level="info"
    )


if __name__ == "__main__":
    run()