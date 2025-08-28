# Scripts PM2 - EFC Backup System

## 🚀 Démarrage complet

```bash
cd /root/efc-backup
./start-pm2.sh
```

## 🔄 Redémarrage avec variables d'environnement

```bash
cd /root/efc-backup
./restart-pm2.sh
```

## 📋 Commandes manuelles

### Redémarrage complet
```bash
source /root/efc-backup/.env && \
export SMTP_ENABLED SMTP_HOST SMTP_USER SMTP_PASS SMTP_PORT SMTP_SECURE NOTIFICATION_EMAIL VERSION && \
pm2 restart efc-backup
```

### Démarrage from scratch
```bash
cd /root/efc-backup && \
source .env && \
export SMTP_ENABLED SMTP_HOST SMTP_USER SMTP_PASS SMTP_PORT SMTP_SECURE NOTIFICATION_EMAIL VERSION && \
pm2 delete efc-backup && \
pm2 start src/index.js --name efc-backup && \
pm2 save
```

### Status et logs
```bash
pm2 status efc-backup
pm2 logs efc-backup --lines 20
pm2 env efc-backup | grep SMTP
```

## 🔧 Résolution de problèmes

Si les notifications ne marchent pas après redémarrage :
1. Vérifier les variables : `pm2 env efc-backup | grep SMTP`
2. Utiliser le script : `./restart-pm2.sh`  
3. Vérifier les logs : `pm2 logs efc-backup`

Les scripts se chargent automatiquement de toutes les variables d'environnement nécessaires !