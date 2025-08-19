#!/bin/bash
# EFC Backup System - Installation Ultra-Rapide Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/votre-repo/efc-backup/main/scripts/install/quick-install.sh | sudo bash

set -e

# Configuration
REPO_URL="https://github.com/votre-repo/efc-backup"  # À remplacer par votre repo
INSTALL_DIR="/opt/efc-backup"
SERVICE_USER="efc-backup"

echo "🚀 EFC Backup System - Installation Rapide"
echo "=========================================="

# Vérification root
if [[ $EUID -ne 0 ]]; then
   echo "❌ Ce script doit être exécuté en root (avec sudo)"
   exit 1
fi

# Détection de l'OS
if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    OS=$ID
else
    echo "❌ OS non supporté"
    exit 1
fi

echo "📋 OS détecté: $OS"

# Installation des dépendances
echo "📦 Installation des dépendances..."
case $OS in
    "ubuntu"|"debian")
        apt-get update -qq
        apt-get install -y curl wget git nodejs npm
        ;;
    "centos"|"rhel"|"fedora")
        if command -v dnf &> /dev/null; then
            dnf install -y curl wget git nodejs npm
        else
            yum install -y curl wget git nodejs npm
        fi
        ;;
    *)
        echo "❌ Distribution $OS non supportée"
        exit 1
        ;;
esac

# Installation de Node.js LTS si version trop ancienne
if ! node --version | grep -qE "v(1[6-9]|[2-9][0-9])"; then
    echo "🔄 Installation de Node.js LTS..."
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
    apt-get install -y nodejs || dnf install -y nodejs || yum install -y nodejs
fi

# Installation PM2
echo "⚙️ Installation de PM2..."
npm install -g pm2

# Créer l'utilisateur
echo "👤 Création de l'utilisateur $SERVICE_USER..."
if ! id "$SERVICE_USER" &>/dev/null; then
    useradd -r -m -s /bin/bash $SERVICE_USER
fi

# Télécharger et installer EFC Backup
echo "📥 Téléchargement d'EFC Backup..."
if [[ -n "$REPO_URL" ]]; then
    # Installation depuis le repository
    git clone "$REPO_URL" "$INSTALL_DIR" || {
        echo "❌ Échec du téléchargement depuis $REPO_URL"
        echo "💡 Astuce: Placez les fichiers manuellement dans $INSTALL_DIR"
        exit 1
    }
else
    # Installation locale
    mkdir -p "$INSTALL_DIR"
    echo "📁 Copiez manuellement les fichiers dans $INSTALL_DIR"
fi

# Permissions
chown -R $SERVICE_USER:$SERVICE_USER "$INSTALL_DIR"

# Créer les dossiers nécessaires
echo "📁 Création des dossiers système..."
mkdir -p /var/backups/efc /var/log/efc-backup /var/lib/efc-backup
chown $SERVICE_USER:$SERVICE_USER /var/backups/efc /var/log/efc-backup /var/lib/efc-backup

# Installation des dépendances
echo "📦 Installation des dépendances Node.js..."
cd "$INSTALL_DIR"
sudo -u $SERVICE_USER npm install --production

# Configuration rapide
echo "⚙️ Configuration..."
if [[ ! -f "$INSTALL_DIR/.env" ]]; then
    cat > "$INSTALL_DIR/.env" << EOF
PORT=3000
NODE_ENV=production
BACKUP_PATH=/var/backups/efc
LOG_PATH=/var/log/efc-backup
DB_PATH=/var/lib/efc-backup/database.db
RETENTION_DAYS=30
ADMIN_PASSWORD=EFC$(openssl rand -base64 8 | tr -d "=+/")123!
JWT_SECRET=$(openssl rand -base64 32)
EOF
    chown $SERVICE_USER:$SERVICE_USER "$INSTALL_DIR/.env"
    chmod 600 "$INSTALL_DIR/.env"
fi

# Démarrer avec PM2
echo "🚀 Démarrage du service..."
sudo -u $SERVICE_USER bash -c "cd $INSTALL_DIR && pm2 start src/index.js --name efc-backup"
sudo -u $SERVICE_USER pm2 save
sudo -u $SERVICE_USER pm2 startup systemd -u $SERVICE_USER --hp /home/$SERVICE_USER

# Configuration du pare-feu
echo "🔥 Configuration du pare-feu..."
if command -v ufw &> /dev/null; then
    ufw allow 3000/tcp
elif command -v firewall-cmd &> /dev/null; then
    firewall-cmd --permanent --add-port=3000/tcp
    firewall-cmd --reload
fi

echo ""
echo "✅ Installation terminée !"
echo "🌐 Interface web: http://$(hostname -I | awk '{print $1}'):3000"
echo "🔐 Mot de passe admin: $(grep ADMIN_PASSWORD $INSTALL_DIR/.env | cut -d'=' -f2)"
echo ""
echo "Commandes utiles:"
echo "  sudo -u $SERVICE_USER pm2 status"
echo "  sudo -u $SERVICE_USER pm2 logs efc-backup"
echo "  sudo -u $SERVICE_USER pm2 restart efc-backup"
echo ""
echo "🎉 EFC Backup System est maintenant opérationnel !"