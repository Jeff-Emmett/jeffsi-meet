# Meeting Intelligence Transcription Service
# Uses whisper.cpp for fast CPU-based transcription
# Uses resemblyzer for speaker diarization

FROM python:3.11-slim AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends     build-essential     cmake     git     ffmpeg     wget     && rm -rf /var/lib/apt/lists/*

# Build whisper.cpp
WORKDIR /build
RUN git clone https://github.com/ggerganov/whisper.cpp.git &&     cd whisper.cpp &&     cmake -B build -DWHISPER_BUILD_EXAMPLES=ON -DBUILD_SHARED_LIBS=ON &&     cmake --build build --config Release -j$(nproc) &&     cp build/bin/whisper-cli /usr/local/bin/whisper &&     cp build/bin/whisper-server /usr/local/bin/whisper-server 2>/dev/null || true &&     mkdir -p /usr/local/lib/whisper &&     find build -name '*.so*' -exec cp {} /usr/local/lib/whisper/ \; &&     ls -la /usr/local/lib/whisper/

# Download whisper models
WORKDIR /models
RUN cd /build/whisper.cpp &&     bash models/download-ggml-model.sh small &&     mv models/ggml-small.bin /models/

# Production image
FROM python:3.11-slim

# Install runtime dependencies and build tools (for compiling Python packages)
RUN apt-get update && apt-get install -y --no-install-recommends     ffmpeg     libsndfile1     curl     build-essential     && rm -rf /var/lib/apt/lists/*

# Copy whisper binary, libraries, and models
COPY --from=builder /usr/local/bin/whisper /usr/local/bin/whisper
COPY --from=builder /usr/local/lib/whisper/ /usr/local/lib/
COPY --from=builder /models /models

# Update shared library cache
RUN ldconfig && /usr/local/bin/whisper --help || echo "Whisper help check failed"

# Set up Python environment
WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Remove build tools to reduce image size
RUN apt-get purge -y build-essential && apt-get autoremove -y

# Copy application code
COPY app/ ./app/

# Create directories
RUN mkdir -p /recordings /audio /logs

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV WHISPER_MODEL=/models/ggml-small.bin
ENV WHISPER_THREADS=8

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3     CMD curl -f http://localhost:8001/health || exit 1

# Run the service
EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1"]
