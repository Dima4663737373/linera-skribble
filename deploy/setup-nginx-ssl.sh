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

  # Cross-origin isolation for SharedArrayBuffer in WASM/Workers
  add_header Cross-Origin-Opener-Policy "same-origin" always;
  add_header Cross-Origin-Embedder-Policy "require-corp" always;

  location /.well-known/acme-challenge/ {
    root /var/www/html;
  }

  location / {
    root ROOT_PLACEHOLDER;
    index index.html;
    try_files $uri $uri/ /index.html;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "require-corp" always;
    add_header Cross-Origin-Resource-Policy "same-origin" always;
  }

  # Static assets with CORS for Workers and dynamic imports
  location /assets/ {
    root ROOT_PLACEHOLDER;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "require-corp" always;
    add_header Cross-Origin-Resource-Policy "same-origin" always;
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS" always;
    add_header Cache-Control "public, max-age=31536000, immutable";
    if ($request_method = OPTIONS) {
      add_header Content-Length 0;
      add_header Content-Type text/plain;
      return 204;
    }
  }

  location /ws {
    proxy_pass http://drawing_ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Host $host;
  }

  # Proxy Linera faucet via local path so the frontend can use the site domain
  location /faucet/ {
    proxy_pass https://faucet.testnet-conway.linera.net/;
    proxy_http_version 1.1;
    proxy_set_header Host faucet.testnet-conway.linera.net;
    proxy_ssl_server_name on;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # Generic Linera RPC dynamic proxy: /linera-rpc/{proto}/{host}/{path}
  location ~ ^/linera-rpc/(?<proto>https|http)/(?<dest>[^/]+)/(?<path>.*)$ {
    if ($request_method = OPTIONS) {
      add_header Access-Control-Allow-Origin *;
      add_header Access-Control-Allow-Methods 'GET, POST, OPTIONS';
      add_header Access-Control-Allow-Headers 'Content-Type, Authorization, X-Requested-With';
      return 204;
    }
    resolver 1.1.1.1 8.8.8.8 valid=300s;
    proxy_pass $proto://$dest/$path$is_args$args;
    proxy_set_header Host $dest;
    proxy_ssl_server_name on;
    proxy_buffering off;
    proxy_http_version 1.1;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Origin $http_origin;
    add_header Access-Control-Allow-Origin *;
    add_header Access-Control-Allow-Methods 'GET, POST, OPTIONS';
    add_header Access-Control-Allow-Headers 'Content-Type, Authorization, X-Requested-With';
    add_header Access-Control-Expose-Headers 'grpc-status,grpc-message,grpc-status-details-bin';
  }
}
EOF

sed -i "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" /etc/nginx/sites-available/$DOMAIN
ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
nginx -t
systemctl reload nginx

# Issue and configure SSL cert
certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --redirect --non-interactive

# Prepare reusable locations + headers snippet for HTTPS server block
cat >/etc/nginx/snippets/${DOMAIN}-locations.conf <<'SNIP'
  # Cross-origin isolation for SharedArrayBuffer in WASM/Workers
  add_header Cross-Origin-Opener-Policy "same-origin" always;
  add_header Cross-Origin-Embedder-Policy "require-corp" always;

  location / {
    root ROOT_PLACEHOLDER;
    index index.html;
    try_files $uri $uri/ /index.html;
  }

  # Static assets with CORS for Workers and dynamic imports
  location /assets/ {
    root ROOT_PLACEHOLDER;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "require-corp" always;
    add_header Cross-Origin-Resource-Policy "same-origin" always;
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS" always;
    add_header Cache-Control "public, max-age=31536000, immutable";
    if ($request_method = OPTIONS) {
      add_header Content-Length 0;
      add_header Content-Type text/plain;
      return 204;
    }
  }

  location /ws {
    proxy_pass http://drawing_ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Host $host;
  }

  # Proxy Linera faucet via local path so the frontend can use the site domain
  location /faucet/ {
    proxy_pass https://faucet.testnet-conway.linera.net/;
    proxy_http_version 1.1;
    proxy_set_header Host faucet.testnet-conway.linera.net;
    proxy_ssl_server_name on;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # Generic Linera RPC dynamic proxy: /linera-rpc/{proto}/{host}/{path}
  location ~ ^/linera-rpc/(?<proto>https|http)/(?<dest>[^/]+)/(?<path>.*)$ {
    if ($request_method = OPTIONS) {
      add_header Access-Control-Allow-Origin *;
      add_header Access-Control-Allow-Methods 'GET, POST, OPTIONS';
      add_header Access-Control-Allow-Headers 'Content-Type, Authorization, X-Requested-With';
      return 204;
    }
    resolver 1.1.1.1 8.8.8.8 valid=300s;
    proxy_pass $proto://$dest/$path$is_args$args;
    proxy_set_header Host $dest;
    proxy_ssl_server_name on;
    proxy_buffering off;
    proxy_http_version 1.1;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Origin $http_origin;
    add_header Access-Control-Allow-Origin *;
    add_header Access-Control-Allow-Methods 'GET, POST, OPTIONS';
    add_header Access-Control-Allow-Headers 'Content-Type, Authorization, X-Requested-With';
  }
SNIP

# Ensure HTTPS server block includes the snippet (added by Certbot)
SITE_CONF="/etc/nginx/sites-available/$DOMAIN"
if grep -q "listen 443" "$SITE_CONF"; then
  if ! grep -q "snippets/${DOMAIN}-locations.conf" "$SITE_CONF"; then
    # Insert include after server_name inside the 443 block
    sed -i "/listen 443.*;/,/}/ { /server_name/s/$/\n    include \/etc\/nginx\/snippets\/${DOMAIN}-locations.conf;/ }" "$SITE_CONF" || true
  fi
fi

# Replace ROOT placeholder with actual deployed directory (under /var/www/$DOMAIN)
sed -i "s|ROOT_PLACEHOLDER|/var/www/$DOMAIN|g" /etc/nginx/sites-available/$DOMAIN
sed -i "s|ROOT_PLACEHOLDER|/var/www/$DOMAIN|g" /etc/nginx/snippets/${DOMAIN}-locations.conf

nginx -t
systemctl reload nginx

# Update project configuration: replace localhost with domain
ENV_FILE="$PROJECT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  sed -i -E "s|ws://localhost:8080|wss://$DOMAIN/ws|g" "$ENV_FILE"
fi

CANVAS_FILE="$PROJECT_DIR/src/components/Canvas.tsx"
if [[ -f "$CANVAS_FILE" ]]; then
  sed -i -E "s|ws://localhost:8080|wss://$DOMAIN/ws|g" "$CANVAS_FILE" || true
fi

# Install dependencies and build frontend (production)
cd "$PROJECT_DIR"
npm ci
npm run build

# Deploy static build to /var/www/$DOMAIN
mkdir -p "/var/www/$DOMAIN"
rm -rf "/var/www/$DOMAIN/*"
cp -r "$PROJECT_DIR/build/"* "/var/www/$DOMAIN/"

# Install and start drawing WebSocket server
cd "$PROJECT_DIR/drawing-server"
npm ci --omit=dev

RUN_USER="${SUDO_USER:-$(whoami)}"

# Ensure any previous dev server unit is disabled and removed
if systemctl list-unit-files | grep -q '^tstdrible-vite\.service'; then
  systemctl disable --now tstdrible-vite.service || true
  rm -f /etc/systemd/system/tstdrible-vite.service || true
fi

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
systemctl enable --now tstdrible-drawing.service

echo "Setup completed. Frontend is served statically from $PROJECT_DIR/build. Visit: https://$DOMAIN/"