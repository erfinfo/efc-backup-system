#!/usr/bin/env node

/**
 * Script de nettoyage pour EFC Backup System
 * - Supprime les anciens backups selon la politique de rétention
 * - Nettoie les logs obsolètes
 * - Supprime les métriques anciennes
 * - Libère l'espace disque
 */

const path = require('path');
const fs = require('fs').promises;
const { initDatabase, getBackups, deleteBackup, getMetrics, db } = require('../src/utils/database');
const { logger } = require('../src/utils/logger');

// Configuration
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '30');
const LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS || '90');
const METRICS_RETENTION_DAYS = parseInt(process.env.METRICS_RETENTION_DAYS || '30');
const BACKUP_PATH = process.env.BACKUP_PATH || '/backups';
const LOG_PATH = process.env.LOG_PATH || './logs';

class CleanupManager {
    constructor() {
        this.stats = {
            backupsDeleted: 0,
            logsDeleted: 0,
            metricsDeleted: 0,
            spaceFreed: 0
        };
    }

    async init() {
        await initDatabase();
        logger.info('Script de nettoyage EFC Backup démarré');
    }

    /**
     * Nettoyer les anciens backups
     */
    async cleanupOldBackups() {
        try {
            logger.info(`Nettoyage des backups de plus de ${RETENTION_DAYS} jours`);
            
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
            
            // Récupérer les backups depuis la base
            const backups = await getBackups();
            const oldBackups = backups.filter(backup => 
                new Date(backup.created_at) < cutoffDate
            );
            
            for (const backup of oldBackups) {
                try {
                    // Supprimer les fichiers physiques
                    const backupPath = path.join(BACKUP_PATH, backup.backup_id);
                    if (await this.pathExists(backupPath)) {
                        const size = await this.getDirectorySize(backupPath);
                        await fs.rm(backupPath, { recursive: true, force: true });
                        this.stats.spaceFreed += size;
                        logger.info(`Backup supprimé: ${backup.backup_id} (${this.formatBytes(size)})`);
                    }
                    
                    // Supprimer de la base
                    await deleteBackup(backup.id);
                    this.stats.backupsDeleted++;
                    
                } catch (error) {
                    logger.error(`Erreur lors de la suppression du backup ${backup.backup_id}:`, error);
                }
            }
            
            logger.info(`${this.stats.backupsDeleted} backups supprimés`);
            
        } catch (error) {
            logger.error('Erreur lors du nettoyage des backups:', error);
        }
    }

    /**
     * Nettoyer les anciens logs
     */
    async cleanupOldLogs() {
        try {
            logger.info(`Nettoyage des logs de plus de ${LOG_RETENTION_DAYS} jours`);
            
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - LOG_RETENTION_DAYS);
            
            const logFiles = await fs.readdir(LOG_PATH);
            
            for (const file of logFiles) {
                const filePath = path.join(LOG_PATH, file);
                const stats = await fs.stat(filePath);
                
                if (stats.mtime < cutoffDate && file.endsWith('.log')) {
                    const size = stats.size;
                    await fs.unlink(filePath);
                    this.stats.logsDeleted++;
                    this.stats.spaceFreed += size;
                    logger.info(`Log supprimé: ${file} (${this.formatBytes(size)})`);
                }
            }
            
            logger.info(`${this.stats.logsDeleted} fichiers de log supprimés`);
            
        } catch (error) {
            logger.error('Erreur lors du nettoyage des logs:', error);
        }
    }

    /**
     * Nettoyer les anciennes métriques
     */
    async cleanupOldMetrics() {
        try {
            logger.info(`Nettoyage des métriques de plus de ${METRICS_RETENTION_DAYS} jours`);
            
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - METRICS_RETENTION_DAYS);
            
            const result = await db.run(
                'DELETE FROM metrics WHERE timestamp < ?',
                [cutoffDate.toISOString()]
            );
            
            this.stats.metricsDeleted = result.changes;
            
            // Nettoyer aussi les vieilles statistiques réseau
            await db.run(
                'DELETE FROM network_stats WHERE created_at < ?',
                [cutoffDate.toISOString()]
            );
            
            // Nettoyer les logs d'activité anciens
            await db.run(
                'DELETE FROM activity_logs WHERE timestamp < ?',
                [cutoffDate.toISOString()]
            );
            
            logger.info(`${this.stats.metricsDeleted} entrées de métriques supprimées`);
            
            // Optimiser la base de données
            await db.run('VACUUM');
            logger.info('Base de données optimisée (VACUUM exécuté)');
            
        } catch (error) {
            logger.error('Erreur lors du nettoyage des métriques:', error);
        }
    }

    /**
     * Nettoyer les fichiers temporaires
     */
    async cleanupTempFiles() {
        try {
            logger.info('Nettoyage des fichiers temporaires');
            
            const tempDirs = [
                '/tmp/efc-backup-*',
                '/tmp/backup-*',
                '/tmp/modified-files-*.txt'
            ];
            
            for (const pattern of tempDirs) {
                try {
                    const baseDir = path.dirname(pattern);
                    const searchPattern = path.basename(pattern).replace('*', '');
                    
                    const files = await fs.readdir(baseDir);
                    for (const file of files) {
                        if (file.includes(searchPattern)) {
                            const filePath = path.join(baseDir, file);
                            const stats = await fs.stat(filePath);
                            
                            // Supprimer si plus vieux que 24h
                            const dayAgo = new Date();
                            dayAgo.setHours(dayAgo.getHours() - 24);
                            
                            if (stats.mtime < dayAgo) {
                                if (stats.isDirectory()) {
                                    await fs.rm(filePath, { recursive: true, force: true });
                                } else {
                                    await fs.unlink(filePath);
                                }
                                logger.info(`Fichier temporaire supprimé: ${filePath}`);
                            }
                        }
                    }
                } catch (error) {
                    // Ignorer les erreurs pour les patterns qui n'existent pas
                }
            }
            
        } catch (error) {
            logger.error('Erreur lors du nettoyage des fichiers temporaires:', error);
        }
    }

    /**
     * Utilitaires
     */
    async pathExists(path) {
        try {
            await fs.access(path);
            return true;
        } catch {
            return false;
        }
    }

    async getDirectorySize(dirPath) {
        let totalSize = 0;
        
        try {
            const files = await fs.readdir(dirPath);
            
            for (const file of files) {
                const filePath = path.join(dirPath, file);
                const stats = await fs.stat(filePath);
                
                if (stats.isDirectory()) {
                    totalSize += await this.getDirectorySize(filePath);
                } else {
                    totalSize += stats.size;
                }
            }
        } catch (error) {
            logger.warn(`Impossible de calculer la taille de ${dirPath}:`, error);
        }
        
        return totalSize;
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Exécuter le nettoyage complet
     */
    async run() {
        try {
            await this.init();
            
            logger.info('=== Démarrage du nettoyage EFC Backup ===');
            
            // Exécuter les différentes tâches de nettoyage
            await this.cleanupOldBackups();
            await this.cleanupOldLogs();
            await this.cleanupOldMetrics();
            await this.cleanupTempFiles();
            
            // Rapport final
            logger.info('=== Nettoyage terminé ===');
            logger.info(`Statistiques du nettoyage:`);
            logger.info(`- Backups supprimés: ${this.stats.backupsDeleted}`);
            logger.info(`- Logs supprimés: ${this.stats.logsDeleted}`);
            logger.info(`- Métriques supprimées: ${this.stats.metricsDeleted}`);
            logger.info(`- Espace libéré: ${this.formatBytes(this.stats.spaceFreed)}`);
            
            process.exit(0);
            
        } catch (error) {
            logger.error('Erreur fatale lors du nettoyage:', error);
            process.exit(1);
        }
    }
}

// Exécution si appelé directement
if (require.main === module) {
    const cleanup = new CleanupManager();
    cleanup.run();
}

module.exports = CleanupManager;