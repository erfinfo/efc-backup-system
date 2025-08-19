const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

// Configuration des couleurs personnalisées EFC
const customColors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    debug: 'blue',
    backup: 'magenta',
    client: 'cyan'
};

winston.addColors(customColors);

// Créer le dossier de logs s'il n'existe pas
const logDir = process.env.LOG_PATH || './logs';
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// Format personnalisé pour les logs
const customFormat = winston.format.combine(
    winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack, clientName, backupId, ...meta }) => {
        let logMessage = `[${timestamp}] [${level.toUpperCase()}]`;
        
        // Ajouter des informations contextuelles
        if (clientName) logMessage += ` [CLIENT: ${clientName}]`;
        if (backupId) logMessage += ` [BACKUP: ${backupId}]`;
        
        logMessage += ` ${message}`;
        
        // Ajouter la stack trace si présente
        if (stack) logMessage += `\n${stack}`;
        
        // Ajouter les métadonnées supplémentaires
        const metaKeys = Object.keys(meta);
        if (metaKeys.length > 0) {
            const metaString = JSON.stringify(meta, null, 2);
            logMessage += `\nMeta: ${metaString}`;
        }
        
        return logMessage;
    })
);

// Format pour la console avec couleurs
const consoleFormat = winston.format.combine(
    winston.format.colorize({ all: true }),
    winston.format.timestamp({
        format: 'HH:mm:ss'
    }),
    winston.format.printf(({ timestamp, level, message, clientName, backupId }) => {
        let logMessage = `[${timestamp}] ${level}`;
        
        if (clientName) logMessage += ` [${clientName}]`;
        if (backupId) logMessage += ` [${backupId.substring(0, 8)}...]`;
        
        logMessage += ` ${message}`;
        return logMessage;
    })
);

// Transports Winston
const transports = [];

// Console transport (si activé)
if (process.env.ENABLE_CONSOLE_LOG !== 'false') {
    transports.push(new winston.transports.Console({
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        format: consoleFormat
    }));
}

// File transports (si activé)
if (process.env.ENABLE_FILE_LOG !== 'false') {
    // Logs généraux avec rotation quotidienne (format JSON pour l'API)
    transports.push(new DailyRotateFile({
        filename: path.join(logDir, 'app-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: process.env.LOG_MAX_SIZE || '20m',
        maxFiles: process.env.LOG_MAX_FILES || '14d',
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
        ),
        level: 'info'
    }));

    // Logs d'erreur séparés
    transports.push(new DailyRotateFile({
        filename: path.join(logDir, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: process.env.LOG_MAX_SIZE || '20m',
        maxFiles: process.env.LOG_MAX_FILES || '30d',
        format: customFormat,
        level: 'error'
    }));

    // Logs de backup séparés
    transports.push(new DailyRotateFile({
        filename: path.join(logDir, 'backup-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: process.env.LOG_MAX_SIZE || '50m',
        maxFiles: process.env.LOG_MAX_FILES || '90d',
        format: customFormat,
        level: 'info',
        // Filtrer seulement les logs contenant des informations de backup
        filter: (info) => {
            return info.message.toLowerCase().includes('backup') || 
                   info.backupId || 
                   info.clientName;
        }
    }));

    // Logs de debug (seulement en développement)
    if (process.env.NODE_ENV !== 'production') {
        transports.push(new DailyRotateFile({
            filename: path.join(logDir, 'debug-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: '10m',
            maxFiles: '3d',
            format: customFormat,
            level: 'debug'
        }));
    }
}

// Créer le logger principal
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: customFormat,
    transports,
    exitOnError: false
});

// Logger spécialisé pour les backups
const backupLogger = winston.createLogger({
    level: 'info',
    format: customFormat,
    transports: [
        new DailyRotateFile({
            filename: path.join(logDir, 'backup-detailed-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: '100m',
            maxFiles: '180d',
            format: customFormat
        }),
        ...(process.env.ENABLE_CONSOLE_LOG !== 'false' ? [
            new winston.transports.Console({
                format: winston.format.combine(
                    winston.format.colorize({ level: true }),
                    winston.format.timestamp({ format: 'HH:mm:ss' }),
                    winston.format.printf(({ timestamp, level, message, clientName, backupId }) => {
                        return `[${timestamp}] ${level} [BACKUP] ${clientName ? `[${clientName}] ` : ''}${message}`;
                    })
                )
            })
        ] : [])
    ]
});

// Logger pour les métriques et monitoring
const metricsLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new DailyRotateFile({
            filename: path.join(logDir, 'metrics-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '30d'
        })
    ]
});

// Transport spécifique par client
const clientLoggers = new Map();

const createClientLogger = (clientName) => {
    if (clientLoggers.has(clientName)) {
        return clientLoggers.get(clientName);
    }

    // Créer un dossier spécifique pour les logs du client
    const clientLogDir = path.join(logDir, 'clients', clientName.replace(/[^a-zA-Z0-9-_]/g, '_'));
    if (!fs.existsSync(clientLogDir)) {
        fs.mkdirSync(clientLogDir, { recursive: true });
    }

    // Logger spécifique pour ce client
    const clientLogger = winston.createLogger({
        level: 'info',
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
        ),
        transports: [
            // Logs généraux du client
            new DailyRotateFile({
                filename: path.join(clientLogDir, 'client-%DATE%.log'),
                datePattern: 'YYYY-MM-DD',
                maxSize: '10m',
                maxFiles: '30d'
            }),
            // Logs de backup spécifiques au client
            new DailyRotateFile({
                filename: path.join(clientLogDir, 'backup-%DATE%.log'),
                datePattern: 'YYYY-MM-DD',
                maxSize: '50m',
                maxFiles: '90d',
                level: 'info'
            }),
            // Logs d'erreur spécifiques au client
            new DailyRotateFile({
                filename: path.join(clientLogDir, 'error-%DATE%.log'),
                datePattern: 'YYYY-MM-DD',
                maxSize: '10m',
                maxFiles: '30d',
                level: 'error'
            })
        ]
    });

    const clientLoggerWrapper = {
        info: (message, meta = {}) => {
            const logData = { clientName, ...meta };
            logger.info(message, logData); // Log global
            clientLogger.info(message, logData); // Log client spécifique
        },
        warn: (message, meta = {}) => {
            const logData = { clientName, ...meta };
            logger.warn(message, logData);
            clientLogger.warn(message, logData);
        },
        error: (message, meta = {}) => {
            const logData = { clientName, ...meta };
            logger.error(message, logData);
            clientLogger.error(message, logData);
        },
        debug: (message, meta = {}) => {
            const logData = { clientName, ...meta };
            logger.debug(message, logData);
            clientLogger.debug(message, logData);
        }
    };

    clientLoggers.set(clientName, clientLoggerWrapper);
    return clientLoggerWrapper;
};

const createBackupLogger = (clientName, backupId) => {
    return {
        info: (message, meta = {}) => backupLogger.info(message, { clientName, backupId, ...meta }),
        warn: (message, meta = {}) => backupLogger.warn(message, { clientName, backupId, ...meta }),
        error: (message, meta = {}) => backupLogger.error(message, { clientName, backupId, ...meta }),
        debug: (message, meta = {}) => backupLogger.debug(message, { clientName, backupId, ...meta })
    };
};

// Métriques système
const logMetric = (metricName, value, unit = '', tags = {}) => {
    metricsLogger.info('metric', {
        name: metricName,
        value,
        unit,
        tags,
        timestamp: new Date().toISOString()
    });
};

// Surveillance des erreurs non gérées
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Fonction pour obtenir les logs récents (pour l'interface web)
const getRecentLogs = async (options = {}) => {
    const {
        level = 'all',
        limit = 100,
        clientName = null,
        since = null
    } = options;

    try {
        const logs = [];
        const today = new Date().toISOString().split('T')[0];
        const logFile = path.join(logDir, `app-${today}.log`);

        if (!fs.existsSync(logFile)) {
            return [];
        }

        // Lire le fichier de log ligne par ligne
        const fileContent = fs.readFileSync(logFile, 'utf8');
        const lines = fileContent.split('\n').filter(line => line.trim());

        // Parser chaque ligne JSON
        for (const line of lines.reverse()) {
            if (logs.length >= limit) break;

            try {
                const logEntry = JSON.parse(line);
                
                // Filtrer par niveau si spécifié
                if (level !== 'all' && logEntry.level !== level) {
                    continue;
                }

                // Filtrer par client si spécifié
                if (clientName && !logEntry.message.toLowerCase().includes(clientName.toLowerCase()) && logEntry.clientName !== clientName) {
                    continue;
                }

                // Filtrer par date si spécifié
                if (since && new Date(logEntry.timestamp) < new Date(since)) {
                    continue;
                }

                logs.push({
                    timestamp: logEntry.timestamp,
                    level: logEntry.level,
                    message: logEntry.message,
                    clientName: logEntry.clientName || null,
                    backupId: logEntry.backupId || null
                });
            } catch (e) {
                // Ignorer les lignes mal formées
                continue;
            }
        }

        return logs;
    } catch (error) {
        logger.error('Erreur lors de la lecture des logs:', error);
        throw error;
    }
};

// Fonction pour obtenir les logs spécifiques d'un client
const getClientLogs = async (clientName, options = {}) => {
    const {
        level = 'all',
        limit = 100,
        since = null,
        logType = 'client' // 'client', 'backup', 'error'
    } = options;

    try {
        const logs = [];
        const today = new Date().toISOString().split('T')[0];
        const clientLogDir = path.join(logDir, 'clients', clientName.replace(/[^a-zA-Z0-9-_]/g, '_'));
        
        let logFile;
        switch (logType) {
            case 'backup':
                logFile = path.join(clientLogDir, `backup-${today}.log`);
                break;
            case 'error':
                logFile = path.join(clientLogDir, `error-${today}.log`);
                break;
            default:
                logFile = path.join(clientLogDir, `client-${today}.log`);
        }

        if (!fs.existsSync(logFile)) {
            return [];
        }

        // Lire le fichier de log ligne par ligne
        const fileContent = fs.readFileSync(logFile, 'utf8');
        const lines = fileContent.split('\n').filter(line => line.trim());

        // Parser chaque ligne JSON
        for (const line of lines.reverse()) {
            if (logs.length >= limit) break;

            try {
                const logEntry = JSON.parse(line);
                
                // Filtrer par niveau si spécifié
                if (level !== 'all' && logEntry.level !== level) {
                    continue;
                }

                // Filtrer par date si spécifié
                if (since && new Date(logEntry.timestamp) < new Date(since)) {
                    continue;
                }

                logs.push({
                    timestamp: logEntry.timestamp,
                    level: logEntry.level,
                    message: logEntry.message,
                    clientName: logEntry.clientName || clientName,
                    backupId: logEntry.backupId || null,
                    logType: logType
                });
            } catch (e) {
                // Ignorer les lignes mal formées
                continue;
            }
        }

        return logs;
    } catch (error) {
        logger.error(`Erreur lors de la lecture des logs du client ${clientName}:`, error);
        throw error;
    }
};

// Fonction pour obtenir la liste des clients ayant des logs
const getClientsWithLogs = () => {
    try {
        const clientsLogDir = path.join(logDir, 'clients');
        if (!fs.existsSync(clientsLogDir)) {
            return [];
        }

        return fs.readdirSync(clientsLogDir)
            .filter(dir => fs.statSync(path.join(clientsLogDir, dir)).isDirectory())
            .map(dir => dir.replace(/_/g, ' ')); // Reconvertir les underscores en espaces
    } catch (error) {
        logger.error('Erreur lors de la récupération de la liste des clients avec logs:', error);
        return [];
    }
};

// Fonction pour obtenir les statistiques des logs
const getLogStats = async () => {
    try {
        const stats = {
            totalLogs: 0,
            errorCount: 0,
            warningCount: 0,
            lastError: null,
            diskUsage: 0
        };

        // Calculer l'utilisation disque des logs
        const logFiles = fs.readdirSync(logDir);
        for (const file of logFiles) {
            const filePath = path.join(logDir, file);
            const stat = fs.statSync(filePath);
            stats.diskUsage += stat.size;
        }

        // Obtenir les logs récents pour les statistiques
        const recentLogs = await getRecentLogs({ limit: 1000 });
        stats.totalLogs = recentLogs.length;
        
        for (const log of recentLogs) {
            if (log.level === 'error') {
                stats.errorCount++;
                if (!stats.lastError || new Date(log.timestamp) > new Date(stats.lastError.timestamp)) {
                    stats.lastError = log;
                }
            } else if (log.level === 'warn') {
                stats.warningCount++;
            }
        }

        stats.diskUsage = Math.round(stats.diskUsage / (1024 * 1024)); // Convertir en MB

        return stats;
    } catch (error) {
        logger.error('Erreur lors de la récupération des statistiques de logs:', error);
        throw error;
    }
};

// Fonction de nettoyage des logs anciens
const cleanupOldLogs = async () => {
    try {
        const retentionDays = parseInt(process.env.LOG_RETENTION_DAYS || '30');
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

        let deletedFiles = 0;
        let freedSpace = 0;

        const logFiles = fs.readdirSync(logDir);
        for (const file of logFiles) {
            const filePath = path.join(logDir, file);
            const stat = fs.statSync(filePath);
            
            if (stat.mtime < cutoffDate) {
                freedSpace += stat.size;
                fs.unlinkSync(filePath);
                deletedFiles++;
                logger.info(`Log ancien supprimé: ${file}`);
            }
        }

        if (deletedFiles > 0) {
            logger.info(`Nettoyage des logs terminé: ${deletedFiles} fichiers supprimés, ${Math.round(freedSpace / (1024 * 1024))} MB libérés`);
        }

        return { deletedFiles, freedSpace };
    } catch (error) {
        logger.error('Erreur lors du nettoyage des logs:', error);
        throw error;
    }
};

module.exports = {
    logger,
    backupLogger,
    metricsLogger,
    createClientLogger,
    createBackupLogger,
    logMetric,
    getRecentLogs,
    getClientLogs,
    getClientsWithLogs,
    getLogStats,
    cleanupOldLogs
};