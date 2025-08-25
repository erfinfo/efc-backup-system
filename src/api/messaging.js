const express = require('express');
const { messagingService } = require('../utils/messaging');
const { logger } = require('../utils/logger');
const AuthMiddleware = require('../middleware/auth');

const router = express.Router();

// Route pour tester le système de messaging
router.post('/test', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const { type = 'all' } = req.body;

        let results = {};

        if (type === 'email' || type === 'all') {
            try {
                const emailResult = await messagingService.sendEmail({
                    to: await messagingService.getNotificationEmail(),
                    subject: 'Test du système email',
                    text: `Test d'envoi d'email depuis EFC Backup System
Initié par: ${req.user.username}
Heure: ${new Date().toLocaleString('fr-CA')}
Statut: Service email fonctionnel`,
                    priority: 'normal'
                });
                results.email = { success: true, ...emailResult };
            } catch (error) {
                results.email = { success: false, error: error.message };
            }
        }

        if (type === 'sms' || type === 'all') {
            try {
                const smsResult = await messagingService.sendSMS(
                    `Test SMS EFC Backup - Initié par ${req.user.username} le ${new Date().toLocaleString('fr-CA')}`
                );
                results.sms = { success: true, ...smsResult };
            } catch (error) {
                results.sms = { success: false, error: error.message };
            }
        }

        logger.info(`Test messaging effectué par ${req.user.username}`, { results });

        res.json({
            success: true,
            message: 'Tests de messaging terminés',
            results
        });

    } catch (error) {
        logger.error('Erreur lors du test messaging:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour envoyer un message personnalisé
router.post('/send', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const { type, recipient, subject, message, priority = 'normal' } = req.body;

        if (!type || !message) {
            return res.status(400).json({ error: 'Type et message requis' });
        }

        let result = {};

        switch (type) {
            case 'email':
                if (!recipient || !subject) {
                    return res.status(400).json({ error: 'Destinataire et sujet requis pour email' });
                }
                
                result = await messagingService.sendEmail({
                    to: recipient,
                    subject,
                    text: message,
                    priority
                });
                break;

            case 'sms':
                result = await messagingService.sendSMS(message, recipient);
                break;

            default:
                return res.status(400).json({ error: 'Type de message non supporté' });
        }

        logger.info(`Message ${type} envoyé par ${req.user.username}`, { 
            recipient, 
            subject: subject || 'SMS',
            result 
        });

        res.json({
            success: true,
            message: `Message ${type} envoyé avec succès`,
            result
        });

    } catch (error) {
        logger.error('Erreur lors de l\'envoi de message:', error);
        res.status(500).json({ error: error.message });
    }
});

// Route pour configurer les notifications email
router.put('/config/email', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const { host, port, user, pass, enabled, notificationEmail, notifySuccess, notifyFailure } = req.body;

        if (!host || !port || !user || !pass) {
            return res.status(400).json({ error: 'Configuration SMTP incomplète' });
        }

        // Mettre à jour la configuration email
        await messagingService.updateEmailConfig({
            host,
            port: parseInt(port),
            user,
            pass,
            enabled: enabled === true
        });

        // Mettre à jour les préférences de notification
        const { setSetting } = require('../utils/database');
        if (notificationEmail) {
            await setSetting('notification_email', notificationEmail);
        }
        if (notifySuccess !== undefined) {
            await setSetting('notify_success', notifySuccess.toString());
        }
        if (notifyFailure !== undefined) {
            await setSetting('notify_failure', notifyFailure.toString());
        }

        logger.info(`Configuration email mise à jour par ${req.user.username}`);

        res.json({
            success: true,
            message: 'Configuration email mise à jour avec succès'
        });

    } catch (error) {
        logger.error('Erreur lors de la mise à jour config email:', error);
        res.status(500).json({ error: error.message });
    }
});

// Route pour configurer les notifications SMS
router.put('/config/sms', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const { enabled, phoneNumber, apiKey, provider = 'telus' } = req.body;

        // Mettre à jour la configuration SMS
        await messagingService.updateSMSConfig({
            enabled: enabled === true,
            phoneNumber
        });

        // Sauvegarder la configuration API si fournie
        const { setSetting } = require('../utils/database');
        if (apiKey) {
            await setSetting('sms_api_key', apiKey);
        }
        await setSetting('sms_provider', provider);

        logger.info(`Configuration SMS mise à jour par ${req.user.username}`);

        res.json({
            success: true,
            message: 'Configuration SMS mise à jour avec succès'
        });

    } catch (error) {
        logger.error('Erreur lors de la mise à jour config SMS:', error);
        res.status(500).json({ error: error.message });
    }
});

// Route pour obtenir la configuration actuelle
router.get('/config', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const { getSetting } = require('../utils/database');

        const config = {
            email: {
                host: await getSetting('smtp_host') || '',
                port: parseInt(await getSetting('smtp_port') || '587'),
                user: await getSetting('smtp_user') || '',
                enabled: (await getSetting('email_notifications_enabled')) === 'true',
                notificationEmail: await getSetting('notification_email') || '',
                notifySuccess: (await getSetting('notify_success')) === 'true',
                notifyFailure: (await getSetting('notify_failure')) !== 'false' // défaut true
            },
            sms: {
                enabled: (await getSetting('sms_notifications_enabled')) === 'true',
                phoneNumber: await getSetting('sms_phone_number') || '418-295-6002',
                provider: await getSetting('sms_provider') || 'telus',
                hasApiKey: !!(await getSetting('sms_api_key'))
            }
        };

        res.json({ config });

    } catch (error) {
        logger.error('Erreur lors de la récupération de la config messaging:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour les notifications de backup (appelée par le système)
router.post('/notify/backup-success', AuthMiddleware.authenticateToken, async (req, res) => {
    try {
        const { clientName, backupDetails } = req.body;

        if (!clientName) {
            return res.status(400).json({ error: 'Nom du client requis' });
        }

        const results = await messagingService.notifyBackupSuccess(clientName, backupDetails || {});

        res.json({
            success: true,
            message: 'Notifications de succès envoyées',
            results
        });

    } catch (error) {
        logger.error('Erreur lors de la notification backup success:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

router.post('/notify/backup-failure', AuthMiddleware.authenticateToken, async (req, res) => {
    try {
        const { clientName, error: backupError } = req.body;

        if (!clientName || !backupError) {
            return res.status(400).json({ error: 'Nom du client et erreur requis' });
        }

        const results = await messagingService.notifyBackupFailure(clientName, backupError);

        res.json({
            success: true,
            message: 'Notifications d\'échec envoyées',
            results
        });

    } catch (error) {
        logger.error('Erreur lors de la notification backup failure:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

router.post('/notify/system-alert', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const { alertType, message } = req.body;

        if (!alertType || !message) {
            return res.status(400).json({ error: 'Type d\'alerte et message requis' });
        }

        const results = await messagingService.notifySystemAlert(alertType, message);

        logger.info(`Alerte système envoyée par ${req.user.username}`, { alertType, message });

        res.json({
            success: true,
            message: 'Alerte système envoyée',
            results
        });

    } catch (error) {
        logger.error('Erreur lors de l\'envoi d\'alerte système:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour l'historique des messages (simulation)
router.get('/history', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const { limit = 50, type } = req.query;

        // Récupérer depuis les logs ou une table dédiée
        // Pour l'instant, on simule avec des données d'exemple
        const history = [
            {
                id: 1,
                type: 'email',
                recipient: 'admin@efcinfo.com',
                subject: 'Backup réussi - PC-Test-1',
                status: 'sent',
                timestamp: new Date(Date.now() - 3600000).toISOString(),
                result: 'Envoyé avec succès'
            },
            {
                id: 2,
                type: 'sms',
                recipient: '418-295-6002',
                subject: 'ECHEC Backup TestClient',
                status: 'sent',
                timestamp: new Date(Date.now() - 7200000).toISOString(),
                result: 'SMS simulé en développement'
            }
        ];

        const filteredHistory = type ? 
            history.filter(item => item.type === type) : 
            history;

        res.json({
            history: filteredHistory.slice(0, parseInt(limit)),
            total: filteredHistory.length
        });

    } catch (error) {
        logger.error('Erreur lors de la récupération de l\'historique:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

module.exports = router;