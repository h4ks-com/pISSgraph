import asyncio
import contextlib
import logging
from datetime import datetime
from typing import Any

from lightstreamer.client import LightstreamerClient
from lightstreamer.client import Subscription

from .database import Database
from .database import TelemetryReading

logger = logging.getLogger(__name__)

URINE_TANK_NODE = "NODE3000005"


class TelemetryService:
    def __init__(self, db: Database, polling_interval: int = 60):
        self.db = db
        self.polling_interval = polling_interval
        self.client: LightstreamerClient | None = None
        self.subscription: Subscription | None = None
        self.connected = False
        self.current_value: float | None = None
        self._connect_lock = asyncio.Lock()
        self._polling_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Start the telemetry polling service"""
        logger.info("Initializing telemetry service...")
        await self.db.init()

        # Start the polling loop in background without waiting for initial connection
        logger.info("Starting telemetry polling in background")
        self._polling_task = asyncio.create_task(self._polling_loop())
        logger.info("Telemetry service started successfully")

    async def stop(self) -> None:
        """Stop the telemetry service"""
        if self._polling_task:
            self._polling_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._polling_task
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
            logger.debug("Starting telemetry poll cycle")
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
                else:
                    logger.debug(f"Value unchanged at {value}%, no storage needed")

                if should_store:
                    await self._store_value(value)
                    logger.info(f"Stored new urine tank level: {value}%")
            else:
                logger.debug("No telemetry value available, connection may still be establishing")
        except Exception as e:
            logger.error(f"Failed to poll telemetry: {type(e).__name__}: {e}")

    async def _get_current_value(self) -> float | None:
        """Get current telemetry value from Lightstreamer"""
        if not await self._ensure_connected():
            logger.warning("Could not connect to Lightstreamer, will retry on next poll")
            return None

        # Wait briefly for initial data if we don't have any yet (non-blocking)
        if self.current_value is None:
            logger.debug("Waiting briefly for initial telemetry data...")
            for attempt in range(5):  # Wait up to 5 seconds for initial data
                await asyncio.sleep(1)
                if self.current_value is not None:
                    logger.info(f"Received initial telemetry data: {self.current_value}%")
                    break
            else:
                logger.debug("No initial telemetry data received yet, will keep trying")

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
            logger.info("Attempting to connect to NASA ISS telemetry stream...")
            logger.debug("Creating Lightstreamer client for https://push.lightstreamer.com with adapter ISSLIVE")

            self.client = LightstreamerClient("https://push.lightstreamer.com", "ISSLIVE")

            connection_future: asyncio.Future[bool] = asyncio.Future()
            status_changes = []

            class ConnectionListener:
                def onStatusChange(self, new_status: str) -> None:
                    status_changes.append(new_status)
                    logger.info(f"Lightstreamer connection status: {new_status}")

                    if new_status == "CONNECTED:WS-STREAMING":
                        logger.info("Successfully established WebSocket streaming connection")
                        if not connection_future.done():
                            connection_future.set_result(True)
                    elif new_status.startswith("DISCONNECTED"):
                        logger.warning(f"Connection disconnected: {new_status}")
                        if not connection_future.done():
                            connection_future.set_result(False)
                    elif "ERROR" in new_status:
                        logger.error(f"Connection error: {new_status}")
                        if not connection_future.done():
                            connection_future.set_result(False)

            self.client.addListener(ConnectionListener())
            logger.debug("Starting Lightstreamer client connection...")
            self.client.connect()

            try:
                logger.info("Waiting up to 15 seconds for connection establishment...")
                result = await asyncio.wait_for(connection_future, timeout=15.0)
                if result:
                    self.connected = True
                    logger.info("Connection established, setting up telemetry subscription...")
                    await self._subscribe_telemetry()
                    logger.info("Successfully connected to ISS telemetry stream and subscribed to data")
                    return True
                else:
                    logger.error(f"Connection failed. Status history: {status_changes}")
            except asyncio.TimeoutError:
                logger.error(f"Connection timed out after 15 seconds. Status history: {status_changes}")
                logger.error("This might be due to network restrictions, firewall, or VPS network configuration")
                if self.client:
                    try:
                        self.client.disconnect()
                    except Exception as disconnect_error:
                        logger.debug(f"Error during disconnect cleanup: {disconnect_error}")

        except Exception as e:
            logger.error(f"Exception during Lightstreamer connection: {type(e).__name__}: {e}")
            logger.error("This could be due to missing dependencies, network issues, or VPS restrictions")

        self.connected = False
        return False

    async def _subscribe_telemetry(self) -> None:
        """Subscribe to ISS urine tank telemetry"""
        if not self.client:
            return

        logger.info(f"Subscribing to telemetry node: {URINE_TANK_NODE}")
        self.subscription = Subscription("MERGE", [URINE_TANK_NODE], ["Value"])

        class TelemetryListener:
            def __init__(self, service: "TelemetryService"):
                self.service = service

            def onItemUpdate(self, update: Any) -> None:
                try:
                    item_name = update.getItemName()
                    value = update.getValue("Value")
                    logger.debug(f"Received update for item {item_name} with value: {value}")

                    if value is not None and item_name == URINE_TANK_NODE:
                        try:
                            new_value = float(value)
                            logger.info(f"Received telemetry update for {URINE_TANK_NODE}: {new_value}%")
                            self.service.current_value = new_value
                        except (ValueError, TypeError) as e:
                            logger.warning(f"Invalid telemetry value received for {item_name}: {value} - {e}")
                    else:
                        logger.debug(
                            f"Ignoring update for different item or null value: item={item_name}, value={value}"
                        )
                except Exception as e:
                    logger.error(f"Error processing telemetry update: {type(e).__name__}: {e}")

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
        reading = TelemetryReading(timestamp=datetime.utcnow(), urine_tank_level=value)
        await self.db.add_reading(reading)
