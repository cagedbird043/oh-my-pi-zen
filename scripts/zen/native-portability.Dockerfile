# Minimal glibc runtime only: no PipeWire/SPA packages, D-Bus, or desktop services.
# Packages are installed inside the disposable image, never on the smoke's host.
FROM ubuntu:24.04
RUN apt-get update \
    && apt-get install -y --no-install-recommends libstdc++6 binutils \
    && rm -rf /var/lib/apt/lists/*
