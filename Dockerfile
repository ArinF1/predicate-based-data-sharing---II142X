# Dockerfile — Multi-stage build for the research prototype


# Circuit Builder
FROM rust:latest AS circuit-builder

# Install Node.js for snarkjs CLI
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Install Circom from source
RUN cargo install --git https://github.com/iden3/circom.git --tag v2.1.9

WORKDIR /build

# Copy package.json and install circomlib for circuit includes
COPY package.json package-lock.json* ./
RUN npm install --ignore-scripts

# Copy circuits
COPY circuits/ ./circuits/

# Build circuits
RUN chmod +x circuits/build-circuits.sh \
    && bash circuits/build-circuits.sh

# Application
FROM node:20-bookworm-slim AS app

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy TypeScript config and source
COPY tsconfig.json ./
COPY src/ ./src/

# Copy pre-built circuit artifacts from stage 1
COPY --from=circuit-builder /build/circuits/build/ ./circuits/build/
COPY circuits/*.circom ./circuits/

# Create output directories
RUN mkdir -p data results

# Default command: run the benchmark
CMD ["npx", "tsx", "src/benchmark/test-runner.ts"]
