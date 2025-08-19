# EFC Backup System - Script d'installation automatique Windows
# Version: 1.0.0
# Auteur: EFC Informatique
# Usage: Exécuter en tant qu'Administrateur
# PowerShell -ExecutionPolicy Bypass -File install-windows.ps1

#Requires -RunAsAdministrator

# Configuration
$EFC_VERSION = "1.0.0"
$EFC_URL = "https://nodejs.org/dist/v18.19.0/node-v18.19.0-x64.msi"
$INSTALL_DIR = "C:\Program Files\EFC-Backup"
$DATA_DIR = "C:\ProgramData\EFC-Backup"
$LOG_DIR = "C:\Logs\EFC-Backup"
$BACKUP_DIR = "C:\Backups\EFC"
$SERVICE_NAME = "EFC-Backup"
$SERVICE_USER = "EFC-BackupService"

# Couleurs pour l'affichage
function Write-ColoredOutput {
    param(
        [string]$Message,
        [string]$Color = "White"
    )
    
    switch ($Color) {
        "Red" { Write-Host $Message -ForegroundColor Red }
        "Green" { Write-Host $Message -ForegroundColor Green }
        "Yellow" { Write-Host $Message -ForegroundColor Yellow }
        "Blue" { Write-Host $Message -ForegroundColor Blue }
        "Magenta" { Write-Host $Message -ForegroundColor Magenta }
        default { Write-Host $Message }
    }
}

function Write-Header {
    Write-ColoredOutput "`n==================================================" "Magenta"
    Write-ColoredOutput "    EFC BACKUP SYSTEM - INSTALLATION WINDOWS" "Magenta"
    Write-ColoredOutput "          EFC Informatique - efcinfo.com" "Magenta"
    Write-ColoredOutput "==================================================" "Magenta"
    Write-ColoredOutput ""
}

function Write-Step {
    param([string]$Message)
    Write-ColoredOutput "[ÉTAPE] $Message" "Blue"
}

function Write-Success {
    param([string]$Message)
    Write-ColoredOutput "[OK] $Message" "Green"
}

function Write-Warning {
    param([string]$Message)
    Write-ColoredOutput "[ATTENTION] $Message" "Yellow"
}

function Write-Error {
    param([string]$Message)
    Write-ColoredOutput "[ERREUR] $Message" "Red"
}

# Vérification des prérequis
function Test-Prerequisites {
    Write-Step "Vérification des prérequis système..."
    
    # Vérifier les droits administrateur
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Error "Ce script doit être exécuté en tant qu'Administrateur"
        exit 1
    }
    
    # Vérifier la version de Windows
    $osVersion = [System.Environment]::OSVersion.Version
    if ($osVersion.Major -lt 10) {
        Write-Error "Windows 10 ou supérieur requis"
        exit 1
    }
    
    # Vérifier l'espace disque (minimum 5GB)
    $disk = Get-WmiObject -Class Win32_LogicalDisk -Filter "DeviceID='C:'"
    $freeSpaceGB = [math]::Round($disk.FreeSpace / 1GB, 2)
    if ($freeSpaceGB -lt 5) {
        Write-Warning "Espace disque insuffisant sur C:. $freeSpaceGB GB disponible, 5GB minimum requis."
    }
    
    # Vérifier PowerShell version
    if ($PSVersionTable.PSVersion.Major -lt 5) {
        Write-Error "PowerShell 5.0 ou supérieur requis"
        exit 1
    }
    
    Write-Success "Prérequis vérifiés"
}

# Installation de Node.js
function Install-NodeJS {
    Write-Step "Vérification/Installation de Node.js..."
    
    # Vérifier si Node.js est déjà installé
    try {
        $nodeVersion = & node --version 2>$null
        if ($nodeVersion -match "v(\d+)\.(\d+)\.(\d+)") {
            $major = [int]$matches[1]
            if ($major -ge 16) {
                Write-Success "Node.js $nodeVersion déjà installé"
                return
            } else {
                Write-Warning "Version de Node.js trop ancienne: $nodeVersion"
            }
        }
    } catch {
        Write-Step "Node.js n'est pas installé, téléchargement en cours..."
    }
    
    # Télécharger Node.js
    $nodeInstaller = "$env:TEMP\nodejs-installer.msi"
    Write-Step "Téléchargement de Node.js depuis nodejs.org..."
    
    try {
        Invoke-WebRequest -Uri $EFC_URL -OutFile $nodeInstaller -UseBasicParsing
        Write-Success "Node.js téléchargé"
    } catch {
        Write-Error "Échec du téléchargement de Node.js: $($_.Exception.Message)"
        exit 1
    }
    
    # Installer Node.js silencieusement
    Write-Step "Installation de Node.js..."
    $installArgs = "/i `"$nodeInstaller`" /quiet /norestart"
    $process = Start-Process -FilePath "msiexec.exe" -ArgumentList $installArgs -Wait -PassThru
    
    if ($process.ExitCode -eq 0) {
        # Recharger les variables d'environnement
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        
        # Vérifier l'installation
        try {
            $nodeVersion = & node --version
            $npmVersion = & npm --version
            Write-Success "Node.js $nodeVersion et npm $npmVersion installés avec succès"
        } catch {
            Write-Error "Node.js installé mais non accessible. Redémarrage requis."
            exit 1
        }
    } else {
        Write-Error "Échec de l'installation de Node.js (Code: $($process.ExitCode))"
        exit 1
    }
    
    # Nettoyer
    Remove-Item $nodeInstaller -Force -ErrorAction SilentlyContinue
}

# Installation de PM2
function Install-PM2 {
    Write-Step "Installation de PM2..."
    
    # Vérifier si PM2 est déjà installé
    try {
        $pm2Version = & pm2 --version 2>$null
        Write-Success "PM2 $pm2Version déjà installé"
        return
    } catch {
        Write-Step "Installation de PM2..."
    }
    
    # Installer PM2 globalement
    try {
        & npm install -g pm2 --silent
        Write-Success "PM2 installé avec succès"
    } catch {
        Write-Error "Échec de l'installation de PM2: $($_.Exception.Message)"
        exit 1
    }
}

# Installation de PM2-Windows-Service
function Install-PM2-Service {
    Write-Step "Installation du service PM2..."
    
    try {
        & npm install -g pm2-windows-service --silent
        Write-Success "PM2-Windows-Service installé"
    } catch {
        Write-Warning "PM2-Windows-Service non disponible, utilisation alternative"
    }
}

# Création de la structure de dossiers
function New-DirectoryStructure {
    Write-Step "Création de la structure de dossiers..."
    
    $directories = @($INSTALL_DIR, $DATA_DIR, $LOG_DIR, $BACKUP_DIR)
    
    foreach ($dir in $directories) {
        if (-not (Test-Path $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            Write-Success "Dossier créé: $dir"
        } else {
            Write-Warning "Dossier existe déjà: $dir"
        }
    }
    
    # Définir les permissions
    try {
        $acl = Get-Acl $DATA_DIR
        $accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            "Users", "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow"
        )
        $acl.SetAccessRule($accessRule)
        Set-Acl -Path $DATA_DIR -AclObject $acl
        
        # Même chose pour les logs et backups
        Set-Acl -Path $LOG_DIR -AclObject $acl
        Set-Acl -Path $BACKUP_DIR -AclObject $acl
        
        Write-Success "Permissions définies"
    } catch {
        Write-Warning "Impossible de définir les permissions: $($_.Exception.Message)"
    }
}

# Copie des fichiers EFC Backup
function Copy-EFCBackupFiles {
    Write-Step "Installation des fichiers EFC Backup..."
    
    # Détecter le dossier source
    $sourceDir = $null
    if (Test-Path ".\src" -and Test-Path ".\package.json") {
        $sourceDir = "."
    } elseif (Test-Path "..\src" -and Test-Path "..\package.json") {
        $sourceDir = ".."
    } else {
        Write-Error "Fichiers du projet EFC Backup non trouvés"
        Write-Error "Placez ce script dans le dossier du projet"
        exit 1
    }
    
    # Copier les fichiers
    try {
        Copy-Item -Path "$sourceDir\*" -Destination $INSTALL_DIR -Recurse -Force -Exclude @("node_modules", ".git", "*.log")
        Write-Success "Fichiers copiés vers $INSTALL_DIR"
    } catch {
        Write-Error "Échec de la copie: $($_.Exception.Message)"
        exit 1
    }
}

# Installation des dépendances npm
function Install-NPMDependencies {
    Write-Step "Installation des dépendances Node.js..."
    
    Push-Location $INSTALL_DIR
    try {
        & npm install --production --silent
        Write-Success "Dépendances installées"
    } catch {
        Write-Error "Échec de l'installation des dépendances: $($_.Exception.Message)"
        Pop-Location
        exit 1
    }
    Pop-Location
}

# Configuration de l'environnement
function Set-EnvironmentConfiguration {
    Write-Step "Configuration de l'environnement..."
    
    $envFile = Join-Path $INSTALL_DIR ".env"
    
    if (-not (Test-Path $envFile)) {
        $envContent = @"
# Configuration EFC Backup System Windows
PORT=3000
NODE_ENV=production
HOST=0.0.0.0

# Chemins Windows
BACKUP_PATH=$($BACKUP_DIR.Replace('\', '/'))
LOG_PATH=$($LOG_DIR.Replace('\', '/'))
TEMP_PATH=$($env:TEMP.Replace('\', '/'))/efc-backup

# Configuration des Backups
RETENTION_DAYS=30
MAX_PARALLEL_BACKUPS=2
COMPRESSION_ENABLED=true
USE_VSS=true

# Base de Données
DB_TYPE=sqlite
DB_PATH=$($DATA_DIR.Replace('\', '/'))/database.db

# Sécurité
JWT_SECRET=$((-join ((65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})))
ADMIN_PASSWORD=EFC$((-join ((65..90) + (97..122) + (48..57) | Get-Random -Count 8 | % {[char]$_})))123!
SESSION_TIMEOUT=3600000

# Logs
LOG_LEVEL=info
LOG_MAX_SIZE=52428800
LOG_MAX_FILES=30

# Windows spécifique
WINDOWS_USE_ROBOCOPY=true
WINDOWS_USE_WBADMIN=false
WINDOWS_SHADOW_COPY=true
"@
        
        try {
            $envContent | Out-File -FilePath $envFile -Encoding UTF8
            Write-Success "Fichier .env créé"
        } catch {
            Write-Error "Échec de la création du fichier .env: $($_.Exception.Message)"
            exit 1
        }
    } else {
        Write-Warning "Fichier .env existe déjà"
    }
}

# Configuration PM2
function Set-PM2Configuration {
    Write-Step "Configuration de PM2..."
    
    $pm2Config = @"
module.exports = {
  apps: [{
    name: 'efc-backup',
    script: './src/index.js',
    cwd: '$($INSTALL_DIR.Replace('\', '/'))',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    env: {
      NODE_ENV: 'production'
    },
    log_file: '$($LOG_DIR.Replace('\', '/'))/pm2.log',
    out_file: '$($LOG_DIR.Replace('\', '/'))/pm2-out.log',
    error_file: '$($LOG_DIR.Replace('\', '/'))/pm2-error.log',
    time: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    max_memory_restart: '1G'
  }]
}
"@
    
    $configFile = Join-Path $INSTALL_DIR "ecosystem.config.js"
    try {
        $pm2Config | Out-File -FilePath $configFile -Encoding UTF8
        Write-Success "Configuration PM2 créée"
    } catch {
        Write-Error "Échec de la création de la configuration PM2: $($_.Exception.Message)"
        exit 1
    }
}

# Configuration du pare-feu Windows
function Set-WindowsFirewall {
    Write-Step "Configuration du pare-feu Windows..."
    
    try {
        # Autoriser le port 3000 pour EFC Backup
        New-NetFirewallRule -DisplayName "EFC Backup System" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Any -ErrorAction SilentlyContinue
        Write-Success "Règle pare-feu ajoutée pour le port 3000"
    } catch {
        Write-Warning "Impossible de configurer le pare-feu: $($_.Exception.Message)"
    }
    
    try {
        # S'assurer que SSH est autorisé si OpenSSH est installé
        New-NetFirewallRule -DisplayName "OpenSSH Server" -Direction Inbound -Protocol TCP -LocalPort 22 -Action Allow -Profile Any -ErrorAction SilentlyContinue
        Write-Success "Règle pare-feu ajoutée pour SSH (port 22)"
    } catch {
        Write-Warning "Impossible de configurer le pare-feu pour SSH"
    }
}

# Installation du service Windows
function Install-WindowsService {
    Write-Step "Installation du service Windows..."
    
    # Créer un script de démarrage pour le service
    $serviceScript = @"
@echo off
cd /d "$INSTALL_DIR"
pm2 start ecosystem.config.js
pm2 save
"@
    
    $serviceScriptPath = Join-Path $INSTALL_DIR "start-service.bat"
    $serviceScript | Out-File -FilePath $serviceScriptPath -Encoding ASCII
    
    try {
        # Utiliser NSSM si disponible, sinon sc.exe
        $nssmPath = Get-Command "nssm.exe" -ErrorAction SilentlyContinue
        if ($nssmPath) {
            Write-Step "Installation du service avec NSSM..."
            & nssm install $SERVICE_NAME "cmd.exe" "/c `"$serviceScriptPath`""
            & nssm set $SERVICE_NAME AppDirectory $INSTALL_DIR
            & nssm set $SERVICE_NAME DisplayName "EFC Backup System"
            & nssm set $SERVICE_NAME Description "Système de backup automatique EFC Informatique"
            & nssm set $SERVICE_NAME Start SERVICE_AUTO_START
        } else {
            Write-Step "Installation du service avec sc.exe..."
            $servicePath = "cmd.exe /c `"$serviceScriptPath`""
            & sc.exe create $SERVICE_NAME binPath= $servicePath start= auto DisplayName= "EFC Backup System"
        }
        
        Write-Success "Service Windows installé"
    } catch {
        Write-Warning "Impossible de créer le service Windows: $($_.Exception.Message)"
        Write-Warning "Le service devra être créé manuellement"
    }
}

# Démarrage des services
function Start-Services {
    Write-Step "Démarrage des services..."
    
    # Démarrer PM2
    Push-Location $INSTALL_DIR
    try {
        & pm2 start ecosystem.config.js
        & pm2 save
        Write-Success "PM2 démarré"
    } catch {
        Write-Error "Échec du démarrage de PM2: $($_.Exception.Message)"
        Pop-Location
        return
    }
    Pop-Location
    
    # Démarrer le service Windows si installé
    try {
        Start-Service -Name $SERVICE_NAME -ErrorAction Stop
        Write-Success "Service Windows démarré"
    } catch {
        Write-Warning "Service Windows non démarré: $($_.Exception.Message)"
    }
}

# Tests de fonctionnement
function Test-Installation {
    Write-Step "Tests de fonctionnement..."
    
    Start-Sleep -Seconds 10
    
    # Test de réponse HTTP
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -eq 200) {
            Write-Success "Interface web accessible"
        }
    } catch {
        Write-Warning "Interface web non accessible immédiatement"
        Write-Warning "Vérifiez les logs PM2 avec: pm2 logs efc-backup"
    }
    
    # Test des dossiers
    if ((Test-Path $INSTALL_DIR) -and (Test-Path $DATA_DIR) -and (Test-Path $LOG_DIR)) {
        Write-Success "Structure de dossiers correcte"
    } else {
        Write-Warning "Structure de dossiers incomplète"
    }
    
    # Test PM2
    try {
        $pm2Status = & pm2 status
        Write-Success "PM2 opérationnel"
    } catch {
        Write-Warning "PM2 non accessible"
    }
}

# Affichage des informations finales
function Show-FinalInfo {
    Write-Step "Installation terminée !"
    
    Write-ColoredOutput "`n==================================================" "Green"
    Write-ColoredOutput "    INSTALLATION EFC BACKUP TERMINÉE" "Green"
    Write-ColoredOutput "==================================================" "Green"
    Write-ColoredOutput ""
    
    # Obtenir l'adresse IP locale
    $localIP = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Ethernet*" | Select-Object -First 1).IPAddress
    if (-not $localIP) {
        $localIP = "localhost"
    }
    
    Write-Host "🌐 Interface web: http://$($localIP):3000" -ForegroundColor Cyan
    Write-Host "📁 Dossier d'installation: $INSTALL_DIR" -ForegroundColor Cyan
    Write-Host "💾 Dossier de backup: $BACKUP_DIR" -ForegroundColor Cyan
    Write-Host "📋 Logs: $LOG_DIR" -ForegroundColor Cyan
    
    # Afficher le mot de passe admin
    $envFile = Join-Path $INSTALL_DIR ".env"
    if (Test-Path $envFile) {
        $adminPass = (Get-Content $envFile | Select-String "ADMIN_PASSWORD=").ToString().Split("=")[1]
        Write-Host "🔐 Mot de passe admin: $adminPass" -ForegroundColor Yellow
    }
    
    Write-Host "`nCommandes utiles:" -ForegroundColor White
    Write-Host "  - PM2 status: pm2 status" -ForegroundColor Gray
    Write-Host "  - PM2 logs: pm2 logs efc-backup" -ForegroundColor Gray
    Write-Host "  - Service: Get-Service $SERVICE_NAME" -ForegroundColor Gray
    Write-Host "  - Redémarrer: pm2 restart efc-backup" -ForegroundColor Gray
    
    Write-Host "`nConfiguration:" -ForegroundColor White
    Write-Host "  - Fichier .env: $INSTALL_DIR\.env" -ForegroundColor Gray
    Write-Host "  - PM2 config: $INSTALL_DIR\ecosystem.config.js" -ForegroundColor Gray
    
    Write-ColoredOutput "`nN'oubliez pas de:" "Yellow"
    Write-Host "  1. Configurer vos clients Windows avec SSH" -ForegroundColor Gray
    Write-Host "  2. Ajouter vos clients dans l'interface web" -ForegroundColor Gray
    Write-Host "  3. Tester un premier backup" -ForegroundColor Gray
    Write-Host "  4. Configurer la planification automatique" -ForegroundColor Gray
    
    Write-ColoredOutput "`nInstallation réussie ! 🎉" "Green"
}

# Fonction de nettoyage en cas d'erreur
function Cleanup-OnError {
    param([string]$ErrorMessage)
    
    Write-Error "Erreur durant l'installation: $ErrorMessage"
    Write-Step "Nettoyage en cours..."
    
    # Arrêter les services
    try {
        & pm2 delete efc-backup -s
    } catch { }
    
    try {
        Stop-Service -Name $SERVICE_NAME -Force -ErrorAction SilentlyContinue
        & sc.exe delete $SERVICE_NAME
    } catch { }
    
    Write-Warning "Nettoyage terminé. Vérifiez les logs dans: $LOG_DIR"
}

# Fonction principale
function Main {
    try {
        Write-Header
        
        # Demander confirmation
        Write-ColoredOutput "Cette installation va configurer EFC Backup System sur ce serveur Windows." "Yellow"
        $confirm = Read-Host "Voulez-vous continuer ? (O/N)"
        if ($confirm -notmatch "^[Oo]$") {
            Write-Host "Installation annulée"
            exit 0
        }
        
        Test-Prerequisites
        Install-NodeJS
        Install-PM2
        Install-PM2-Service
        New-DirectoryStructure
        Copy-EFCBackupFiles
        Install-NPMDependencies
        Set-EnvironmentConfiguration
        Set-PM2Configuration
        Set-WindowsFirewall
        Install-WindowsService
        Start-Services
        Test-Installation
        Show-FinalInfo
        
    } catch {
        Cleanup-OnError $_.Exception.Message
        exit 1
    }
}

# Point d'entrée
if ($MyInvocation.InvocationName -ne '.') {
    Main
}