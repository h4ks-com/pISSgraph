# pISSgraph 🚽

Live ISS Urine Tank Telemetry Visualization

**🌐 Live Demo: [https://piss.h4ks.com](https://piss.h4ks.com)**

## Overview

pISSgraph is a real-time monitoring system that tracks and visualizes the ISS urine tank levels using NASA's live telemetry data. The system consists of a FastAPI backend that polls telemetry data and a React frontend that displays interactive charts.

## Features

- Real-time ISS urine tank level monitoring
- Interactive time-series charts with multiple zoom levels
- Data persistence with change-only logging
- Docker containerized deployment
- Responsive web interface
- RESTful API with OpenAPI documentation

## Quick Start

1. Clone the repository
2. Copy environment files:
   ```bash
   cp .env.example .env
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
   ```

3. Start with Docker Compose:
   ```bash
   docker compose up --build
   ```

4. Access the application:
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8000
   - API Documentation: http://localhost:8000/docs

5. If no data appears initially, you can seed the database with sample data:
   ```bash
   curl -X POST http://localhost:8000/telemetry/seed
   ```

6. To clear all telemetry data from the database:
   ```bash
   curl -X DELETE http://localhost:8000/telemetry/clear
   ```

   Note: Both seed and clear endpoints can be disabled by setting `ENABLE_SEED_ENDPOINT=false`

## Architecture

### Backend (Python/FastAPI)
- **Telemetry Service**: Connects to NASA's Lightstreamer feed
- **Database**: SQLite with SQLAlchemy ORM
- **API**: FastAPI with automatic OpenAPI generation
- **Polling**: Configurable interval data collection

### Frontend (React/TypeScript)
- **Charts**: Recharts library for data visualization
- **Styling**: Tailwind CSS
- **Build**: Vite with TypeScript
- **Deployment**: Nginx container

## Development

### Backend Development
```bash
cd backend
uv sync
uv run python -m pissgraph.main
```

### Frontend Development
```bash
cd frontend
pnpm install
pnpm dev
```

## Environment Variables

### Root (.env)
- `BACKEND_PORT`: Backend port (default: 8000)
- `FRONTEND_PORT`: Frontend port (default: 3000)
- `POLLING_INTERVAL`: Data polling interval in seconds (default: 60)
- `ENABLE_SEED_ENDPOINT`: Enable/disable sample data seeding endpoint (default: true)

### Backend (backend/.env)
- `PORT`: Server port
- `DATABASE_PATH`: SQLite database file path
- `POLLING_INTERVAL`: Telemetry polling interval
- `CORS_ORIGINS`: Allowed CORS origins
- `ENABLE_SEED_ENDPOINT`: Enable/disable sample data seeding endpoint (default: true)

### Frontend (frontend/.env)
- `VITE_API_BASE_URL`: Backend API URL

## Data Source

Data is sourced from NASA's live ISS telemetry stream via the [ISS Mimic](https://iss-mimic.github.io/Mimic/) project, specifically monitoring the urine tank level sensor (NODE3000005).

## License

MIT License
