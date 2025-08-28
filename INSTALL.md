# 🚀 Guide d'Installation Rapide - EFC Backup System

## Installation en 5 Minutes

### 1️⃣ Prérequis Minimaux

- **Node.js 16+** et **npm 7+**
- **2 GB RAM** minimum
- **100 GB** d'espace disque
- **Port 3000** disponible

### 2️⃣ Installation Express

```bash
# Télécharger et installer Node.js si nécessaire
# Linux/Mac : curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - && sudo apt install -y nodejs
# Windows : Télécharger depuis https://nodejs.org/

# Installer le système
cd /opt  # ou C:\ sur Windows
git clone [URL] efc-backup  # ou extraire l'archive
cd efc-backup
npm install

# Configuration rapide
echo "PORT=3000
BACKUP_PATH=/backup
RETENTION_DAYS=30
ADMIN_PASSWORD=changeme123" > .env

# Créer les dossiers
mkdir -p /var/backups/efc /var/log/efc-backup

# Démarrer
npm start
```

### 3️⃣ Accès Interface Web

Ouvrir dans un navigateur : **http://localhost:3000**

### 4️⃣ Configuration Client Windows (Rapide)

Sur chaque PC Windows à sauvegarder :

```powershell
# PowerShell en Admin
# Installer SSH
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0

# Démarrer SSH
Start-Service sshd
Set-Service -Name sshd -StartupType 'Automatic'

# Créer utilisateur backup
$Pass = ConvertTo-SecureString "BackupPass123!" -AsPlainText -Force
New-LocalUser -Name "backupuser" -Password $Pass
Add-LocalGroupMember -Group "Administrators" -Member "backupuser"

# Autoriser dans le pare-feu
New-NetFirewallRule -Name sshd -DisplayName 'SSH' -Direction Inbound -Protocol TCP -LocalPort 22 -Action Allow
```

### 5️⃣ Ajouter un Client dans l'Interface

1. Cliquer sur **"Clients"** → **"Ajouter Client"**
2. Remplir :
   - Nom : `PC-Bureau`
   - IP : `192.168.1.100`
   - Utilisateur : `backupuser`
   - Mot de passe : `BackupPass123!`
3. Cliquer **"Ajouter"**
4. Tester avec **"Backup Manuel"**

## 🎯 C'est Tout !

Le système est maintenant opérationnel. Les backups automatiques se lanceront selon la planification configurée.

---

## 📦 Installation Complète avec PM2 (Production)

Pour un environnement de production stable :

```bash
# Installer PM2 globalement
npm install -g pm2

# Démarrer avec PM2
pm2 start src/index.js --name efc-backup
pm2 save
pm2 startup  # Suivre les instructions affichées

# Vérifier
pm2 status
pm2 logs efc-backup
```

## 🐳 Installation Docker (Alternative)

```bash
# Créer l'image
docker build -t efc-backup .

# Lancer le conteneur
docker run -d \
  --name efc-backup \
  -p 3000:3000 \
  -v /var/backups/efc:/backups \
  -v /var/log/efc-backup:/logs \
  --restart unless-stopped \
  efc-backup
```

## ⚡ Commandes Utiles

```bash
# Statut du service
pm2 status efc-backup

# Voir les logs en temps réel
pm2 logs efc-backup --lines 100

# Redémarrer
pm2 restart efc-backup

# Arrêter
pm2 stop efc-backup

# Backup manuel via CLI
npm run backup -- --client="PC-Bureau" --type="full"

# Nettoyer les anciens backups
npm run cleanup -- --days=30
```

## 🆘 Aide Rapide

| Problème | Solution |
|----------|----------|
| Port 3000 occupé | Changer `PORT=3001` dans `.env` |
| Connexion SSH échoue | Vérifier que `sshd` est actif sur le client Windows |
| Espace disque plein | Réduire `RETENTION_DAYS` dans `.env` |
| Interface inaccessible | Vérifier le pare-feu : `sudo ufw allow 3000` |

## 📱 Accès Mobile

L'interface est responsive et fonctionne sur mobile. Pour un accès externe :

1. Configurer le port forwarding sur votre routeur
2. Utiliser un DNS dynamique (DuckDNS, No-IP)
3. Activer HTTPS (voir documentation complète)

---

**Besoin d'aide ?** Consultez le [README.md](README.md) pour la documentation complète.