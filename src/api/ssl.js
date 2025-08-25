const express = require('express');
const { apacheSSLManager } = require('../utils/ssl-manager-apache');
const { logger } = require('../utils/logger');
const AuthMiddleware = require('../middleware/auth');

const router = express.Router();

// Route pour obtenir le statut SSL actuel
router.get('/status', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const status = await apacheSSLManager.getSSLStatus();
        
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

        const result = await apacheSSLManager.setupSSL();

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

        const result = await apacheSSLManager.renewCertificate();

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
        const testResult = await apacheSSLManager.testSSLConfiguration();

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
                apache: false,
                certbot: false,
                ports: false
            },
            recommendations: []
        };

        try {
            await apacheSSLManager.checkDNSConfiguration();
            prerequisites.checks.dns = true;
        } catch (error) {
            prerequisites.recommendations.push('Configurer le DNS pour pointer backup.efcinfo.com vers ce serveur');
        }

        try {
            await apacheSSLManager.checkApacheInstallation();
            prerequisites.checks.apache = true;
        } catch (error) {
            prerequisites.recommendations.push('Installer Apache2');
        }

        try {
            await apacheSSLManager.checkCertbotInstallation();
            prerequisites.checks.certbot = true;
        } catch (error) {
            prerequisites.recommendations.push('Installer Certbot avec plugin Apache');
        }

        try {
            await apacheSSLManager.checkPorts();
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

        // Lecture des logs Apache et Certbot
        const logs = {
            apache: {
                access: [],
                error: [],
                sslAccess: [],
                sslError: []
            },
            certbot: [],
            letsencrypt: []
        };

        try {
            // Logs Apache
            const apacheAccess = await apacheSSLManager.runCommand('tail', ['-n', lines, '/var/log/apache2/efc-backup-access.log']);
            logs.apache.access = apacheAccess.split('\n').filter(line => line.trim());
        } catch (error) {
            logs.apache.access = ['Fichier de log non trouvé'];
        }

        try {
            const apacheError = await apacheSSLManager.runCommand('tail', ['-n', lines, '/var/log/apache2/efc-backup-error.log']);
            logs.apache.error = apacheError.split('\n').filter(line => line.trim());
        } catch (error) {
            logs.apache.error = ['Fichier de log non trouvé'];
        }

        try {
            const apacheSSLAccess = await apacheSSLManager.runCommand('tail', ['-n', lines, '/var/log/apache2/efc-backup-ssl-access.log']);
            logs.apache.sslAccess = apacheSSLAccess.split('\n').filter(line => line.trim());
        } catch (error) {
            logs.apache.sslAccess = ['Fichier de log non trouvé'];
        }

        try {
            const apacheSSLError = await apacheSSLManager.runCommand('tail', ['-n', lines, '/var/log/apache2/efc-backup-ssl-error.log']);
            logs.apache.sslError = apacheSSLError.split('\n').filter(line => line.trim());
        } catch (error) {
            logs.apache.sslError = ['Fichier de log non trouvé'];
        }

        try {
            // Logs Certbot
            const certbotLogs = await apacheSSLManager.runCommand('tail', ['-n', lines, '/var/log/letsencrypt/letsencrypt.log']);
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

// Route pour obtenir la configuration Apache actuelle
router.get('/apache-config', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const fs = require('fs').promises;
        const configPath = '/etc/apache2/sites-available/efc-backup.conf';
        const sslConfigPath = '/etc/apache2/sites-available/efc-backup-ssl.conf';

        const configs = {};

        try {
            const config = await fs.readFile(configPath, 'utf8');
            configs.http = {
                exists: true,
                path: configPath,
                config
            };
        } catch (error) {
            configs.http = {
                exists: false,
                path: configPath,
                message: 'Configuration Apache HTTP non trouvée'
            };
        }

        try {
            const sslConfig = await fs.readFile(sslConfigPath, 'utf8');
            configs.ssl = {
                exists: true,
                path: sslConfigPath,
                config: sslConfig
            };
        } catch (error) {
            configs.ssl = {
                exists: false,
                path: sslConfigPath,
                message: 'Configuration Apache SSL non trouvée'
            };
        }
            
        res.json({
            configs,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Erreur lors de la lecture de la config Apache:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour les informations du certificat
router.get('/certificate-info', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const certPath = '/etc/letsencrypt/live/backup.efcinfo.com/fullchain.pem';
        
        try {
            const certInfo = await apacheSSLManager.runCommand('openssl', [
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