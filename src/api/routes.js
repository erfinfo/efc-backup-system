const express = require('express');
const router = express.Router();
const { logger, getRecentLogs, getClientLogs, getClientsWithLogs, getLogStats } = require('../utils/logger');
const { 
    addClient, 
    getClients, 
    getClient, 
    updateClient, 
    deleteClient,
    getBackups,
    getBackupStats,
    addSchedule,
    getSchedules,
    getActivityLogs,
    getSetting,
    setSetting,
    getNetworkStats,
    getNetworkStatsByClient
} = require('../utils/database');
const backupScheduler = require('../backup/scheduler');
const systemMonitor = require('../monitor/systemMonitor');
const { testNotificationConfig } = require('../utils/notification');

// Middleware pour les logs d'API
router.use((req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info(`API ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`, {
            method: req.method,
            url: req.originalUrl,
            statusCode: res.statusCode,
            duration,
            userAgent: req.get('User-Agent'),
            ip: req.ip
        });
    });
    
    next();
});

// Routes Dashboard
router.get('/dashboard', async (req, res) => {
    try {
        const [clients, backupStats, systemStatus, scheduleStatus] = await Promise.all([
            getClients(),
            getBackupStats(),
            systemMonitor.getSystemStatus(),
            backupScheduler.getScheduleStatus()
        ]);

        const dashboard = {
            summary: {
                activeClients: clients.filter(c => c.active).length,
                totalClients: clients.length,
                todayBackups: backupStats.last24h,
                totalBackups: backupStats.total,
                storageUsedMB: backupStats.totalSizeMB,
                runningBackups: scheduleStatus.runningBackups,
                lastRun: new Date().toISOString()
            },
            system: {
                status: systemStatus.monitoring.running ? 'healthy' : 'warning',
                uptime: systemStatus.nodejs.uptime,
                cpuUsage: systemStatus.cpu.usage,
                memoryUsage: systemStatus.memory.usagePercent,
                diskUsage: systemStatus.disk.backup ? systemStatus.disk.backup.usagePercent : 0
            },
            scheduler: scheduleStatus,
            recentActivity: await getActivityLogs(10)
        };

        res.json(dashboard);
    } catch (error) {
        logger.error('Erreur API dashboard:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Routes Clients
router.get('/clients', async (req, res) => {
    try {
        const clients = await getClients();
        res.json(clients);
    } catch (error) {
        logger.error('Erreur API get clients:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des clients' });
    }
});

router.post('/clients', async (req, res) => {
    try {
        const { name, host, port, username, password, folders, backup_type, os_type } = req.body;
        
        if (!name || !host || !username || !password) {
            return res.status(400).json({ error: 'Champs obligatoires manquants' });
        }

        const result = await addClient({
            name,
            host,
            port: parseInt(port) || 22,
            username,
            password,
            folders,
            backup_type: backup_type || 'full',
            os_type: os_type || 'windows'
        });

        logger.info(`Client ajouté: ${name}`, { clientId: result.id });
        res.status(201).json({ message: 'Client ajouté avec succès', id: result.id });
    } catch (error) {
        if (error.message.includes('UNIQUE constraint')) {
            res.status(409).json({ error: 'Un client avec ce nom existe déjà' });
        } else {
            logger.error('Erreur API add client:', error);
            res.status(500).json({ error: 'Erreur lors de l\'ajout du client' });
        }
    }
});

router.get('/clients/:id', async (req, res) => {
    try {
        const client = await getClient(req.params.id);
        if (!client) {
            return res.status(404).json({ error: 'Client non trouvé' });
        }
        
        // Ne pas renvoyer le mot de passe dans la réponse
        const { password, ...clientData } = client;
        res.json(clientData);
    } catch (error) {
        logger.error('Erreur API get client:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération du client' });
    }
});

router.put('/clients/:id', async (req, res) => {
    try {
        const client = await getClient(req.params.id);
        if (!client) {
            return res.status(404).json({ error: 'Client non trouvé' });
        }

        await updateClient(req.params.id, req.body);
        logger.info(`Client modifié: ${client.name}`, { clientId: req.params.id });
        res.json({ message: 'Client modifié avec succès' });
    } catch (error) {
        logger.error('Erreur API update client:', error);
        res.status(500).json({ error: 'Erreur lors de la modification du client' });
    }
});

router.delete('/clients/:id', async (req, res) => {
    try {
        const client = await getClient(req.params.id);
        if (!client) {
            return res.status(404).json({ error: 'Client non trouvé' });
        }

        await deleteClient(req.params.id);
        logger.info(`Client supprimé: ${client.name}`, { clientId: req.params.id });
        res.json({ message: 'Client supprimé avec succès' });
    } catch (error) {
        logger.error('Erreur API delete client:', error);
        res.status(500).json({ error: 'Erreur lors de la suppression du client' });
    }
});

// Routes Backups
router.get('/backups', async (req, res) => {
    try {
        const filters = {};
        
        if (req.query.client_name) filters.client_name = req.query.client_name;
        if (req.query.status) filters.status = req.query.status;
        if (req.query.type) filters.type = req.query.type;
        if (req.query.limit) filters.limit = parseInt(req.query.limit);
        if (req.query.since) filters.since = req.query.since;

        const backups = await getBackups(filters);
        res.json(backups);
    } catch (error) {
        logger.error('Erreur API get backups:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des backups' });
    }
});

router.get('/backups/stats', async (req, res) => {
    try {
        const stats = await getBackupStats();
        res.json(stats);
    } catch (error) {
        logger.error('Erreur API backup stats:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
    }
});

router.post('/backups/start', async (req, res) => {
    try {
        const { clients, type = 'full' } = req.body;
        
        logger.info('Démarrage backup manuel via API', { clients, type });
        
        const result = await backupScheduler.startManualBackup(clients, type);
        
        res.json({
            message: 'Backup manuel démarré',
            backupId: result.backupId,
            results: result.results
        });
    } catch (error) {
        logger.error('Erreur API start backup:', error);
        res.status(500).json({ error: error.message });
    }
});

// Routes Scheduler
router.get('/schedules', async (req, res) => {
    try {
        const schedules = await getSchedules();
        const status = backupScheduler.getScheduleStatus();
        
        res.json({
            schedules,
            status
        });
    } catch (error) {
        logger.error('Erreur API get schedules:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des planifications' });
    }
});

router.post('/schedules', async (req, res) => {
    try {
        const { name, cron_pattern, backup_type, client_names, description } = req.body;
        
        if (!name || !cron_pattern || !backup_type) {
            return res.status(400).json({ error: 'Champs obligatoires manquants' });
        }

        // Ajouter à la base de données
        const result = await addSchedule({
            name,
            cron_pattern,
            backup_type,
            client_names,
            description
        });

        // Ajouter au scheduler
        backupScheduler.addCustomSchedule(name, cron_pattern, backup_type, description, client_names);

        logger.info(`Planification ajoutée: ${name}`);
        res.status(201).json({ message: 'Planification ajoutée avec succès', id: result.id });
    } catch (error) {
        logger.error('Erreur API add schedule:', error);
        res.status(500).json({ error: 'Erreur lors de l\'ajout de la planification' });
    }
});

router.delete('/schedules/:name', async (req, res) => {
    try {
        const success = backupScheduler.removeSchedule(req.params.name);
        
        if (success) {
            logger.info(`Planification supprimée: ${req.params.name}`);
            res.json({ message: 'Planification supprimée avec succès' });
        } else {
            res.status(404).json({ error: 'Planification non trouvée' });
        }
    } catch (error) {
        logger.error('Erreur API delete schedule:', error);
        res.status(500).json({ error: 'Erreur lors de la suppression de la planification' });
    }
});

// Routes System Monitoring
router.get('/system/status', async (req, res) => {
    try {
        const status = await systemMonitor.getSystemStatus();
        res.json(status);
    } catch (error) {
        logger.error('Erreur API system status:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération du statut système' });
    }
});

router.get('/system/metrics/:metric', async (req, res) => {
    try {
        const { metric } = req.params;
        const hours = parseInt(req.query.hours) || 24;
        
        const metrics = await systemMonitor.getMetricsHistory(metric, hours);
        res.json(metrics);
    } catch (error) {
        logger.error(`Erreur API metrics ${req.params.metric}:`, error);
        res.status(500).json({ error: 'Erreur lors de la récupération des métriques' });
    }
});

router.post('/system/health-check', async (req, res) => {
    try {
        const health = await systemMonitor.performHealthCheck();
        res.json(health);
    } catch (error) {
        logger.error('Erreur API health check:', error);
        res.status(500).json({ error: 'Erreur lors du health check' });
    }
});

// Routes Logs
router.get('/logs', async (req, res) => {
    try {
        const options = {
            level: req.query.level || 'info',
            limit: parseInt(req.query.limit) || 100,
            clientName: req.query.client,
            since: req.query.since
        };

        const logs = await getRecentLogs(options);
        res.json(logs);
    } catch (error) {
        logger.error('Erreur API get logs:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des logs' });
    }
});

router.get('/logs/stats', async (req, res) => {
    try {
        const stats = await getLogStats();
        res.json(stats);
    } catch (error) {
        logger.error('Erreur API log stats:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des statistiques de logs' });
    }
});

// Routes pour logs spécifiques aux clients
router.get('/logs/clients', async (req, res) => {
    try {
        const clients = getClientsWithLogs();
        res.json(clients);
    } catch (error) {
        logger.error('Erreur API get clients with logs:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des clients avec logs' });
    }
});

router.get('/logs/clients/:clientName', async (req, res) => {
    try {
        const { clientName } = req.params;
        const options = {
            level: req.query.level || 'all',
            limit: parseInt(req.query.limit) || 100,
            since: req.query.since,
            logType: req.query.type || 'client'
        };

        const logs = await getClientLogs(clientName, options);
        res.json(logs);
    } catch (error) {
        logger.error(`Erreur API get client logs ${req.params.clientName}:`, error);
        res.status(500).json({ error: 'Erreur lors de la récupération des logs du client' });
    }
});

// Routes Activity
router.get('/activity', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const activities = await getActivityLogs(limit);
        res.json(activities);
    } catch (error) {
        logger.error('Erreur API get activity:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des activités' });
    }
});

// Routes Settings
router.get('/settings', async (req, res) => {
    try {
        const settings = {};
        const settingKeys = [
            'backup_retention_days',
            'max_parallel_backups',
            'notification_email',
            'smtp_enabled'
        ];

        for (const key of settingKeys) {
            settings[key] = await getSetting(key);
        }

        res.json(settings);
    } catch (error) {
        logger.error('Erreur API get settings:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des paramètres' });
    }
});

router.put('/settings', async (req, res) => {
    try {
        const updates = [];
        
        for (const [key, value] of Object.entries(req.body)) {
            await setSetting(key, value);
            updates.push(key);
        }

        logger.info(`Paramètres modifiés: ${updates.join(', ')}`);
        res.json({ message: 'Paramètres sauvegardés avec succès', updated: updates });
    } catch (error) {
        logger.error('Erreur API update settings:', error);
        res.status(500).json({ error: 'Erreur lors de la sauvegarde des paramètres' });
    }
});

// Routes Test et Diagnostic
router.post('/test/notification', async (req, res) => {
    try {
        const result = await testNotificationConfig();
        res.json(result);
    } catch (error) {
        logger.error('Erreur API test notification:', error);
        res.status(500).json({ error: 'Erreur lors du test de notification' });
    }
});

router.post('/test/client-connection', async (req, res) => {
    try {
        const { host, port = 22, username, password, os_type = 'windows' } = req.body;
        
        if (!host || !username || !password) {
            return res.status(400).json({ error: 'Paramètres de connexion manquants' });
        }

        // Choisir le bon client selon le type d'OS
        const WindowsBackupClient = require('../backup/windowsBackup');
        const LinuxBackupClient = require('../backup/linuxBackup');
        
        const BackupClientClass = os_type === 'linux' ? LinuxBackupClient : WindowsBackupClient;
        const testClient = new BackupClientClass({
            name: 'test',
            host,
            port,
            username,
            password
        });

        await testClient.connect();
        const systemInfo = await testClient.getSystemInfo();
        await testClient.disconnect();

        res.json({ 
            success: true, 
            message: 'Connexion réussie',
            systemInfo,
            os_type 
        });
    } catch (error) {
        logger.error('Erreur test connexion client:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Routes Network Statistics
router.get('/network/stats', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const stats = await getNetworkStats(limit);
        res.json(stats);
    } catch (error) {
        logger.error('Erreur API network stats:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des statistiques réseau' });
    }
});

router.get('/network/stats/:clientName', async (req, res) => {
    try {
        const { clientName } = req.params;
        const limit = parseInt(req.query.limit) || 10;
        const stats = await getNetworkStatsByClient(clientName, limit);
        res.json(stats);
    } catch (error) {
        logger.error(`Erreur API network stats for ${req.params.clientName}:`, error);
        res.status(500).json({ error: 'Erreur lors de la récupération des statistiques réseau du client' });
    }
});

// Routes d'information système
router.get('/info', (req, res) => {
    res.json({
        name: 'EFC Backup System API',
        version: '1.1.0',
        author: 'EFC Informatique',
        website: 'https://efcinfo.com',
        node: process.version,
        uptime: Math.floor(process.uptime()),
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
    });
});

// Middleware de gestion d'erreurs
router.use((error, req, res, next) => {
    logger.error('Erreur API non gérée:', error);
    res.status(500).json({ 
        error: 'Erreur interne du serveur',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;