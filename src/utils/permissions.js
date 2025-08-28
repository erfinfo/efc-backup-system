const { db } = require('./database');
const { logger } = require('./logger');

// Définition des permissions disponibles
const PERMISSIONS = {
    // Permissions générales
    DASHBOARD_VIEW: 'dashboard_view',
    SYSTEM_MONITOR: 'system_monitor',
    
    // Permissions clients
    CLIENTS_VIEW: 'clients_view',
    CLIENTS_CREATE: 'clients_create',
    CLIENTS_EDIT: 'clients_edit',
    CLIENTS_DELETE: 'clients_delete',
    CLIENTS_TEST: 'clients_test',
    
    // Permissions backups
    BACKUPS_VIEW: 'backups_view',
    BACKUPS_CREATE: 'backups_create',
    BACKUPS_RESTORE: 'backups_restore',
    BACKUPS_DELETE: 'backups_delete',
    BACKUPS_SCHEDULE: 'backups_schedule',
    
    // Permissions utilisateurs (admin seulement par défaut)
    USERS_VIEW: 'users_view',
    USERS_CREATE: 'users_create',
    USERS_EDIT: 'users_edit',
    USERS_DELETE: 'users_delete',
    USERS_PERMISSIONS: 'users_permissions',
    
    // Permissions logs et monitoring
    LOGS_VIEW: 'logs_view',
    LOGS_EXPORT: 'logs_export',
    METRICS_VIEW: 'metrics_view',
    
    // Permissions système
    SETTINGS_VIEW: 'settings_view',
    SETTINGS_EDIT: 'settings_edit',
    SSL_MANAGE: 'ssl_manage',
    NOTIFICATIONS_MANAGE: 'notifications_manage'
};

// Permissions par défaut pour chaque rôle
const DEFAULT_PERMISSIONS = {
    admin: Object.values(PERMISSIONS), // Toutes les permissions
    client: [
        PERMISSIONS.DASHBOARD_VIEW,
        PERMISSIONS.CLIENTS_VIEW,
        PERMISSIONS.BACKUPS_VIEW,
        PERMISSIONS.BACKUPS_CREATE,
        PERMISSIONS.BACKUPS_RESTORE,
        PERMISSIONS.LOGS_VIEW
    ]
};

// Ressources pour les permissions spécifiques
const RESOURCES = {
    CLIENT: 'client',
    BACKUP: 'backup',
    USER: 'user',
    SYSTEM: 'system'
};

class PermissionManager {
    
    // Vérifier si un utilisateur a une permission
    async hasPermission(userId, permission, resource = null, resourceId = null) {
        try {
            // Récupérer l'utilisateur
            const user = await db.get('SELECT role, permissions FROM users WHERE id = ? AND active = 1', [userId]);
            
            if (!user) {
                return false;
            }
            
            // Les admins ont toutes les permissions par défaut
            if (user.role === 'admin') {
                return true;
            }
            
            // Vérifier les permissions générales du rôle
            let userPermissions = DEFAULT_PERMISSIONS[user.role] || [];
            
            // Ajouter les permissions personnalisées du JSON
            try {
                const customPermissions = JSON.parse(user.permissions || '{}');
                if (customPermissions.granted) {
                    userPermissions = userPermissions.concat(customPermissions.granted);
                }
                if (customPermissions.revoked) {
                    userPermissions = userPermissions.filter(p => !customPermissions.revoked.includes(p));
                }
            } catch (e) {
                logger.warn(`Erreur parsing permissions pour utilisateur ${userId}:`, e);
            }
            
            // Vérifier les permissions détaillées dans la base
            if (resource && resourceId) {
                const specificPermission = await db.get(`
                    SELECT granted FROM user_permissions 
                    WHERE user_id = ? AND permission_type = ? AND resource = ? AND resource_id = ?
                    AND (expires_at IS NULL OR expires_at > datetime('now'))
                `, [userId, permission, resource, resourceId]);
                
                if (specificPermission !== undefined) {
                    return Boolean(specificPermission.granted);
                }
            }
            
            // Vérifier la permission générale
            return userPermissions.includes(permission);
            
        } catch (error) {
            logger.error('Erreur vérification permission:', error);
            return false;
        }
    }
    
    // Octroyer une permission spécifique à un utilisateur
    async grantPermission(userId, permission, resource = null, resourceId = null, grantedBy = null, expiresAt = null) {
        try {
            await db.run(`
                INSERT OR REPLACE INTO user_permissions 
                (user_id, permission_type, resource, resource_id, granted, granted_by, expires_at)
                VALUES (?, ?, ?, ?, 1, ?, ?)
            `, [userId, permission, resource, resourceId, grantedBy, expiresAt]);
            
            logger.info(`Permission ${permission} accordée à l'utilisateur ${userId}`, {
                userId, permission, resource, resourceId, grantedBy
            });
            
            return true;
        } catch (error) {
            logger.error('Erreur octroi permission:', error);
            return false;
        }
    }
    
    // Révoquer une permission spécifique
    async revokePermission(userId, permission, resource = null, resourceId = null) {
        try {
            await db.run(`
                UPDATE user_permissions 
                SET granted = 0 
                WHERE user_id = ? AND permission_type = ? 
                AND (resource IS NULL OR resource = ?) 
                AND (resource_id IS NULL OR resource_id = ?)
            `, [userId, permission, resource, resourceId]);
            
            logger.info(`Permission ${permission} révoquée pour l'utilisateur ${userId}`, {
                userId, permission, resource, resourceId
            });
            
            return true;
        } catch (error) {
            logger.error('Erreur révocation permission:', error);
            return false;
        }
    }
    
    // Obtenir toutes les permissions d'un utilisateur
    async getUserPermissions(userId) {
        try {
            const user = await db.get('SELECT role, permissions FROM users WHERE id = ?', [userId]);
            
            if (!user) {
                return [];
            }
            
            let permissions = DEFAULT_PERMISSIONS[user.role] || [];
            
            // Ajouter les permissions personnalisées
            try {
                const customPermissions = JSON.parse(user.permissions || '{}');
                if (customPermissions.granted) {
                    permissions = permissions.concat(customPermissions.granted);
                }
                if (customPermissions.revoked) {
                    permissions = permissions.filter(p => !customPermissions.revoked.includes(p));
                }
            } catch (e) {
                // Ignorer les erreurs de parsing
            }
            
            // Ajouter les permissions spécifiques
            const specificPermissions = await db.all(`
                SELECT permission_type, resource, resource_id, granted 
                FROM user_permissions 
                WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
            `, [userId]);
            
            for (const perm of specificPermissions) {
                const key = perm.resource && perm.resource_id 
                    ? `${perm.permission_type}:${perm.resource}:${perm.resource_id}`
                    : perm.permission_type;
                    
                if (perm.granted) {
                    if (!permissions.includes(key)) {
                        permissions.push(key);
                    }
                } else {
                    permissions = permissions.filter(p => p !== key);
                }
            }
            
            return [...new Set(permissions)]; // Enlever les doublons
            
        } catch (error) {
            logger.error('Erreur récupération permissions utilisateur:', error);
            return [];
        }
    }
    
    // Vérifier les permissions pour les clients - un utilisateur client ne peut voir que ses propres clients
    async getClientPermissions(userId) {
        try {
            const user = await db.get('SELECT role, client_name FROM users WHERE id = ?', [userId]);
            
            if (!user) {
                return { canViewAll: false, allowedClients: [] };
            }
            
            if (user.role === 'admin') {
                return { canViewAll: true, allowedClients: [] };
            }
            
            // Pour les clients, ils ne peuvent voir que leur client associé
            if (user.client_name) {
                return { 
                    canViewAll: false, 
                    allowedClients: [user.client_name] 
                };
            }
            
            return { canViewAll: false, allowedClients: [] };
            
        } catch (error) {
            logger.error('Erreur récupération permissions clients:', error);
            return { canViewAll: false, allowedClients: [] };
        }
    }
    
    // Middleware pour vérifier les permissions
    requirePermission(permission, resource = null) {
        return async (req, res, next) => {
            try {
                if (!req.user) {
                    return res.status(401).json({ error: 'Non authentifié' });
                }
                
                const hasPermission = await this.hasPermission(
                    req.user.id, 
                    permission, 
                    resource, 
                    req.params.id || req.params.clientId
                );
                
                if (!hasPermission) {
                    logger.warn(`Accès refusé - Permission ${permission} manquante`, {
                        userId: req.user.id,
                        username: req.user.username,
                        permission,
                        resource,
                        ip: req.ip
                    });
                    
                    return res.status(403).json({ error: 'Permission insuffisante' });
                }
                
                next();
            } catch (error) {
                logger.error('Erreur middleware permissions:', error);
                return res.status(500).json({ error: 'Erreur interne du serveur' });
            }
        };
    }
}

const permissionManager = new PermissionManager();

module.exports = {
    PERMISSIONS,
    DEFAULT_PERMISSIONS,
    RESOURCES,
    permissionManager,
    
    // Middlewares de convenance
    requireAdmin: (req, res, next) => {
        if (req.user && req.user.role === 'admin') {
            next();
        } else {
            res.status(403).json({ error: 'Privilèges administrateur requis' });
        }
    },
    
    requirePermission: (permission, resource = null) => {
        return permissionManager.requirePermission(permission, resource);
    }
};