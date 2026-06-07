#!/bin/bash
# TrustDCX VPS bootstrap — run as root on Ubuntu 22.04
set -e

echo "=== TrustDCX VPS Setup ==="

apt-get update -qq
apt-get install -y nginx

mkdir -p /var/www/trustdcx.com/html

cp trustdcx.com.nginx.conf /etc/nginx/sites-available/trustdcx.com
ln -sf /etc/nginx/sites-available/trustdcx.com /etc/nginx/sites-enabled/trustdcx.com
unlink /etc/nginx/sites-enabled/default 2>/dev/null || true

nginx -t
systemctl enable nginx
systemctl restart nginx

echo "=== Done. Nginx is serving trustdcx.com ==="
