const nodemailer = require('nodemailer');
const { logger } = require('./logger');

class NotificationService {
    constructor() {
        this.transporter = null;
        this.isConfigured = false;
        this.init();
    }

    init() {
        if (!process.env.SMTP_ENABLED || process.env.SMTP_ENABLED === 'false') {
            logger.info('Service de notifications email désactivé');
            return;
        }

        if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
            logger.warn('Configuration SMTP incomplète, notifications email désactivées');
            return;
        }

        try {
            this.transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: parseInt(process.env.SMTP_PORT || '587'),
                secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS,
                },
                tls: {
                    rejectUnauthorized: false // Allow self-signed certificates
                }
            });

            this.isConfigured = true;
            logger.info('Service de notifications email configuré');
        } catch (error) {
            logger.error('Erreur lors de la configuration du service email:', error);
        }
    }

    async sendEmail(to, subject, text, html = null) {
        if (!this.isConfigured) {
            logger.warn('Service email non configuré, impossible d\'envoyer l\'email');
            return false;
        }

        try {
            const mailOptions = {
                from: `"EFC Backup System" <${process.env.NOTIFICATION_EMAIL}>`,
                to: to,
                subject: `[EFC Backup] ${subject}`,
                text: text,
                html: html || this.generateHTMLEmail(subject, text)
            };

            const info = await this.transporter.sendMail(mailOptions);
            logger.info(`Email envoyé avec succès: ${info.messageId}`);
            return true;
        } catch (error) {
            logger.error('Erreur lors de l\'envoi de l\'email:', error);
            return false;
        }
    }

    generateHTMLEmail(subject, text) {
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>${subject}</title>
            <style>
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    margin: 0;
                    padding: 20px;
                    background-color: #f5f5f5;
                }
                .container {
                    max-width: 600px;
                    margin: 0 auto;
                    background-color: white;
                    border-radius: 8px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                    overflow: hidden;
                }
                .header {
                    background: linear-gradient(135deg, #5d8052, #a8d49a);
                    color: white;
                    padding: 20px;
                    text-align: center;
                }
                .header h1 {
                    margin: 0;
                    font-size: 24px;
                }
                .content {
                    padding: 30px;
                    line-height: 1.6;
                }
                .footer {
                    background-color: #f8f9fa;
                    padding: 20px;
                    text-align: center;
                    font-size: 12px;
                    color: #6c757d;
                }
                .status-success { color: #28a745; }
                .status-warning { color: #ffc107; }
                .status-error { color: #dc3545; }
                .logo {
                    width: 32px;
                    height: 32px;
                    display: inline-block;
                    vertical-align: middle;
                    margin-right: 10px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>EFC Backup System</h1>
                    <p>EFC Informatique - Solutions professionnelles</p>
                </div>
                <div class="content">
                    <h2>${subject}</h2>
                    <pre style="white-space: pre-wrap; font-family: inherit;">${text}</pre>
                    <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
                    <p><strong>Date:</strong> ${new Date().toLocaleString('fr-FR')}</p>
                    <p><strong>Serveur:</strong> ${process.env.HOSTNAME || 'EFC-Backup-Server'}</p>
                </div>
                <div class="footer">
                    <p>EFC Informatique - Système de backup professionnel</p>
                    <p>Site web: <a href="https://efcinfo.com">efcinfo.com</a> | Support: erick@efcinfo.com</p>
                </div>
            </div>
        </body>
        </html>
        `;
    }

    async sendBackupNotification(type, clientName, backupId, status, details = {}) {
        if (!this.shouldSendNotification(status)) {
            return false;
        }

        const recipient = process.env.NOTIFICATION_EMAIL;
        if (!recipient) {
            logger.warn('Aucun email de notification configuré');
            return false;
        }

        let subject, message, statusIcon;
        
        switch (status) {
            case 'completed':
                subject = `✅ Backup réussi - ${clientName}`;
                statusIcon = '✅';
                message = this.formatBackupSuccessMessage(type, clientName, backupId, details);
                break;
            case 'failed':
                subject = `❌ Backup échoué - ${clientName}`;
                statusIcon = '❌';
                message = this.formatBackupFailureMessage(type, clientName, backupId, details);
                break;
            case 'started':
                subject = `🔄 Backup démarré - ${clientName}`;
                statusIcon = '🔄';
                message = this.formatBackupStartedMessage(type, clientName, backupId, details);
                break;
            default:
                return false;
        }

        return await this.sendEmail(recipient, subject, message);
    }

    formatBackupSuccessMessage(type, clientName, backupId, details) {
        const duration = details.duration ? ` (${Math.round(details.duration / 1000 / 60)} min)` : '';
        const size = details.size_mb ? ` - ${details.size_mb} MB` : '';
        const fileCount = details.file_count ? ` - ${details.file_count} fichiers` : '';
        
        return `
Backup terminé avec succès !

Client: ${clientName}
Type: ${type}
ID: ${backupId}
Durée: ${duration}
Taille: ${size}
Fichiers: ${fileCount}

${details.folders ? `Dossiers sauvegardés:\n${details.folders.join('\n')}` : ''}

${details.notes ? `Notes:\n${details.notes}` : ''}
        `.trim();
    }

    formatBackupFailureMessage(type, clientName, backupId, details) {
        return `
❌ ÉCHEC DU BACKUP ❌

Client: ${clientName}
Type: ${type}
ID: ${backupId}

Erreur: ${details.error || 'Erreur inconnue'}

${details.partial_results ? `Résultats partiels:\n${JSON.stringify(details.partial_results, null, 2)}` : ''}

Action recommandée:
1. Vérifier la connectivité SSH avec le client
2. Vérifier l'espace disque disponible
3. Consulter les logs détaillés
4. Relancer un backup manuel si nécessaire

Logs: Consultez l'interface web ou les fichiers de logs du serveur.
        `.trim();
    }

    formatBackupStartedMessage(type, clientName, backupId, details) {
        return `
Backup en cours de démarrage...

Client: ${clientName}
Type: ${type}
ID: ${backupId}
Heure de début: ${new Date().toLocaleString('fr-FR')}

${details.folders ? `Dossiers à sauvegarder:\n${details.folders.join('\n')}` : ''}

Ce backup sera suivi automatiquement. Vous recevrez une notification à la fin.
        `.trim();
    }

    shouldSendNotification(status) {
        switch (status) {
            case 'completed':
                return process.env.SEND_SUCCESS_NOTIFICATIONS === 'true';
            case 'failed':
                return process.env.SEND_FAILURE_NOTIFICATIONS !== 'false'; // Envoi par défaut
            case 'started':
                return process.env.SEND_START_NOTIFICATIONS === 'true';
            default:
                return false;
        }
    }

    async sendSystemAlert(level, title, message, details = {}) {
        const recipient = process.env.NOTIFICATION_EMAIL;
        if (!recipient) return false;

        const levelIcons = {
            'info': 'ℹ️',
            'warning': '⚠️',
            'error': '🚨',
            'critical': '🔥'
        };

        const icon = levelIcons[level] || 'ℹ️';
        const subject = `${icon} Alerte Système - ${title}`;
        
        const fullMessage = `
Alerte système EFC Backup

Niveau: ${level.toUpperCase()}
Titre: ${title}

Message:
${message}

${Object.keys(details).length > 0 ? `Détails:\n${JSON.stringify(details, null, 2)}` : ''}

Serveur: ${process.env.HOSTNAME || 'EFC-Backup-Server'}
Timestamp: ${new Date().toISOString()}
        `.trim();

        return await this.sendEmail(recipient, subject, fullMessage);
    }

    async sendMaintenanceNotification(type, message, scheduledTime = null) {
        const recipient = process.env.NOTIFICATION_EMAIL;
        if (!recipient) return false;

        let subject, fullMessage;
        
        switch (type) {
            case 'scheduled':
                subject = '🔧 Maintenance programmée';
                fullMessage = `
Maintenance programmée du système EFC Backup

${message}

${scheduledTime ? `Heure prévue: ${scheduledTime}` : ''}

Cette maintenance peut temporairement interrompre les backups automatiques.
Les backups reprendront automatiquement après la maintenance.
                `.trim();
                break;
                
            case 'completed':
                subject = '✅ Maintenance terminée';
                fullMessage = `
Maintenance du système EFC Backup terminée

${message}

Le système est maintenant opérationnel.
Les backups automatiques ont repris normalement.
                `.trim();
                break;
                
            case 'emergency':
                subject = '🚨 Maintenance d\'urgence';
                fullMessage = `
MAINTENANCE D'URGENCE EN COURS

${message}

Cette maintenance d'urgence peut affecter les backups en cours.
Nous vous tiendrons informés de l'évolution.
                `.trim();
                break;
                
            default:
                return false;
        }

        return await this.sendEmail(recipient, subject, fullMessage);
    }

    async testConfiguration(sendTestEmail = false) {
        if (!this.isConfigured) {
            return {
                success: false,
                error: 'Service email non configuré'
            };
        }

        try {
            await this.transporter.verify();
            
            // Envoyer un email de test seulement si explicitement demandé
            if (sendTestEmail) {
                const testRecipient = process.env.NOTIFICATION_EMAIL;
                if (testRecipient) {
                    const sent = await this.sendEmail(
                        testRecipient,
                        'Test de configuration',
                        'Ceci est un email de test pour vérifier la configuration du système de notifications EFC Backup.\n\nSi vous recevez cet email, la configuration est correcte.'
                    );
                    
                    return {
                        success: sent,
                        message: sent ? 'Email de test envoyé avec succès' : 'Erreur lors de l\'envoi de l\'email de test'
                    };
                }
            }
            
            return {
                success: true,
                message: 'Configuration SMTP valide'
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    async getNotificationStats() {
        // Cette fonction pourrait être étendue pour tracker les statistiques d'envoi
        return {
            configured: this.isConfigured,
            smtpHost: process.env.SMTP_HOST || null,
            recipient: process.env.NOTIFICATION_EMAIL || null,
            successNotifications: process.env.SEND_SUCCESS_NOTIFICATIONS === 'true',
            failureNotifications: process.env.SEND_FAILURE_NOTIFICATIONS !== 'false'
        };
    }
}

// Instance singleton
const notificationService = new NotificationService();

// Fonctions d'interface simplifiée
const sendNotification = async (subject, message, type = 'info') => {
    const recipient = process.env.NOTIFICATION_EMAIL;
    if (!recipient) {
        logger.warn('Aucun destinataire configuré pour les notifications');
        return false;
    }

    const typeIcons = {
        'info': 'ℹ️',
        'success': '✅',
        'warning': '⚠️',
        'error': '❌'
    };

    const icon = typeIcons[type] || 'ℹ️';
    return await notificationService.sendEmail(recipient, `${icon} ${subject}`, message);
};

const sendBackupNotification = async (type, clientName, backupId, status, details = {}) => {
    return await notificationService.sendBackupNotification(type, clientName, backupId, status, details);
};

const sendSystemAlert = async (level, title, message, details = {}) => {
    return await notificationService.sendSystemAlert(level, title, message, details);
};

const testNotificationConfig = async () => {
    return await notificationService.testConfiguration();
};

module.exports = {
    notificationService,
    sendNotification,
    sendBackupNotification,
    sendSystemAlert,
    testNotificationConfig
};