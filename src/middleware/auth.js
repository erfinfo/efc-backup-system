const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { logger } = require('../utils/logger');
// const { permissionManager } = require('../utils/permissions'); // Import will be loaded dynamically

const JWT_SECRET = process.env.JWT_SECRET || 'efc-backup-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

class AuthMiddleware {
    static generateToken(user) {
        return jwt.sign(
            { 
                id: user.id, 
                username: user.username, 
                role: user.role,
                clientName: user.client_name || null
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );
    }

    static verifyToken(token) {
        try {
            return jwt.verify(token, JWT_SECRET);
        } catch (error) {
            logger.warn('Token JWT invalide:', error.message);
            return null;
        }
    }

    static async hashPassword(password) {
        const saltRounds = 12;
        return await bcrypt.hash(password, saltRounds);
    }

    static async comparePassword(password, hashedPassword) {
        return await bcrypt.compare(password, hashedPassword);
    }

    static authenticateToken(req, res, next) {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        
        if (!token) {
            const cookieToken = req.cookies?.auth_token;
            if (!cookieToken) {
                return res.status(401).json({ error: 'Token d\'authentification requis' });
            }
            req.token = cookieToken;
        } else {
            req.token = token;
        }

        const decoded = AuthMiddleware.verifyToken(req.token);
        if (!decoded) {
            return res.status(403).json({ error: 'Token invalide ou expiré' });
        }

        req.user = decoded;
        logger.info(`Utilisateur authentifié: ${decoded.username} (${decoded.role})`);
        next();
    }

    static requireAdmin(req, res, next) {
        AuthMiddleware.authenticateToken(req, res, (error) => {
            if (error) return;
            
            if (req.user.role !== 'admin') {
                logger.warn(`Accès admin refusé pour: ${req.user.username}`);
                return res.status(403).json({ error: 'Accès administrateur requis' });
            }
            next();
        });
    }

    static requireClientAccess(req, res, next) {
        AuthMiddleware.authenticateToken(req, res, async (error) => {
            if (error) return;
            
            try {
                // Les admins ont toujours accès
                if (req.user.role === 'admin') {
                    return next();
                }
                
                // Pour les clients, vérifier les permissions
                const { permissionManager } = require('../utils/permissions');
                const clientPermissions = await permissionManager.getClientPermissions(req.user.id);
                
                if (req.user.role === 'client') {
                    const requestedClient = req.params.clientName || req.params.client || req.query.client || req.body.client_name;
                    
                    if (requestedClient) {
                        // Vérifier si l'utilisateur peut accéder à ce client spécifique
                        if (!clientPermissions.canViewAll && !clientPermissions.allowedClients.includes(requestedClient)) {
                            logger.warn(`Accès refusé: ${req.user.username} a tenté d'accéder aux données de ${requestedClient}`, {
                                userId: req.user.id,
                                requestedClient,
                                allowedClients: clientPermissions.allowedClients
                            });
                            return res.status(403).json({ error: 'Accès non autorisé aux données de ce client' });
                        }
                    }
                    
                    // Ajouter les clients autorisés à la requête pour filtrage ultérieur
                    req.clientPermissions = clientPermissions;
                }
                
                next();
                
            } catch (err) {
                logger.error('Erreur vérification permissions client:', err);
                return res.status(500).json({ error: 'Erreur interne du serveur' });
            }
        });
    }

    // Middleware pour filtrer les données selon les permissions client
    static async filterClientData(req, res, next) {
        AuthMiddleware.authenticateToken(req, res, async (error) => {
            if (error) return;
            
            try {
                // Les admins voient tout
                if (req.user.role === 'admin') {
                    req.dataFilter = { canViewAll: true };
                    return next();
                }
                
                // Pour les clients, obtenir leurs permissions
                const { permissionManager } = require('../utils/permissions');
                const clientPermissions = await permissionManager.getClientPermissions(req.user.id);
                req.dataFilter = clientPermissions;
                
                next();
                
            } catch (err) {
                logger.error('Erreur configuration filtre données:', err);
                return res.status(500).json({ error: 'Erreur interne du serveur' });
            }
        });
    }

    // Middleware pour vérifier une permission spécifique
    static requirePermission(permission, resource = null) {
        return (req, res, next) => {
            AuthMiddleware.authenticateToken(req, res, async (error) => {
                if (error) return;
                
                try {
                    const { permissionManager } = require('../utils/permissions');
                    const hasPermission = await permissionManager.hasPermission(
                        req.user.id,
                        permission,
                        resource,
                        req.params.id || req.params.clientId
                    );
                    
                    if (!hasPermission) {
                        logger.warn(`Permission refusée: ${req.user.username} - ${permission}`, {
                            userId: req.user.id,
                            permission,
                            resource,
                            resourceId: req.params.id || req.params.clientId
                        });
                        return res.status(403).json({ error: 'Permission insuffisante' });
                    }
                    
                    next();
                    
                } catch (err) {
                    logger.error('Erreur vérification permission:', err);
                    return res.status(500).json({ error: 'Erreur interne du serveur' });
                }
            });
        };
    }

    static securityLogger(req, res, next) {
        const startTime = Date.now();
        
        res.on('finish', () => {
            const duration = Date.now() - startTime;
            const logData = {
                method: req.method,
                url: req.originalUrl,
                status: res.statusCode,
                ip: req.ip || req.connection.remoteAddress,
                userAgent: req.get('User-Agent'),
                user: req.user ? req.user.username : 'anonymous',
                duration: duration
            };

            if (res.statusCode >= 400) {
                logger.warn('Requête suspecte:', logData);
            } else if (req.user) {
                logger.info('Accès autorisé:', logData);
            }
        });
        
        next();
    }
}

module.exports = AuthMiddleware;