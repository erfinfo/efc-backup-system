#!/bin/bash
# Script de redémarrage PM2 avec variables d'environnement
# EFC Backup System v1.5.0

echo "🔄 Redémarrage du serveur EFC Backup..."

# Charger les variables d'environnement
source /root/efc-backup/.env

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

# Redémarrer PM2
pm2 restart efc-backup

# Afficher le status
sleep 2
pm2 status efc-backup

echo "✅ Serveur EFC Backup redémarré avec succès!"
echo "📧 Notifications: $SMTP_ENABLED"
echo "🔖 Version: $VERSION"