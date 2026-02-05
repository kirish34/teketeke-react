# DigitalOcean Deployment (Ubuntu + Nginx + PM2)

This guide targets a fresh Ubuntu 22.04/24.04 Droplet (≥2GB RAM) exposing the Node/Express API at `https://api.teketeke.org`.

## 1) Prereqs & DNS
- Create Droplet (Ubuntu 22.04/24.04, 2GB RAM recommended).
- Point DNS: `api.teketeke.org` → Droplet public IP (A record).

## 2) Harden base OS
```bash
# create non-root user
adduser deploy
usermod -aG sudo deploy
su - deploy

# basic firewall
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable
```

## 3) Install runtime + tooling
```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git nginx python3-certbot-nginx
npm install -g pm2
```

## 4) Fetch app & install
```bash
cd ~
git clone https://github.com/kirish34/teketeke-react.git
cd teketeke-react
npm ci       # or npm install
cp .env.production.example .env
# fill in all required secrets (Supabase, Daraja/M-Pesa, etc.)
```

## 5) Database migrate (optional if DB already provisioned)
```bash
npm run migrate
```

## 6) PM2 process (entrypoint: server/server.js, PORT default 5001)
```bash
mkdir -p ops/pm2
pm2 start ops/pm2/ecosystem.config.cjs
pm2 save
pm2 startup systemd -u $USER --hp $HOME
```

## 7) Nginx reverse proxy (server_name api.teketeke.org)
```bash
sudo mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
sudo cp ops/nginx/api.teketeke.org.conf /etc/nginx/sites-available/api.teketeke.org.conf
sudo ln -s /etc/nginx/sites-available/api.teketeke.org.conf /etc/nginx/sites-enabled/api.teketeke.org.conf
sudo nginx -t && sudo systemctl reload nginx
```

### Certbot TLS
```bash
sudo certbot --nginx -d api.teketeke.org --redirect --non-interactive --agree-tos -m admin@teketeke.org
sudo systemctl reload nginx
```

## 8) Expected health checks
```bash
curl -I https://api.teketeke.org/
curl -I https://api.teketeke.org/api/mpesa/callback
curl -I https://api.teketeke.org/api/pay/stk/callback
curl -I https://api.teketeke.org/api/daraja/b2c/result
curl -I https://api.teketeke.org/api/daraja/b2c/timeout
pm2 status
pm2 logs --lines 100
sudo nginx -t
```
(`curl -I` may return 404/405 which is acceptable; goal is 200/4xx not 5xx.)

## 9) Safaricom callback URLs (register exactly)
- C2B PayBill confirmation: `https://api.teketeke.org/api/mpesa/callback`
- STK Push callback: `https://api.teketeke.org/api/pay/stk/callback`
- B2C Result: `https://api.teketeke.org/api/daraja/b2c/result`
- B2C Timeout: `https://api.teketeke.org/api/daraja/b2c/timeout`

## 10) Roll forward / roll back
```bash
cd ~/teketeke-react
git pull
npm ci       # or npm install
pm2 restart teketeke-api
pm2 save
pm2 logs --lines 100
sudo nginx -t && sudo systemctl reload nginx
```

## 11) Frontend note
- Set `VITE_API_BASE=https://api.teketeke.org` for any frontend build consuming this API.
