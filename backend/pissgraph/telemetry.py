import asyncio
import logging
from datetime import datetime
from typing import Optional

import aiohttp
from lightstreamer.client import LightstreamerClient, Subscription

from .database import Database, TelemetryReading

logger = logging.getLogger(__name__)

URINE_TANK_NODE = "NODE3000005"


class TelemetryService:
    def __init__(self, db: Database, polling_interval: int = 60):
        self.db = db
        self.polling_interval = polling_interval
        self.client: Optional[LightstreamerClient] = None
        self.subscription: Optional[Subscription] = None
        self.connected = False
        self.current_value: Optional[float] = None
        self._connect_lock = asyncio.Lock()
        self._polling_task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        """Start the telemetry polling service"""
        await self.db.init()
        # Do an immediate poll on startup to get initial data
        await self._poll_telemetry()
        self._polling_task = asyncio.create_task(self._polling_loop())

    async def stop(self) -> None:
        """Stop the telemetry service"""
        if self._polling_task:
            self._polling_task.cancel()
            try:
                await self._polling_task
            except asyncio.CancelledError:
                pass
        self._disconnect()

    async def _polling_loop(self) -> None:
        """Main polling loop that runs every interval"""
        while True:
            try:
                await self._poll_telemetry()
                await asyncio.sleep(self.polling_interval)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in polling loop: {e}")
                await asyncio.sleep(self.polling_interval)

    async def _poll_telemetry(self) -> None:
        """Poll telemetry data and store if changed"""
        try:
            value = await self._get_current_value()
            if value is not None:
                # Check if database is empty to always store first value
                latest_db_reading = await self.db.get_latest_reading()
                
                # Store if: database is empty OR value has changed from last stored value
                should_store = False
                if latest_db_reading is None:
                    # Database is empty, store the first value
                    should_store = True
                    logger.info(f"Database empty, storing initial value: {value}%")
                elif value != latest_db_reading.urine_tank_level:
                    # Value changed from last stored value
                    should_store = True
                    logger.info(f"Value changed from {latest_db_reading.urine_tank_level}% to {value}%")
                
                if should_store:
                    await self._store_value(value)
                    logger.info(f"Stored new urine tank level: {value}%")
        except Exception as e:
            logger.error(f"Failed to poll telemetry: {e}")

    async def _get_current_value(self) -> Optional[float]:
        """Get current telemetry value from Lightstreamer"""
        if not await self._ensure_connected():
            logger.warning("Could not connect to Lightstreamer")
            return None

        # Wait for initial data if we don't have any yet
        if self.current_value is None:
            logger.info("Waiting for initial telemetry data...")
            for i in range(10):  # Wait up to 10 seconds for initial data
                await asyncio.sleep(1)
                if self.current_value is not None:
                    break
            else:
                logger.warning("No telemetry data received after 10 seconds")

        return self.current_value

    async def _ensure_connected(self) -> bool:
        """Ensure connection to NASA telemetry stream"""
        if self.connected and self.client:
            return True

        async with self._connect_lock:
            if self.connected and self.client:
                return True
            return await self._connect()

    async def _connect(self) -> bool:
        """Connect to NASA's ISS telemetry stream"""
        try:
            logger.info("Connecting to NASA ISS telemetry stream...")
            self.client = LightstreamerClient("https://push.lightstreamer.com", "ISSLIVE")

            connection_future = asyncio.Future()

            class ConnectionListener:
                def onStatusChange(self, new_status: str) -> None:
                    logger.info(f"Lightstreamer status: {new_status}")
                    if new_status == "CONNECTED:WS-STREAMING":
                        if not connection_future.done():
                            connection_future.set_result(True)
                    elif new_status.startswith("DISCONNECTED"):
                        if not connection_future.done():
                            connection_future.set_result(False)

            self.client.addListener(ConnectionListener())
            self.client.connect()

            try:
                result = await asyncio.wait_for(connection_future, timeout=15.0)
                if result:
                    self.connected = True
                    await self._subscribe_telemetry()
                    logger.info("Successfully connected to ISS telemetry stream")
                    return True
            except asyncio.TimeoutError:
                logger.warning("Connection to Lightstreamer timed out after 15 seconds")

        except Exception as e:
            logger.error(f"Failed to connect to Lightstreamer: {e}")

        return False

    async def _subscribe_telemetry(self) -> None:
        """Subscribe to ISS urine tank telemetry"""
        if not self.client:
            return

        logger.info(f"Subscribing to telemetry node: {URINE_TANK_NODE}")
        self.subscription = Subscription("MERGE", [URINE_TANK_NODE], ["Value"])

        class TelemetryListener:
            def __init__(self, service: 'TelemetryService'):
                self.service = service

            def onItemUpdate(self, update) -> None:
                item_name = update.getItemName()
                value = update.getValue("Value")
                if value is not None and item_name == URINE_TANK_NODE:
                    try:
                        new_value = float(value)
                        logger.debug(f"Received telemetry update: {new_value}%")
                        self.service.current_value = new_value
                    except (ValueError, TypeError):
                        logger.warning(f"Invalid telemetry value received: {value}")

        self.subscription.addListener(TelemetryListener(self))
        self.client.subscribe(self.subscription)
        logger.info("Telemetry subscription activated")

    def _disconnect(self) -> None:
        """Disconnect from telemetry stream"""
        if self.subscription and self.client:
            self.client.unsubscribe(self.subscription)
        if self.client:
            self.client.disconnect()
        self.connected = False

    async def _store_value(self, value: float) -> None:
        """Store telemetry value in database"""
        reading = TelemetryReading(
            timestamp=datetime.utcnow(),
            urine_tank_level=value
        )
        await self.db.add_reading(reading)