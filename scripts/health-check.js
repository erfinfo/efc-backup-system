#!/usr/bin/env node

/**
 * Script de vérification de santé pour EFC Backup System
 * - Vérifie l'état de la base de données
 * - Teste la connectivité avec les clients
 * - Vérifie l'espace disque disponible
 * - Contrôle les processus en cours
 * - Vérifie les planifications actives
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { initDatabase, getClients, getBackups, db } = require('../src/utils/database');
const { logger } = require('../src/utils/logger');
const backupScheduler = require('../src/backup/scheduler');

class HealthChecker {
    constructor() {
        this.results = {
            database: { status: 'unknown', message: '' },
            diskSpace: { status: 'unknown', message: '' },
            memory: { status: 'unknown', message: '' },
            clients: { status: 'unknown', message: '', details: [] },
            scheduler: { status: 'unknown', message: '' },
            backups: { status: 'unknown', message: '' },
            overall: 'healthy'
        };
    }

    /**
     * Vérifier l'état de la base de données
     */
    async checkDatabase() {
        try {
            await initDatabase();
            
            // Tester une requête simple
            const tables = await db.all(
                "SELECT name FROM sqlite_master WHERE type='table'"
            );
            
            if (tables.length > 0) {
                this.results.database.status = 'healthy';
                this.results.database.message = `Base de données OK (${tables.length} tables)`;
                logger.info('✅ Base de données: OK');
            } else {
                throw new Error('Aucune table trouvée');
            }
            
        } catch (error) {
            this.results.database.status = 'unhealthy';
            this.results.database.message = `Erreur base de données: ${error.message}`;
            this.results.overall = 'unhealthy';
            logger.error('❌ Base de données: Erreur', error);
        }
    }

    /**
     * Vérifier l'espace disque disponible
     */
    async checkDiskSpace() {
        try {
            const backupPath = process.env.BACKUP_PATH || '/backups';
            
            // Utiliser df pour obtenir l'espace disque sur Linux
            const { exec } = require('child_process');
            const diskInfo = await new Promise((resolve, reject) => {
                exec(`df -h ${backupPath}`, (error, stdout) => {
                    if (error) reject(error);
                    else resolve(stdout);
                });
            });
            
            // Parser la sortie de df
            const lines = diskInfo.split('\n');
            if (lines.length > 1) {
                const parts = lines[1].split(/\s+/);
                const usePercent = parseInt(parts[4].replace('%', ''));
                const available = parts[3];
                
                const alertThreshold = parseInt(process.env.ALERT_DISK_USAGE_PERCENT || '80');
                const criticalThreshold = parseInt(process.env.ALERT_DISK_CRITICAL_PERCENT || '95');
                
                if (usePercent >= criticalThreshold) {
                    this.results.diskSpace.status = 'critical';
                    this.results.diskSpace.message = `Espace disque critique: ${usePercent}% utilisé (${available} disponible)`;
                    this.results.overall = 'critical';
                    logger.error('🔴 Espace disque: CRITIQUE');
                } else if (usePercent >= alertThreshold) {
                    this.results.diskSpace.status = 'warning';
                    this.results.diskSpace.message = `Espace disque faible: ${usePercent}% utilisé (${available} disponible)`;
                    if (this.results.overall === 'healthy') {
                        this.results.overall = 'warning';
                    }
                    logger.warn('🟡 Espace disque: Attention');
                } else {
                    this.results.diskSpace.status = 'healthy';
                    this.results.diskSpace.message = `Espace disque OK: ${usePercent}% utilisé (${available} disponible)`;
                    logger.info('✅ Espace disque: OK');
                }
            }
            
        } catch (error) {
            this.results.diskSpace.status = 'unknown';
            this.results.diskSpace.message = `Impossible de vérifier l'espace disque: ${error.message}`;
            logger.warn('⚠️  Espace disque: Non vérifié');
        }
    }

    /**
     * Vérifier l'utilisation mémoire
     */
    async checkMemory() {
        try {
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;
            const usePercent = Math.round((usedMem / totalMem) * 100);
            
            const alertThreshold = parseInt(process.env.ALERT_MEMORY_USAGE_PERCENT || '85');
            
            if (usePercent >= 95) {
                this.results.memory.status = 'critical';
                this.results.memory.message = `Mémoire critique: ${usePercent}% utilisée`;
                this.results.overall = 'critical';
                logger.error('🔴 Mémoire: CRITIQUE');
            } else if (usePercent >= alertThreshold) {
                this.results.memory.status = 'warning';
                this.results.memory.message = `Mémoire élevée: ${usePercent}% utilisée`;
                if (this.results.overall === 'healthy') {
                    this.results.overall = 'warning';
                }
                logger.warn('🟡 Mémoire: Attention');
            } else {
                this.results.memory.status = 'healthy';
                this.results.memory.message = `Mémoire OK: ${usePercent}% utilisée`;
                logger.info('✅ Mémoire: OK');
            }
            
        } catch (error) {
            this.results.memory.status = 'unknown';
            this.results.memory.message = `Impossible de vérifier la mémoire: ${error.message}`;
            logger.warn('⚠️  Mémoire: Non vérifiée');
        }
    }

    /**
     * Vérifier la connectivité avec les clients
     */
    async checkClients() {
        try {
            const clients = await getClients({ active: true });
            
            if (clients.length === 0) {
                this.results.clients.status = 'info';
                this.results.clients.message = 'Aucun client actif configuré';
                logger.info('ℹ️  Clients: Aucun client actif');
                return;
            }
            
            let healthyCount = 0;
            let unhealthyCount = 0;
            
            for (const client of clients) {
                const clientStatus = {
                    name: client.name,
                    host: client.host,
                    status: 'unknown'
                };
                
                // Test ping simple
                const { exec } = require('child_process');
                try {
                    await new Promise((resolve, reject) => {
                        exec(`ping -c 1 -W 2 ${client.host}`, (error) => {
                            if (error) reject(error);
                            else resolve();
                        });
                    });
                    clientStatus.status = 'reachable';
                    healthyCount++;
                } catch {
                    clientStatus.status = 'unreachable';
                    unhealthyCount++;
                }
                
                this.results.clients.details.push(clientStatus);
            }
            
            if (unhealthyCount === 0) {
                this.results.clients.status = 'healthy';
                this.results.clients.message = `Tous les clients sont accessibles (${healthyCount}/${clients.length})`;
                logger.info('✅ Clients: Tous accessibles');
            } else if (healthyCount === 0) {
                this.results.clients.status = 'critical';
                this.results.clients.message = `Aucun client accessible (0/${clients.length})`;
                this.results.overall = 'critical';
                logger.error('🔴 Clients: Aucun accessible');
            } else {
                this.results.clients.status = 'warning';
                this.results.clients.message = `Certains clients inaccessibles (${healthyCount}/${clients.length} OK)`;
                if (this.results.overall === 'healthy') {
                    this.results.overall = 'warning';
                }
                logger.warn('🟡 Clients: Partiellement accessibles');
            }
            
        } catch (error) {
            this.results.clients.status = 'unknown';
            this.results.clients.message = `Impossible de vérifier les clients: ${error.message}`;
            logger.warn('⚠️  Clients: Non vérifiés');
        }
    }

    /**
     * Vérifier le planificateur
     */
    async checkScheduler() {
        try {
            const status = backupScheduler.getScheduleStatus();
            
            if (status.totalSchedules > 0) {
                this.results.scheduler.status = 'healthy';
                this.results.scheduler.message = `Planificateur OK: ${status.activeSchedules}/${status.totalSchedules} planifications actives`;
                logger.info('✅ Planificateur: OK');
            } else {
                this.results.scheduler.status = 'info';
                this.results.scheduler.message = 'Aucune planification configurée';
                logger.info('ℹ️  Planificateur: Aucune planification');
            }
            
            if (status.runningBackups > 0) {
                this.results.scheduler.message += ` (${status.runningBackups} backups en cours)`;
            }
            
        } catch (error) {
            this.results.scheduler.status = 'unknown';
            this.results.scheduler.message = `Impossible de vérifier le planificateur: ${error.message}`;
            logger.warn('⚠️  Planificateur: Non vérifié');
        }
    }

    /**
     * Vérifier les backups récents
     */
    async checkRecentBackups() {
        try {
            const backups = await getBackups();
            const now = new Date();
            const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
            const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
            
            const recentBackups = backups.filter(b => new Date(b.created_at) > oneDayAgo);
            const weekBackups = backups.filter(b => new Date(b.created_at) > oneWeekAgo);
            const failedRecent = recentBackups.filter(b => b.status === 'failed');
            
            if (recentBackups.length === 0) {
                this.results.backups.status = 'warning';
                this.results.backups.message = 'Aucun backup dans les dernières 24h';
                if (this.results.overall === 'healthy') {
                    this.results.overall = 'warning';
                }
                logger.warn('🟡 Backups: Aucun récent');
            } else if (failedRecent.length > 0) {
                const failRate = Math.round((failedRecent.length / recentBackups.length) * 100);
                if (failRate > 50) {
                    this.results.backups.status = 'critical';
                    this.results.backups.message = `Taux d'échec élevé: ${failRate}% (${failedRecent.length}/${recentBackups.length})`;
                    this.results.overall = 'critical';
                    logger.error('🔴 Backups: Taux d\'échec critique');
                } else {
                    this.results.backups.status = 'warning';
                    this.results.backups.message = `Quelques échecs: ${failRate}% (${failedRecent.length}/${recentBackups.length})`;
                    if (this.results.overall === 'healthy') {
                        this.results.overall = 'warning';
                    }
                    logger.warn('🟡 Backups: Quelques échecs');
                }
            } else {
                this.results.backups.status = 'healthy';
                this.results.backups.message = `Backups OK: ${recentBackups.length} dans les 24h, ${weekBackups.length} cette semaine`;
                logger.info('✅ Backups: OK');
            }
            
        } catch (error) {
            this.results.backups.status = 'unknown';
            this.results.backups.message = `Impossible de vérifier les backups: ${error.message}`;
            logger.warn('⚠️  Backups: Non vérifiés');
        }
    }

    /**
     * Générer le rapport de santé
     */
    generateReport() {
        console.log('\n' + '='.repeat(60));
        console.log('    📊 RAPPORT DE SANTÉ - EFC BACKUP SYSTEM');
        console.log('='.repeat(60));
        console.log(`Date: ${new Date().toLocaleString()}`);
        console.log('');
        
        const statusEmoji = {
            healthy: '✅',
            warning: '🟡',
            critical: '🔴',
            unknown: '⚠️',
            info: 'ℹ️'
        };
        
        // Afficher chaque composant
        const components = [
            { name: 'Base de données', data: this.results.database },
            { name: 'Espace disque', data: this.results.diskSpace },
            { name: 'Mémoire', data: this.results.memory },
            { name: 'Clients', data: this.results.clients },
            { name: 'Planificateur', data: this.results.scheduler },
            { name: 'Backups', data: this.results.backups }
        ];
        
        for (const component of components) {
            const emoji = statusEmoji[component.data.status] || '❓';
            console.log(`${emoji} ${component.name.padEnd(15)} : ${component.data.message}`);
            
            // Afficher les détails des clients si disponibles
            if (component.name === 'Clients' && component.data.details.length > 0) {
                for (const client of component.data.details) {
                    const clientEmoji = client.status === 'reachable' ? '  ✓' : '  ✗';
                    console.log(`${clientEmoji} ${client.name} (${client.host}): ${client.status}`);
                }
            }
        }
        
        console.log('\n' + '-'.repeat(60));
        
        // État global
        const overallEmoji = statusEmoji[this.results.overall] || '❓';
        const overallText = {
            healthy: 'SYSTÈME EN BONNE SANTÉ',
            warning: 'SYSTÈME FONCTIONNEL AVEC AVERTISSEMENTS',
            critical: 'SYSTÈME EN ÉTAT CRITIQUE',
            unknown: 'ÉTAT DU SYSTÈME INCONNU'
        };
        
        console.log(`${overallEmoji} État global: ${overallText[this.results.overall] || 'INCONNU'}`);
        console.log('='.repeat(60) + '\n');
        
        // Code de sortie basé sur l'état
        return this.results.overall === 'critical' ? 2 : (this.results.overall === 'warning' ? 1 : 0);
    }

    /**
     * Exécuter la vérification complète
     */
    async run() {
        try {
            logger.info('Démarrage de la vérification de santé...');
            
            // Exécuter toutes les vérifications
            await this.checkDatabase();
            await this.checkDiskSpace();
            await this.checkMemory();
            await this.checkClients();
            await this.checkScheduler();
            await this.checkRecentBackups();
            
            // Générer et afficher le rapport
            const exitCode = this.generateReport();
            
            // Sauvegarder le résultat en base si possible
            if (this.results.database.status === 'healthy') {
                try {
                    await db.run(
                        `INSERT INTO metrics (metric_name, metric_value, metric_unit, tags) 
                         VALUES ('health_check', ?, 'status', ?)`,
                        [
                            this.results.overall === 'healthy' ? 1 : 0,
                            JSON.stringify(this.results)
                        ]
                    );
                } catch (error) {
                    logger.warn('Impossible de sauvegarder les métriques de santé:', error);
                }
            }
            
            process.exit(exitCode);
            
        } catch (error) {
            logger.error('Erreur fatale lors de la vérification:', error);
            console.error('❌ Erreur fatale lors de la vérification de santé');
            process.exit(3);
        }
    }
}

// Exécution si appelé directement
if (require.main === module) {
    const checker = new HealthChecker();
    checker.run();
}

module.exports = HealthChecker;