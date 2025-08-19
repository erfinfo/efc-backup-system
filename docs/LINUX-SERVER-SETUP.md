# 🐧 Configuration Serveur Linux - EFC Backup System

Guide complet pour configurer votre serveur Linux de destination des backups.

## 📋 Prérequis Serveur

### Spécifications Minimales
- **OS** : Ubuntu 20.04+, Debian 11+, CentOS 8+, RHEL 8+
- **RAM** : 4 GB minimum (8 GB recommandé)
- **CPU** : 2 cores minimum (4 cores recommandé)
- **Stockage** : 500 GB minimum pour les backups
- **Réseau** : Connexion stable, ports 22 et 3000 ouverts

### Stockage Recommandé
- **SSD** pour le système et la base de données
- **HDD** en RAID 1/5/6 pour le stockage des backups
- **Partition séparée** pour `/backups` (recommandé)

## 🚀 Installation Pas à Pas

### 1. Mise à Jour du Système

```bash
# Ubuntu/Debian
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git unzip htop fail2ban ufw

# CentOS/RHEL
sudo dnf update -y
sudo dnf install -y curl wget git unzip htop fail2ban firewalld
```

### 2. Installation de Node.js

```bash
# Méthode recommandée via NodeSource
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Vérifier l'installation
node --version
npm --version

# Alternative avec snap (Ubuntu)
sudo snap install node --classic
```

### 3. Création de l'Utilisateur EFC Backup

```bash
# Créer un utilisateur dédié
sudo adduser efc-backup

# Ajouter aux groupes nécessaires
sudo usermod -aG sudo efc-backup
sudo usermod -aG backup efc-backup

# Passer à l'utilisateur
sudo su - efc-backup
```

### 4. Configuration des Dossiers

```bash
# Créer la structure des dossiers
sudo mkdir -p /opt/efc-backup
sudo mkdir -p /var/backups/efc
sudo mkdir -p /var/log/efc-backup
sudo mkdir -p /etc/efc-backup

# Définir les permissions
sudo chown -R efc-backup:efc-backup /opt/efc-backup
sudo chown -R efc-backup:efc-backup /var/backups/efc
sudo chown -R efc-backup:efc-backup /var/log/efc-backup
sudo chown -R efc-backup:efc-backup /etc/efc-backup

# Permissions de sécurité
sudo chmod 755 /opt/efc-backup
sudo chmod 750 /var/backups/efc
sudo chmod 750 /var/log/efc-backup
sudo chmod 700 /etc/efc-backup
```

### 5. Installation du Système EFC Backup

```bash
# Aller dans le dossier d'installation
cd /opt/efc-backup

# Télécharger le système (ou copier depuis votre développement)
# Option 1: Git clone
git clone https://github.com/votre-repo/efc-backup.git .

# Option 2: Copie directe
scp -r /root/efc-backup/* efc-backup@serveur-ip:/opt/efc-backup/

# Installer les dépendances
npm install --production
```

### 6. Configuration de l'Environnement

```bash
# Copier le fichier de configuration
cp .env.example .env

# Éditer la configuration
nano .env
```

Configuration recommandée pour serveur Linux :

```env
# Configuration Serveur Linux Production
PORT=3000
NODE_ENV=production
HOST=0.0.0.0

# Chemins Linux
BACKUP_PATH=/var/backups/efc
LOG_PATH=/var/log/efc-backup
TEMP_PATH=/tmp/efc-backup

# Configuration des Backups
RETENTION_DAYS=90
MAX_PARALLEL_BACKUPS=3
COMPRESSION_ENABLED=true
COMPRESSION_LEVEL=6
USE_VSS=true

# Planning par Défaut
DAILY_BACKUP_TIME=02:00
WEEKLY_BACKUP_DAY=0
WEEKLY_BACKUP_TIME=03:00
MONTHLY_BACKUP_DAY=1
MONTHLY_BACKUP_TIME=04:00

# Base de Données
DB_TYPE=sqlite
DB_PATH=/var/lib/efc-backup/database.db

# Sécurité
JWT_SECRET=$(openssl rand -base64 32)
ADMIN_PASSWORD=VotreMotDePasseSecurise123!
SESSION_TIMEOUT=3600000

# Performance
MAX_FILE_SIZE=53687091200
CHUNK_SIZE=134217728
TRANSFER_SPEED_LIMIT=0
CACHE_ENABLED=true

# Monitoring
ENABLE_METRICS=true
HEALTH_CHECK_INTERVAL=60000
ALERT_DISK_USAGE_PERCENT=85
ALERT_BACKUP_AGE_HOURS=48

# Logs
LOG_LEVEL=info
LOG_MAX_SIZE=52428800
LOG_MAX_FILES=30
LOG_COMPRESS=true
```

### 7. Installation de PM2 (Gestionnaire de Process)

```bash
# Installer PM2 globalement
sudo npm install -g pm2

# Configurer PM2 pour l'utilisateur
pm2 startup
# Suivre les instructions affichées

# Créer un fichier de configuration PM2
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'efc-backup',
    script: './src/index.js',
    cwd: '/opt/efc-backup',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    log_file: '/var/log/efc-backup/pm2.log',
    out_file: '/var/log/efc-backup/pm2-out.log',
    error_file: '/var/log/efc-backup/pm2-error.log',
    time: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    max_memory_restart: '1G'
  }]
}
EOF
```

## 🔥 Configuration du Pare-feu

### UFW (Ubuntu/Debian)

```bash
# Activer UFW
sudo ufw enable

# Autoriser SSH
sudo ufw allow 22/tcp

# Autoriser EFC Backup
sudo ufw allow 3000/tcp

# Autoriser depuis des IPs spécifiques (recommandé)
sudo ufw allow from 192.168.1.0/24 to any port 3000
sudo ufw allow from IP_DE_VOS_CLIENTS to any port 3000

# Vérifier les règles
sudo ufw status
```

### Firewalld (CentOS/RHEL)

```bash
# Démarrer firewalld
sudo systemctl start firewalld
sudo systemctl enable firewalld

# Autoriser les ports
sudo firewall-cmd --permanent --add-port=22/tcp
sudo firewall-cmd --permanent --add-port=3000/tcp

# Autoriser depuis des sources spécifiques
sudo firewall-cmd --permanent --add-rich-rule="rule family='ipv4' source address='192.168.1.0/24' port protocol='tcp' port='3000' accept"

# Recharger la configuration
sudo firewall-cmd --reload
```

## 🔐 Sécurisation du Serveur

### 1. Configuration SSH Sécurisée

```bash
# Éditer la configuration SSH
sudo nano /etc/ssh/sshd_config

# Modifications recommandées :
# Port 2222                    # Changer le port par défaut
# PermitRootLogin no          # Interdire root
# PasswordAuthentication no    # Utiliser uniquement les clés
# AllowUsers efc-backup       # Autoriser seulement l'utilisateur EFC
```

### 2. Authentification par Clés SSH

```bash
# Générer une paire de clés (sur votre poste admin)
ssh-keygen -t rsa -b 4096 -C "admin@efc-backup"

# Copier la clé publique sur le serveur
ssh-copy-id efc-backup@IP_SERVEUR

# Tester la connexion
ssh efc-backup@IP_SERVEUR
```

### 3. Configuration Fail2Ban

```bash
# Créer une configuration pour EFC Backup
sudo nano /etc/fail2ban/jail.local

[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3

[efc-backup]
enabled = true
port = 3000
filter = efc-backup
logpath = /var/log/efc-backup/app.log
maxretry = 5
bantime = 1800

# Créer le filtre
sudo nano /etc/fail2ban/filter.d/efc-backup.conf

[Definition]
failregex = .*Failed login attempt from <HOST>.*
            .*Authentication failed.*<HOST>.*
            .*Invalid credentials.*<HOST>.*

# Redémarrer Fail2Ban
sudo systemctl restart fail2ban
```

## 🎯 Démarrage du Service

### 1. Test Initial

```bash
# Test de base
cd /opt/efc-backup
npm start

# Vérifier que l'interface est accessible
curl http://localhost:3000
```

### 2. Démarrage avec PM2

```bash
# Démarrer avec PM2
pm2 start ecosystem.config.js

# Vérifier le status
pm2 status
pm2 logs efc-backup

# Sauvegarder la configuration
pm2 save
```

### 3. Service Système (Alternative)

```bash
# Créer un service systemd
sudo nano /etc/systemd/system/efc-backup.service

[Unit]
Description=EFC Backup System
After=network.target
Wants=network.target

[Service]
Type=simple
User=efc-backup
Group=efc-backup
WorkingDirectory=/opt/efc-backup
ExecStart=/usr/bin/node /opt/efc-backup/src/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=efc-backup
Environment=NODE_ENV=production
Environment=PATH=/usr/bin:/usr/local/bin
KillMode=mixed
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target

# Activer le service
sudo systemctl daemon-reload
sudo systemctl enable efc-backup
sudo systemctl start efc-backup
sudo systemctl status efc-backup
```

## 📊 Configuration du Stockage

### 1. Disque Dédié aux Backups

```bash
# Identifier le disque
sudo fdisk -l

# Créer une partition
sudo fdisk /dev/sdb
# n -> p -> 1 -> entrée -> entrée -> w

# Formater en ext4
sudo mkfs.ext4 /dev/sdb1

# Créer le point de montage
sudo mkdir -p /mnt/efc-backups

# Monter temporairement
sudo mount /dev/sdb1 /mnt/efc-backups

# Obtenir l'UUID
sudo blkid /dev/sdb1

# Ajouter au fstab pour montage automatique
echo "UUID=votre-uuid-ici /var/backups/efc ext4 defaults,noatime 0 2" | sudo tee -a /etc/fstab

# Tester le montage
sudo mount -a
```

### 2. RAID (Recommandé pour Production)

```bash
# Installer mdadm
sudo apt install mdadm

# Créer un RAID 1 avec 2 disques
sudo mdadm --create /dev/md0 --level=1 --raid-devices=2 /dev/sdb /dev/sdc

# Formater et monter
sudo mkfs.ext4 /dev/md0
sudo mount /dev/md0 /var/backups/efc

# Ajouter au fstab
echo "/dev/md0 /var/backups/efc ext4 defaults,noatime 0 2" | sudo tee -a /etc/fstab
```

## 🔧 Configuration Avancée

### 1. Optimisation Réseau

```bash
# Optimiser pour les transferts SSH
echo "net.core.rmem_max = 134217728" | sudo tee -a /etc/sysctl.conf
echo "net.core.wmem_max = 134217728" | sudo tee -a /etc/sysctl.conf
echo "net.ipv4.tcp_rmem = 4096 65536 134217728" | sudo tee -a /etc/sysctl.conf
echo "net.ipv4.tcp_wmem = 4096 65536 134217728" | sudo tee -a /etc/sysctl.conf

# Appliquer les changements
sudo sysctl -p
```

### 2. Rotation des Logs

```bash
# Créer une configuration logrotate
sudo nano /etc/logrotate.d/efc-backup

/var/log/efc-backup/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 644 efc-backup efc-backup
    postrotate
        pm2 reloadLogs
    endscript
}
```

### 3. Monitoring avec Cron

```bash
# Ajouter des tâches cron
crontab -e

# Vérification quotidienne de l'espace disque
0 8 * * * /opt/efc-backup/scripts/check-disk-space.sh

# Nettoyage hebdomadaire
0 2 * * 0 /opt/efc-backup/scripts/cleanup-old-backups.sh

# Health check toutes les 5 minutes
*/5 * * * * /opt/efc-backup/scripts/health-check.sh
```

### 4. Sauvegarde de la Configuration

```bash
# Script de sauvegarde quotidienne de la DB
cat > /opt/efc-backup/scripts/backup-config.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d)
cp /var/lib/efc-backup/database.db /var/backups/efc/config-backup-$DATE.db
find /var/backups/efc -name "config-backup-*.db" -mtime +7 -delete
EOF

chmod +x /opt/efc-backup/scripts/backup-config.sh

# Ajouter au cron
0 1 * * * /opt/efc-backup/scripts/backup-config.sh
```

## 📝 Configuration HTTPS (Recommandé)

### Avec Nginx Reverse Proxy

```bash
# Installer Nginx
sudo apt install nginx

# Configuration Nginx
sudo nano /etc/nginx/sites-available/efc-backup

server {
    listen 80;
    server_name backup.efcinfo.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name backup.efcinfo.com;

    ssl_certificate /etc/ssl/certs/efc-backup.crt;
    ssl_certificate_key /etc/ssl/private/efc-backup.key;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

# Activer le site
sudo ln -s /etc/nginx/sites-available/efc-backup /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## ✅ Vérification Finale

### Tests de Fonctionnement

```bash
# Vérifier les services
sudo systemctl status efc-backup
pm2 status

# Vérifier les ports
sudo netstat -tlnp | grep -E "(3000|443|80)"

# Test de l'interface web
curl http://localhost:3000
curl -k https://backup.efcinfo.com

# Vérifier les logs
tail -f /var/log/efc-backup/app.log

# Test de connexion SSH depuis un client Windows
ssh backupuser@IP_CLIENT
```

### Checklist de Sécurité

- ✅ Firewall configuré avec règles strictes
- ✅ SSH sécurisé (port changé, clés uniquement)
- ✅ Fail2Ban actif
- ✅ Utilisateur dédié sans privilèges root
- ✅ HTTPS configuré (si applicable)
- ✅ Logs rotationnés automatiquement
- ✅ Surveillance de l'espace disque

## 🆘 Commandes de Maintenance

```bash
# Redémarrer EFC Backup
pm2 restart efc-backup

# Voir les logs en temps réel
pm2 logs efc-backup --lines 100

# Vérifier l'espace disque
df -h /var/backups/efc

# Status complet du système
sudo systemctl status efc-backup
sudo systemctl status nginx
sudo systemctl status fail2ban

# Nettoyer les anciens backups manuellement
find /var/backups/efc -type f -mtime +90 -delete

# Backup de la configuration
sudo tar -czf /tmp/efc-config-$(date +%Y%m%d).tar.gz /opt/efc-backup/.env /var/lib/efc-backup/
```

---

**🎉 Serveur Linux Configuré !**

Votre serveur Linux est maintenant prêt à recevoir et gérer les backups de vos clients Windows. L'interface web EFC Backup est accessible et sécurisée.