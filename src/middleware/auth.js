const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { logger } = require('../utils/logger');

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
        AuthMiddleware.authenticateToken(req, res, (error) => {
            if (error) return;
            
            if (req.user.role === 'admin') {
                return next();
            }
            
            if (req.user.role === 'client') {
                const requestedClient = req.params.clientName || req.query.client || req.body.client_name;
                
                if (requestedClient && requestedClient !== req.user.clientName) {
                    logger.warn(`Accès refusé: ${req.user.username} a tenté d'accéder aux données de ${requestedClient}`);
                    return res.status(403).json({ error: 'Accès non autorisé aux données de ce client' });
                }
            }
            
            next();
        });
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