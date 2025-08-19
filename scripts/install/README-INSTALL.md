# 📦 Scripts d'Installation EFC Backup System

Scripts d'installation automatique pour déployer rapidement le système EFC Backup sur vos serveurs.

## 🐧 Installation Linux (Ubuntu/Debian/CentOS)

### Utilisation Rapide

```bash
# Rendre le script exécutable
chmod +x scripts/install/install-linux.sh

# Exécuter l'installation (en tant que root)
sudo ./scripts/install/install-linux.sh
```

### Ce que fait le script

✅ **Installation automatique complète** :
- Node.js 18 LTS
- PM2 (gestionnaire de processus)
- Toutes les dépendances système
- Configuration sécurisée

✅ **Configuration système** :
- Utilisateur dédié `efc-backup`
- Structure de dossiers optimisée
- Service systemd automatique
- Pare-feu (UFW/firewalld)
- Fail2Ban pour la sécurité

✅ **Démarrage automatique** :
- Service démarré et activé
- PM2 configuré pour redémarrage auto
- Logs rotationnés automatiquement

### Temps d'installation
⏱️ **5-10 minutes** selon la connexion internet

### Résultat
🌐 Interface accessible sur `http://IP-SERVEUR:3000`

---

## 🪟 Installation Windows Server

### Utilisation

```powershell
# Ouvrir PowerShell en Administrateur
# Autoriser l'exécution de scripts
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process

# Exécuter l'installation
.\scripts\install\install-windows.ps1
```

### Ce que fait le script

✅ **Installation automatique complète** :
- Node.js 18 LTS (téléchargement automatique)
- PM2 + PM2-Windows-Service
- Toutes les dépendances npm
- Configuration Windows optimisée

✅ **Configuration système** :
- Dossiers système Windows appropriés
- Service Windows natif
- Pare-feu Windows configuré
- Permissions sécurisées

✅ **Structure Windows** :
- Installation : `C:\Program Files\EFC-Backup`
- Données : `C:\ProgramData\EFC-Backup`
- Logs : `C:\Logs\EFC-Backup`
- Backups : `C:\Backups\EFC`

### Temps d'installation
⏱️ **10-15 minutes** (téléchargement Node.js inclus)

---

## 🔧 Configuration Post-Installation

### 1. Premier Accès

Après installation, l'interface est accessible sur :
- **Linux** : `http://IP-SERVEUR:3000`
- **Windows** : `http://IP-SERVEUR:3000`

### 2. Mot de Passe Admin

Le script génère automatiquement un mot de passe admin sécurisé affiché en fin d'installation.

**Format** : `EFC[8-caractères-aléatoires]123!`

### 3. Configuration des Clients

1. Accéder à l'interface web
2. Aller dans "Clients" → "Ajouter Client"
3. Configurer chaque PC Windows à sauvegarder

---

## 🛠️ Commandes de Maintenance

### Linux

```bash
# Status du service
systemctl status efc-backup

# Logs en temps réel
journalctl -u efc-backup -f

# PM2 status
sudo -u efc-backup pm2 status

# Redémarrer
systemctl restart efc-backup

# Arrêter/Démarrer
systemctl stop efc-backup
systemctl start efc-backup
```

### Windows

```powershell
# Status PM2
pm2 status

# Logs PM2
pm2 logs efc-backup

# Service Windows
Get-Service EFC-Backup

# Redémarrer PM2
pm2 restart efc-backup

# Redémarrer service Windows
Restart-Service EFC-Backup
```

---

## 🔐 Sécurité Intégrée

### Linux
- ✅ Pare-feu UFW/firewalld configuré
- ✅ Fail2Ban activé
- ✅ Utilisateur non-privilégié
- ✅ Permissions strictes
- ✅ Service isolé

### Windows
- ✅ Pare-feu Windows configuré
- ✅ Service Windows sécurisé
- ✅ Permissions NTFS appropriées
- ✅ Isolation des processus

---

## 📁 Structure des Fichiers

### Linux
```
/opt/efc-backup/           # Application
/var/backups/efc/          # Stockage backups
/var/log/efc-backup/       # Logs
/etc/efc-backup/           # Configuration
/var/lib/efc-backup/       # Base de données
```

### Windows
```
C:\Program Files\EFC-Backup\     # Application
C:\Backups\EFC\                  # Stockage backups
C:\Logs\EFC-Backup\              # Logs
C:\ProgramData\EFC-Backup\       # Base de données
```

---

## 🚨 Résolution de Problèmes

### Script Linux ne démarre pas
```bash
# Vérifier les permissions
ls -la scripts/install/install-linux.sh

# Rendre exécutable si nécessaire
chmod +x scripts/install/install-linux.sh

# Vérifier qu'on est dans le bon dossier
ls -la package.json src/
```

### Script Windows bloqué
```powershell
# Vérifier la politique d'exécution
Get-ExecutionPolicy

# Autoriser temporairement
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process

# Vérifier les droits admin
[Security.Principal.WindowsIdentity]::GetCurrent().Groups -contains 'S-1-5-32-544'
```

### Service ne démarre pas

**Linux :**
```bash
# Vérifier les logs
journalctl -u efc-backup -n 50

# Status détaillé
systemctl status efc-backup -l

# Tester manuellement
sudo -u efc-backup bash
cd /opt/efc-backup
npm start
```

**Windows :**
```powershell
# Vérifier les logs PM2
pm2 logs efc-backup

# Tester manuellement
cd "C:\Program Files\EFC-Backup"
node src\index.js
```

### Interface web inaccessible

1. **Vérifier les ports** :
```bash
# Linux
netstat -tulpn | grep 3000

# Windows
netstat -an | findstr 3000
```

2. **Vérifier le pare-feu** :
```bash
# Linux (UFW)
sudo ufw status

# Windows
Get-NetFirewallRule -DisplayName "*EFC*"
```

3. **Tester en local** :
```bash
curl http://localhost:3000
```

---

## 🔄 Mise à Jour

### Linux
```bash
# Arrêter le service
systemctl stop efc-backup

# Sauvegarder la config
cp /opt/efc-backup/.env /tmp/efc-backup-env.backup

# Copier la nouvelle version
cp -r nouvelle-version/* /opt/efc-backup/

# Restaurer la config
cp /tmp/efc-backup-env.backup /opt/efc-backup/.env

# Mettre à jour les dépendances
cd /opt/efc-backup
sudo -u efc-backup npm install --production

# Redémarrer
systemctl start efc-backup
```

### Windows
```powershell
# Arrêter PM2
pm2 stop efc-backup

# Sauvegarder la config
Copy-Item "C:\Program Files\EFC-Backup\.env" "C:\Temp\efc-backup-env.backup"

# Copier la nouvelle version (remplacer les fichiers)
# Restaurer la config
Copy-Item "C:\Temp\efc-backup-env.backup" "C:\Program Files\EFC-Backup\.env"

# Mettre à jour les dépendances
cd "C:\Program Files\EFC-Backup"
npm install --production

# Redémarrer
pm2 restart efc-backup
```

---

## 📞 Support

Pour toute assistance :
- 📧 Email : support@efcinfo.com
- 🌐 Site web : https://efcinfo.com
- 📱 Documentation complète dans `/docs/`

**Version** : 1.0.0  
**Dernière mise à jour** : 2024