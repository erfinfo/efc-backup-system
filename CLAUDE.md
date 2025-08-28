# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projet : EFC Backup System

Système de backup automatique pour clients Windows et Linux avec interface web standalone, permettant des sauvegardes via SSH/SCP, création d'images disque et sauvegarde de dossiers importants.

## Commandes Essentielles

```bash
# Installation des dépendances
npm install

# Démarrer le serveur de production (avec monitoring)
npm start

# Mode développement avec auto-reload
npm run dev

# Servir uniquement l'interface web
npm run serve-web

# Exécuter les backups manuellement
npm run backup

# Health check système
npm run health-check

# Nettoyage des anciens backups et logs
npm run cleanup

# Tests
npm test

# Linting
npm run lint
```

## Architecture du Projet

### Structure des Dossiers
- `/src` - Code backend Node.js
  - `/backup` - Modules de backup Windows et Linux (SSH, SCP, VSS, rsync, tar)
  - `/api` - Routes API REST pour l'interface web
  - `/monitor` - Système de monitoring et logs
  - `/utils` - Utilitaires (database, logger, configuration)
- `/web` - Interface web standalone (HTML/CSS/JS vanilla)
- `/config` - Fichiers de configuration
- `/scripts` - Scripts de maintenance et automatisation
- `/logs` - Fichiers de logs
- `/backups` - Stockage des backups clients

### Technologies Principales
- **Backend**: Node.js avec Express
- **Base de données**: SQLite3 (embarquée)
- **Interface**: Web standalone sans framework (HTML/CSS/JS vanilla)
- **Backup Windows**: node-ssh pour connexion SSH/SCP
- **Planification**: node-cron pour l'automatisation
- **Temps réel**: Socket.io pour les mises à jour live

### Fonctionnalités Clés

1. **Backup Windows Natif**
   - Connexion SSH aux clients Windows
   - Support VSS (Volume Shadow Copy)
   - Création d'images système avec wbadmin
   - Backup du registre Windows
   - Copie SCP des dossiers importants
   - Backups complets, incrémentaux et différentiels

2. **Interface Web Standalone**
   - Dashboard avec statistiques en temps réel
   - Gestion des clients (CRUD)
   - Historique et monitoring des backups
   - Planification automatique avancée
   - Visualisation des logs avec filtres
   - Monitoring système intégré

3. **Automatisation Complète**
   - Planificateur avec node-cron et node-schedule
   - Backups planifiés (quotidien, hebdomadaire, mensuel)
   - Support des backups complets, incrémentaux et différentiels
   - Notifications email personnalisables
   - Rotation automatique des anciens backups
   - Nettoyage automatique des logs

4. **Monitoring et Alertes**
   - Surveillance système temps réel (CPU, RAM, disque)
   - Métriques détaillées avec historique
   - Alertes automatiques par email
   - Health checks réguliers
   - Logs structurés avec rotation automatique
   - Interface de monitoring intégrée

5. **API REST Complète**
   - Endpoints pour toutes les fonctionnalités
   - Tests de connexion clients
   - Gestion des paramètres
   - Statistiques et métriques
   - Interface programmatique

6. **Gestion des Utilisateurs et Sécurité**
   - Système d'authentification JWT sécurisé
   - Gestion complète des utilisateurs (CRUD)
   - Système de permissions granulaires
   - Contrôle d'accès basé sur les rôles (Admin/Client)
   - Interface de changement de mot de passe
   - Chiffrement bcrypt des mots de passe (12 rounds)
   - Restrictions d'accès aux données (clients voient uniquement leurs backups)
   - Association utilisateurs-clients pour contrôle d'accès
   - Validation avancée des mots de passe
   - Session management avec cookies sécurisés

### Points d'Entrée Importants

- `src/index.js` - Point d'entrée principal du serveur avec initialisation complète
- `src/backup/windowsBackup.js` - Classe principale pour les backups Windows
- `src/backup/linuxBackup.js` - Classe principale pour les backups Linux
- `src/backup/scheduler.js` - Gestionnaire de planification avancé avec cron
- `src/utils/logger.js` - Système de logs complet avec rotation
- `src/utils/database.js` - Base de données SQLite avec ORM simplifiée  
- `src/monitor/systemMonitor.js` - Monitoring système temps réel
- `src/api/routes.js` - API REST complète
- `src/api/users.js` - API gestion des utilisateurs et authentification
- `src/api/auth.js` - Routes d'authentification (login/logout)
- `src/middleware/auth.js` - Middleware d'authentification et permissions
- `src/utils/permissions.js` - Système de permissions et contrôle d'accès
- `src/utils/password-validator.js` - Validation et hachage des mots de passe
- `src/utils/ssl-manager-apache.js` - Gestionnaire SSL pour Apache2
- `src/utils/notification.js` - Service de notifications email
- `web/index.html` - Interface web principale avec branding EFC
- `web/app.js` - Logique frontend interactive

### Configuration

Le système utilise des variables d'environnement (fichier `.env`):

**Version & Serveur:**
- `VERSION` - Version actuelle du système EFC Backup (ex: 1.5.0)
- `PORT` - Port du serveur (défaut: 3000)
- `DB_PATH` - Chemin de la base SQLite
- `NODE_ENV` - Environnement (production/development)

**Chemins système:**
- `BACKUP_PATH` - Chemin de stockage des backups
- `LOG_PATH` - Chemin des logs système
- `TEMP_PATH` - Dossier temporaire

**Configuration backups:**
- `RETENTION_DAYS` - Durée de rétention des backups
- `MAX_PARALLEL_BACKUPS` - Nombre max de backups simultanés
- `USE_VSS` - Utiliser Volume Shadow Copy (true/false)
- `COMPRESSION_ENABLED` - Compression des backups

**Planification:**
- `DAILY_BACKUP_TIME` - Heure backup quotidien (ex: 02:00)
- `WEEKLY_BACKUP_DAY` - Jour backup hebdo (0=Dimanche)
- `MONTHLY_BACKUP_DAY` - Jour du mois backup mensuel

**Authentification & Sécurité:**
- `JWT_SECRET` - Clé secrète pour tokens JWT
- `SESSION_SECRET` - Clé secrète pour sessions Express
- `PASSWORD_SALT_ROUNDS` - Nombre de rounds bcrypt (défaut: 12)
- `DEFAULT_ADMIN_PASSWORD` - Mot de passe admin initial

**Notifications & Monitoring:**
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` - Configuration email
- `NOTIFICATION_EMAIL` - Email de destination
- `SEND_SUCCESS_NOTIFICATIONS` - Notifier les succès
- `ALERT_DISK_USAGE_PERCENT` - Seuil alerte disque (80%)
- `HEALTH_CHECK_INTERVAL` - Intervalle health check (ms)

**Logs:**
- `LOG_LEVEL` - Niveau de logs (debug, info, warn, error)
- `LOG_MAX_SIZE` - Taille max par fichier de log
- `LOG_MAX_FILES` - Nombre max de fichiers de log

### Support Multi-OS (Windows/Linux)

Le système EFC Backup prend en charge les clients Windows et Linux avec des modules spécialisés :

**Support Windows:**
- Module `windowsBackup.js` avec SSH/SCP
- Support Volume Shadow Copy (VSS) pour fichiers ouverts  
- Backup des profils utilisateurs (C:\Users)
- Sauvegarde registre Windows et configurations système
- Création d'images disque avec wbadmin
- Dossiers par défaut : `C:\Users, C:\ProgramData`

**Support Linux:**
- Module `linuxBackup.js` avec SSH/rsync/tar
- Backup des dossiers système critiques (/home, /etc, /var/www, /opt)
- Sauvegarde configurations système (/etc/passwd, /etc/fstab, etc.)
- Liste des packages installés (dpkg/rpm)
- Compression tar.gz automatique
- Dossiers par défaut : `/home, /etc, /var/www, /opt`

**Configuration automatique:**
- Sélection du type d'OS lors de l'ajout de client
- Dossiers par défaut adaptés selon l'OS sélectionné
- Interface web avec icônes distinctives (🪟 Windows / 🐧 Linux)
- Logs séparés par client avec support des deux OS
- Tests de connectivité adaptés au type de système

### Notes de Développement

- L'interface web est standalone avec branding EFC en mode sombre
- **INTERFACE PROFESSIONNELLE** : Éviter les icônes emoji dans l'interface (🎯, 📧, etc.) - préférer du texte simple ou icônes SVG pour un rendu professionnel
- Architecture modulaire avec séparation des responsabilités
- Base de données SQLite intégrée avec migrations automatiques
- Système de logs avancé avec rotation automatique et niveaux par client
- Monitoring système intégré avec métriques et alertes
- Planificateur robuste avec support des patterns cron
- API REST complète pour intégration avec d'autres systèmes
- Tests de connectivité intégrés pour validation des clients Windows/Linux
- Gestion d'erreurs complète avec notifications automatiques
- Support multi-clients avec configuration individuelle avancée
- Scripts d'installation automatique pour Linux et Windows
- Système de notifications email HTML personnalisées EFC
- Health checks automatiques et surveillance continue
- Nettoyage automatique des données anciennes (backups/logs/métriques)