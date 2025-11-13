#!/usr/bin/env bash
set -euo pipefail

# Configuration
DOMAIN="${DOMAIN:-skribbl-linera.xyz}"
EMAIL="${EMAIL:-egor4042007@gmail.com}"
PROJECT_DIR="${PROJECT_DIR:-$(pwd)}"

if [[ $EUID -ne 0 ]]; then
  echo "Please run as root: sudo bash deploy/setup-nginx-ssl.sh"
  exit 1
fi

echo "Domain: $DOMAIN"
echo "Email:  $EMAIL"
echo "Project: $PROJECT_DIR"

if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "Project directory not found: $PROJECT_DIR"
  exit 1
fi

# Install Nginx, Certbot and Node.js (Debian/Ubuntu)
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx curl gnupg lsb-release ca-certificates

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# Allow firewall (optional)
if command -v ufw >/dev/null 2>&1; then
  ufw allow 'Nginx Full' || true
  ufw allow OpenSSH || true
fi

# Nginx site config
cat >/etc/nginx/sites-available/$DOMAIN <<'EOF'
map $http_upgrade $connection_upgrade {
  default upgrade;
  ''      close;
}

upstream vite_dev {
  server 127.0.0.1:3100;
}

upstream drawing_ws {
  server 127.0.0.1:8070;
}

server {
  listen 80;
  server_name DOMAIN_PLACEHOLDER;

  location /.well-known/acme-challenge/ {
    root /var/www/html;
  }

  location / {
    proxy_pass http://vite_dev;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
  }

  location /ws {
    proxy_pass http://drawing_ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Host $host;
  }
}
EOF

sed -i "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" /etc/nginx/sites-available/$DOMAIN
ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
nginx -t
systemctl reload nginx

# Issue and configure SSL cert
certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --redirect --non-interactive

# Update project configuration: replace localhost with domain
ENV_FILE="$PROJECT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  sed -i -E "s|ws://localhost:8080|wss://$DOMAIN/ws|g" "$ENV_FILE"
fi

CANVAS_FILE="$PROJECT_DIR/src/components/Canvas.tsx"
if [[ -f "$CANVAS_FILE" ]]; then
  sed -i -E "s|ws://localhost:8080|wss://$DOMAIN/ws|g" "$CANVAS_FILE" || true
fi

# Install dependencies and configure services
cd "$PROJECT_DIR"
npm install

cd "$PROJECT_DIR/drawing-server"
npm install --omit=dev

RUN_USER="${SUDO_USER:-$(whoami)}"

cat >/etc/systemd/system/tstdrible-vite.service <<SERVICE
[Unit]
Description=Tstdrible Vite Dev Server
After=network.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$PROJECT_DIR
Environment=PORT=3100
ExecStart=/usr/bin/npm run dev
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SERVICE

cat >/etc/systemd/system/tstdrible-drawing.service <<SERVICE
[Unit]
Description=Tstdrible Drawing WebSocket Server
After=network.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$PROJECT_DIR/drawing-server
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now tstdrible-vite.service
systemctl enable --now tstdrible-drawing.service

echo "Setup completed. Visit: https://$DOMAIN/"