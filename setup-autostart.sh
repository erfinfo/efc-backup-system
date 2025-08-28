#!/bin/bash
# Configuration du démarrage automatique - EFC Backup System
# Version 1.5.0

echo "🚀 Configuration du démarrage automatique EFC Backup..."

# 1. Désactiver les anciens services PM2 pour éviter les conflits
systemctl disable pm2-root 2>/dev/null || true

# 2. Activer notre service systemd personnalisé
systemctl enable efc-backup.service

# 3. Sauvegarder la configuration PM2 actuelle
pm2 save

echo "✅ Configuration terminée !"
echo ""
echo "📋 Services configurés :"
echo "  • efc-backup.service (systemd) - ACTIVÉ"
echo "  • pm2-root.service (systemd) - DÉSACTIVÉ"
echo ""
echo "🔄 Commandes disponibles :"
echo "  • systemctl start efc-backup    # Démarrer"
echo "  • systemctl stop efc-backup     # Arrêter" 
echo "  • systemctl restart efc-backup  # Redémarrer"
echo "  • systemctl status efc-backup   # Status"
echo ""
echo "⚠️  Au prochain redémarrage du serveur :"
echo "   Le service EFC Backup démarrera automatiquement"
echo "   avec toutes les variables d'environnement."