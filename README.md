# 📦 EFC Backup System - Documentation Complète

Système professionnel de backup automatique pour clients Windows avec interface web standalone.

## 🚀 Installation Rapide

### Prérequis Système

#### Sur le serveur de backup (Linux/Windows/Mac)
- **Node.js** version 16 ou supérieure
- **npm** version 7 ou supérieure
- **Espace disque** : Au moins 100 GB pour stocker les backups
- **RAM** : Minimum 2 GB recommandé
- **Ports** : Port 3000 (configurable) pour l'interface web

#### Sur les clients Windows à sauvegarder
- **Windows 10/11** ou **Windows Server 2016+**
- **OpenSSH Server** activé (voir configuration ci-dessous)
- **Compte administrateur** pour les backups système
- **PowerShell 5.0+** installé

## 📋 Installation Étape par Étape

### 1. Installation de Node.js

#### Linux (Ubuntu/Debian)
```bash
# Mettre à jour le système
sudo apt update && sudo apt upgrade -y

# Installer Node.js via NodeSource
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Vérifier l'installation
node --version
npm --version
```

#### Windows
1. Télécharger Node.js depuis https://nodejs.org/
2. Exécuter l'installateur MSI
3. Redémarrer le terminal
4. Vérifier avec `node --version`

#### macOS
```bash
# Avec Homebrew
brew install node

# Ou télécharger depuis nodejs.org
```

### 2. Installation du Système EFC Backup

```bash
# Cloner le projet depuis GitHub
cd /opt  # ou C:\ sur Windows
git clone https://github.com/erfinfo/efc-backup-system.git efc-backup

# Accéder au dossier
cd efc-backup

# Installer les dépendances
npm install

# Créer le fichier de configuration
cp .env.example .env  # ou copy sur Windows
```

### 3. Configuration Initiale

Créer un fichier `.env` à la racine du projet :

```env
# Configuration du serveur
PORT=3000
NODE_ENV=production

# Chemins de stockage
BACKUP_PATH=/var/backups/efc
LOG_PATH=/var/log/efc-backup

# Configuration des backups
RETENTION_DAYS=30
MAX_PARALLEL_BACKUPS=2
COMPRESSION_ENABLED=true

# Notifications
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
NOTIFICATION_EMAIL=admin@company.com

# Sécurité
JWT_SECRET=change-this-secret-key-in-production
ADMIN_PASSWORD=changeme123

# Base de données
DB_PATH=./data/efc-backup.db
```

### 4. Création des dossiers nécessaires

```bash
# Linux/Mac
sudo mkdir -p /var/backups/efc
sudo mkdir -p /var/log/efc-backup
sudo chown -R $USER:$USER /var/backups/efc /var/log/efc-backup

# Windows (PowerShell en admin)
New-Item -ItemType Directory -Path "C:\Backups\EFC" -Force
New-Item -ItemType Directory -Path "C:\Logs\EFC-Backup" -Force
```

## 🖥️ Configuration des Clients Windows

### Activer OpenSSH Server sur Windows

#### Windows 10/11
```powershell
# Exécuter PowerShell en tant qu'administrateur

# Installer OpenSSH Server
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0

# Démarrer le service
Start-Service sshd

# Configurer le démarrage automatique
Set-Service -Name sshd -StartupType 'Automatic'

# Vérifier le pare-feu
New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
```

#### Windows Server
```powershell
# Installer la fonctionnalité
Install-WindowsFeature -Name OpenSSH.Server

# Démarrer et configurer
Start-Service sshd
Set-Service -Name sshd -StartupType 'Automatic'
```

### Créer un utilisateur de backup

```powershell
# Créer un utilisateur dédié aux backups
$Password = ConvertTo-SecureString "BackupP@ssw0rd!" -AsPlainText -Force
New-LocalUser -Name "backupuser" -Password $Password -FullName "EFC Backup User" -Description "Compte pour les backups automatiques"

# Ajouter aux groupes nécessaires
Add-LocalGroupMember -Group "Administrators" -Member "backupuser"
Add-LocalGroupMember -Group "Backup Operators" -Member "backupuser"
```

### Configurer les permissions VSS

```powershell
# Donner les droits VSS à l'utilisateur backup
vssadmin add shadowstorage /for=C: /on=C: /maxsize=10GB
```

## 🚀 Démarrage du Système

### Mode Production

```bash
# Démarrer le serveur
npm start

# Ou avec PM2 pour la production (recommandé)
npm install -g pm2
pm2 start src/index.js --name efc-backup
pm2 save
pm2 startup
# Suivre les instructions affichées pour configurer le démarrage automatique
```

### Configuration PM2 pour le Démarrage Automatique

Pour que le serveur EFC Backup démarre automatiquement au boot du système :

```bash
# Installer PM2 globalement
npm install -g pm2

# Démarrer le service EFC Backup avec PM2
pm2 start src/index.js --name efc-backup

# Sauvegarder la configuration PM2
pm2 save

# Configurer le démarrage automatique
pm2 startup

# Exécuter la commande affichée par pm2 startup (exemple) :
# sudo env PATH=$PATH:/usr/bin /usr/local/lib/node_modules/pm2/bin/pm2 startup systemd -u root --hp /root

# Vérifier le statut
pm2 status
```

**Commandes PM2 utiles :**
- `pm2 status` - Voir le statut des processus
- `pm2 logs efc-backup` - Voir les logs en temps réel  
- `pm2 restart efc-backup` - Redémarrer le service
- `pm2 stop efc-backup` - Arrêter le service
- `pm2 delete efc-backup` - Supprimer le service
- `pm2 monit` - Interface de monitoring

### Mode Développement

```bash
# Avec rechargement automatique
npm run dev
```

### Service Système (Linux)

Créer `/etc/systemd/system/efc-backup.service` :

```ini
[Unit]
Description=EFC Backup System
After=network.target

[Service]
Type=simple
User=efc-backup
WorkingDirectory=/opt/efc-backup
ExecStart=/usr/bin/node /opt/efc-backup/src/index.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=efc-backup
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Activer le service :
```bash
sudo systemctl daemon-reload
sudo systemctl enable efc-backup
sudo systemctl start efc-backup
sudo systemctl status efc-backup
```

## 🌐 Utilisation de l'Interface Web

### Accès Initial

1. Ouvrir un navigateur web
2. Accéder à `http://IP_DU_SERVEUR:3000`
3. Se connecter avec le mot de passe défini dans `.env`

### Dashboard Principal

Le dashboard affiche :
- **Clients Actifs** : Nombre de clients configurés
- **Backups Aujourd'hui** : Backups effectués dans les 24h
- **Espace Utilisé** : Espace disque total des backups
- **Dernière Exécution** : Heure du dernier backup

### Ajouter un Client

1. Cliquer sur l'onglet **"Clients"**
2. Cliquer sur **"Ajouter Client"**
3. Remplir les informations :
   - **Nom** : Identifiant unique du client
   - **Adresse IP** : IP ou nom d'hôte du client Windows
   - **Port SSH** : 22 par défaut
   - **Utilisateur** : backupuser (créé précédemment)
   - **Mot de passe** : Mot de passe du compte
   - **Type de backup** : 
     - Complet : Backup total
     - Incrémentiel : Seulement les changements
     - Différentiel : Changements depuis le dernier complet
   - **Dossiers** : Chemins à sauvegarder (ex: `C:\Users, C:\Program Files`)

### Planification des Backups

1. Aller dans **"Planification"**
2. Configurer les horaires :
   - **Quotidien** : Backup incrémentiel tous les jours
   - **Hebdomadaire** : Backup complet le dimanche
   - **Mensuel** : Archive complète le 1er du mois

### Types de Backup

#### Backup Manuel
- Cliquer sur **"Backup Manuel"** dans le dashboard
- Sélectionner les clients
- Choisir le type de backup
- Lancer l'opération

#### Backup Automatique
Les backups se lancent automatiquement selon la planification configurée.

## 📊 Monitoring et Logs

### Visualisation des Logs

1. Onglet **"Logs"** dans l'interface
2. Filtrer par niveau :
   - **Info** : Opérations normales
   - **Warning** : Avertissements
   - **Error** : Erreurs critiques

### Fichiers de Logs

Les logs sont stockés dans :
- Linux : `/var/log/efc-backup/`
- Windows : `C:\Logs\EFC-Backup\`

Format des fichiers :
- `app-YYYY-MM-DD.log` : Logs de l'application
- `backup-YYYY-MM-DD.log` : Logs des backups
- `error-YYYY-MM-DD.log` : Erreurs uniquement

## 🔧 Maintenance

### Rotation des Backups

Le système supprime automatiquement les backups de plus de X jours (configuré dans `RETENTION_DAYS`).

Pour une rotation manuelle :
```bash
# Linux
find /var/backups/efc -type f -mtime +30 -delete

# Windows PowerShell
Get-ChildItem "C:\Backups\EFC" -Recurse | Where-Object {$_.LastWriteTime -lt (Get-Date).AddDays(-30)} | Remove-Item
```

### Sauvegarde de la Base de Données

```bash
# Sauvegarder la configuration
cp data/efc-backup.db data/efc-backup.db.backup

# Exporter en JSON
sqlite3 data/efc-backup.db .dump > backup-config.sql
```

### Mise à Jour du Système

```bash
# Arrêter le service
pm2 stop efc-backup

# Sauvegarder la configuration
cp -r config config.backup
cp .env .env.backup

# Mettre à jour depuis GitHub
git pull origin master
npm install

# Redémarrer
pm2 restart efc-backup
```

## 🚨 Dépannage

### Le client Windows n'est pas accessible

1. Vérifier que SSH est actif :
```powershell
Get-Service sshd
```

2. Tester la connexion :
```bash
ssh backupuser@IP_CLIENT
```

3. Vérifier le pare-feu Windows :
```powershell
Get-NetFirewallRule -Name sshd
```

### Erreur "VSS not available"

Exécuter sur le client Windows :
```powershell
# Réparer VSS
vssadmin list writers
vssadmin list shadows
vssadmin delete shadows /all

# Redémarrer le service
Restart-Service VSS
```

### L'interface web ne se charge pas

1. Vérifier que le serveur est lancé :
```bash
pm2 status
# ou
systemctl status efc-backup
```

2. Vérifier les logs :
```bash
pm2 logs efc-backup
# ou
journalctl -u efc-backup -f
```

3. Vérifier le port :
```bash
netstat -tulpn | grep 3000
```

### Espace disque insuffisant

1. Vérifier l'espace :
```bash
df -h /var/backups/efc
```

2. Nettoyer les anciens backups :
```bash
npm run cleanup
```

## 📞 Support

### Logs de Debug

Pour activer les logs détaillés :
```bash
NODE_ENV=development npm start
```

### Structure des Backups

Les backups sont organisés ainsi :
```
/var/backups/efc/
├── backup_CLIENT1_1234567890/
│   ├── backup_metadata.json
│   ├── system_info.json
│   ├── Users/
│   ├── ProgramData/
│   └── registry/
│       ├── SOFTWARE.reg
│       ├── SYSTEM.reg
│       └── CURRENT_USER_SOFTWARE.reg
└── backup_CLIENT2_1234567891/
    └── ...
```

### Restauration d'un Backup

1. Localiser le backup dans `/var/backups/efc/`
2. Copier les fichiers vers le client via SCP
3. Restaurer le registre si nécessaire :
```powershell
reg import "C:\Restore\SOFTWARE.reg"
```

## 🔒 Sécurité

### Recommandations

1. **Changer les mots de passe par défaut** dans `.env`
2. **Utiliser HTTPS** avec un certificat SSL
3. **Limiter l'accès** à l'interface par IP
4. **Chiffrer les backups** sensibles
5. **Auditer régulièrement** les accès

### Configuration HTTPS

```javascript
// Dans src/index.js, ajouter :
const https = require('https');
const fs = require('fs');

const options = {
  key: fs.readFileSync('private-key.pem'),
  cert: fs.readFileSync('certificate.pem')
};

https.createServer(options, app).listen(443);
```

## 📈 Performances

### Optimisation

- **Compression** : Activée par défaut pour réduire l'espace
- **Parallélisation** : 2 backups simultanés maximum
- **Bande passante** : Limitation possible dans la configuration

### Monitoring des Ressources

```bash
# CPU et RAM
top -p $(pgrep -f efc-backup)

# Espace disque
watch -n 60 'df -h /var/backups/efc'

# Réseau
iftop -i eth0
```

## 📝 Notes Importantes

1. **Tester les backups** régulièrement en restaurant sur une machine de test
2. **Conserver une copie** des backups hors site
3. **Documenter** la configuration de chaque client
4. **Former** les utilisateurs sur la procédure de restauration
5. **Planifier** les backups en dehors des heures de production

---

**Version** : 1.0.1  
**Dernière mise à jour** : 2024  
**Support** : erick@efcinfo.com  
**Repository GitHub** : https://github.com/erfinfo/efc-backup-system  
**Site web** : https://efcinfo.com