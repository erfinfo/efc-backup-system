const express = require('express');
const { sslManager } = require('../utils/ssl-manager');
const { logger } = require('../utils/logger');
const AuthMiddleware = require('../middleware/auth');

const router = express.Router();

// Route pour obtenir le statut SSL actuel
router.get('/status', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const status = await sslManager.getSSLStatus();
        
        res.json({
            domain: 'backup.efcinfo.com',
            status,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Erreur lors de la vérification du statut SSL:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour configurer SSL complet
router.post('/setup', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        logger.info(`Configuration SSL initiée par ${req.user.username}`);

        // Cette opération peut prendre plusieurs minutes
        res.setTimeout(300000); // 5 minutes timeout

        const result = await sslManager.setupSSL();

        logger.info('Configuration SSL terminée avec succès', { result });

        res.json({
            success: true,
            message: 'Configuration SSL terminée avec succès',
            domain: 'backup.efcinfo.com',
            result,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Erreur lors de la configuration SSL:', error);
        res.status(500).json({ 
            error: 'Erreur lors de la configuration SSL',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Route pour renouveler le certificat manuellement
router.post('/renew', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        logger.info(`Renouvellement SSL initié par ${req.user.username}`);

        const result = await sslManager.renewCertificate();

        logger.info('Renouvellement SSL terminé', { result });

        res.json({
            success: true,
            message: 'Certificat SSL renouvelé avec succès',
            result,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Erreur lors du renouvellement SSL:', error);
        res.status(500).json({ 
            error: 'Erreur lors du renouvellement SSL',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Route pour tester la configuration SSL
router.post('/test', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const testResult = await sslManager.testSSLConfiguration();

        res.json({
            success: true,
            message: 'Test SSL terminé',
            test: testResult,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Erreur lors du test SSL:', error);
        res.status(500).json({ 
            error: 'Erreur lors du test SSL',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Route pour vérifier les prérequis SSL
router.get('/prerequisites', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        // Vérification des prérequis sans configuration
        const prerequisites = {
            domain: 'backup.efcinfo.com',
            checks: {
                dns: false,
                nginx: false,
                certbot: false,
                ports: false
            },
            recommendations: []
        };

        try {
            await sslManager.checkDNSConfiguration();
            prerequisites.checks.dns = true;
        } catch (error) {
            prerequisites.recommendations.push('Configurer le DNS pour pointer backup.efcinfo.com vers ce serveur');
        }

        try {
            await sslManager.checkNginxInstallation();
            prerequisites.checks.nginx = true;
        } catch (error) {
            prerequisites.recommendations.push('Installer Nginx');
        }

        try {
            await sslManager.checkCertbotInstallation();
            prerequisites.checks.certbot = true;
        } catch (error) {
            prerequisites.recommendations.push('Installer Certbot');
        }

        try {
            await sslManager.checkPorts();
            prerequisites.checks.ports = true;
        } catch (error) {
            prerequisites.recommendations.push('Vérifier que les ports 80 et 443 sont disponibles');
        }

        const readyForSSL = Object.values(prerequisites.checks).every(check => check);

        res.json({
            ready: readyForSSL,
            prerequisites,
            message: readyForSSL ? 
                'Système prêt pour la configuration SSL' : 
                'Prérequis manquants pour la configuration SSL',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Erreur lors de la vérification des prérequis:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour obtenir les logs SSL
router.get('/logs', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const { lines = 50 } = req.query;

        // Lecture des logs Nginx et Certbot
        const logs = {
            nginx: {
                access: [],
                error: []
            },
            certbot: [],
            letsencrypt: []
        };

        try {
            // Logs Nginx
            const nginxAccess = await sslManager.runCommand('tail', ['-n', lines, '/var/log/nginx/efc-backup-access.log']);
            logs.nginx.access = nginxAccess.split('\n').filter(line => line.trim());
        } catch (error) {
            logs.nginx.access = ['Fichier de log non trouvé'];
        }

        try {
            const nginxError = await sslManager.runCommand('tail', ['-n', lines, '/var/log/nginx/efc-backup-error.log']);
            logs.nginx.error = nginxError.split('\n').filter(line => line.trim());
        } catch (error) {
            logs.nginx.error = ['Fichier de log non trouvé'];
        }

        try {
            // Logs Certbot
            const certbotLogs = await sslManager.runCommand('tail', ['-n', lines, '/var/log/letsencrypt/letsencrypt.log']);
            logs.certbot = certbotLogs.split('\n').filter(line => line.trim());
        } catch (error) {
            logs.certbot = ['Fichier de log non trouvé'];
        }

        res.json({
            logs,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Erreur lors de la lecture des logs SSL:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour obtenir la configuration Nginx actuelle
router.get('/nginx-config', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const fs = require('fs').promises;
        const configPath = '/etc/nginx/sites-available/efc-backup';

        try {
            const config = await fs.readFile(configPath, 'utf8');
            
            res.json({
                exists: true,
                path: configPath,
                config,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            res.json({
                exists: false,
                path: configPath,
                message: 'Configuration Nginx non trouvée',
                timestamp: new Date().toISOString()
            });
        }

    } catch (error) {
        logger.error('Erreur lors de la lecture de la config Nginx:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour les informations du certificat
router.get('/certificate-info', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const certPath = '/etc/letsencrypt/live/backup.efcinfo.com/fullchain.pem';
        
        try {
            const certInfo = await sslManager.runCommand('openssl', [
                'x509', '-in', certPath,
                '-noout', '-text'
            ]);

            // Extraire les informations importantes
            const subject = certInfo.match(/Subject: (.+)/)?.[1] || 'Non trouvé';
            const issuer = certInfo.match(/Issuer: (.+)/)?.[1] || 'Non trouvé';
            const validFrom = certInfo.match(/Not Before: (.+)/)?.[1] || 'Non trouvé';
            const validTo = certInfo.match(/Not After : (.+)/)?.[1] || 'Non trouvé';
            const serialNumber = certInfo.match(/Serial Number:\s*(.+)/)?.[1] || 'Non trouvé';

            res.json({
                exists: true,
                path: certPath,
                certificate: {
                    subject,
                    issuer,
                    validFrom,
                    validTo,
                    serialNumber
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            res.json({
                exists: false,
                path: certPath,
                message: 'Certificat non trouvé ou illisible',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }

    } catch (error) {
        logger.error('Erreur lors de la lecture du certificat:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

module.exports = router;