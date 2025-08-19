const cron = require('node-cron');
const schedule = require('node-schedule');
const { logger } = require('../utils/logger');
const { getClients, updateBackupStatus } = require('../utils/database');
const WindowsBackupClient = require('./windowsBackup');
const LinuxBackupClient = require('./linuxBackup');
const { sendNotification } = require('../utils/notification');
const path = require('path');
const fs = require('fs').promises;

class BackupScheduler {
    constructor() {
        this.runningBackups = new Map();
        this.scheduledJobs = new Map();
        this.isInitialized = false;
    }

    async init() {
        if (this.isInitialized) return;
        
        try {
            logger.info('Initialisation du planificateur de backups...');
            
            // Charger les planifications par défaut
            await this.loadDefaultSchedules();
            
            // Charger les planifications personnalisées depuis la DB
            await this.loadCustomSchedules();
            
            this.isInitialized = true;
            logger.info('Planificateur de backups initialisé avec succès');
        } catch (error) {
            logger.error('Erreur lors de l\'initialisation du planificateur:', error);
            throw error;
        }
    }

    async loadDefaultSchedules() {
        const schedules = [
            {
                name: 'backup-daily',
                cron: process.env.DAILY_BACKUP_TIME ? 
                    this.timeToCron(process.env.DAILY_BACKUP_TIME) : '0 2 * * *',
                type: 'incremental',
                description: 'Backup quotidien incrémentiel'
            },
            {
                name: 'backup-weekly',
                cron: process.env.WEEKLY_BACKUP_DAY && process.env.WEEKLY_BACKUP_TIME ?
                    this.timeToCron(process.env.WEEKLY_BACKUP_TIME, process.env.WEEKLY_BACKUP_DAY) : '0 3 * * 0',
                type: 'full',
                description: 'Backup hebdomadaire complet'
            },
            {
                name: 'backup-monthly',
                cron: process.env.MONTHLY_BACKUP_DAY && process.env.MONTHLY_BACKUP_TIME ?
                    this.timeToCron(process.env.MONTHLY_BACKUP_TIME, null, process.env.MONTHLY_BACKUP_DAY) : '0 4 1 * *',
                type: 'full',
                description: 'Backup mensuel complet avec archivage'
            }
        ];

        for (const sched of schedules) {
            this.scheduleBackup(sched);
        }

        logger.info(`${schedules.length} planifications par défaut chargées`);
    }

    async loadCustomSchedules() {
        // Charger les planifications personnalisées depuis la base de données
        try {
            // TODO: Implémenter la récupération depuis la DB
            // const customSchedules = await getCustomSchedules();
            // for (const schedule of customSchedules) {
            //     this.scheduleBackup(schedule);
            // }
            logger.info('Planifications personnalisées chargées');
        } catch (error) {
            logger.warn('Aucune planification personnalisée trouvée');
        }
    }

    timeToCron(time, dayOfWeek = null, dayOfMonth = null) {
        const [hour, minute] = time.split(':').map(Number);
        
        if (dayOfMonth) {
            // Mensuel
            return `${minute} ${hour} ${dayOfMonth} * *`;
        } else if (dayOfWeek !== null) {
            // Hebdomadaire
            return `${minute} ${hour} * * ${dayOfWeek}`;
        } else {
            // Quotidien
            return `${minute} ${hour} * * *`;
        }
    }

    scheduleBackup(scheduleConfig) {
        const { name, cron: cronPattern, type, description } = scheduleConfig;

        if (this.scheduledJobs.has(name)) {
            logger.warn(`Planification ${name} déjà existante, écrasement...`);
            this.scheduledJobs.get(name).destroy();
        }

        const job = cron.schedule(cronPattern, async () => {
            logger.info(`Exécution de la planification: ${description}`);
            await this.runScheduledBackup(type, name);
        }, {
            scheduled: false,
            timezone: process.env.TZ || "Europe/Paris"
        });

        job.start();
        this.scheduledJobs.set(name, job);

        logger.info(`Planification ajoutée: ${name} (${cronPattern}) - ${description}`);
    }

    async runScheduledBackup(type, scheduleName) {
        const backupId = `scheduled_${scheduleName}_${Date.now()}`;
        
        try {
            logger.info(`Démarrage du backup planifié: ${scheduleName} (type: ${type})`);
            
            // Récupérer tous les clients actifs
            const clients = await getClients({ active: true });
            
            if (clients.length === 0) {
                logger.warn('Aucun client actif pour le backup planifié');
                return;
            }

            const results = [];
            const maxParallel = parseInt(process.env.MAX_PARALLEL_BACKUPS || '2');
            
            // Traitement par lots pour éviter la surcharge
            for (let i = 0; i < clients.length; i += maxParallel) {
                const batch = clients.slice(i, i + maxParallel);
                const batchPromises = batch.map(client => 
                    this.performClientBackup(client, type, backupId)
                );
                
                const batchResults = await Promise.allSettled(batchPromises);
                results.push(...batchResults);
            }

            // Analyser les résultats
            const successful = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
            const failed = results.length - successful;

            logger.info(`Backup planifié ${scheduleName} terminé: ${successful} réussis, ${failed} échoués`);

            // Envoyer notification si configuré
            if (process.env.SEND_SUCCESS_NOTIFICATIONS === 'true' || failed > 0) {
                await this.sendBackupNotification(scheduleName, successful, failed, results);
            }

            // Nettoyage automatique si configuré
            if (type === 'full') {
                await this.cleanupOldBackups();
            }

        } catch (error) {
            logger.error(`Erreur lors du backup planifié ${scheduleName}:`, error);
            
            if (process.env.SEND_FAILURE_NOTIFICATIONS === 'true') {
                await sendNotification(
                    'Erreur Backup Planifié',
                    `Le backup planifié ${scheduleName} a échoué: ${error.message}`,
                    'error'
                );
            }
        }
    }

    async performClientBackup(client, type, backupId) {
        const clientBackupId = `${backupId}_${client.name}`;
        
        try {
            // Marquer le backup comme démarré
            await updateBackupStatus(clientBackupId, 'running', {
                client_name: client.name,
                type: type,
                started_at: new Date().toISOString()
            });

            // Choisir le bon client selon le type d'OS
            const BackupClientClass = client.os_type === 'linux' ? LinuxBackupClient : WindowsBackupClient;
            const backupClient = new BackupClientClass({
                name: client.name,
                host: client.host,
                port: client.port || 22,
                username: client.username,
                password: client.password,
                folders: client.folders ? client.folders.split(',').map(f => f.trim()) : []
            });

            const backupOptions = {
                type: type,
                backupId: clientBackupId,
                backupPath: process.env.BACKUP_PATH || '/var/backups/efc',
                useVSS: process.env.USE_VSS !== 'false',
                createImage: type === 'full' && process.env.CREATE_SYSTEM_IMAGE === 'true',
                folders: client.folders ? client.folders.split(',').map(f => f.trim()) : []
            };

            let result;
            if (type === 'incremental' || type === 'differential') {
                // Trouver le dernier backup complet
                const lastFullBackup = await this.findLastFullBackup(client.name);
                if (lastFullBackup) {
                    result = await backupClient.performIncrementalBackup(lastFullBackup, backupOptions);
                } else {
                    logger.warn(`Aucun backup complet trouvé pour ${client.name}, backup complet forcé`);
                    result = await backupClient.performFullBackup(backupOptions);
                }
            } else {
                result = await backupClient.performFullBackup(backupOptions);
            }

            // Marquer le backup comme réussi
            await updateBackupStatus(clientBackupId, 'completed', {
                ...result.metadata,
                completed_at: new Date().toISOString(),
                size_mb: await this.calculateBackupSize(result.path)
            });

            logger.info(`Backup réussi pour ${client.name}: ${result.backupId}`);
            return { success: true, client: client.name, result };

        } catch (error) {
            logger.error(`Backup échoué pour ${client.name}:`, error);
            
            // Marquer le backup comme échoué
            await updateBackupStatus(clientBackupId, 'failed', {
                client_name: client.name,
                type: type,
                error: error.message,
                failed_at: new Date().toISOString()
            });

            return { success: false, client: client.name, error: error.message };
        }
    }

    async findLastFullBackup(clientName) {
        try {
            const backupDir = path.join(process.env.BACKUP_PATH || '/var/backups/efc');
            const entries = await fs.readdir(backupDir);
            
            const clientBackups = entries
                .filter(entry => entry.startsWith(`backup_${clientName}_`))
                .map(entry => ({
                    path: path.join(backupDir, entry),
                    timestamp: parseInt(entry.split('_').pop())
                }))
                .sort((a, b) => b.timestamp - a.timestamp);

            for (const backup of clientBackups) {
                const metadataPath = path.join(backup.path, 'backup_metadata.json');
                try {
                    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
                    if (metadata.type === 'full') {
                        return backup.path;
                    }
                } catch (error) {
                    continue;
                }
            }

            return null;
        } catch (error) {
            logger.error('Erreur lors de la recherche du dernier backup complet:', error);
            return null;
        }
    }

    async calculateBackupSize(backupPath) {
        try {
            const stats = await this.getDirSize(backupPath);
            return Math.round(stats / (1024 * 1024)); // Convert to MB
        } catch (error) {
            logger.warn(`Impossible de calculer la taille du backup ${backupPath}:`, error);
            return 0;
        }
    }

    async getDirSize(dirPath) {
        let size = 0;
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                size += await this.getDirSize(fullPath);
            } else {
                const stats = await fs.stat(fullPath);
                size += stats.size;
            }
        }
        
        return size;
    }

    async cleanupOldBackups() {
        try {
            const retentionDays = parseInt(process.env.RETENTION_DAYS || '30');
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

            logger.info(`Nettoyage des backups antérieurs au ${cutoffDate.toISOString()}`);

            const backupDir = process.env.BACKUP_PATH || '/var/backups/efc';
            const entries = await fs.readdir(backupDir);

            let deletedCount = 0;
            let freedSpace = 0;

            for (const entry of entries) {
                if (!entry.startsWith('backup_')) continue;

                const backupPath = path.join(backupDir, entry);
                const stats = await fs.stat(backupPath);

                if (stats.mtime < cutoffDate) {
                    const size = await this.getDirSize(backupPath);
                    await fs.rmdir(backupPath, { recursive: true });
                    deletedCount++;
                    freedSpace += size;
                    logger.info(`Backup supprimé: ${entry} (${Math.round(size / (1024 * 1024))} MB)`);
                }
            }

            if (deletedCount > 0) {
                logger.info(`Nettoyage terminé: ${deletedCount} backups supprimés, ${Math.round(freedSpace / (1024 * 1024))} MB libérés`);
            } else {
                logger.info('Nettoyage terminé: aucun backup à supprimer');
            }

        } catch (error) {
            logger.error('Erreur lors du nettoyage des backups:', error);
        }
    }

    async sendBackupNotification(scheduleName, successful, failed, results) {
        try {
            const subject = failed > 0 ? 
                `Backup ${scheduleName} - Erreurs détectées` : 
                `Backup ${scheduleName} - Succès`;

            const details = results.map(result => {
                if (result.status === 'fulfilled' && result.value?.success) {
                    return `✅ ${result.value.client}: Réussi`;
                } else {
                    const error = result.reason || result.value?.error || 'Erreur inconnue';
                    return `❌ ${result.value?.client || 'Client inconnu'}: ${error}`;
                }
            }).join('\n');

            const message = `
Backup planifié: ${scheduleName}
Résultats: ${successful} réussis, ${failed} échoués

Détails:
${details}

Timestamp: ${new Date().toLocaleString('fr-FR')}
Serveur: ${process.env.HOSTNAME || 'EFC-Backup-Server'}
            `;

            await sendNotification(subject, message, failed > 0 ? 'warning' : 'info');
        } catch (error) {
            logger.error('Erreur lors de l\'envoi de notification:', error);
        }
    }

    async startManualBackup(clientNames = null, type = 'full') {
        const backupId = `manual_${Date.now()}`;
        
        try {
            logger.info(`Démarrage du backup manuel (type: ${type})`);
            
            let clients;
            if (clientNames && clientNames.length > 0) {
                clients = await getClients({ names: clientNames });
            } else {
                clients = await getClients({ active: true });
            }

            if (clients.length === 0) {
                throw new Error('Aucun client trouvé pour le backup manuel');
            }

            const results = [];
            
            // Exécuter les backups en parallèle (limité)
            const maxParallel = parseInt(process.env.MAX_PARALLEL_BACKUPS || '2');
            for (let i = 0; i < clients.length; i += maxParallel) {
                const batch = clients.slice(i, i + maxParallel);
                const batchPromises = batch.map(client => 
                    this.performClientBackup(client, type, backupId)
                );
                
                const batchResults = await Promise.allSettled(batchPromises);
                results.push(...batchResults);
            }

            const successful = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
            const failed = results.length - successful;

            logger.info(`Backup manuel terminé: ${successful} réussis, ${failed} échoués`);

            return {
                success: failed === 0,
                backupId,
                results: {
                    successful,
                    failed,
                    details: results
                }
            };

        } catch (error) {
            logger.error('Erreur lors du backup manuel:', error);
            throw error;
        }
    }

    addCustomSchedule(name, cronPattern, type, description, clientNames = null) {
        const scheduleConfig = {
            name: `custom_${name}`,
            cron: cronPattern,
            type,
            description,
            clients: clientNames
        };

        // TODO: Sauvegarder en base de données
        this.scheduleBackup(scheduleConfig);
        
        logger.info(`Planification personnalisée ajoutée: ${name}`);
        return true;
    }

    removeSchedule(name) {
        const scheduleName = name.startsWith('custom_') ? name : `custom_${name}`;
        
        if (this.scheduledJobs.has(scheduleName)) {
            this.scheduledJobs.get(scheduleName).destroy();
            this.scheduledJobs.delete(scheduleName);
            
            // TODO: Supprimer de la base de données
            
            logger.info(`Planification supprimée: ${scheduleName}`);
            return true;
        }
        
        return false;
    }

    getScheduleStatus() {
        const schedules = [];
        
        for (const [name, job] of this.scheduledJobs) {
            schedules.push({
                name,
                active: job.running,
                nextRun: job.nextDate ? job.nextDate().toISOString() : null,
                lastRun: job.lastDate ? job.lastDate().toISOString() : null
            });
        }
        
        return {
            totalSchedules: schedules.length,
            activeSchedules: schedules.filter(s => s.active).length,
            runningBackups: this.runningBackups.size,
            schedules
        };
    }

    start() {
        if (!this.isInitialized) {
            this.init().then(() => {
                logger.info('Planificateur de backups démarré');
            }).catch(error => {
                logger.error('Erreur lors du démarrage du planificateur:', error);
            });
        } else {
            for (const [name, job] of this.scheduledJobs) {
                if (!job.running) {
                    job.start();
                    logger.info(`Planification redémarrée: ${name}`);
                }
            }
        }
    }

    stop() {
        for (const [name, job] of this.scheduledJobs) {
            if (job.running) {
                job.stop();
                logger.info(`Planification arrêtée: ${name}`);
            }
        }
    }

    destroy() {
        for (const [name, job] of this.scheduledJobs) {
            job.destroy();
        }
        this.scheduledJobs.clear();
        this.runningBackups.clear();
        this.isInitialized = false;
        logger.info('Planificateur de backups détruit');
    }
}

// Instance singleton
const backupScheduler = new BackupScheduler();

module.exports = backupScheduler;