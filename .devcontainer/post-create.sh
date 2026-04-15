#!/bin/bash

# Install gitleaks
GITLEAKS_VERSION=$(curl -s "https://api.github.com/repos/gitleaks/gitleaks/releases/latest" | grep -Po '"tag_name": "v\K[0-9.]+')
TMP_ARCHIVE="/tmp/gitleaks.tar.gz"
wget -qO "$TMP_ARCHIVE" "https://github.com/gitleaks/gitleaks/releases/latest/download/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
sudo tar xf "$TMP_ARCHIVE" -C /usr/local/bin gitleaks
rm -f "$TMP_ARCHIVE"

npm install
npm run build && npm link
