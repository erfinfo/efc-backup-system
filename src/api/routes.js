const express = require('express');
const router = express.Router();
const { logger, getRecentLogs, getClientLogs, getClientsWithLogs, getLogStats } = require('../utils/logger');
const { 
    addClient, 
    getClients, 
    getClient,
    getClientByName, 
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
    getNetworkStatsByClient,
    db
} = require('../utils/database');
const backupScheduler = require('../backup/scheduler');
const systemMonitor = require('../monitor/systemMonitor');
const { testNotificationConfig } = require('../utils/notification');
const AuthMiddleware = require('../middleware/auth');
const i18n = require('../utils/i18n-server');

// Middleware pour les logs d'API et sécurité
router.use(AuthMiddleware.securityLogger);
router.use(i18n.middleware());
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
            ip: req.ip,
            user: req.user ? req.user.username : 'anonymous'
        });
    });
    
    next();
});

// Route publique pour la version
router.get('/version', (req, res) => {
    res.json({
        version: process.env.VERSION || '1.0.0',
        name: 'EFC Backup System',
        node_version: process.version,
        uptime: process.uptime()
    });
});

// Routes Dashboard (authentification requise)
router.get('/dashboard', AuthMiddleware.authenticateToken, async (req, res) => {
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
                diskUsage: systemStatus.disk.backup ? systemStatus.disk.backup.usagePercent : 0,
                diskInfo: systemStatus.disk.backup || null,
                backupStorageMB: backupStats.totalSizeMB
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

// Routes Clients (avec restrictions d'accès)
router.get('/clients', AuthMiddleware.filterClientData, async (req, res) => {
    try {
        let clients;
        
        // Utiliser les permissions pour filtrer les clients
        if (req.dataFilter.canViewAll) {
            clients = await getClients();
        } else {
            // Filtrer par clients autorisés
            clients = await getClients({ names: req.dataFilter.allowedClients });
        }
        
        res.json(clients);
    } catch (error) {
        logger.error('Erreur API get clients:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des clients' });
    }
});

router.post('/clients', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const { name, host, port, username, password, folders, backup_type, os_type } = req.body;
        
        if (!name || !host || !username || !password) {
            return res.status(400).json({ error: req.t('errors.required_field') });
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
        res.status(201).json({ message: req.t('success_message'), id: result.id });
    } catch (error) {
        if (error.message.includes('UNIQUE constraint')) {
            res.status(409).json({ error: 'Un client avec ce nom existe déjà' });
        } else {
            logger.error('Erreur API add client:', error);
            res.status(500).json({ error: 'Erreur lors de l\'ajout du client' });
        }
    }
});

router.get('/clients/:id', AuthMiddleware.requireClientAccess, async (req, res) => {
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

router.put('/clients/:id', AuthMiddleware.requireAdmin, async (req, res) => {
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

router.delete('/clients/:id', AuthMiddleware.requireAdmin, async (req, res) => {
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
router.get('/backups', AuthMiddleware.filterClientData, async (req, res) => {
    try {
        const filters = {};
        
        // Appliquer les restrictions de permissions
        if (!req.dataFilter.canViewAll && req.dataFilter.allowedClients.length > 0) {
            // Pour les clients avec restrictions, ne montrer que leurs backups
            if (req.dataFilter.allowedClients.length === 1) {
                filters.client_name = req.dataFilter.allowedClients[0];
            }
        } else if (req.query.client_name) {
            filters.client_name = req.query.client_name;
        }
        
        if (req.query.status) filters.status = req.query.status;
        if (req.query.type) filters.type = req.query.type;
        if (req.query.limit) filters.limit = parseInt(req.query.limit);
        if (req.query.since) filters.since = req.query.since;

        let backups = await getBackups(filters);
        
        // Filtrage supplémentaire pour les clients avec plusieurs clients autorisés
        if (!req.dataFilter.canViewAll) {
            backups = backups.filter(backup => 
                req.dataFilter.allowedClients.includes(backup.client_name)
            );
        }
        
        res.json(backups);
    } catch (error) {
        logger.error('Erreur API get backups:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des backups' });
    }
});

router.get('/backups/stats', AuthMiddleware.authenticateToken, async (req, res) => {
    try {
        const stats = await getBackupStats();
        res.json(stats);
    } catch (error) {
        logger.error('Erreur API backup stats:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
    }
});

router.post('/backups/start', AuthMiddleware.requireAdmin, async (req, res) => {
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
router.get('/schedules', AuthMiddleware.requireAdmin, async (req, res) => {
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

router.post('/schedules', AuthMiddleware.requireAdmin, async (req, res) => {
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

        // Ajouter au scheduler (avec l'ID utilisateur si disponible)
        const userId = req.user ? req.user.id : null;
        await backupScheduler.addCustomSchedule(name, cron_pattern, backup_type, description, client_names, userId);

        logger.info(`Planification ajoutée: ${name}`);
        res.status(201).json({ message: 'Planification ajoutée avec succès', id: result.id });
    } catch (error) {
        logger.error('Erreur API add schedule:', error);
        res.status(500).json({ error: 'Erreur lors de l\'ajout de la planification' });
    }
});

router.delete('/schedules/:name', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const success = await backupScheduler.removeSchedule(req.params.name);
        
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
router.get('/system/status', AuthMiddleware.authenticateToken, async (req, res) => {
    try {
        const status = await systemMonitor.getSystemStatus();
        res.json(status);
    } catch (error) {
        logger.error('Erreur API system status:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération du statut système' });
    }
});

router.get('/system/metrics/:metric', AuthMiddleware.authenticateToken, async (req, res) => {
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

router.post('/system/health-check', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const health = await systemMonitor.performHealthCheck();
        res.json(health);
    } catch (error) {
        logger.error('Erreur API health check:', error);
        res.status(500).json({ error: 'Erreur lors du health check' });
    }
});

// Routes Logs
router.get('/logs', AuthMiddleware.requireClientAccess, async (req, res) => {
    try {
        const options = {
            level: req.query.level || 'info',
            limit: parseInt(req.query.limit) || 100,
            clientName: req.user.role === 'client' ? req.user.clientName : req.query.client,
            since: req.query.since
        };

        const logs = await getRecentLogs(options);
        res.json(logs);
    } catch (error) {
        logger.error('Erreur API get logs:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des logs' });
    }
});

router.get('/logs/stats', AuthMiddleware.authenticateToken, async (req, res) => {
    try {
        const stats = await getLogStats();
        res.json(stats);
    } catch (error) {
        logger.error('Erreur API log stats:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des statistiques de logs' });
    }
});

// Routes pour logs spécifiques aux clients
router.get('/logs/clients', AuthMiddleware.authenticateToken, async (req, res) => {
    try {
        // Récupérer tous les clients de la base de données
        const allClients = await getClients();
        const clientNames = allClients.map(client => client.name);
        
        // Optionnellement, on pourrait marquer lesquels ont des logs existants
        // const clientsWithLogs = getClientsWithLogs();
        // const clientList = clientNames.map(name => ({
        //     name: name,
        //     hasLogs: clientsWithLogs.includes(name)
        // }));
        
        res.json(clientNames);
    } catch (error) {
        logger.error('Erreur API get clients with logs:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des clients avec logs' });
    }
});

router.get('/logs/clients/:clientName', AuthMiddleware.requireClientAccess, async (req, res) => {
    try {
        const { clientName } = req.params;
        const options = {
            level: req.query.level || 'all',
            limit: parseInt(req.query.limit) || 100,
            since: req.query.since,
            logType: req.query.type || 'client'
        };

        // Vérifier que le client existe dans la base de données
        const client = await getClientByName(clientName);
        if (!client) {
            return res.status(404).json({ error: 'Client non trouvé' });
        }

        const logs = await getClientLogs(clientName, options);
        
        // Si aucun log n'existe pour ce client, retourner un message informatif
        if (logs.length === 0) {
            const noLogsMessage = {
                timestamp: new Date().toISOString(),
                level: 'info',
                message: `Aucun log disponible pour le client ${clientName}. Les logs apparaîtront lors de la première activité (connexion, backup, etc.)`,
                clientName: clientName,
                backupId: null,
                logType: options.logType
            };
            res.json([noLogsMessage]);
        } else {
            res.json(logs);
        }
    } catch (error) {
        logger.error(`Erreur API get client logs ${req.params.clientName}:`, error);
        res.status(500).json({ error: 'Erreur lors de la récupération des logs du client' });
    }
});

// Routes Activity
router.get('/activity', AuthMiddleware.authenticateToken, async (req, res) => {
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
router.get('/settings', AuthMiddleware.requireAdmin, async (req, res) => {
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

router.put('/settings', AuthMiddleware.requireAdmin, async (req, res) => {
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
router.post('/test/notification', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const result = await testNotificationConfig();
        res.json(result);
    } catch (error) {
        logger.error('Erreur API test notification:', error);
        res.status(500).json({ error: 'Erreur lors du test de notification' });
    }
});

router.post('/test/client-connection', AuthMiddleware.requireAdmin, async (req, res) => {
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
router.get('/network/stats', AuthMiddleware.requireClientAccess, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        let stats;
        
        // Client ne peut voir que ses propres stats
        if (req.user.role === 'client') {
            stats = await getNetworkStatsByClient(req.user.clientName, limit);
        } else {
            stats = await getNetworkStats(limit);
        }
        
        res.json(stats);
    } catch (error) {
        logger.error('Erreur API network stats:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des statistiques réseau' });
    }
});

router.get('/network/stats/:clientName', AuthMiddleware.requireClientAccess, async (req, res) => {
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
        version: process.env.VERSION || '1.5.0',
        author: 'EFC Informatique',
        website: 'https://efcinfo.com',
        node: process.version,
        uptime: Math.floor(process.uptime()),
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
    });
});

// Routes de maintenance
router.post('/system/cleanup', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        logger.info('Lancement du nettoyage système via API');
        
        // Exécuter le script de nettoyage
        const { spawn } = require('child_process');
        const cleanupProcess = spawn('node', ['scripts/cleanup.js'], {
            cwd: process.cwd()
        });
        
        let output = '';
        let errorOutput = '';
        
        cleanupProcess.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        cleanupProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        
        cleanupProcess.on('close', (code) => {
            if (code === 0) {
                // Parse la sortie pour extraire les statistiques
                const stats = {
                    backupsDeleted: 0,
                    logsDeleted: 0,
                    spaceFreed: '0 MB'
                };
                
                // Extraction basique des statistiques depuis la sortie
                const backupsMatch = output.match(/(\d+) backups supprimés/);
                const logsMatch = output.match(/(\d+) fichiers de log supprimés/);
                const spaceMatch = output.match(/Espace libéré: ([0-9.]+ [A-Z]{1,2})/);
                
                if (backupsMatch) stats.backupsDeleted = parseInt(backupsMatch[1]);
                if (logsMatch) stats.logsDeleted = parseInt(logsMatch[1]);
                if (spaceMatch) stats.spaceFreed = spaceMatch[1];
                
                res.json({
                    success: true,
                    message: 'Nettoyage terminé avec succès',
                    ...stats,
                    output: output
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: 'Erreur lors du nettoyage',
                    output: errorOutput || output
                });
            }
        });
        
    } catch (error) {
        logger.error('Erreur API cleanup:', error);
        res.status(500).json({ error: 'Erreur lors du lancement du nettoyage' });
    }
});

router.post('/test-connections', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        logger.info('Test de connexions via API');
        
        const clients = await getClients({ active: true });
        const results = [];
        
        for (const client of clients) {
            const startTime = Date.now();
            
            try {
                // Utiliser le système de test de connexion existant
                const response = await fetch(`${req.protocol}://${req.get('host')}/api/test-client`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        host: client.host,
                        port: client.port || 22,
                        username: client.username,
                        password: client.password
                    })
                });
                
                const testResult = await response.json();
                const duration = Date.now() - startTime;
                
                results.push({
                    client: client.name,
                    host: client.host,
                    success: testResult.success,
                    duration: duration,
                    error: testResult.success ? null : (testResult.error || 'Connexion échouée')
                });
                
            } catch (error) {
                const duration = Date.now() - startTime;
                results.push({
                    client: client.name,
                    host: client.host,
                    success: false,
                    duration: duration,
                    error: error.message
                });
            }
        }
        
        res.json({
            success: true,
            results: results,
            summary: {
                total: results.length,
                successful: results.filter(r => r.success).length,
                failed: results.filter(r => !r.success).length
            }
        });
        
    } catch (error) {
        logger.error('Erreur API test-connections:', error);
        res.status(500).json({ error: 'Erreur lors du test des connexions' });
    }
});

router.post('/system/test-error-handling', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        logger.info('Lancement des tests de gestion d\'erreur via API');
        
        // Exécuter le script de test
        const { spawn } = require('child_process');
        const testProcess = spawn('node', ['scripts/test-error-handling.js'], {
            cwd: process.cwd()
        });
        
        let output = '';
        let errorOutput = '';
        
        testProcess.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        testProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        
        testProcess.on('close', (code) => {
            // Parse la sortie pour extraire les résultats
            const results = [];
            
            // Extraction basique des résultats de test depuis la sortie
            const testLines = output.split('\n').filter(line => line.includes('✅') || line.includes('❌'));
            
            for (const line of testLines) {
                const success = line.includes('✅');
                const testName = line.replace(/[✅❌]/g, '').split(':')[0].trim();
                const message = line.split(':')[1]?.trim() || '';
                
                results.push({
                    name: testName,
                    success: success,
                    message: message
                });
            }
            
            res.json({
                success: code === 0,
                results: results,
                output: output,
                errorOutput: errorOutput
            });
        });
        
    } catch (error) {
        logger.error('Erreur API test-error-handling:', error);
        res.status(500).json({ error: 'Erreur lors du lancement des tests' });
    }
});

router.get('/system/cleanup-estimate', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        // Estimer l'espace libérable sans effectuer le nettoyage
        const retentionDays = parseInt(process.env.RETENTION_DAYS || '30');
        const logRetentionDays = parseInt(process.env.LOG_RETENTION_DAYS || '90');
        
        let estimatedSpace = 0;
        
        // Estimer les backups anciens (implémentation basique)
        const backupPath = process.env.BACKUP_PATH || '/backups';
        try {
            const backups = await getBackups();
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
            
            const oldBackups = backups.filter(b => new Date(b.created_at) < cutoffDate);
            
            // Estimation approximative : 100MB par backup ancien
            estimatedSpace += oldBackups.length * 100;
            
        } catch (error) {
            logger.warn('Erreur estimation backups:', error);
        }
        
        // Estimation finale
        const formattedSpace = estimatedSpace > 1024 ? 
            `${(estimatedSpace / 1024).toFixed(1)} GB` : 
            `${estimatedSpace} MB`;
            
        res.json({
            estimatedSpace: formattedSpace,
            details: {
                retentionDays,
                logRetentionDays,
                estimatedSpaceMB: estimatedSpace
            }
        });
        
    } catch (error) {
        logger.error('Erreur API cleanup-estimate:', error);
        res.status(500).json({ error: 'Erreur lors de l\'estimation' });
    }
});

// Route pour récupérer les permissions de l'utilisateur connecté
router.get('/user/permissions', AuthMiddleware.authenticateToken, async (req, res) => {
    try {
        const { permissionManager } = require('../utils/permissions');
        
        // Récupérer les permissions de l'utilisateur
        const permissions = await permissionManager.getUserPermissions(req.user.id);
        const clientPermissions = await permissionManager.getClientPermissions(req.user.id);
        
        res.json({
            success: true,
            data: {
                role: req.user.role,
                permissions: permissions,
                clientAccess: clientPermissions,
                userId: req.user.id,
                username: req.user.username
            }
        });
        
    } catch (error) {
        logger.error('Erreur récupération permissions:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération des permissions' });
    }
});

// Route pour récupérer l'état des backups en cours
router.get('/backups/status', AuthMiddleware.authenticateToken, async (req, res) => {
    try {
        const backupScheduler = require('../backup/scheduler');
        const { permissionManager } = require('../utils/permissions');
        
        // Vérifier les permissions
        const hasPermission = await permissionManager.hasPermission(req.user.id, 'backups_view');
        if (!hasPermission) {
            return res.status(403).json({ error: 'Permission insuffisante' });
        }
        
        // Récupérer les informations sur les backups en cours
        const runningBackups = backupScheduler.getRunningBackups();
        const clientPermissions = await permissionManager.getClientPermissions(req.user.id);
        
        // Filtrer selon les permissions utilisateur
        let filteredBackups = runningBackups;
        if (req.user.role !== 'admin' && !clientPermissions.canViewAll) {
            filteredBackups = runningBackups.filter(backup => 
                clientPermissions.allowedClients.includes(backup.clientName)
            );
        }
        
        // Désactiver le cache pour les données en temps réel
        res.set({
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        
        res.json({
            success: true,
            data: {
                runningBackups: filteredBackups,
                totalRunning: filteredBackups.length
            }
        });
        
    } catch (error) {
        logger.error('Erreur récupération état backups:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération de l\'état des backups' });
    }
});

// Route pour démarrer un backup manuel
router.post('/backups/start/:clientId', AuthMiddleware.authenticateToken, async (req, res) => {
    try {
        const { permissionManager } = require('../utils/permissions');
        const clientId = parseInt(req.params.clientId);
        
        // Vérifier les permissions de création de backup
        const hasPermission = await permissionManager.hasPermission(req.user.id, 'backups_create');
        if (!hasPermission) {
            return res.status(403).json({ error: 'Permission insuffisante pour créer un backup' });
        }
        
        // Récupérer le client
        const client = await getClient(clientId);
        if (!client) {
            return res.status(404).json({ error: 'Client non trouvé' });
        }
        
        // Vérifier les permissions client
        const clientPermissions = await permissionManager.getClientPermissions(req.user.id);
        if (req.user.role !== 'admin' && !clientPermissions.canViewAll) {
            if (!clientPermissions.allowedClients.includes(client.name)) {
                return res.status(403).json({ error: 'Accès non autorisé à ce client' });
            }
        }
        
        // Démarrer le backup manuel
        const backupScheduler = require('../backup/scheduler');
        const backupId = await backupScheduler.startManualBackupForClient(clientId, {
            type: req.body.type || 'full',
            createImage: req.body.createImage || false,
            triggered_by: req.user.username
        });
        
        logger.info(`Backup manuel démarré par ${req.user.username}`, {
            clientId,
            clientName: client.name,
            backupId,
            userId: req.user.id
        });
        
        res.json({
            success: true,
            data: {
                backupId,
                clientName: client.name,
                status: 'started',
                message: 'Backup manuel démarré avec succès'
            }
        });
        
    } catch (error) {
        logger.error('Erreur démarrage backup manuel:', error);
        res.status(500).json({ error: 'Erreur lors du démarrage du backup manuel' });
    }
});

// Route pour télécharger un backup
router.get('/backups/download/:backupId', AuthMiddleware.authenticateToken, async (req, res) => {
    try {
        const { permissionManager } = require('../utils/permissions');
        const backupId = req.params.backupId;
        
        // Vérifier les permissions de téléchargement de backup
        logger.info(`Vérification permission backups_view pour utilisateur ${req.user.id} (${req.user.username}) - rôle: ${req.user.role}`);
        const hasPermission = await permissionManager.hasPermission(req.user.id, 'backups_view');
        logger.info(`Permission backups_view: ${hasPermission}`);
        if (!hasPermission) {
            logger.warn(`Accès refusé - permission backups_view manquante pour ${req.user.username} (rôle: ${req.user.role})`);
            return res.status(403).json({ error: 'Permission insuffisante pour télécharger un backup' });
        }
        
        // Récupérer les informations du backup
        const backup = await db.get('SELECT * FROM backups WHERE backup_id = ?', [backupId]);
        if (!backup) {
            logger.warn(`Backup non trouvé: ${backupId}`);
            return res.status(404).json({ error: 'Backup non trouvé' });
        }
        
        logger.info(`Backup trouvé: ${backup.client_name}, status: ${backup.status}`);
        
        // Vérifier les permissions client
        const clientPermissions = await permissionManager.getClientPermissions(req.user.id);
        logger.info(`Permissions client pour ${req.user.username}:`, clientPermissions);
        
        if (req.user.role !== 'admin' && !clientPermissions.canViewAll) {
            logger.info(`Vérification accès client: backup.client_name=${backup.client_name}, allowedClients=${JSON.stringify(clientPermissions.allowedClients)}`);
            if (!clientPermissions.allowedClients.includes(backup.client_name)) {
                logger.warn(`Accès refusé - client ${backup.client_name} non autorisé pour ${req.user.username}`);
                return res.status(403).json({ error: 'Accès non autorisé à ce backup' });
            }
        }
        
        // Vérifier que le backup est terminé avec succès
        if (backup.status !== 'completed') {
            return res.status(400).json({ error: 'Le backup n\'est pas disponible pour téléchargement' });
        }
        
        // Vérifier que le fichier existe
        const fs = require('fs');
        const path = require('path');
        
        let filePath = backup.path;
        if (!filePath) {
            return res.status(404).json({ error: 'Chemin du fichier backup non trouvé' });
        }
        
        // Si le chemin n'est pas absolu, l'ajouter au dossier de backup par défaut
        if (!path.isAbsolute(filePath)) {
            const backupDir = process.env.BACKUP_PATH || '/tmp';
            filePath = path.join(backupDir, filePath);
        }
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Fichier backup non trouvé sur le disque' });
        }
        
        // Obtenir les informations du fichier
        const stats = fs.statSync(filePath);
        const fileName = path.basename(filePath);
        
        logger.info(`Téléchargement backup ${backupId} par ${req.user.username}`, {
            backupId,
            clientName: backup.client_name,
            fileName,
            filePath,
            fileSize: stats.size,
            userId: req.user.id
        });
        
        // Définir les headers pour le téléchargement
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', stats.size);
        
        // Créer un stream de lecture et l'envoyer
        const readStream = fs.createReadStream(filePath);
        readStream.pipe(res);
        
        readStream.on('error', (error) => {
            logger.error('Erreur lecture fichier backup:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Erreur lors de la lecture du fichier' });
            }
        });
        
    } catch (error) {
        logger.error('Erreur téléchargement backup:', error);
        res.status(500).json({ error: 'Erreur lors du téléchargement du backup' });
    }
});

// Fonction pour effectuer la restauration d'un backup
async function performRestore(backup, destinationDir, verifyRestore) {
    const fs = require('fs');
    const path = require('path');
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    const result = {
        success: false,
        extractedFiles: [],
        errors: [],
        verification: null,
        stats: {
            startTime: new Date().toISOString(),
            endTime: null,
            duration: null,
            filesExtracted: 0,
            totalSize: 0
        }
    };
    
    try {
        logger.info(`Début restauration: ${backup.backup_id} vers ${destinationDir}`);
        
        // Déterminer le type de backup (tar.gz pour Linux)
        const backupPath = backup.path;
        const isLinuxBackup = backup.client_name.includes('Linux') || backupPath.endsWith('.tar.gz');
        
        if (isLinuxBackup) {
            // Restauration Linux avec tar
            const tarCommand = `tar -xzf "${backupPath}" -C "${destinationDir}" --verbose`;
            logger.info(`Exécution commande: ${tarCommand}`);
            
            const { stdout, stderr } = await execAsync(tarCommand);
            
            if (stderr && !stderr.includes('Removing leading')) {
                result.errors.push(`Avertissements tar: ${stderr}`);
                logger.warn(`Avertissements lors de l'extraction:`, stderr);
            }
            
            // Parser la sortie pour compter les fichiers extraits
            if (stdout) {
                const extractedLines = stdout.split('\n').filter(line => line.trim() && !line.includes('Removing leading'));
                result.extractedFiles = extractedLines.map(line => line.trim());
                result.stats.filesExtracted = extractedLines.length;
                logger.info(`${result.stats.filesExtracted} fichiers extraits`);
            }
            
        } else {
            // Pour les backups Windows, implémenter l'extraction ZIP si nécessaire
            throw new Error('Type de backup non supporté pour la restauration automatique');
        }
        
        result.stats.endTime = new Date().toISOString();
        result.stats.duration = new Date(result.stats.endTime) - new Date(result.stats.startTime);
        result.success = true;
        
        // Vérification optionnelle des fichiers restaurés
        if (verifyRestore && result.success) {
            logger.info('Vérification des fichiers restaurés...');
            result.verification = await verifyRestoredFiles(destinationDir, result.extractedFiles);
        }
        
        logger.info(`Restauration terminée avec succès: ${result.stats.filesExtracted} fichiers en ${result.stats.duration}ms`);
        
    } catch (error) {
        result.success = false;
        result.errors.push(`Erreur lors de l'extraction: ${error.message}`);
        result.stats.endTime = new Date().toISOString();
        result.stats.duration = new Date(result.stats.endTime) - new Date(result.stats.startTime);
        logger.error('Erreur lors de la restauration:', error);
    }
    
    return result;
}

// Fonction pour vérifier que les fichiers ont bien été restaurés
async function verifyRestoredFiles(destinationDir, extractedFilesList) {
    const fs = require('fs');
    const path = require('path');
    
    const verification = {
        totalFiles: extractedFilesList.length,
        verifiedFiles: 0,
        missingFiles: [],
        corruptedFiles: [],
        totalSize: 0,
        success: false
    };
    
    try {
        logger.info(`Vérification de ${verification.totalFiles} fichiers dans ${destinationDir}`);
        
        for (const relativePath of extractedFilesList) {
            const fullPath = path.join(destinationDir, relativePath);
            
            try {
                if (fs.existsSync(fullPath)) {
                    const stats = fs.statSync(fullPath);
                    if (stats.isFile()) {
                        verification.totalSize += stats.size;
                    }
                    verification.verifiedFiles++;
                } else {
                    verification.missingFiles.push(relativePath);
                    logger.warn(`Fichier manquant après restauration: ${relativePath}`);
                }
            } catch (error) {
                verification.corruptedFiles.push(relativePath);
                logger.warn(`Erreur accès fichier: ${relativePath} - ${error.message}`);
            }
        }
        
        verification.success = verification.missingFiles.length === 0 && verification.corruptedFiles.length === 0;
        
        logger.info(`Vérification terminée: ${verification.verifiedFiles}/${verification.totalFiles} fichiers OK, ${verification.missingFiles.length} manquants, ${verification.corruptedFiles.length} corrompus`);
        
    } catch (error) {
        verification.success = false;
        logger.error('Erreur lors de la vérification:', error);
    }
    
    return verification;
}

// Route pour restaurer un backup
router.post('/backups/restore/:backupId', AuthMiddleware.authenticateToken, async (req, res) => {
    try {
        const { permissionManager } = require('../utils/permissions');
        const backupId = req.params.backupId;
        const { destinationPath, verifyRestore = true } = req.body;
        
        // Vérifier les permissions de restauration
        logger.info(`Vérification permission backups_restore pour utilisateur ${req.user.id} (${req.user.username}) - rôle: ${req.user.role}`);
        const hasPermission = await permissionManager.hasPermission(req.user.id, 'backups_restore');
        logger.info(`Permission backups_restore: ${hasPermission}`);
        if (!hasPermission) {
            logger.warn(`Accès refusé - permission backups_restore manquante pour ${req.user.username} (rôle: ${req.user.role})`);
            return res.status(403).json({ error: 'Permission insuffisante pour restaurer un backup' });
        }
        
        // Récupérer les informations du backup
        const backup = await db.get('SELECT * FROM backups WHERE backup_id = ?', [backupId]);
        if (!backup) {
            logger.warn(`Backup non trouvé: ${backupId}`);
            return res.status(404).json({ error: 'Backup non trouvé' });
        }
        
        logger.info(`Backup trouvé pour restauration: ${backup.client_name}, status: ${backup.status}`);
        
        // Vérifier les permissions client
        const clientPermissions = await permissionManager.getClientPermissions(req.user.id);
        logger.info(`Permissions client pour ${req.user.username}:`, clientPermissions);
        
        if (req.user.role !== 'admin' && !clientPermissions.canViewAll) {
            if (!clientPermissions.allowedClients.includes(backup.client_name)) {
                logger.warn(`Accès refusé - client ${backup.client_name} non autorisé pour ${req.user.username}`);
                return res.status(403).json({ error: 'Accès non autorisé à ce backup' });
            }
        }
        
        // Vérifier que le backup est terminé avec succès
        if (backup.status !== 'completed') {
            return res.status(400).json({ error: 'Le backup n\'est pas disponible pour restauration' });
        }
        
        // Vérifier que le fichier existe
        const fs = require('fs');
        const path = require('path');
        
        let filePath = backup.path;
        if (!filePath) {
            return res.status(404).json({ error: 'Chemin du fichier backup non trouvé' });
        }
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Fichier backup non trouvé sur le disque' });
        }
        
        // Valider le chemin de destination
        if (!destinationPath) {
            return res.status(400).json({ error: 'Chemin de destination requis' });
        }
        
        // Créer le dossier de destination s'il n'existe pas
        const destinationDir = path.resolve(destinationPath);
        if (!fs.existsSync(destinationDir)) {
            fs.mkdirSync(destinationDir, { recursive: true });
        }
        
        // Effectuer la restauration
        const restoreResult = await performRestore(backup, destinationDir, verifyRestore);
        
        logger.info(`Restauration effectuée: ${backupId} vers ${destinationDir} par ${req.user.username}`);
        
        res.json({
            backup_id: backupId,
            destination: destinationDir,
            restore_result: restoreResult,
            restored_at: new Date().toISOString(),
            restored_by: req.user.username
        });
        
    } catch (error) {
        logger.error('Erreur restauration backup:', error);
        res.status(500).json({ error: 'Erreur lors de la restauration du backup' });
    }
});

// ========================================
// ROUTES NOTIFICATIONS EMAIL
// ========================================

// Récupérer la configuration des notifications
router.get('/notifications/config', AuthMiddleware.authenticateToken, async (req, res) => {
    try {
        const { notificationService } = require('../utils/notification');
        const stats = await notificationService.getNotificationStats();
        
        const config = {
            smtp_enabled: process.env.SMTP_ENABLED === 'true',
            smtp_configured: stats.configured,
            smtp_host: process.env.SMTP_HOST,
            smtp_port: process.env.SMTP_PORT,
            smtp_user: process.env.SMTP_USER,
            smtp_pass: process.env.SMTP_PASS ? '••••••••' : '',
            smtp_secure: process.env.SMTP_SECURE === 'true',
            notification_email: process.env.NOTIFICATION_EMAIL,
            send_success_notifications: process.env.SEND_SUCCESS_NOTIFICATIONS === 'true',
            send_failure_notifications: process.env.SEND_FAILURE_NOTIFICATIONS !== 'false',
            send_start_notifications: process.env.SEND_START_NOTIFICATIONS === 'true',
            send_system_notifications: process.env.SEND_SYSTEM_NOTIFICATIONS === 'true',
            send_startup_notifications: process.env.SEND_STARTUP_NOTIFICATIONS === 'true',
            stats: {
                emails_sent_24h: 0, // TODO: implémenter le comptage depuis les logs
                last_notification_date: '-',
                last_notification_type: '-'
            }
        };
        
        res.json(config);
    } catch (error) {
        logger.error('Erreur récupération config notifications:', error);
        res.status(500).json({ error: 'Erreur lors de la récupération de la configuration' });
    }
});

// Sauvegarder la configuration des notifications
router.post('/notifications/config', AuthMiddleware.authenticateToken, async (req, res) => {
    try {
        const {
            smtp_enabled, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure,
            notification_email, send_success_notifications, send_failure_notifications,
            send_start_notifications, send_system_notifications, send_startup_notifications
        } = req.body;
        
        // Validation basique
        if (smtp_enabled && (!smtp_host || !smtp_user || !smtp_pass || !notification_email)) {
            return res.status(400).json({ 
                error: 'Configuration SMTP incomplète. Veuillez remplir tous les champs obligatoires.' 
            });
        }
        
        // Sauvegarder les variables d'environnement (en production, utiliser une base de données ou fichier sécurisé)
        const fs = require('fs').promises;
        const path = require('path');
        const envPath = path.join(__dirname, '../../.env');
        
        let envContent = await fs.readFile(envPath, 'utf8');
        
        // Fonction helper pour mettre à jour une variable d'environnement
        const updateEnvVar = (content, key, value) => {
            const regex = new RegExp(`^${key}=.*$`, 'm');
            const line = `${key}=${value}`;
            return regex.test(content) ? content.replace(regex, line) : content + `\n${line}`;
        };
        
        envContent = updateEnvVar(envContent, 'SMTP_ENABLED', smtp_enabled);
        envContent = updateEnvVar(envContent, 'SMTP_HOST', smtp_host || '');
        envContent = updateEnvVar(envContent, 'SMTP_PORT', smtp_port || '587');
        envContent = updateEnvVar(envContent, 'SMTP_USER', smtp_user || '');
        if (smtp_pass && smtp_pass !== '••••••••') {
            envContent = updateEnvVar(envContent, 'SMTP_PASS', smtp_pass);
        }
        envContent = updateEnvVar(envContent, 'SMTP_SECURE', smtp_secure || false);
        envContent = updateEnvVar(envContent, 'NOTIFICATION_EMAIL', notification_email || '');
        envContent = updateEnvVar(envContent, 'SEND_SUCCESS_NOTIFICATIONS', send_success_notifications || false);
        envContent = updateEnvVar(envContent, 'SEND_FAILURE_NOTIFICATIONS', send_failure_notifications !== false);
        envContent = updateEnvVar(envContent, 'SEND_START_NOTIFICATIONS', send_start_notifications || false);
        envContent = updateEnvVar(envContent, 'SEND_SYSTEM_NOTIFICATIONS', send_system_notifications || false);
        envContent = updateEnvVar(envContent, 'SEND_STARTUP_NOTIFICATIONS', send_startup_notifications || false);
        
        await fs.writeFile(envPath, envContent);
        
        // Recharger les variables d'environnement
        require('dotenv').config({ override: true });
        
        // Réinitialiser le service de notification
        const { notificationService } = require('../utils/notification');
        notificationService.init();
        
        logger.info(`Configuration notifications mise à jour par ${req.user.username}`);
        res.json({ success: true, message: 'Configuration sauvegardée avec succès' });
        
    } catch (error) {
        logger.error('Erreur sauvegarde config notifications:', error);
        res.status(500).json({ error: 'Erreur lors de la sauvegarde de la configuration' });
    }
});

// Tester la configuration SMTP
router.post('/notifications/test-smtp', AuthMiddleware.authenticateToken, async (req, res) => {
    try {
        const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure, notification_email } = req.body;
        
        if (!smtp_host || !smtp_user || !smtp_pass || !notification_email) {
            return res.status(400).json({ error: 'Paramètres SMTP manquants' });
        }
        
        // Créer un transporteur temporaire pour le test
        const nodemailer = require('nodemailer');
        const testTransporter = nodemailer.createTransport({
            host: smtp_host,
            port: parseInt(smtp_port),
            secure: smtp_secure,
            auth: {
                user: smtp_user,
                pass: smtp_pass
            },
            tls: {
                rejectUnauthorized: false
            }
        });
        
        // Tester la connexion
        await testTransporter.verify();
        
        // Envoyer un email de test
        await testTransporter.sendMail({
            from: `"EFC Backup System" <${notification_email}>`,
            to: notification_email,
            subject: '[EFC Backup] Test de configuration SMTP',
            text: `Test de configuration SMTP réussi !

Ce message confirme que la configuration SMTP est correcte et fonctionnelle.

Serveur: ${smtp_host}:${smtp_port}
Utilisateur: ${smtp_user}
Sécurité: ${smtp_secure ? 'SSL/TLS' : 'Non'}
Date: ${new Date().toLocaleString('fr-FR')}

EFC Backup System - Configuration validée avec succès.`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background: linear-gradient(135deg, #5d8052, #a8d49a); color: white; padding: 20px; text-align: center;">
                        <h1>✅ Test SMTP Réussi</h1>
                        <p>EFC Backup System</p>
                    </div>
                    <div style="padding: 20px; background: #f9f9f9;">
                        <p>Ce message confirme que la configuration SMTP est correcte et fonctionnelle.</p>
                        <ul>
                            <li><strong>Serveur:</strong> ${smtp_host}:${smtp_port}</li>
                            <li><strong>Utilisateur:</strong> ${smtp_user}</li>
                            <li><strong>Sécurité:</strong> ${smtp_secure ? 'SSL/TLS' : 'Non'}</li>
                            <li><strong>Date:</strong> ${new Date().toLocaleString('fr-FR')}</li>
                        </ul>
                        <p style="color: #5d8052; font-weight: bold;">Configuration validée avec succès !</p>
                    </div>
                </div>
            `
        });
        
        logger.info(`Test SMTP réussi par ${req.user.username} vers ${notification_email}`);
        res.json({ 
            success: true, 
            message: 'Test SMTP réussi, email envoyé avec succès' 
        });
        
    } catch (error) {
        logger.error('Erreur test SMTP:', error);
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Envoyer un email de test
router.post('/notifications/send-test', AuthMiddleware.authenticateToken, async (req, res) => {
    try {
        const { notificationService } = require('../utils/notification');
        const result = await notificationService.testConfiguration();
        
        if (result.success) {
            logger.info(`Email de test envoyé par ${req.user.username}`);
            res.json({ 
                success: true, 
                message: result.message || 'Email de test envoyé avec succès' 
            });
        } else {
            res.status(400).json({ 
                success: false, 
                error: result.error 
            });
        }
    } catch (error) {
        logger.error('Erreur envoi email test:', error);
        res.status(500).json({ error: 'Erreur lors de l\'envoi de l\'email de test' });
    }
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