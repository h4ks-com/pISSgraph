FROM python:3.12-slim AS backend-openapi

WORKDIR /backend

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Copy backend files
COPY backend/pyproject.toml backend/uv.lock ./
COPY backend/pissgraph/ ./pissgraph/

# Install dependencies and generate OpenAPI
RUN uv sync --frozen
RUN uv run python -m pissgraph.export_openapi /tmp/openapi.json

FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY frontend/package.json frontend/pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy OpenAPI schema from backend stage
COPY --from=backend-openapi /tmp/openapi.json ./openapi.json

# Generate TypeScript client
RUN pnpm run generate-client

# Copy source code
COPY frontend/ .

# Build the application
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm build

# Production stage
FROM nginx:alpine

# Copy built files
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
