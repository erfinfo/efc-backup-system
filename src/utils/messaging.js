const nodemailer = require('nodemailer');
const axios = require('axios');
const { logger } = require('./logger');
const { getSetting, setSetting } = require('./database');
const { telusSMSService } = require('./sms-telus');

class MessagingService {
    constructor() {
        this.emailTransporter = null;
        this.smsConfig = {
            telusApiUrl: process.env.TELUS_SMS_API_URL || 'https://api.telus.com/sms/v1',
            telusApiKey: process.env.TELUS_API_KEY || '',
            telusPhoneNumber: '418-295-6002'
        };
        this.initializeEmailService();
    }

    async initializeEmailService() {
        try {
            const emailConfig = {
                host: process.env.SMTP_HOST || await getSetting('smtp_host'),
                port: parseInt(process.env.SMTP_PORT || await getSetting('smtp_port') || '587'),
                secure: false, // true pour 465, false pour autres ports
                auth: {
                    user: process.env.SMTP_USER || await getSetting('smtp_user'),
                    pass: process.env.SMTP_PASS || await getSetting('smtp_pass')
                },
                tls: {
                    rejectUnauthorized: false
                }
            };

            if (emailConfig.host && emailConfig.auth.user) {
                this.emailTransporter = nodemailer.createTransporter(emailConfig);
                
                // Vérifier la connexion
                await this.emailTransporter.verify();
                logger.info('Service email configuré et testé avec succès');
            } else {
                logger.warn('Configuration email incomplète - service désactivé');
            }
        } catch (error) {
            logger.error('Erreur lors de l\'initialisation du service email:', error);
            this.emailTransporter = null;
        }
    }

    async sendEmail(options) {
        if (!this.emailTransporter) {
            throw new Error('Service email non configuré');
        }

        const {
            to,
            subject,
            text,
            html,
            priority = 'normal'
        } = options;

        const emailOptions = {
            from: `"EFC Backup System" <${process.env.SMTP_USER || await getSetting('smtp_user')}>`,
            to,
            subject: `[EFC Backup] ${subject}`,
            text,
            html: html || this.generateHTMLEmail(subject, text),
            priority
        };

        try {
            const result = await this.emailTransporter.sendMail(emailOptions);
            logger.info(`Email envoyé avec succès à ${to}`, { messageId: result.messageId });
            return { success: true, messageId: result.messageId };
        } catch (error) {
            logger.error(`Erreur lors de l'envoi email à ${to}:`, error);
            throw error;
        }
    }

    async sendSMS(message, phoneNumber = null) {
        const targetNumber = phoneNumber || this.smsConfig.telusPhoneNumber;
        
        try {
            // Utiliser le service SMS Telus spécialisé
            if (targetNumber.includes('418-295-6002') || targetNumber.includes('4182956002')) {
                logger.info('Utilisation du service SMS Telus spécialisé');
                return await telusSMSService.sendSMS(message, targetNumber);
            }

            // Pour autres numéros, utiliser la méthode générique
            return await this.sendSMSGeneric(message, targetNumber);

        } catch (error) {
            logger.error(`Erreur lors de l'envoi SMS à ${targetNumber}:`, error);
            
            // Fallback: essayer d'envoyer par email si SMS échoue
            try {
                await this.sendSMSFallbackEmail(message, targetNumber);
                return { success: true, provider: 'email-fallback' };
            } catch (emailError) {
                throw new Error(`SMS et email fallback ont échoué: ${error.message}`);
            }
        }
    }

    async sendSMSGeneric(message, phoneNumber) {
        try {
            // Configuration pour l'API Telus SMS générique
            const smsData = {
                to: this.formatPhoneNumber(phoneNumber),
                message: `[EFC Backup] ${message}`,
                from: 'EFC-BACKUP'
            };

            // Méthode 1: API Telus officielle (si disponible)
            if (this.smsConfig.telusApiKey) {
                const response = await axios.post(
                    `${this.smsConfig.telusApiUrl}/send`,
                    smsData,
                    {
                        headers: {
                            'Authorization': `Bearer ${this.smsConfig.telusApiKey}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 10000
                    }
                );

                if (response.status === 200) {
                    logger.info(`SMS envoyé avec succès à ${phoneNumber}`, { response: response.data });
                    return { success: true, provider: 'telus', response: response.data };
                }
            }

            // Méthode 2: Service alternatif ou webhook Telus
            const alternativeResult = await this.sendSMSAlternative(message, phoneNumber);
            return alternativeResult;

        } catch (error) {
            throw new Error(`SMS générique échoué: ${error.message}`);
        }
    }

    async sendSMSAlternative(message, phoneNumber) {
        // Méthode alternative utilisant un service SMS générique
        // Peut être configuré avec d'autres fournisseurs SMS
        
        const alternativeConfig = {
            url: process.env.ALTERNATIVE_SMS_URL || 'https://api.twilio.com/sms', // Exemple
            apiKey: process.env.ALTERNATIVE_SMS_KEY || ''
        };

        if (!alternativeConfig.apiKey) {
            // Si aucune configuration alternative, simuler l'envoi pour les tests
            logger.warn(`SMS simulé vers ${phoneNumber}: ${message}`);
            return { 
                success: true, 
                provider: 'simulation', 
                message: 'SMS simulé en mode développement' 
            };
        }

        // Implémentation pour service SMS alternatif
        try {
            const response = await axios.post(alternativeConfig.url, {
                to: this.formatPhoneNumber(phoneNumber),
                body: message,
                from: 'EFC-BACKUP'
            }, {
                headers: {
                    'Authorization': `Bearer ${alternativeConfig.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            return { success: true, provider: 'alternative', response: response.data };
        } catch (error) {
            throw new Error(`Service SMS alternatif échoué: ${error.message}`);
        }
    }

    async sendSMSFallbackEmail(message, phoneNumber) {
        // Envoyer par email si SMS échoue
        const emailGateways = [
            `${phoneNumber.replace(/\D/g, '')}@msg.telus.com`, // Telus
            `${phoneNumber.replace(/\D/g, '')}@txt.bell.ca`,   // Bell
            `${phoneNumber.replace(/\D/g, '')}@fido.ca`        // Fido
        ];

        for (const gateway of emailGateways) {
            try {
                await this.sendEmail({
                    to: gateway,
                    subject: 'Alert EFC Backup',
                    text: message,
                    priority: 'high'
                });
                
                logger.info(`SMS envoyé via email gateway: ${gateway}`);
                return { success: true, method: 'email-gateway', gateway };
            } catch (error) {
                logger.warn(`Échec email gateway ${gateway}:`, error.message);
            }
        }

        throw new Error('Tous les gateways email ont échoué');
    }

    formatPhoneNumber(phoneNumber) {
        // Nettoyer et formater le numéro de téléphone
        let cleaned = phoneNumber.replace(/\D/g, '');
        
        // Ajouter le code pays canadien si nécessaire
        if (cleaned.length === 10) {
            cleaned = '1' + cleaned;
        }
        
        // Format: +1XXXXXXXXXX
        return '+' + cleaned;
    }

    generateHTMLEmail(subject, text) {
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    line-height: 1.6;
                    color: #333;
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                }
                .header {
                    background: linear-gradient(135deg, #4CAF50, #45a049);
                    color: white;
                    padding: 20px;
                    text-align: center;
                    border-radius: 8px 8px 0 0;
                }
                .content {
                    background: #f9f9f9;
                    padding: 30px;
                    border: 1px solid #ddd;
                }
                .footer {
                    background: #333;
                    color: white;
                    padding: 15px;
                    text-align: center;
                    border-radius: 0 0 8px 8px;
                    font-size: 12px;
                }
                .alert {
                    background: #fff3cd;
                    border: 1px solid #ffeaa7;
                    padding: 15px;
                    border-radius: 4px;
                    margin: 15px 0;
                }
                .logo {
                    font-size: 24px;
                    font-weight: bold;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="logo">🔒 EFC Backup System</div>
                <p>Système de sauvegarde professionnel</p>
            </div>
            <div class="content">
                <h2>${subject}</h2>
                <div class="alert">
                    <strong>Message automatique du système de backup EFC</strong>
                </div>
                <p>${text.replace(/\n/g, '<br>')}</p>
                <hr>
                <p><small>Timestamp: ${new Date().toLocaleString('fr-CA')}</small></p>
            </div>
            <div class="footer">
                <p><strong>EFC Informatique</strong></p>
                <p>Solutions informatiques professionnelles</p>
                <p>Email: support@efcinfo.com | Web: https://efcinfo.com</p>
            </div>
        </body>
        </html>
        `;
    }

    // Méthodes de notification pour différents événements

    async notifyBackupSuccess(clientName, backupDetails) {
        const message = `✅ Backup réussi pour ${clientName}
Taille: ${Math.round(backupDetails.size_mb || 0)} MB
Durée: ${Math.round(backupDetails.duration || 0)} min
Fichiers: ${backupDetails.file_count || 0}`;

        const notifications = [];

        // Email
        if (await this.shouldSendEmailNotification('success')) {
            notifications.push(
                this.sendEmail({
                    to: await this.getNotificationEmail(),
                    subject: `Backup réussi - ${clientName}`,
                    text: message,
                    priority: 'normal'
                })
            );
        }

        return Promise.allSettled(notifications);
    }

    async notifyBackupFailure(clientName, error) {
        const message = `❌ ÉCHEC Backup ${clientName}
Erreur: ${error}
Heure: ${new Date().toLocaleString('fr-CA')}
Action requise: Vérifier la configuration`;

        const notifications = [];

        // Email (toujours pour les échecs)
        notifications.push(
            this.sendEmail({
                to: await this.getNotificationEmail(),
                subject: `🚨 ÉCHEC Backup - ${clientName}`,
                text: message,
                priority: 'high'
            })
        );

        // SMS pour les échecs critiques
        if (await this.shouldSendSMSNotification()) {
            notifications.push(
                this.sendSMS(`ECHEC Backup ${clientName}: ${error}`)
            );
        }

        return Promise.allSettled(notifications);
    }

    async notifySystemAlert(alertType, message) {
        const fullMessage = `🚨 ALERTE SYSTÈME ${alertType}
${message}
Serveur: ${process.env.HOSTNAME || 'EFC-Backup'}
Heure: ${new Date().toLocaleString('fr-CA')}`;

        const notifications = [];

        // Email
        notifications.push(
            this.sendEmail({
                to: await this.getNotificationEmail(),
                subject: `🚨 Alerte Système - ${alertType}`,
                text: fullMessage,
                priority: 'high'
            })
        );

        // SMS pour alertes critiques
        if (['DISK_FULL', 'SERVICE_DOWN', 'SECURITY_BREACH'].includes(alertType)) {
            notifications.push(
                this.sendSMS(`ALERTE ${alertType}: ${message}`)
            );
        }

        return Promise.allSettled(notifications);
    }

    async sendTestMessage() {
        const testMessage = `Test du système de messaging EFC Backup
Heure: ${new Date().toLocaleString('fr-CA')}
Tous les services fonctionnent correctement.`;

        const results = await Promise.allSettled([
            this.sendEmail({
                to: await this.getNotificationEmail(),
                subject: 'Test du système de messaging',
                text: testMessage,
                priority: 'normal'
            }),
            this.sendSMS('Test SMS du système EFC Backup - Tout fonctionne!')
        ]);

        return {
            email: results[0],
            sms: results[1]
        };
    }

    // Méthodes de configuration

    async shouldSendEmailNotification(type = 'all') {
        const emailEnabled = await getSetting('email_notifications_enabled') === 'true';
        if (!emailEnabled) return false;

        switch (type) {
            case 'success':
                return await getSetting('notify_success') === 'true';
            case 'failure':
                return true; // Toujours notifier les échecs
            default:
                return true;
        }
    }

    async shouldSendSMSNotification() {
        return await getSetting('sms_notifications_enabled') === 'true';
    }

    async getNotificationEmail() {
        return await getSetting('notification_email') || 'admin@efcinfo.com';
    }

    async updateEmailConfig(config) {
        const { host, port, user, pass, enabled } = config;
        
        await setSetting('smtp_host', host);
        await setSetting('smtp_port', port.toString());
        await setSetting('smtp_user', user);
        await setSetting('smtp_pass', pass);
        await setSetting('email_notifications_enabled', enabled.toString());
        
        // Réinitialiser le service
        await this.initializeEmailService();
        
        logger.info('Configuration email mise à jour');
    }

    async updateSMSConfig(config) {
        const { enabled, phoneNumber } = config;
        
        await setSetting('sms_notifications_enabled', enabled.toString());
        if (phoneNumber) {
            this.smsConfig.telusPhoneNumber = phoneNumber;
            await setSetting('sms_phone_number', phoneNumber);
        }
        
        logger.info('Configuration SMS mise à jour');
    }
}

// Instance singleton
const messagingService = new MessagingService();

module.exports = {
    messagingService,
    MessagingService
};