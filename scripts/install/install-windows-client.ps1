# EFC Backup System - Configuration automatique client Windows
# Version: 1.0.0
# Auteur: EFC Informatique
# Usage: Configuration SSH et utilisateur backup sur client Windows
# PowerShell -ExecutionPolicy Bypass -File install-windows-client.ps1

#Requires -RunAsAdministrator

# Configuration
$BACKUP_USER = "backupuser"
$BACKUP_PASSWORD = "BackupEFC$(Get-Random -Minimum 1000 -Maximum 9999)!"
$SSH_PORT = 22

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
    Write-ColoredOutput "    EFC BACKUP - CONFIGURATION CLIENT WINDOWS" "Magenta"
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
    Write-Step "Vérification des prérequis..."
    
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
    
    # Vérifier PowerShell version
    if ($PSVersionTable.PSVersion.Major -lt 5) {
        Write-Error "PowerShell 5.0 ou supérieur requis"
        exit 1
    }
    
    Write-Success "Prérequis vérifiés"
}

# Installation d'OpenSSH Server
function Install-OpenSSHServer {
    Write-Step "Installation d'OpenSSH Server..."
    
    # Vérifier si déjà installé
    $sshServerFeature = Get-WindowsCapability -Online | Where-Object Name -eq "OpenSSH.Server~~~~0.0.1.0"
    
    if ($sshServerFeature.State -eq "Installed") {
        Write-Success "OpenSSH Server déjà installé"
    } else {
        Write-Step "Installation d'OpenSSH Server..."
        try {
            Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
            Write-Success "OpenSSH Server installé"
        } catch {
            Write-Error "Échec de l'installation d'OpenSSH Server: $($_.Exception.Message)"
            exit 1
        }
    }
    
    # Vérifier le service SSH
    $sshService = Get-Service -Name sshd -ErrorAction SilentlyContinue
    if ($sshService) {
        Write-Success "Service SSH détecté"
    } else {
        Write-Error "Service SSH non trouvé après installation"
        exit 1
    }
}

# Configuration du service SSH
function Set-SSHConfiguration {
    Write-Step "Configuration du service SSH..."
    
    # Démarrer le service SSH
    try {
        Start-Service sshd
        Set-Service -Name sshd -StartupType 'Automatic'
        Write-Success "Service SSH démarré et configuré pour démarrage automatique"
    } catch {
        Write-Error "Échec du démarrage du service SSH: $($_.Exception.Message)"
        exit 1
    }
    
    # Configurer le service ssh-agent (optionnel mais recommandé)
    try {
        Set-Service -Name ssh-agent -StartupType 'Automatic'
        Start-Service ssh-agent -ErrorAction SilentlyContinue
        Write-Success "Service ssh-agent configuré"
    } catch {
        Write-Warning "Impossible de configurer ssh-agent: $($_.Exception.Message)"
    }
    
    # Configuration de base sshd_config
    $sshdConfigPath = "$env:ProgramData\ssh\sshd_config"
    if (Test-Path $sshdConfigPath) {
        Write-Step "Configuration avancée de SSH..."
        
        # Backup de la configuration existante
        Copy-Item $sshdConfigPath "$sshdConfigPath.backup" -Force
        
        # Configuration de sécurité de base
        $configContent = @"
# EFC Backup SSH Configuration
Port $SSH_PORT
Protocol 2
PermitRootLogin no
PasswordAuthentication yes
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
PermitEmptyPasswords no
ChallengeResponseAuthentication no
UsePAM no
X11Forwarding no
PrintMotd no
AcceptEnv LANG LC_*
Subsystem sftp sftp-server.exe
AllowUsers $BACKUP_USER
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 2
"@
        
        try {
            $configContent | Out-File -FilePath $sshdConfigPath -Encoding UTF8 -Force
            Write-Success "Configuration SSH mise à jour"
            
            # Redémarrer le service pour appliquer la config
            Restart-Service sshd
            Write-Success "Service SSH redémarré"
        } catch {
            Write-Warning "Impossible de modifier la configuration SSH: $($_.Exception.Message)"
            # Restaurer le backup
            Copy-Item "$sshdConfigPath.backup" $sshdConfigPath -Force
        }
    }
}

# Création de l'utilisateur de backup
function New-BackupUser {
    Write-Step "Création de l'utilisateur de backup..."
    
    # Vérifier si l'utilisateur existe déjà
    try {
        $existingUser = Get-LocalUser -Name $BACKUP_USER -ErrorAction Stop
        Write-Warning "L'utilisateur $BACKUP_USER existe déjà"
        
        # Demander s'il faut réinitialiser le mot de passe
        $reset = Read-Host "Voulez-vous réinitialiser le mot de passe ? (O/N)"
        if ($reset -match "^[Oo]$") {
            $securePassword = ConvertTo-SecureString $BACKUP_PASSWORD -AsPlainText -Force
            Set-LocalUser -Name $BACKUP_USER -Password $securePassword
            Write-Success "Mot de passe réinitialisé pour $BACKUP_USER"
        }
    } catch {
        # L'utilisateur n'existe pas, le créer
        Write-Step "Création de l'utilisateur $BACKUP_USER..."
        try {
            $securePassword = ConvertTo-SecureString $BACKUP_PASSWORD -AsPlainText -Force
            New-LocalUser -Name $BACKUP_USER -Password $securePassword -FullName "EFC Backup User" -Description "Compte pour les sauvegardes automatiques EFC"
            Write-Success "Utilisateur $BACKUP_USER créé"
        } catch {
            Write-Error "Échec de la création de l'utilisateur: $($_.Exception.Message)"
            exit 1
        }
    }
    
    # Ajouter aux groupes nécessaires
    try {
        Add-LocalGroupMember -Group "Administrators" -Member $BACKUP_USER -ErrorAction SilentlyContinue
        Add-LocalGroupMember -Group "Backup Operators" -Member $BACKUP_USER -ErrorAction SilentlyContinue
        Add-LocalGroupMember -Group "Remote Desktop Users" -Member $BACKUP_USER -ErrorAction SilentlyContinue
        Write-Success "Utilisateur ajouté aux groupes nécessaires"
    } catch {
        Write-Warning "Impossible d'ajouter l'utilisateur à tous les groupes: $($_.Exception.Message)"
    }
    
    # Configuration du répertoire SSH
    $userProfile = "C:\Users\$BACKUP_USER"
    $sshDir = "$userProfile\.ssh"
    
    if (-not (Test-Path $userProfile)) {
        # Créer le profil utilisateur en se connectant une fois
        Write-Step "Initialisation du profil utilisateur..."
        try {
            # Utiliser runas pour initialiser le profil
            $processInfo = New-Object System.Diagnostics.ProcessStartInfo
            $processInfo.FileName = "cmd.exe"
            $processInfo.Arguments = "/c echo Profile initialized"
            $processInfo.UserName = $BACKUP_USER
            $processInfo.Password = ConvertTo-SecureString $BACKUP_PASSWORD -AsPlainText -Force
            $processInfo.UseShellExecute = $false
            $processInfo.LoadUserProfile = $true
            
            $process = [System.Diagnostics.Process]::Start($processInfo)
            $process.WaitForExit()
            
            Start-Sleep -Seconds 2
            Write-Success "Profil utilisateur initialisé"
        } catch {
            Write-Warning "Impossible d'initialiser automatiquement le profil utilisateur"
        }
    }
    
    # Créer le répertoire SSH
    if (-not (Test-Path $sshDir)) {
        try {
            New-Item -ItemType Directory -Path $sshDir -Force
            # Définir les permissions correctes
            $acl = Get-Acl $sshDir
            $acl.SetOwner([System.Security.Principal.NTAccount]"$env:COMPUTERNAME\$BACKUP_USER")
            $acl.SetAccessRuleProtection($true, $false)
            $accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule("$env:COMPUTERNAME\$BACKUP_USER", "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")
            $acl.SetAccessRule($accessRule)
            Set-Acl -Path $sshDir -AclObject $acl
            Write-Success "Répertoire SSH créé: $sshDir"
        } catch {
            Write-Warning "Impossible de créer le répertoire SSH: $($_.Exception.Message)"
        }
    }
}

# Configuration du pare-feu Windows
function Set-WindowsFirewall {
    Write-Step "Configuration du pare-feu Windows..."
    
    try {
        # Règle pour SSH
        New-NetFirewallRule -DisplayName "OpenSSH Server (sshd)" -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort $SSH_PORT -Profile Any -ErrorAction SilentlyContinue
        Write-Success "Règle pare-feu ajoutée pour SSH (port $SSH_PORT)"
    } catch {
        Write-Warning "Impossible de configurer le pare-feu pour SSH: $($_.Exception.Message)"
    }
    
    try {
        # Règle pour les connexions sortantes (optionnel)
        New-NetFirewallRule -DisplayName "OpenSSH Client (ssh)" -Enabled True -Direction Outbound -Protocol TCP -Action Allow -LocalPort 22 -Profile Any -ErrorAction SilentlyContinue
        Write-Success "Règle pare-feu ajoutée pour les connexions SSH sortantes"
    } catch {
        Write-Warning "Impossible de configurer le pare-feu pour SSH sortant"
    }
}

# Configuration des permissions VSS
function Set-VSSPermissions {
    Write-Step "Configuration des permissions VSS (Volume Shadow Copy)..."
    
    try {
        # Vérifier si VSS est disponible
        $vssService = Get-Service -Name VSS -ErrorAction SilentlyContinue
        if ($vssService) {
            if ($vssService.Status -ne "Running") {
                Start-Service VSS
            }
            Write-Success "Service Volume Shadow Copy opérationnel"
            
            # Donner les permissions VSS à l'utilisateur backup
            try {
                # Utiliser wmic pour donner les droits de backup
                & wmic.exe useraccount where "name='$BACKUP_USER'" set PasswordExpires=False
                Write-Success "Mot de passe configuré pour ne pas expirer"
            } catch {
                Write-Warning "Impossible de configurer l'expiration du mot de passe"
            }
            
        } else {
            Write-Warning "Service Volume Shadow Copy non disponible"
        }
    } catch {
        Write-Warning "Impossible de configurer VSS: $($_.Exception.Message)"
    }
}

# Configuration des exclusions antivirus (Windows Defender)
function Set-AntivirusExclusions {
    Write-Step "Configuration des exclusions antivirus..."
    
    try {
        # Exclure les processus SSH
        Add-MpPreference -ExclusionProcess "ssh.exe" -ErrorAction SilentlyContinue
        Add-MpPreference -ExclusionProcess "sshd.exe" -ErrorAction SilentlyContinue
        Add-MpPreference -ExclusionProcess "sftp.exe" -ErrorAction SilentlyContinue
        
        # Exclure les répertoires de backup temporaires
        Add-MpPreference -ExclusionPath "$env:TEMP\efc-backup" -ErrorAction SilentlyContinue
        Add-MpPreference -ExclusionPath "C:\Windows\Temp\efc-backup" -ErrorAction SilentlyContinue
        
        Write-Success "Exclusions antivirus ajoutées"
    } catch {
        Write-Warning "Impossible de configurer les exclusions antivirus: $($_.Exception.Message)"
        Write-Warning "Configurez manuellement les exclusions dans Windows Defender"
    }
}

# Test de la configuration
function Test-Configuration {
    Write-Step "Tests de configuration..."
    
    # Test du service SSH
    $sshService = Get-Service -Name sshd -ErrorAction SilentlyContinue
    if ($sshService -and $sshService.Status -eq "Running") {
        Write-Success "Service SSH opérationnel"
    } else {
        Write-Error "Service SSH non opérationnel"
        return $false
    }
    
    # Test de l'utilisateur
    try {
        $user = Get-LocalUser -Name $BACKUP_USER -ErrorAction Stop
        Write-Success "Utilisateur $BACKUP_USER configuré"
    } catch {
        Write-Error "Utilisateur $BACKUP_USER non trouvé"
        return $false
    }
    
    # Test de connectivité SSH local
    Write-Step "Test de connectivité SSH..."
    try {
        $testConnection = Test-NetConnection -ComputerName "localhost" -Port $SSH_PORT -WarningAction SilentlyContinue
        if ($testConnection.TcpTestSucceeded) {
            Write-Success "Port SSH $SSH_PORT accessible"
        } else {
            Write-Warning "Port SSH $SSH_PORT non accessible"
        }
    } catch {
        Write-Warning "Impossible de tester la connectivité SSH"
    }
    
    return $true
}

# Affichage des informations de connexion
function Show-ConnectionInfo {
    Write-Step "Configuration terminée !"
    
    Write-ColoredOutput "`n==================================================" "Green"
    Write-ColoredOutput "    CONFIGURATION CLIENT WINDOWS TERMINÉE" "Green"
    Write-ColoredOutput "==================================================" "Green"
    Write-ColoredOutput ""
    
    # Informations de connexion
    $localIP = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Ethernet*" | Select-Object -First 1).IPAddress
    if (-not $localIP) {
        $localIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -ne "127.0.0.1"} | Select-Object -First 1).IPAddress
    }
    
    Write-Host "🖥️  Nom de la machine: $env:COMPUTERNAME" -ForegroundColor Cyan
    Write-Host "🌐 Adresse IP: $localIP" -ForegroundColor Cyan
    Write-Host "🚪 Port SSH: $SSH_PORT" -ForegroundColor Cyan
    Write-Host "👤 Utilisateur backup: $BACKUP_USER" -ForegroundColor Yellow
    Write-Host "🔐 Mot de passe: $BACKUP_PASSWORD" -ForegroundColor Yellow
    
    Write-Host "`nInformations pour la configuration serveur EFC:" -ForegroundColor White
    Write-Host "┌────────────────────────────────────────────────┐" -ForegroundColor Gray
    Write-Host "│ Nom du client: $env:COMPUTERNAME" -ForegroundColor Gray
    Write-Host "│ Adresse IP: $localIP" -ForegroundColor Gray
    Write-Host "│ Port SSH: $SSH_PORT" -ForegroundColor Gray
    Write-Host "│ Utilisateur: $BACKUP_USER" -ForegroundColor Gray
    Write-Host "│ Mot de passe: $BACKUP_PASSWORD" -ForegroundColor Gray
    Write-Host "└────────────────────────────────────────────────┘" -ForegroundColor Gray
    
    Write-Host "`nTest de connexion SSH:" -ForegroundColor White
    Write-Host "ssh $BACKUP_USER@$localIP" -ForegroundColor Gray
    
    Write-ColoredOutput "`nDossiers recommandés pour le backup:" "White"
    Write-Host "  - C:\Users (profils utilisateurs)" -ForegroundColor Gray
    Write-Host "  - C:\ProgramData (données applications)" -ForegroundColor Gray
    Write-Host "  - D:\ (autres disques de données)" -ForegroundColor Gray
    
    Write-ColoredOutput "`nÉtapes suivantes:" "Yellow"
    Write-Host "  1. Notez les informations de connexion ci-dessus" -ForegroundColor Gray
    Write-Host "  2. Ajoutez ce client dans l'interface EFC Backup" -ForegroundColor Gray
    Write-Host "  3. Configurez les dossiers à sauvegarder" -ForegroundColor Gray
    Write-Host "  4. Testez un premier backup" -ForegroundColor Gray
    
    # Sauvegarder les informations dans un fichier
    $infoFile = "$env:USERPROFILE\Desktop\EFC-Backup-Client-Info.txt"
    $infoContent = @"
EFC Backup System - Informations de connexion client
===================================================
Date de configuration: $(Get-Date)
Nom de la machine: $env:COMPUTERNAME
Adresse IP: $localIP
Port SSH: $SSH_PORT
Utilisateur backup: $BACKUP_USER
Mot de passe: $BACKUP_PASSWORD

Configuration serveur EFC Backup:
- Nom du client: $env:COMPUTERNAME
- Adresse IP: $localIP
- Port SSH: $SSH_PORT
- Utilisateur: $BACKUP_USER
- Mot de passe: $BACKUP_PASSWORD

Dossiers recommandés pour le backup:
- C:\Users
- C:\ProgramData
- D:\ (si applicable)

Test de connexion SSH:
ssh $BACKUP_USER@$localIP
"@
    
    try {
        $infoContent | Out-File -FilePath $infoFile -Encoding UTF8
        Write-Host "`n📄 Informations sauvegardées dans: $infoFile" -ForegroundColor Green
    } catch {
        Write-Warning "Impossible de sauvegarder les informations sur le bureau"
    }
    
    Write-ColoredOutput "`nConfiguration réussie ! 🎉" "Green"
}

# Fonction de nettoyage en cas d'erreur
function Cleanup-OnError {
    param([string]$ErrorMessage)
    
    Write-Error "Erreur durant la configuration: $ErrorMessage"
    Write-Step "Nettoyage en cours..."
    
    # Arrêter le service SSH si démarré
    try {
        Stop-Service sshd -Force -ErrorAction SilentlyContinue
    } catch { }
    
    Write-Warning "La configuration peut être incomplète"
}

# Fonction principale
function Main {
    try {
        Write-Header
        
        # Demander confirmation
        Write-ColoredOutput "Cette configuration va préparer ce PC Windows pour les backups EFC." "Yellow"
        Write-ColoredOutput "Un utilisateur '$BACKUP_USER' sera créé avec des privilèges d'administrateur." "Yellow"
        $confirm = Read-Host "`nVoulez-vous continuer ? (O/N)"
        if ($confirm -notmatch "^[Oo]$") {
            Write-Host "Configuration annulée"
            exit 0
        }
        
        Test-Prerequisites
        Install-OpenSSHServer
        Set-SSHConfiguration
        New-BackupUser
        Set-WindowsFirewall
        Set-VSSPermissions
        Set-AntivirusExclusions
        
        if (Test-Configuration) {
            Show-ConnectionInfo
        } else {
            Write-Error "La configuration n'est pas complète"
            exit 1
        }
        
    } catch {
        Cleanup-OnError $_.Exception.Message
        exit 1
    }
}

# Point d'entrée
if ($MyInvocation.InvocationName -ne '.') {
    Main
}