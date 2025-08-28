#!/bin/bash
# Script de démarrage PM2 avec variables d'environnement
# EFC Backup System v1.5.0

echo "🚀 Démarrage du serveur EFC Backup..."

# Aller dans le répertoire du projet
cd /root/efc-backup

# Charger les variables d'environnement
source .env

# Exporter les variables SMTP pour PM2
export SMTP_ENABLED
export SMTP_HOST
export SMTP_USER
export SMTP_PASS
export SMTP_PORT
export SMTP_SECURE
export NOTIFICATION_EMAIL
export VERSION

# Variables de notification
export SEND_SUCCESS_NOTIFICATIONS
export SEND_FAILURE_NOTIFICATIONS
export SEND_START_NOTIFICATIONS
export SEND_STARTUP_NOTIFICATIONS
export SEND_SHUTDOWN_NOTIFICATIONS

# Autres variables importantes
export JWT_SECRET
export SESSION_SECRET
export DATABASE_PATH
export BACKUP_PATH
export LOG_PATH
export NODE_ENV

# Arrêter l'ancienne instance si elle existe
pm2 delete efc-backup 2>/dev/null || true

# Démarrer PM2
pm2 start src/index.js --name efc-backup

# Sauvegarder la configuration
pm2 save

# Afficher le status
sleep 3
pm2 status efc-backup

echo "✅ Serveur EFC Backup démarré avec succès!"
echo "📧 Notifications: $SMTP_ENABLED"
echo "🔖 Version: $VERSION"
echo "🌐 URL: https://backup.efcinfo.com"