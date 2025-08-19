const si = require('systeminformation');
const diskusage = require('diskusage');
const { logger, logMetric } = require('../utils/logger');
const { addMetric } = require('../utils/database');
const { sendSystemAlert } = require('../utils/notification');

class SystemMonitor {
    constructor() {
        this.isRunning = false;
        this.intervals = new Map();
        this.lastAlerts = new Map();
        this.alertCooldown = 30 * 60 * 1000; // 30 minutes entre les alertes
    }

    start() {
        if (this.isRunning) {
            logger.warn('Le monitoring système est déjà en cours');
            return;
        }

        this.isRunning = true;
        logger.info('Démarrage du monitoring système...');

        // Monitoring des métriques système toutes les minutes
        this.intervals.set('system', setInterval(async () => {
            await this.collectSystemMetrics();
        }, 60000));

        // Monitoring de l'espace disque toutes les 5 minutes
        this.intervals.set('disk', setInterval(async () => {
            await this.monitorDiskUsage();
        }, 5 * 60000));

        // Health check général toutes les 30 secondes
        this.intervals.set('health', setInterval(async () => {
            await this.performHealthCheck();
        }, parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000')));

        // Nettoyage des métriques anciennes une fois par jour
        this.intervals.set('cleanup', setInterval(async () => {
            await this.cleanupOldMetrics();
        }, 24 * 60 * 60 * 1000));

        logger.info('Monitoring système démarré avec succès');
    }

    stop() {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;

        for (const [name, interval] of this.intervals) {
            clearInterval(interval);
            logger.info(`Monitoring ${name} arrêté`);
        }

        this.intervals.clear();
        logger.info('Monitoring système arrêté');
    }

    async collectSystemMetrics() {
        try {
            // CPU
            const cpu = await si.currentLoad();
            await this.recordMetric('cpu_usage_percent', cpu.currentLoad, '%', { cores: cpu.cpus.length });
            logMetric('cpu_usage', cpu.currentLoad, '%');

            // Mémoire
            const memory = await si.mem();
            const memoryUsagePercent = (memory.used / memory.total) * 100;
            await this.recordMetric('memory_usage_percent', memoryUsagePercent, '%');
            await this.recordMetric('memory_used_mb', memory.used / (1024 * 1024), 'MB');
            await this.recordMetric('memory_total_mb', memory.total / (1024 * 1024), 'MB');
            logMetric('memory_usage', memoryUsagePercent, '%');

            // Réseau
            const networkStats = await si.networkStats();
            if (networkStats && networkStats.length > 0) {
                const mainInterface = networkStats[0];
                await this.recordMetric('network_rx_bytes', mainInterface.rx_bytes, 'bytes', { interface: mainInterface.iface });
                await this.recordMetric('network_tx_bytes', mainInterface.tx_bytes, 'bytes', { interface: mainInterface.iface });
            }

            // Processus Node.js
            const processStats = process.memoryUsage();
            await this.recordMetric('nodejs_memory_rss', processStats.rss / (1024 * 1024), 'MB');
            await this.recordMetric('nodejs_memory_heap_used', processStats.heapUsed / (1024 * 1024), 'MB');
            await this.recordMetric('nodejs_memory_heap_total', processStats.heapTotal / (1024 * 1024), 'MB');

            // Uptime
            const uptimeHours = process.uptime() / 3600;
            await this.recordMetric('nodejs_uptime_hours', uptimeHours, 'hours');

            // Vérifier les seuils d'alerte
            await this.checkSystemAlerts(cpu.currentLoad, memoryUsagePercent);

        } catch (error) {
            logger.error('Erreur lors de la collecte des métriques système:', error);
        }
    }

    async monitorDiskUsage() {
        try {
            const backupPath = process.env.BACKUP_PATH || '/var/backups/efc';
            const logPath = process.env.LOG_PATH || './logs';

            // Monitoring du disque des backups
            try {
                const backupDisk = await diskusage.check(backupPath);
                const backupUsagePercent = ((backupDisk.total - backupDisk.free) / backupDisk.total) * 100;
                
                await this.recordMetric('backup_disk_usage_percent', backupUsagePercent, '%', { path: backupPath });
                await this.recordMetric('backup_disk_free_gb', backupDisk.free / (1024 * 1024 * 1024), 'GB', { path: backupPath });
                await this.recordMetric('backup_disk_total_gb', backupDisk.total / (1024 * 1024 * 1024), 'GB', { path: backupPath });
                
                logMetric('backup_disk_usage', backupUsagePercent, '%');

                // Alerte si l'espace disque est critique
                await this.checkDiskSpaceAlert(backupUsagePercent, backupPath, 'backup');
            } catch (error) {
                logger.warn(`Impossible de monitorer le disque des backups (${backupPath}):`, error.message);
            }

            // Monitoring du disque des logs
            try {
                const logDisk = await diskusage.check(logPath);
                const logUsagePercent = ((logDisk.total - logDisk.free) / logDisk.total) * 100;
                
                await this.recordMetric('log_disk_usage_percent', logUsagePercent, '%', { path: logPath });
                await this.recordMetric('log_disk_free_gb', logDisk.free / (1024 * 1024 * 1024), 'GB', { path: logPath });
                
                await this.checkDiskSpaceAlert(logUsagePercent, logPath, 'log');
            } catch (error) {
                logger.warn(`Impossible de monitorer le disque des logs (${logPath}):`, error.message);
            }

        } catch (error) {
            logger.error('Erreur lors du monitoring des disques:', error);
        }
    }

    async performHealthCheck() {
        try {
            const health = {
                timestamp: new Date().toISOString(),
                status: 'healthy',
                services: {},
                metrics: {}
            };

            // Vérifier la base de données
            try {
                const { db } = require('../utils/database');
                await db.get('SELECT 1');
                health.services.database = 'healthy';
            } catch (error) {
                health.services.database = 'unhealthy';
                health.status = 'degraded';
                logger.error('Health check database failed:', error);
            }

            // Vérifier les dossiers critiques
            const criticalPaths = [
                process.env.BACKUP_PATH || '/var/backups/efc',
                process.env.LOG_PATH || './logs'
            ];

            for (const pathToCheck of criticalPaths) {
                try {
                    const fs = require('fs').promises;
                    await fs.access(pathToCheck);
                    health.services[`path_${pathToCheck.replace(/[^a-zA-Z0-9]/g, '_')}`] = 'accessible';
                } catch (error) {
                    health.services[`path_${pathToCheck.replace(/[^a-zA-Z0-9]/g, '_')}`] = 'inaccessible';
                    health.status = 'degraded';
                    logger.error(`Path inaccessible: ${pathToCheck}`, error);
                }
            }

            // Métriques rapides
            health.metrics.uptime_seconds = Math.floor(process.uptime());
            health.metrics.memory_usage_mb = Math.floor(process.memoryUsage().rss / (1024 * 1024));
            
            // Enregistrer le health check
            await this.recordMetric('health_check_status', health.status === 'healthy' ? 1 : 0, 'boolean');
            
            if (health.status !== 'healthy') {
                await this.sendHealthAlert(health);
            }

            return health;

        } catch (error) {
            logger.error('Erreur lors du health check:', error);
            return {
                timestamp: new Date().toISOString(),
                status: 'unhealthy',
                error: error.message
            };
        }
    }

    async recordMetric(name, value, unit = '', tags = {}) {
        try {
            await addMetric(name, value, unit, tags);
        } catch (error) {
            logger.error(`Erreur lors de l'enregistrement de la métrique ${name}:`, error);
        }
    }

    async checkSystemAlerts(cpuUsage, memoryUsage) {
        const cpuThreshold = parseFloat(process.env.ALERT_CPU_USAGE_PERCENT || '80');
        const memoryThreshold = parseFloat(process.env.ALERT_MEMORY_USAGE_PERCENT || '85');

        // Alerte CPU
        if (cpuUsage > cpuThreshold) {
            await this.sendAlert('cpu_high', 'warning', 'Utilisation CPU élevée', 
                `L'utilisation CPU est de ${cpuUsage.toFixed(1)}% (seuil: ${cpuThreshold}%)`, 
                { cpuUsage, threshold: cpuThreshold });
        }

        // Alerte mémoire
        if (memoryUsage > memoryThreshold) {
            await this.sendAlert('memory_high', 'warning', 'Utilisation mémoire élevée', 
                `L'utilisation mémoire est de ${memoryUsage.toFixed(1)}% (seuil: ${memoryThreshold}%)`,
                { memoryUsage, threshold: memoryThreshold });
        }
    }

    async checkDiskSpaceAlert(usagePercent, diskPath, diskType) {
        const threshold = parseFloat(process.env.ALERT_DISK_USAGE_PERCENT || '80');
        const criticalThreshold = parseFloat(process.env.ALERT_DISK_CRITICAL_PERCENT || '95');

        if (usagePercent > criticalThreshold) {
            await this.sendAlert(`disk_critical_${diskType}`, 'critical', 
                `Espace disque critique - ${diskType}`, 
                `L'espace disque ${diskType} (${diskPath}) est utilisé à ${usagePercent.toFixed(1)}%. Action immédiate requise !`,
                { usagePercent, threshold: criticalThreshold, path: diskPath, type: diskType });
        } else if (usagePercent > threshold) {
            await this.sendAlert(`disk_warning_${diskType}`, 'warning', 
                `Espace disque faible - ${diskType}`, 
                `L'espace disque ${diskType} (${diskPath}) est utilisé à ${usagePercent.toFixed(1)}% (seuil: ${threshold}%)`,
                { usagePercent, threshold, path: diskPath, type: diskType });
        }
    }

    async sendHealthAlert(healthStatus) {
        const alertKey = 'health_degraded';
        
        if (this.shouldSendAlert(alertKey)) {
            const unhealthyServices = Object.entries(healthStatus.services)
                .filter(([_, status]) => status !== 'healthy')
                .map(([service, status]) => `${service}: ${status}`)
                .join('\n');

            await sendSystemAlert('warning', 'État système dégradé', 
                `Le système EFC Backup présente des problèmes:\n\n${unhealthyServices}`,
                healthStatus);
            
            this.lastAlerts.set(alertKey, Date.now());
        }
    }

    async sendAlert(alertKey, level, title, message, details = {}) {
        if (this.shouldSendAlert(alertKey)) {
            await sendSystemAlert(level, title, message, details);
            this.lastAlerts.set(alertKey, Date.now());
            logger.warn(`Alerte ${level}: ${title} - ${message}`);
        }
    }

    shouldSendAlert(alertKey) {
        const lastAlert = this.lastAlerts.get(alertKey);
        if (!lastAlert) return true;
        
        return (Date.now() - lastAlert) > this.alertCooldown;
    }

    async cleanupOldMetrics() {
        try {
            const retentionDays = parseInt(process.env.METRICS_RETENTION_DAYS || '30');
            const { db } = require('../utils/database');
            
            const result = await db.run(
                'DELETE FROM metrics WHERE timestamp < datetime("now", "-' + retentionDays + ' days")'
            );
            
            if (result.changes > 0) {
                logger.info(`Nettoyage des métriques: ${result.changes} entrées supprimées`);
            }
        } catch (error) {
            logger.error('Erreur lors du nettoyage des métriques:', error);
        }
    }

    async getSystemStatus() {
        try {
            // Métriques en temps réel
            const cpu = await si.currentLoad();
            const memory = await si.mem();
            const osInfo = await si.osInfo();
            const system = await si.system();

            // Utilisation des disques
            const backupPath = process.env.BACKUP_PATH || '/var/backups/efc';
            let diskInfo = {};
            try {
                const backupDisk = await diskusage.check(backupPath);
                diskInfo.backup = {
                    path: backupPath,
                    total: Math.floor(backupDisk.total / (1024 * 1024 * 1024)),
                    free: Math.floor(backupDisk.free / (1024 * 1024 * 1024)),
                    used: Math.floor((backupDisk.total - backupDisk.free) / (1024 * 1024 * 1024)),
                    usagePercent: Math.floor(((backupDisk.total - backupDisk.free) / backupDisk.total) * 100)
                };
            } catch (error) {
                logger.warn('Impossible d\'obtenir les informations du disque de backup');
            }

            return {
                timestamp: new Date().toISOString(),
                system: {
                    manufacturer: system.manufacturer,
                    model: system.model,
                    os: `${osInfo.distro} ${osInfo.release}`,
                    platform: osInfo.platform,
                    arch: osInfo.arch,
                    uptime: Math.floor(process.uptime())
                },
                cpu: {
                    usage: Math.floor(cpu.currentLoad),
                    cores: cpu.cpus.length,
                    model: cpu.cpus[0]?.model || 'Unknown'
                },
                memory: {
                    total: Math.floor(memory.total / (1024 * 1024)),
                    used: Math.floor(memory.used / (1024 * 1024)),
                    free: Math.floor(memory.free / (1024 * 1024)),
                    usagePercent: Math.floor((memory.used / memory.total) * 100)
                },
                disk: diskInfo,
                nodejs: {
                    version: process.version,
                    uptime: Math.floor(process.uptime()),
                    memory: {
                        rss: Math.floor(process.memoryUsage().rss / (1024 * 1024)),
                        heapUsed: Math.floor(process.memoryUsage().heapUsed / (1024 * 1024)),
                        heapTotal: Math.floor(process.memoryUsage().heapTotal / (1024 * 1024))
                    }
                },
                monitoring: {
                    running: this.isRunning,
                    activeIntervals: this.intervals.size,
                    lastAlerts: this.lastAlerts.size
                }
            };
        } catch (error) {
            logger.error('Erreur lors de la récupération du statut système:', error);
            throw error;
        }
    }

    async getMetricsHistory(metricName, hours = 24) {
        try {
            const { getMetrics } = require('../utils/database');
            const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
            
            return await getMetrics(metricName, since);
        } catch (error) {
            logger.error(`Erreur lors de la récupération de l'historique pour ${metricName}:`, error);
            return [];
        }
    }
}

// Instance singleton
const systemMonitor = new SystemMonitor();

module.exports = systemMonitor;