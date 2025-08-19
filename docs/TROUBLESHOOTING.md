# 🔧 Guide de Dépannage - EFC Backup System

## 🚨 Problèmes Courants et Solutions

### 1. Impossible de se connecter à l'interface web

#### Symptômes
- Page inaccessible sur http://localhost:3000
- Erreur "This site can't be reached"
- Timeout de connexion

#### Solutions

**A. Vérifier que le serveur est lancé**
```bash
# Vérifier le processus
ps aux | grep efc-backup
# ou avec PM2
pm2 status

# Vérifier les logs
pm2 logs efc-backup
# ou directement
tail -f logs/app.log
```

**B. Vérifier le port**
```bash
# Vérifier que le port 3000 est ouvert
netstat -tulpn | grep 3000
# ou
ss -tulpn | grep 3000
```

**C. Problème de pare-feu**
```bash
# Linux (Ubuntu/Debian)
sudo ufw allow 3000

# Linux (CentOS/RHEL)
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload

# Windows
netsh advfirewall firewall add rule name="EFC Backup" dir=in action=allow protocol=TCP localport=3000
```

### 2. Erreur de connexion SSH aux clients Windows

#### Symptômes
- "Connection refused"
- "Authentication failed"
- "Host unreachable"

#### Solutions

**A. Vérifier SSH sur le client Windows**
```powershell
# Sur le client Windows (PowerShell Admin)
Get-Service sshd
Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH*'

# Si SSH n'est pas installé
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0

# Démarrer le service
Start-Service sshd
Set-Service -Name sshd -StartupType 'Automatic'
```

**B. Tester la connexion manuellement**
```bash
# Depuis le serveur de backup
ssh -v backupuser@IP_CLIENT

# Test avec clé (si configurée)
ssh -i ~/.ssh/id_rsa backupuser@IP_CLIENT
```

**C. Problème d'authentification**
```powershell
# Vérifier que l'utilisateur existe
Get-LocalUser backupuser

# Réinitialiser le mot de passe
$Password = ConvertTo-SecureString "NewPassword123!" -AsPlainText -Force
Set-LocalUser -Name "backupuser" -Password $Password

# Vérifier les groupes
Get-LocalGroupMember -Group "Administrators" | Where-Object Name -like "*backupuser*"
```

### 3. Backup qui échoue avec "Permission denied"

#### Symptômes
- Erreurs "Access denied" dans les logs
- Certains fichiers ne sont pas sauvegardés
- Erreur VSS

#### Solutions

**A. Vérifier les permissions Windows**
```powershell
# Donner tous les droits à l'utilisateur backup
$User = "backupuser"
$Folders = @("C:\Users", "C:\ProgramData")

foreach ($Folder in $Folders) {
    icacls $Folder /grant "${User}:(OI)(CI)F" /T /C
}

# Ajouter aux opérateurs de sauvegarde
Add-LocalGroupMember -Group "Backup Operators" -Member $User
```

**B. Configuration VSS**
```powershell
# Vérifier VSS
vssadmin list writers
vssadmin list providers

# Réparer VSS si nécessaire
vssadmin delete shadows /all
Restart-Service VSS
```

**C. Exclusions antivirus**
Ajouter les exclusions dans votre antivirus :
- Processus : `ssh.exe`, `scp.exe`
- Dossiers : Répertoires de backup temporaires

### 4. Erreur "Disk space full" ou espace insuffisant

#### Symptômes
- Backup qui s'arrête brutalement
- Message "No space left on device"
- Performance dégradée

#### Solutions

**A. Nettoyer les anciens backups**
```bash
# Nettoyage manuel
find /var/backups/efc -type f -mtime +30 -delete

# Ou utiliser le script intégré
npm run cleanup -- --days=15

# Vérifier l'espace après nettoyage
df -h /var/backups/efc
```

**B. Optimiser la configuration**
```bash
# Dans .env, réduire la rétention
RETENTION_DAYS=15

# Activer la compression
COMPRESSION_ENABLED=true
COMPRESSION_LEVEL=6

# Limiter les backups parallèles
MAX_PARALLEL_BACKUPS=1
```

**C. Déplacer sur un autre volume**
```bash
# Créer un nouveau point de montage
sudo mkdir /mnt/backup-disk
sudo mount /dev/sdb1 /mnt/backup-disk

# Modifier le chemin dans .env
BACKUP_PATH=/mnt/backup-disk/efc
```

### 5. Performance lente / Timeout de backup

#### Symptômes
- Backup très long (plusieurs heures)
- Erreur de timeout
- Interface web qui ne répond plus

#### Solutions

**A. Optimiser les paramètres réseau**
```bash
# Dans .env, augmenter les timeouts
BACKUP_TIMEOUT=14400000  # 4 heures

# Limiter la bande passante si nécessaire
TRANSFER_SPEED_LIMIT=1024  # 1 MB/s max
```

**B. Optimiser SSH**
Créer `~/.ssh/config` sur le serveur :
```
Host *
    Compression yes
    CompressionLevel 6
    ServerAliveInterval 30
    ServerAliveCountMax 3
    TCPKeepAlive yes
```

**C. Exclure des fichiers volumineux**
```bash
# Modifier la configuration client pour exclure :
# - Fichiers temporaires
# - Cache navigateurs
# - Fichiers système volumineux
```

### 6. Base de données corrompue

#### Symptômes
- Erreur "database is locked"
- Interface web qui ne charge plus les données
- Erreur SQLite

#### Solutions

**A. Vérifier l'intégrité**
```bash
# Vérifier la base SQLite
sqlite3 data/efc-backup.db "PRAGMA integrity_check;"

# Réparer si nécessaire
sqlite3 data/efc-backup.db ".backup backup.db"
mv backup.db data/efc-backup.db
```

**B. Restaurer depuis une sauvegarde**
```bash
# Arrêter le service
pm2 stop efc-backup

# Restaurer la DB
cp data/efc-backup.db.backup data/efc-backup.db

# Redémarrer
pm2 start efc-backup
```

### 7. Logs qui ne s'affichent pas

#### Symptômes
- Onglet "Logs" vide
- Pas de fichiers dans le dossier logs/
- Erreurs non tracées

#### Solutions

**A. Vérifier la configuration de logs**
```bash
# Dans .env
LOG_LEVEL=debug
ENABLE_FILE_LOG=true
ENABLE_CONSOLE_LOG=true

# Créer le dossier s'il n'existe pas
mkdir -p logs
chmod 755 logs
```

**B. Permissions des fichiers**
```bash
# Vérifier les permissions
ls -la logs/
sudo chown -R $(whoami):$(whoami) logs/
```

### 8. Interface web blanche ou erreur JavaScript

#### Symptômes
- Page blanche après chargement
- Erreur 404 sur les ressources CSS/JS
- Console browser avec erreurs

#### Solutions

**A. Vérifier les fichiers statiques**
```bash
# Vérifier que les fichiers existent
ls -la web/
ls -la web/styles.css
ls -la web/app.js
```

**B. Problème de cache navigateur**
```bash
# Vider le cache navigateur
# Ou ouvrir en mode incognito
# Ou utiliser Ctrl+F5 pour reload complet
```

**C. Permissions des fichiers web**
```bash
chmod -R 644 web/
chmod 755 web/
```

## 🔍 Diagnostic Avancé

### Collecte d'informations système

```bash
#!/bin/bash
# Script de diagnostic

echo "=== EFC Backup System - Diagnostic ==="
echo "Date: $(date)"
echo

echo "--- Système ---"
uname -a
df -h
free -h
echo

echo "--- Node.js ---"
node --version
npm --version
echo

echo "--- Processus EFC ---"
ps aux | grep -E "(node|efc)" | grep -v grep
echo

echo "--- Ports ---"
netstat -tulpn | grep -E "(3000|22)"
echo

echo "--- Logs récents ---"
tail -n 20 logs/error.log 2>/dev/null || echo "Pas de logs d'erreur"
echo

echo "--- Espace disque backups ---"
du -sh /var/backups/efc/* 2>/dev/null | tail -10
echo

echo "--- Configuration SSH ---"
ssh -V
ls -la ~/.ssh/
```

### Activation du mode debug

```bash
# Dans .env
DEBUG_MODE=true
LOG_LEVEL=debug

# Redémarrer avec debug
DEBUG=* npm start
```

### Test de connectivité réseau

```bash
# Test ping
ping -c 4 IP_CLIENT

# Test port SSH
nc -zv IP_CLIENT 22

# Test depuis le client vers le serveur
# (depuis le client Windows)
Test-NetConnection SERVER_IP -Port 3000
```

## 📞 Obtenir de l'Aide

### Informations à fournir

Avant de contacter le support, préparez :

1. **Fichiers de logs** :
```bash
tar -czf efc-debug.tar.gz logs/ data/ .env
```

2. **Configuration système** :
```bash
# Informations système
cat /etc/os-release
node --version
npm --version
```

3. **Description détaillée** :
- Étapes qui ont mené au problème
- Messages d'erreur exacts
- Capture d'écran si problème d'interface
- Heure approximative du problème

### Commandes de Debug Utiles

```bash
# Démarrer en mode verbose
NODE_ENV=development DEBUG=* npm start

# Surveiller les logs en temps réel
tail -f logs/app.log logs/error.log

# Tester un backup spécifique
node -e "
const BackupClient = require('./src/backup/windowsBackup');
const client = new BackupClient({
  name: 'test',
  host: 'IP_CLIENT',
  username: 'backupuser',
  password: 'PASSWORD'
});
client.connect().then(() => console.log('OK')).catch(console.error);
"
```

---

**💡 Conseil** : Gardez toujours des sauvegardes de votre configuration (.env, data/) avant toute modification importante !