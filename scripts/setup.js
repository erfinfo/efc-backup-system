#!/usr/bin/env node

/**
 * Script de configuration initiale pour EFC Backup System
 * - Création des dossiers nécessaires
 * - Initialisation de la base de données
 * - Création de l'utilisateur admin par défaut
 * - Vérification de la configuration
 * - Tests de connectivité
 */

const path = require('path');
const fs = require('fs').promises;
const readline = require('readline');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { initDatabase, createUser, db } = require('../src/utils/database');
const { logger } = require('../src/utils/logger');

// Configuration
const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_EMAIL = 'admin@efc-backup.local';

class SetupManager {
    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    async prompt(question) {
        return new Promise((resolve) => {
            this.rl.question(question, (answer) => {
                resolve(answer);
            });
        });
    }

    async promptPassword(question) {
        return new Promise((resolve) => {
            const stdin = process.stdin;
            const stdout = process.stdout;
            
            stdin.on('data', (char) => {
                char = char.toString('utf8');
                switch (char) {
                    case '\n':
                    case '\r':
                    case '\u0004':
                        stdin.pause();
                        break;
                    default:
                        stdout.clearLine();
                        stdout.cursorTo(0);
                        stdout.write(question + Array(stdin.line.length + 1).join('*'));
                        break;
                }
            });
            
            this.rl.question(question, (answer) => {
                resolve(answer);
            });
        });
    }

    /**
     * Créer les dossiers nécessaires
     */
    async createDirectories() {
        console.log('\n📁 Création des dossiers nécessaires...');
        
        const directories = [
            process.env.BACKUP_PATH || '/backup',
            process.env.LOG_PATH || './logs',
            './data',
            './temp',
            './config'
        ];
        
        for (const dir of directories) {
            try {
                await fs.mkdir(dir, { recursive: true });
                console.log(`✅ Dossier créé/vérifié: ${dir}`);
            } catch (error) {
                console.error(`❌ Erreur lors de la création de ${dir}:`, error.message);
            }
        }
    }

    /**
     * Initialiser la base de données
     */
    async initializeDatabase() {
        console.log('\n🗄️  Initialisation de la base de données...');
        
        try {
            await initDatabase();
            console.log('✅ Base de données initialisée avec succès');
            
            // Vérifier les tables
            const tables = await db.all(
                "SELECT name FROM sqlite_master WHERE type='table'"
            );
            console.log(`✅ ${tables.length} tables créées`);
            
        } catch (error) {
            console.error('❌ Erreur lors de l\'initialisation de la base:', error);
            throw error;
        }
    }

    /**
     * Créer l'utilisateur admin par défaut
     */
    async createAdminUser() {
        console.log('\n👤 Configuration de l\'utilisateur administrateur...');
        
        try {
            // Vérifier si un admin existe déjà
            const existingAdmin = await db.get(
                'SELECT * FROM users WHERE role = ? LIMIT 1',
                ['admin']
            );
            
            if (existingAdmin) {
                console.log('ℹ️  Un utilisateur admin existe déjà');
                const reset = await this.prompt('Voulez-vous réinitialiser le mot de passe admin? (o/n): ');
                
                if (reset.toLowerCase() !== 'o') {
                    return;
                }
            }
            
            // Demander les informations
            const username = await this.prompt(`Nom d'utilisateur admin [${DEFAULT_ADMIN_USERNAME}]: `) || DEFAULT_ADMIN_USERNAME;
            const email = await this.prompt(`Email admin [${DEFAULT_ADMIN_EMAIL}]: `) || DEFAULT_ADMIN_EMAIL;
            
            let password;
            let confirmPassword;
            
            do {
                password = await this.prompt('Mot de passe admin (min 8 caractères): ');
                
                if (password.length < 8) {
                    console.log('❌ Le mot de passe doit contenir au moins 8 caractères');
                    continue;
                }
                
                confirmPassword = await this.prompt('Confirmer le mot de passe: ');
                
                if (password !== confirmPassword) {
                    console.log('❌ Les mots de passe ne correspondent pas');
                }
            } while (password.length < 8 || password !== confirmPassword);
            
            // Hasher le mot de passe
            const hashedPassword = await bcrypt.hash(password, 12);
            
            if (existingAdmin) {
                // Mettre à jour l'admin existant
                await db.run(
                    'UPDATE users SET username = ?, email = ?, password = ? WHERE id = ?',
                    [username, email, hashedPassword, existingAdmin.id]
                );
                console.log('✅ Mot de passe admin réinitialisé');
            } else {
                // Créer le nouvel admin
                await createUser({
                    username,
                    email,
                    password: hashedPassword,
                    role: 'admin',
                    active: true,
                    permissions: JSON.stringify({
                        all: true
                    })
                });
                console.log('✅ Utilisateur admin créé avec succès');
            }
            
            console.log('\n📋 Informations de connexion:');
            console.log(`   Utilisateur: ${username}`);
            console.log(`   Email: ${email}`);
            console.log('   Mot de passe: [celui que vous avez défini]');
            
        } catch (error) {
            console.error('❌ Erreur lors de la création de l\'admin:', error);
            throw error;
        }
    }

    /**
     * Vérifier et créer le fichier .env
     */
    async checkEnvironment() {
        console.log('\n⚙️  Vérification de la configuration...');
        
        const envPath = path.join(process.cwd(), '.env');
        
        try {
            await fs.access(envPath);
            console.log('✅ Fichier .env trouvé');
        } catch {
            console.log('⚠️  Fichier .env non trouvé, création...');
            
            // Générer des secrets
            const jwtSecret = crypto.randomBytes(32).toString('hex');
            const sessionSecret = crypto.randomBytes(32).toString('hex');
            
            const envContent = `# Configuration EFC Backup System
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Base de données
DB_PATH=./data/efc-backup.db

# Chemins
BACKUP_PATH=/backup
LOG_PATH=./logs

# Sécurité
JWT_SECRET=${jwtSecret}
SESSION_SECRET=${sessionSecret}
PASSWORD_SALT_ROUNDS=12

# Backup
MAX_PARALLEL_BACKUPS=2
RETENTION_DAYS=30
USE_VSS=true

# Logs
LOG_LEVEL=info
LOG_MAX_FILES=10
LOG_MAX_SIZE=100MB

# Monitoring
HEALTH_CHECK_INTERVAL=30000
METRICS_RETENTION_DAYS=30

# Alertes
ALERT_CPU_USAGE_PERCENT=80
ALERT_MEMORY_USAGE_PERCENT=85
ALERT_DISK_USAGE_PERCENT=80

# Notifications (à configurer)
SMTP_ENABLED=false
NOTIFICATION_EMAIL=
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
`;
            
            await fs.writeFile(envPath, envContent);
            console.log('✅ Fichier .env créé avec des valeurs par défaut');
            console.log('⚠️  IMPORTANT: Configurez les paramètres SMTP pour les notifications');
        }
    }

    /**
     * Vérifier les dépendances système
     */
    async checkSystemDependencies() {
        console.log('\n🔍 Vérification des dépendances système...');
        
        const dependencies = {
            'node': 'node --version',
            'npm': 'npm --version',
            'git': 'git --version'
        };
        
        for (const [name, command] of Object.entries(dependencies)) {
            try {
                const { exec } = require('child_process');
                await new Promise((resolve, reject) => {
                    exec(command, (error, stdout) => {
                        if (error) reject(error);
                        else resolve(stdout);
                    });
                });
                console.log(`✅ ${name} installé`);
            } catch {
                console.log(`⚠️  ${name} non trouvé ou non accessible`);
            }
        }
    }

    /**
     * Tests de connectivité réseau
     */
    async testNetworkConnectivity() {
        console.log('\n🌐 Test de connectivité réseau...');
        
        const { exec } = require('child_process');
        
        // Test de résolution DNS
        try {
            await new Promise((resolve, reject) => {
                exec('nslookup google.com', (error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });
            console.log('✅ Résolution DNS fonctionnelle');
        } catch {
            console.log('⚠️  Problème de résolution DNS détecté');
        }
        
        // Test de connectivité Internet
        try {
            await new Promise((resolve, reject) => {
                exec('ping -c 1 8.8.8.8', (error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });
            console.log('✅ Connectivité Internet OK');
        } catch {
            console.log('⚠️  Pas de connectivité Internet détectée');
        }
    }

    /**
     * Afficher le résumé de l'installation
     */
    displaySummary() {
        console.log('\n' + '='.repeat(50));
        console.log('🎉 Configuration EFC Backup System terminée!');
        console.log('='.repeat(50));
        console.log('\n📝 Prochaines étapes:');
        console.log('1. Configurez les paramètres SMTP dans .env pour les notifications');
        console.log('2. Ajoutez des clients via l\'interface web');
        console.log('3. Configurez les planifications de backup');
        console.log('\n🚀 Pour démarrer le serveur:');
        console.log('   npm start');
        console.log('\n🌐 L\'interface sera accessible sur:');
        console.log('   http://localhost:3000');
        console.log('\n📚 Documentation:');
        console.log('   https://github.com/erfinfo/efc-backup-system');
    }

    /**
     * Exécuter la configuration complète
     */
    async run() {
        try {
            console.log('');
            console.log('╔══════════════════════════════════════════════╗');
            console.log('║     EFC Backup System - Setup Wizard        ║');
            console.log('╚══════════════════════════════════════════════╝');
            
            // Étapes de configuration
            await this.createDirectories();
            await this.checkEnvironment();
            await this.initializeDatabase();
            await this.createAdminUser();
            await this.checkSystemDependencies();
            await this.testNetworkConnectivity();
            
            // Afficher le résumé
            this.displaySummary();
            
            this.rl.close();
            process.exit(0);
            
        } catch (error) {
            console.error('\n❌ Erreur fatale lors de la configuration:', error);
            this.rl.close();
            process.exit(1);
        }
    }
}

// Exécution si appelé directement
if (require.main === module) {
    const setup = new SetupManager();
    setup.run();
}

module.exports = SetupManager;