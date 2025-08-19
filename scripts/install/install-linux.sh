#!/bin/bash
# EFC Backup System - Script d'installation automatique Linux
# Version: 1.0.0
# Auteur: EFC Informatique
# Usage: ./install-linux.sh

set -e  # Arrêter en cas d'erreur

# Couleurs pour l'affichage
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Variables de configuration
EFC_USER="efc-backup"
EFC_HOME="/opt/efc-backup"
BACKUP_DIR="/var/backups/efc"
LOG_DIR="/var/log/efc-backup"
CONFIG_DIR="/etc/efc-backup"
SERVICE_NAME="efc-backup"

# Fonction d'affichage
print_header() {
    echo -e "${PURPLE}"
    echo "=================================================="
    echo "    EFC BACKUP SYSTEM - INSTALLATION LINUX"
    echo "          EFC Informatique - efcinfo.com"
    echo "=================================================="
    echo -e "${NC}"
}

print_step() {
    echo -e "${BLUE}[ÉTAPE]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[ATTENTION]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERREUR]${NC} $1"
}

# Vérification des prérequis
check_prerequisites() {
    print_step "Vérification des prérequis système..."
    
    # Vérifier si on est root
    if [[ $EUID -ne 0 ]]; then
        print_error "Ce script doit être exécuté en tant que root (sudo)"
        exit 1
    fi
    
    # Vérifier la distribution
    if [[ -f /etc/os-release ]]; then
        . /etc/os-release
        OS=$NAME
        VER=$VERSION_ID
        echo "OS détecté: $OS $VER"
    else
        print_error "Distribution Linux non supportée"
        exit 1
    fi
    
    # Vérifier l'espace disque
    AVAILABLE=$(df / | tail -1 | awk '{print $4}')
    REQUIRED=2097152  # 2GB en KB
    if [[ $AVAILABLE -lt $REQUIRED ]]; then
        print_warning "Espace disque insuffisant. Minimum 2GB requis."
    fi
    
    print_success "Prérequis vérifiés"
}

# Installation des dépendances système
install_system_dependencies() {
    print_step "Installation des dépendances système..."
    
    # Mise à jour du système
    echo "Mise à jour des paquets..."
    if command -v apt-get &> /dev/null; then
        apt-get update -qq
        apt-get upgrade -y -qq
        apt-get install -y curl wget git unzip htop fail2ban ufw sqlite3 logrotate cron
    elif command -v dnf &> /dev/null; then
        dnf update -y -q
        dnf install -y curl wget git unzip htop fail2ban firewalld sqlite logrotate cronie
        systemctl enable firewalld
    elif command -v yum &> /dev/null; then
        yum update -y -q
        yum install -y curl wget git unzip htop fail2ban firewalld sqlite logrotate cronie
        systemctl enable firewalld
    else
        print_error "Gestionnaire de paquets non supporté"
        exit 1
    fi
    
    print_success "Dépendances système installées"
}

# Installation de Node.js
install_nodejs() {
    print_step "Installation de Node.js..."
    
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        print_warning "Node.js déjà installé: $NODE_VERSION"
        
        # Vérifier la version minimale
        MIN_VERSION="v16.0.0"
        if [[ "$(printf '%s\n' "$MIN_VERSION" "$NODE_VERSION" | sort -V | head -n1)" = "$MIN_VERSION" ]]; then
            print_success "Version de Node.js compatible"
            return
        else
            print_warning "Version de Node.js trop ancienne, mise à jour..."
        fi
    fi
    
    # Installation via NodeSource
    echo "Téléchargement et installation de Node.js 18..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - > /dev/null 2>&1
    
    if command -v apt-get &> /dev/null; then
        apt-get install -y nodejs
    elif command -v dnf &> /dev/null; then
        dnf install -y nodejs npm
    elif command -v yum &> /dev/null; then
        yum install -y nodejs npm
    fi
    
    # Vérifier l'installation
    if command -v node &> /dev/null && command -v npm &> /dev/null; then
        NODE_VERSION=$(node --version)
        NPM_VERSION=$(npm --version)
        print_success "Node.js $NODE_VERSION et npm $NPM_VERSION installés"
    else
        print_error "Échec de l'installation de Node.js"
        exit 1
    fi
}

# Installation de PM2
install_pm2() {
    print_step "Installation de PM2..."
    
    if command -v pm2 &> /dev/null; then
        print_warning "PM2 déjà installé"
        return
    fi
    
    npm install -g pm2 --silent
    
    if command -v pm2 &> /dev/null; then
        print_success "PM2 installé avec succès"
    else
        print_error "Échec de l'installation de PM2"
        exit 1
    fi
}

# Création de l'utilisateur système
create_system_user() {
    print_step "Création de l'utilisateur système..."
    
    if id "$EFC_USER" &>/dev/null; then
        print_warning "L'utilisateur $EFC_USER existe déjà"
    else
        useradd -r -m -s /bin/bash -d /home/$EFC_USER $EFC_USER
        usermod -aG backup $EFC_USER
        print_success "Utilisateur $EFC_USER créé"
    fi
}

# Création de la structure de dossiers
create_directory_structure() {
    print_step "Création de la structure de dossiers..."
    
    # Créer les dossiers principaux
    mkdir -p "$EFC_HOME"
    mkdir -p "$BACKUP_DIR"
    mkdir -p "$LOG_DIR"
    mkdir -p "$CONFIG_DIR"
    mkdir -p "/var/lib/efc-backup"
    
    # Définir les permissions
    chown -R $EFC_USER:$EFC_USER "$EFC_HOME"
    chown -R $EFC_USER:$EFC_USER "$BACKUP_DIR"
    chown -R $EFC_USER:$EFC_USER "$LOG_DIR"
    chown -R $EFC_USER:$EFC_USER "/var/lib/efc-backup"
    chown -R $EFC_USER:$EFC_USER "$CONFIG_DIR"
    
    # Permissions de sécurité
    chmod 755 "$EFC_HOME"
    chmod 750 "$BACKUP_DIR"
    chmod 750 "$LOG_DIR"
    chmod 700 "$CONFIG_DIR"
    chmod 750 "/var/lib/efc-backup"
    
    print_success "Structure de dossiers créée"
}

# Installation du système EFC Backup
install_efc_backup() {
    print_step "Installation du système EFC Backup..."
    
    # Détecter si nous sommes dans le dossier du projet
    if [[ -f "../package.json" && -d "../src" ]]; then
        print_step "Installation depuis le dossier local..."
        cp -r ../* "$EFC_HOME/"
    elif [[ -f "package.json" && -d "src" ]]; then
        print_step "Installation depuis le dossier courant..."
        cp -r ./* "$EFC_HOME/"
    else
        print_error "Fichiers du projet EFC Backup non trouvés"
        print_error "Placez ce script dans le dossier du projet ou un dossier au-dessus"
        exit 1
    fi
    
    # Ajuster les permissions
    chown -R $EFC_USER:$EFC_USER "$EFC_HOME"
    
    # Installation des dépendances Node.js
    print_step "Installation des dépendances Node.js..."
    cd "$EFC_HOME"
    sudo -u $EFC_USER npm install --production --silent
    
    print_success "Système EFC Backup installé"
}

# Configuration de l'environnement
configure_environment() {
    print_step "Configuration de l'environnement..."
    
    # Créer le fichier .env si il n'existe pas
    if [[ ! -f "$EFC_HOME/.env" ]]; then
        if [[ -f "$EFC_HOME/.env.example" ]]; then
            cp "$EFC_HOME/.env.example" "$EFC_HOME/.env"
        else
            # Créer un .env minimal
            cat > "$EFC_HOME/.env" << EOF
# Configuration EFC Backup System
PORT=3000
NODE_ENV=production
HOST=0.0.0.0

# Chemins Linux
BACKUP_PATH=$BACKUP_DIR
LOG_PATH=$LOG_DIR
TEMP_PATH=/tmp/efc-backup

# Configuration des Backups
RETENTION_DAYS=30
MAX_PARALLEL_BACKUPS=2
COMPRESSION_ENABLED=true
USE_VSS=true

# Base de Données
DB_TYPE=sqlite
DB_PATH=/var/lib/efc-backup/database.db

# Sécurité
JWT_SECRET=$(openssl rand -base64 32)
ADMIN_PASSWORD=EFC$(openssl rand -base64 12 | tr -d "=+/" | cut -c1-8)123!
SESSION_TIMEOUT=3600000

# Logs
LOG_LEVEL=info
LOG_MAX_SIZE=52428800
LOG_MAX_FILES=30
EOF
        fi
        
        chown $EFC_USER:$EFC_USER "$EFC_HOME/.env"
        chmod 600 "$EFC_HOME/.env"
    fi
    
    print_success "Environnement configuré"
}

# Configuration PM2
configure_pm2() {
    print_step "Configuration de PM2..."
    
    # Créer le fichier ecosystem pour PM2
    cat > "$EFC_HOME/ecosystem.config.js" << 'EOF'
module.exports = {
  apps: [{
    name: 'efc-backup',
    script: './src/index.js',
    cwd: '/opt/efc-backup',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    env: {
      NODE_ENV: 'production'
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
    
    chown $EFC_USER:$EFC_USER "$EFC_HOME/ecosystem.config.js"
    
    print_success "PM2 configuré"
}

# Configuration du service système
configure_systemd_service() {
    print_step "Configuration du service système..."
    
    cat > "/etc/systemd/system/$SERVICE_NAME.service" << EOF
[Unit]
Description=EFC Backup System
After=network.target
Wants=network.target

[Service]
Type=forking
User=$EFC_USER
Group=$EFC_USER
WorkingDirectory=$EFC_HOME
ExecStart=/usr/bin/pm2 start ecosystem.config.js --no-daemon
ExecReload=/usr/bin/pm2 reload ecosystem.config.js
ExecStop=/usr/bin/pm2 delete ecosystem.config.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=efc-backup
Environment=HOME=/home/$EFC_USER
Environment=PATH=/usr/bin:/usr/local/bin

[Install]
WantedBy=multi-user.target
EOF
    
    systemctl daemon-reload
    systemctl enable $SERVICE_NAME
    
    print_success "Service système configuré"
}

# Configuration du pare-feu
configure_firewall() {
    print_step "Configuration du pare-feu..."
    
    if command -v ufw &> /dev/null; then
        # Ubuntu/Debian avec UFW
        ufw --force enable
        ufw allow 22/tcp comment "SSH"
        ufw allow 3000/tcp comment "EFC Backup"
        print_success "Pare-feu UFW configuré"
    elif command -v firewall-cmd &> /dev/null; then
        # CentOS/RHEL avec firewalld
        systemctl start firewalld
        firewall-cmd --permanent --add-port=22/tcp
        firewall-cmd --permanent --add-port=3000/tcp
        firewall-cmd --reload
        print_success "Pare-feu firewalld configuré"
    else
        print_warning "Aucun pare-feu supporté détecté"
    fi
}

# Configuration de Fail2Ban
configure_fail2ban() {
    print_step "Configuration de Fail2Ban..."
    
    # Configuration de base
    cat > "/etc/fail2ban/jail.local" << EOF
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

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
logpath = $LOG_DIR/app.log
maxretry = 5
bantime = 1800
EOF
    
    # Créer le filtre pour EFC Backup
    cat > "/etc/fail2ban/filter.d/efc-backup.conf" << 'EOF'
[Definition]
failregex = .*Failed login attempt from <HOST>.*
            .*Authentication failed.*<HOST>.*
            .*Invalid credentials.*<HOST>.*
ignoreregex =
EOF
    
    systemctl enable fail2ban
    systemctl restart fail2ban
    
    print_success "Fail2Ban configuré"
}

# Configuration de logrotate
configure_logrotate() {
    print_step "Configuration de la rotation des logs..."
    
    cat > "/etc/logrotate.d/efc-backup" << EOF
$LOG_DIR/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 644 $EFC_USER $EFC_USER
    postrotate
        sudo -u $EFC_USER pm2 reloadLogs > /dev/null 2>&1 || true
    endscript
}
EOF
    
    print_success "Rotation des logs configurée"
}

# Démarrage des services
start_services() {
    print_step "Démarrage des services..."
    
    # Démarrer PM2 en tant qu'utilisateur efc-backup
    sudo -u $EFC_USER bash -c "cd $EFC_HOME && pm2 start ecosystem.config.js"
    sudo -u $EFC_USER pm2 save
    
    # Démarrer le service système
    systemctl start $SERVICE_NAME
    
    # Vérifier le statut
    sleep 5
    if systemctl is-active --quiet $SERVICE_NAME; then
        print_success "Service EFC Backup démarré"
    else
        print_error "Échec du démarrage du service"
        systemctl status $SERVICE_NAME
        exit 1
    fi
}

# Tests de fonctionnement
run_tests() {
    print_step "Tests de fonctionnement..."
    
    # Test de réponse HTTP
    sleep 10
    if curl -s http://localhost:3000 > /dev/null; then
        print_success "Interface web accessible"
    else
        print_warning "Interface web non accessible immédiatement"
        print_warning "Vérifiez les logs: journalctl -u $SERVICE_NAME -f"
    fi
    
    # Test des dossiers
    if [[ -d "$BACKUP_DIR" && -d "$LOG_DIR" ]]; then
        print_success "Structure de dossiers correcte"
    fi
    
    # Test des permissions
    if [[ -O "$EFC_HOME" ]] && sudo -u $EFC_USER test -w "$BACKUP_DIR"; then
        print_success "Permissions correctes"
    fi
}

# Affichage des informations finales
show_final_info() {
    print_step "Installation terminée !"
    
    echo -e "${GREEN}"
    echo "=================================================="
    echo "    INSTALLATION EFC BACKUP TERMINÉE"
    echo "=================================================="
    echo -e "${NC}"
    
    echo "🌐 Interface web: http://$(hostname -I | awk '{print $1}'):3000"
    echo "👤 Utilisateur système: $EFC_USER"
    echo "📁 Dossier d'installation: $EFC_HOME"
    echo "💾 Dossier de backup: $BACKUP_DIR"
    echo "📋 Logs: $LOG_DIR"
    
    # Afficher le mot de passe admin
    if [[ -f "$EFC_HOME/.env" ]]; then
        ADMIN_PASS=$(grep "ADMIN_PASSWORD=" "$EFC_HOME/.env" | cut -d'=' -f2)
        echo "🔐 Mot de passe admin: $ADMIN_PASS"
    fi
    
    echo ""
    echo "Commandes utiles:"
    echo "  - Statut: systemctl status $SERVICE_NAME"
    echo "  - Logs: journalctl -u $SERVICE_NAME -f"
    echo "  - PM2: sudo -u $EFC_USER pm2 status"
    echo "  - Redémarrer: systemctl restart $SERVICE_NAME"
    echo ""
    echo "Configuration:"
    echo "  - Fichier .env: $EFC_HOME/.env"
    echo "  - PM2 config: $EFC_HOME/ecosystem.config.js"
    echo ""
    echo -e "${YELLOW}N'oubliez pas de:${NC}"
    echo "  1. Configurer vos clients Windows"
    echo "  2. Ajouter vos clients dans l'interface"
    echo "  3. Tester un premier backup"
    echo ""
    echo -e "${GREEN}Installation réussie ! 🎉${NC}"
}

# Fonction de nettoyage en cas d'erreur
cleanup_on_error() {
    print_error "Erreur durant l'installation"
    print_step "Nettoyage en cours..."
    
    systemctl stop $SERVICE_NAME 2>/dev/null || true
    systemctl disable $SERVICE_NAME 2>/dev/null || true
    sudo -u $EFC_USER pm2 delete efc-backup 2>/dev/null || true
    
    echo "Logs disponibles dans: $LOG_DIR"
    exit 1
}

# Fonction principale
main() {
    # Trap pour le nettoyage en cas d'erreur
    trap cleanup_on_error ERR
    
    print_header
    
    # Demander confirmation
    echo -e "${YELLOW}Cette installation va configurer EFC Backup System sur ce serveur.${NC}"
    echo "Voulez-vous continuer ? (y/N)"
    read -r CONFIRM
    if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
        echo "Installation annulée"
        exit 0
    fi
    
    check_prerequisites
    install_system_dependencies
    install_nodejs
    install_pm2
    create_system_user
    create_directory_structure
    install_efc_backup
    configure_environment
    configure_pm2
    configure_systemd_service
    configure_firewall
    configure_fail2ban
    configure_logrotate
    start_services
    run_tests
    show_final_info
    
    # Désactiver le trap
    trap - ERR
}

# Exécution du script
main "$@"