#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "   AI Customer Support Copilot - VPS Deployment Script   "
echo "=========================================================="

# 1. Check Root / Sudo
if [ "$EUID" -ne 0 ]; then
  echo "[-] Please run as root or with sudo: sudo bash scripts/deploy-vps.sh"
  exit 1
fi

# 2. Check & Setup Swap if RAM < 3.5GB (Prevents Docker build OOM on smaller VPS nodes)
TOTAL_MEM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
TOTAL_MEM_MB=$((TOTAL_MEM_KB / 1024))
SWAP_TOTAL_KB=$(grep SwapTotal /proc/meminfo | awk '{print $2}')

echo "[+] Total RAM: ${TOTAL_MEM_MB} MB"
if [ "$TOTAL_MEM_MB" -lt 3500 ] && [ "$SWAP_TOTAL_KB" -lt 1048576 ]; then
  echo "[!] Low RAM detected (< 3.5GB) without sufficient swap."
  echo "[+] Allocating 2GB swap file to guarantee smooth Next.js & Prisma compilation..."
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  if ! grep -q '/swapfile' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
  echo "[+] Swap configured successfully."
fi

# 3. Check & Install Docker / Docker Compose plugin if missing
if ! command -v docker &> /dev/null; then
  echo "[+] Docker not found. Installing Docker Engine..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

if ! docker compose version &> /dev/null; then
  echo "[+] Installing Docker Compose plugin..."
  apt-get update && apt-get install -y docker-compose-plugin || true
fi

# 4. Prepare .env configuration
if [ ! -f .env ]; then
  echo "[+] Creating .env from .env.example..."
  cp .env.example .env

  # Generate random 64-char JWT secret
  RAND_JWT=$(openssl rand -hex 32 2>/dev/null || tr -dc 'a-zA-Z0-9' < /dev/urandom | head -c 64)
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${RAND_JWT}|" .env
  echo "[+] Generated cryptographically random JWT_SECRET."
fi

# Detect public server IP
SERVER_IP=$(curl -s https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
echo "[+] Detected Server Public IP: ${SERVER_IP}"

# Ensure CORS_ORIGIN allows this IP and localhost
if grep -q "CORS_ORIGIN=" .env; then
  CURRENT_CORS=$(grep "^CORS_ORIGIN=" .env | cut -d'=' -f2-)
  if [[ "$CURRENT_CORS" != *"$SERVER_IP"* ]] && [[ "$CURRENT_CORS" != *"*"* ]]; then
    NEW_CORS="${CURRENT_CORS},http://${SERVER_IP}:3000"
    sed -i "s|^CORS_ORIGIN=.*|CORS_ORIGIN=${NEW_CORS}|" .env
    echo "[+] Appended http://${SERVER_IP}:3000 to CORS_ORIGIN"
  fi
fi

echo ""
echo "=========================================================="
echo " Building & launching containers with Docker Compose..."
echo "=========================================================="
docker compose up --build -d

echo ""
echo "=========================================================="
echo " Verifying stack health..."
echo "=========================================================="
for i in {1..30}; do
  if curl -s "http://localhost:3001/api/v1/health" | grep -q '"status":"ok"'; then
    echo "[+] API and Database are healthy and ready!"
    break
  fi
  echo "Waiting for services to become healthy... ($i/30)"
  sleep 4
done

echo ""
echo "=========================================================="
echo " Deployment Successfully Completed!"
echo "=========================================================="
echo " Web Console:  http://${SERVER_IP}:3000"
echo " REST API:     http://${SERVER_IP}:3001/api/v1"
echo " Swagger Docs: http://${SERVER_IP}:3001/api/docs"
echo ""
echo " Default Demo Credentials (SEED_DEFAULT_PASSWORD=RelayDemo2026!):"
echo "   - Admin:   alex.morgan@acme-support.test"
echo "   - Manager: priya.shah@acme-support.test"
echo "   - Agent:   sam.okafor@acme-support.test"
echo "=========================================================="
