const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const dotenv = require('dotenv');

// Charger les variables d'environnement en premier
dotenv.config();

const { initDatabase } = require('./utils/database');
const { logger } = require('./utils/logger');
const backupScheduler = require('./backup/scheduler');
const systemMonitor = require('./monitor/systemMonitor');
const apiRoutes = require('./api/routes');
const { notificationService } = require('./utils/notification');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Middleware de sécurité et performance - Adapté pour HTTP
app.use(helmet({
    contentSecurityPolicy: false,  // Désactivé pour simplifier en HTTP
    crossOriginOpenerPolicy: false,  // Désactivé pour éviter l'erreur COOP
    originAgentCluster: false  // Désactivé pour éviter l'erreur cluster
}));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Middleware de logging des requêtes
app.use((req, res, next) => {
    if (process.env.LOG_LEVEL === 'debug') {
        logger.debug(`${req.method} ${req.url}`, {
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });
    }
    next();
});

// Servir les fichiers statiques avec cache
app.use(express.static(path.join(__dirname, '../web'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0'
}));

// Routes API
app.use('/api', apiRoutes);

// Route principale avec fallback pour SPA
app.get('*', (req, res) => {
    // Si c'est une route API non trouvée, retourner 404
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Endpoint non trouvé' });
    }
    
    // Sinon, servir l'interface web
    res.sendFile(path.join(__dirname, '../web/index.html'));
});

// Initialisation complète du système
async function initialize() {
    try {
        logger.info('🚀 Démarrage EFC Backup System...');
        logger.info(`Version Node.js: ${process.version}`);
        logger.info(`Environnement: ${process.env.NODE_ENV || 'development'}`);

        // 1. Initialiser la base de données
        logger.info('📊 Initialisation de la base de données...');
        await initDatabase();
        logger.info('✅ Base de données initialisée');

        // 2. Démarrer le monitoring système
        logger.info('📈 Démarrage du monitoring système...');
        systemMonitor.start();
        logger.info('✅ Monitoring système démarré');

        // 3. Initialiser et démarrer le planificateur de backup
        logger.info('⏰ Initialisation du planificateur de backups...');
        await backupScheduler.init();
        backupScheduler.start();
        logger.info('✅ Planificateur de backups démarré');

        // 4. Test de la configuration des notifications
        logger.info('📧 Test de la configuration des notifications...');
        const notifTest = await notificationService.testConfiguration();
        if (notifTest.success) {
            logger.info('✅ Notifications configurées et opérationnelles');
        } else {
            logger.warn(`⚠️ Notifications: ${notifTest.error || notifTest.message}`);
        }

        // 5. Démarrer le serveur HTTP
        const server = app.listen(PORT, HOST, () => {
            logger.info('🌐 Serveur HTTP démarré');
            logger.info(`📱 Interface web: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
            logger.info('🎉 EFC Backup System opérationnel !');
            
            // Log du résumé de configuration
            logConfigurationSummary();
        });

        // Configuration du serveur
        server.timeout = 300000; // 5 minutes timeout pour les gros backups
        server.keepAliveTimeout = 65000;
        server.headersTimeout = 66000;

        // 6. Envoyer notification de démarrage si configuré
        if (process.env.SEND_STARTUP_NOTIFICATIONS === 'true') {
            setTimeout(async () => {
                try {
                    await notificationService.sendSystemAlert('info', 
                        'Système démarré', 
                        'EFC Backup System a été démarré avec succès',
                        {
                            version: '1.0.0',
                            port: PORT,
                            hostname: process.env.HOSTNAME || 'EFC-Backup-Server',
                            nodeVersion: process.version
                        }
                    );
                } catch (error) {
                    logger.warn('Impossible d\'envoyer la notification de démarrage:', error);
                }
            }, 5000); // Attendre 5 secondes pour s'assurer que tout est initialisé
        }

    } catch (error) {
        logger.error('❌ Erreur critique lors de l\'initialisation:', error);
        process.exit(1);
    }
}

function logConfigurationSummary() {
    logger.info('📋 Configuration système:');
    logger.info(`   • Port serveur: ${PORT}`);
    logger.info(`   • Chemin backups: ${process.env.BACKUP_PATH || '/var/backups/efc'}`);
    logger.info(`   • Rétention: ${process.env.RETENTION_DAYS || '30'} jours`);
    logger.info(`   • Backups parallèles: ${process.env.MAX_PARALLEL_BACKUPS || '2'}`);
    logger.info(`   • VSS activé: ${process.env.USE_VSS !== 'false'}`);
    logger.info(`   • Notifications: ${process.env.SMTP_ENABLED === 'true' ? 'Activées' : 'Désactivées'}`);
    logger.info(`   • Niveau de logs: ${process.env.LOG_LEVEL || 'info'}`);
}

// Gestion avancée des erreurs
process.on('unhandledRejection', (reason, promise) => {
    logger.error('🚨 Unhandled Rejection:', reason);
    logger.error('Promise:', promise);
    
    // En production, redémarrer gracieusement
    if (process.env.NODE_ENV === 'production') {
        setTimeout(() => {
            logger.error('Redémarrage du processus suite à une erreur non gérée');
            process.exit(1);
        }, 1000);
    }
});

process.on('uncaughtException', (error) => {
    logger.error('🚨 Uncaught Exception:', error);
    
    // Nettoyage d'urgence
    performEmergencyCleanup();
    process.exit(1);
});

// Arrêt propre du système
process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

async function handleShutdown(signal) {
    logger.info(`🛑 Signal ${signal} reçu, arrêt du système...`);
    
    try {
        // 1. Arrêter le planificateur de backups
        logger.info('⏰ Arrêt du planificateur...');
        backupScheduler.stop();
        
        // 2. Arrêter le monitoring
        logger.info('📈 Arrêt du monitoring...');
        systemMonitor.stop();
        
        // 3. Notification d'arrêt si configuré
        if (process.env.SEND_SHUTDOWN_NOTIFICATIONS === 'true') {
            await notificationService.sendSystemAlert('info',
                'Système arrêté',
                'EFC Backup System a été arrêté proprement',
                { timestamp: new Date().toISOString() }
            );
        }
        
        // 4. Fermer la base de données
        logger.info('📊 Fermeture de la base de données...');
        const { db } = require('./utils/database');
        await db.close();
        
        logger.info('✅ Arrêt terminé proprement');
        process.exit(0);
        
    } catch (error) {
        logger.error('❌ Erreur lors de l\'arrêt:', error);
        process.exit(1);
    }
}

function performEmergencyCleanup() {
    logger.info('🚨 Nettoyage d\'urgence...');
    
    try {
        // Arrêter les composants critiques
        backupScheduler.stop();
        systemMonitor.stop();
        
        // Sauvegarder les données critiques si possible
        backupScheduler.getScheduleStatus();
        
    } catch (error) {
        logger.error('Erreur lors du nettoyage d\'urgence:', error);
    }
}

// Gestion des warnings Node.js
process.on('warning', (warning) => {
    logger.warn(`Node.js Warning: ${warning.name} - ${warning.message}`);
    if (warning.stack) {
        logger.debug(`Stack trace: ${warning.stack}`);
    }
});

// Surveillance de la mémoire
if (process.env.NODE_ENV === 'production') {
    setInterval(() => {
        const memUsage = process.memoryUsage();
        const memUsageMB = Math.round(memUsage.rss / 1024 / 1024);
        
        if (memUsageMB > 1024) { // Plus de 1GB
            logger.warn(`Utilisation mémoire élevée: ${memUsageMB}MB`);
        }
        
        if (memUsageMB > 2048) { // Plus de 2GB
            logger.error(`Utilisation mémoire critique: ${memUsageMB}MB`);
            // Envoyer une alerte
            notificationService.sendSystemAlert('critical',
                'Utilisation mémoire critique',
                `Le serveur EFC Backup utilise ${memUsageMB}MB de mémoire`,
                { memoryUsage: memUsage }
            );
        }
    }, 60000); // Vérifier toutes les minutes
}

// Démarrer l'application
if (require.main === module) {
    initialize();
}

module.exports = app;