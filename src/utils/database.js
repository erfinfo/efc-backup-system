const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
    constructor() {
        this.db = null;
        this.dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'efc-backup.db');
    }

    async init() {
        return new Promise((resolve, reject) => {
            // Créer le dossier de la base de données s'il n'existe pas
            const dbDir = path.dirname(this.dbPath);
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
            }

            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                console.log(`Base de données SQLite connectée: ${this.dbPath}`);
                this.createTables().then(resolve).catch(reject);
            });
        });
    }

    async createTables() {
        const tables = [
            // Table des clients
            `CREATE TABLE IF NOT EXISTS clients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                host TEXT NOT NULL,
                port INTEGER DEFAULT 22,
                username TEXT NOT NULL,
                password TEXT NOT NULL,
                folders TEXT,
                backup_type TEXT DEFAULT 'full',
                os_type TEXT DEFAULT 'windows',
                active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Table des backups
            `CREATE TABLE IF NOT EXISTS backups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                backup_id TEXT UNIQUE NOT NULL,
                client_name TEXT NOT NULL,
                type TEXT NOT NULL,
                status TEXT NOT NULL,
                started_at DATETIME,
                completed_at DATETIME,
                failed_at DATETIME,
                size_mb INTEGER DEFAULT 0,
                file_count INTEGER DEFAULT 0,
                path TEXT,
                error_message TEXT,
                metadata TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Table des planifications
            `CREATE TABLE IF NOT EXISTS schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                cron_pattern TEXT NOT NULL,
                backup_type TEXT NOT NULL,
                client_names TEXT,
                description TEXT,
                active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Table des logs d'activité
            `CREATE TABLE IF NOT EXISTS activity_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action TEXT NOT NULL,
                client_name TEXT,
                backup_id TEXT,
                user_ip TEXT,
                details TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Table des paramètres système
            `CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Table des métriques
            `CREATE TABLE IF NOT EXISTS metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                metric_name TEXT NOT NULL,
                metric_value REAL NOT NULL,
                metric_unit TEXT,
                tags TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        for (const table of tables) {
            await this.run(table);
        }

        // Créer les index pour optimiser les performances
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_backups_client_name ON backups(client_name)',
            'CREATE INDEX IF NOT EXISTS idx_backups_status ON backups(status)',
            'CREATE INDEX IF NOT EXISTS idx_backups_created_at ON backups(created_at)',
            'CREATE INDEX IF NOT EXISTS idx_activity_logs_timestamp ON activity_logs(timestamp)',
            'CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp)'
        ];

        for (const index of indexes) {
            await this.run(index);
        }

        // Migration pour ajouter os_type aux clients existants
        try {
            await this.run(`ALTER TABLE clients ADD COLUMN os_type TEXT DEFAULT 'windows'`);
        } catch (error) {
            // La colonne existe déjà, ignorer l'erreur
            if (!error.message.includes('duplicate column name')) {
                console.log('Migration os_type:', error.message);
            }
        }

        console.log('Tables de base de données créées/vérifiées');
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve({ id: this.lastID, changes: this.changes });
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(row);
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(rows);
            });
        });
    }

    close() {
        return new Promise((resolve, reject) => {
            this.db.close((err) => {
                if (err) {
                    reject(err);
                    return;
                }
                console.log('Base de données fermée');
                resolve();
            });
        });
    }
}

// Instance singleton de la base de données
const db = new Database();

// Fonctions utilitaires pour les clients
const addClient = async (clientData) => {
    const { name, host, port = 22, username, password, folders, backup_type = 'full', os_type = 'windows' } = clientData;
    
    const result = await db.run(
        `INSERT INTO clients (name, host, port, username, password, folders, backup_type, os_type) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [name, host, port, username, password, folders, backup_type, os_type]
    );
    
    await logActivity('CLIENT_ADDED', name, null, null, { clientData });
    return result;
};

const getClients = async (filters = {}) => {
    let sql = 'SELECT * FROM clients WHERE 1=1';
    const params = [];
    
    if (filters.active !== undefined) {
        sql += ' AND active = ?';
        params.push(filters.active ? 1 : 0);
    }
    
    if (filters.names && filters.names.length > 0) {
        const placeholders = filters.names.map(() => '?').join(',');
        sql += ` AND name IN (${placeholders})`;
        params.push(...filters.names);
    }
    
    sql += ' ORDER BY created_at DESC';
    
    return await db.all(sql, params);
};

const getClient = async (id) => {
    return await db.get('SELECT * FROM clients WHERE id = ?', [id]);
};

const updateClient = async (id, clientData) => {
    const fields = [];
    const params = [];
    
    for (const [key, value] of Object.entries(clientData)) {
        if (['name', 'host', 'port', 'username', 'password', 'folders', 'backup_type', 'active'].includes(key)) {
            fields.push(`${key} = ?`);
            params.push(value);
        }
    }
    
    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    
    const result = await db.run(
        `UPDATE clients SET ${fields.join(', ')} WHERE id = ?`,
        params
    );
    
    const client = await getClient(id);
    await logActivity('CLIENT_UPDATED', client?.name, null, null, { clientData });
    
    return result;
};

const deleteClient = async (id) => {
    const client = await getClient(id);
    const result = await db.run('DELETE FROM clients WHERE id = ?', [id]);
    
    if (client) {
        await logActivity('CLIENT_DELETED', client.name, null, null, { clientId: id });
    }
    
    return result;
};

// Fonctions utilitaires pour les backups
const addBackup = async (backupData) => {
    const {
        backup_id,
        client_name,
        type,
        status = 'pending',
        started_at,
        completed_at,
        failed_at,
        size_mb = 0,
        file_count = 0,
        path,
        error_message,
        metadata
    } = backupData;
    
    const result = await db.run(
        `INSERT INTO backups (backup_id, client_name, type, status, started_at, completed_at, failed_at, size_mb, file_count, path, error_message, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [backup_id, client_name, type, status, started_at, completed_at, failed_at, size_mb, file_count, path, error_message, JSON.stringify(metadata)]
    );
    
    await logActivity('BACKUP_CREATED', client_name, backup_id, null, { type, status });
    return result;
};

const updateBackupStatus = async (backup_id, status, additionalData = {}) => {
    const fields = ['status = ?'];
    const params = [status];
    
    // Ajouter les timestamps appropriés
    if (status === 'running' && !additionalData.started_at) {
        fields.push('started_at = CURRENT_TIMESTAMP');
    } else if (status === 'completed' && !additionalData.completed_at) {
        fields.push('completed_at = CURRENT_TIMESTAMP');
    } else if (status === 'failed' && !additionalData.failed_at) {
        fields.push('failed_at = CURRENT_TIMESTAMP');
    }
    
    // Ajouter les autres champs
    for (const [key, value] of Object.entries(additionalData)) {
        if (['size_mb', 'file_count', 'path', 'error_message', 'metadata', 'started_at', 'completed_at', 'failed_at'].includes(key)) {
            fields.push(`${key} = ?`);
            params.push(key === 'metadata' ? JSON.stringify(value) : value);
        }
    }
    
    params.push(backup_id);
    
    const result = await db.run(
        `UPDATE backups SET ${fields.join(', ')} WHERE backup_id = ?`,
        params
    );
    
    const backup = await db.get('SELECT client_name FROM backups WHERE backup_id = ?', [backup_id]);
    if (backup) {
        await logActivity('BACKUP_STATUS_UPDATED', backup.client_name, backup_id, null, { status, ...additionalData });
    }
    
    return result;
};

const getBackups = async (filters = {}) => {
    let sql = 'SELECT * FROM backups WHERE 1=1';
    const params = [];
    
    if (filters.client_name) {
        sql += ' AND client_name = ?';
        params.push(filters.client_name);
    }
    
    if (filters.status) {
        sql += ' AND status = ?';
        params.push(filters.status);
    }
    
    if (filters.type) {
        sql += ' AND type = ?';
        params.push(filters.type);
    }
    
    if (filters.since) {
        sql += ' AND created_at >= ?';
        params.push(filters.since);
    }
    
    if (filters.limit) {
        sql += ' LIMIT ?';
        params.push(filters.limit);
    }
    
    sql += ' ORDER BY created_at DESC';
    
    const backups = await db.all(sql, params);
    
    // Parser le metadata JSON
    return backups.map(backup => ({
        ...backup,
        metadata: backup.metadata ? JSON.parse(backup.metadata) : null
    }));
};

const getBackupStats = async () => {
    const stats = {
        total: 0,
        completed: 0,
        failed: 0,
        running: 0,
        totalSizeMB: 0,
        avgSizeMB: 0,
        last24h: 0
    };
    
    // Stats générales
    const totalResult = await db.get('SELECT COUNT(*) as count, SUM(size_mb) as totalSize FROM backups');
    stats.total = totalResult.count;
    stats.totalSizeMB = totalResult.totalSize || 0;
    
    if (stats.total > 0) {
        stats.avgSizeMB = Math.round(stats.totalSizeMB / stats.total);
    }
    
    // Stats par statut
    const statusStats = await db.all('SELECT status, COUNT(*) as count FROM backups GROUP BY status');
    for (const stat of statusStats) {
        if (stat.status in stats) {
            stats[stat.status] = stat.count;
        }
    }
    
    // Stats 24h
    const last24hResult = await db.get(
        'SELECT COUNT(*) as count FROM backups WHERE created_at >= datetime("now", "-1 day")'
    );
    stats.last24h = last24hResult.count;
    
    return stats;
};

// Fonctions utilitaires pour les planifications
const addSchedule = async (scheduleData) => {
    const { name, cron_pattern, backup_type, client_names, description } = scheduleData;
    
    return await db.run(
        `INSERT INTO schedules (name, cron_pattern, backup_type, client_names, description)
         VALUES (?, ?, ?, ?, ?)`,
        [name, cron_pattern, backup_type, client_names, description]
    );
};

const getSchedules = async (activeOnly = false) => {
    let sql = 'SELECT * FROM schedules';
    const params = [];
    
    if (activeOnly) {
        sql += ' WHERE active = 1';
    }
    
    sql += ' ORDER BY created_at DESC';
    
    return await db.all(sql, params);
};

// Fonctions utilitaires pour les logs d'activité
const logActivity = async (action, client_name = null, backup_id = null, user_ip = null, details = {}) => {
    return await db.run(
        `INSERT INTO activity_logs (action, client_name, backup_id, user_ip, details)
         VALUES (?, ?, ?, ?, ?)`,
        [action, client_name, backup_id, user_ip, JSON.stringify(details)]
    );
};

const getActivityLogs = async (limit = 100) => {
    const logs = await db.all(
        'SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT ?',
        [limit]
    );
    
    // Parser les détails JSON
    return logs.map(log => ({
        ...log,
        details: log.details ? JSON.parse(log.details) : null
    }));
};

// Fonctions utilitaires pour les paramètres
const getSetting = async (key) => {
    const result = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
    return result ? result.value : null;
};

const setSetting = async (key, value) => {
    return await db.run(
        `INSERT OR REPLACE INTO settings (key, value, updated_at) 
         VALUES (?, ?, CURRENT_TIMESTAMP)`,
        [key, value]
    );
};

// Fonctions utilitaires pour les métriques
const addMetric = async (name, value, unit = '', tags = {}) => {
    return await db.run(
        `INSERT INTO metrics (metric_name, metric_value, metric_unit, tags)
         VALUES (?, ?, ?, ?)`,
        [name, value, unit, JSON.stringify(tags)]
    );
};

const getMetrics = async (name, since = null, limit = 1000) => {
    let sql = 'SELECT * FROM metrics WHERE metric_name = ?';
    const params = [name];
    
    if (since) {
        sql += ' AND timestamp >= ?';
        params.push(since);
    }
    
    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);
    
    const metrics = await db.all(sql, params);
    
    return metrics.map(metric => ({
        ...metric,
        tags: metric.tags ? JSON.parse(metric.tags) : {}
    }));
};

// Fonction d'initialisation
const initDatabase = async () => {
    await db.init();
    
    // Insérer des paramètres par défaut si nécessaire
    const defaultSettings = [
        ['backup_retention_days', process.env.RETENTION_DAYS || '30'],
        ['max_parallel_backups', process.env.MAX_PARALLEL_BACKUPS || '2'],
        ['notification_email', process.env.NOTIFICATION_EMAIL || ''],
        ['system_initialized', new Date().toISOString()]
    ];
    
    for (const [key, value] of defaultSettings) {
        const existing = await getSetting(key);
        if (!existing) {
            await setSetting(key, value);
        }
    }
};

module.exports = {
    db,
    initDatabase,
    
    // Clients
    addClient,
    getClients,
    getClient,
    updateClient,
    deleteClient,
    
    // Backups
    addBackup,
    updateBackupStatus,
    getBackups,
    getBackupStats,
    
    // Schedules
    addSchedule,
    getSchedules,
    
    // Activity logs
    logActivity,
    getActivityLogs,
    
    // Settings
    getSetting,
    setSetting,
    
    // Metrics
    addMetric,
    getMetrics
};