const axios = require('axios');
const { logger } = require('./logger');

/**
 * Service SMS spécialisé pour Telus Canada
 * Configuration pour le numéro 418-295-6002
 */
class TelusSMSService {
    constructor() {
        this.config = {
            // Configuration Telus officielle
            apiUrl: process.env.TELUS_SMS_API_URL || 'https://api.telus.com/messaging/v1',
            apiKey: process.env.TELUS_API_KEY || '',
            clientId: process.env.TELUS_CLIENT_ID || '',
            clientSecret: process.env.TELUS_CLIENT_SECRET || '',
            
            // Numéro de destination
            targetNumber: '418-295-6002',
            
            // Configuration alternative via webhook ou service tiers
            webhookUrl: process.env.TELUS_WEBHOOK_URL || '',
            
            // Email-to-SMS gateway Telus
            emailGateway: '4182956002@msg.telus.com'
        };
        
        this.accessToken = null;
        this.tokenExpiry = null;
    }

    /**
     * Méthode principale pour envoyer un SMS
     */
    async sendSMS(message, phoneNumber = null) {
        const targetNumber = phoneNumber || this.config.targetNumber;
        
        logger.info(`Tentative d'envoi SMS Telus vers ${targetNumber}`, { message });

        try {
            // Méthode 1: API Telus officielle
            if (this.config.apiKey && this.config.clientId) {
                return await this.sendViaOfficialAPI(message, targetNumber);
            }

            // Méthode 2: Webhook configuré
            if (this.config.webhookUrl) {
                return await this.sendViaWebhook(message, targetNumber);
            }

            // Méthode 3: Email-to-SMS gateway
            return await this.sendViaEmailGateway(message, targetNumber);

        } catch (error) {
            logger.error('Erreur envoi SMS Telus:', error);
            
            // Dernière tentative: Email gateway
            try {
                return await this.sendViaEmailGateway(message, targetNumber);
            } catch (fallbackError) {
                throw new Error(`Toutes les méthodes SMS Telus ont échoué: ${error.message}`);
            }
        }
    }

    /**
     * Envoi via l'API officielle Telus
     */
    async sendViaOfficialAPI(message, phoneNumber) {
        try {
            // Obtenir un token d'accès si nécessaire
            await this.ensureValidAccessToken();

            const formattedNumber = this.formatTelusPhoneNumber(phoneNumber);
            
            const requestData = {
                from: 'EFC-BACKUP',
                to: formattedNumber,
                body: this.formatMessage(message),
                messageClass: 'promotional' // ou 'transactional'
            };

            const response = await axios.post(
                `${this.config.apiUrl}/sms`,
                requestData,
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    timeout: 15000
                }
            );

            if (response.status === 200 || response.status === 201) {
                logger.info('SMS Telus envoyé avec succès via API officielle', {
                    messageId: response.data.messageId,
                    phoneNumber: formattedNumber
                });

                return {
                    success: true,
                    provider: 'telus-official',
                    messageId: response.data.messageId,
                    response: response.data
                };
            } else {
                throw new Error(`API Telus erreur: ${response.status} - ${response.statusText}`);
            }

        } catch (error) {
            logger.error('Erreur API officielle Telus:', error);
            throw error;
        }
    }

    /**
     * Envoi via webhook configuré
     */
    async sendViaWebhook(message, phoneNumber) {
        try {
            const webhookData = {
                phone: this.formatTelusPhoneNumber(phoneNumber),
                message: this.formatMessage(message),
                provider: 'telus',
                timestamp: new Date().toISOString(),
                source: 'efc-backup'
            };

            const response = await axios.post(
                this.config.webhookUrl,
                webhookData,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'EFC-Backup-SMS/1.0'
                    },
                    timeout: 10000
                }
            );

            if (response.status >= 200 && response.status < 300) {
                logger.info('SMS Telus envoyé via webhook', {
                    webhookUrl: this.config.webhookUrl,
                    phoneNumber
                });

                return {
                    success: true,
                    provider: 'telus-webhook',
                    response: response.data
                };
            } else {
                throw new Error(`Webhook erreur: ${response.status}`);
            }

        } catch (error) {
            logger.error('Erreur webhook Telus:', error);
            throw error;
        }
    }

    /**
     * Envoi via email-to-SMS gateway Telus
     */
    async sendViaEmailGateway(message, phoneNumber) {
        try {
            const { messagingService } = require('./messaging');
            
            // Construire l'adresse email gateway
            const cleanNumber = phoneNumber.replace(/\D/g, '');
            let emailGateway;
            
            // Déterminer le gateway selon le numéro
            if (cleanNumber.startsWith('418') || cleanNumber.startsWith('1418')) {
                emailGateway = `${cleanNumber.slice(-10)}@msg.telus.com`;
            } else {
                emailGateway = this.config.emailGateway;
            }

            const emailResult = await messagingService.sendEmail({
                to: emailGateway,
                subject: '', // Souvent ignoré par les gateways SMS
                text: this.formatMessage(message),
                priority: 'high'
            });

            logger.info('SMS Telus envoyé via email gateway', {
                gateway: emailGateway,
                phoneNumber,
                emailResult
            });

            return {
                success: true,
                provider: 'telus-email-gateway',
                gateway: emailGateway,
                emailResult
            };

        } catch (error) {
            logger.error('Erreur email gateway Telus:', error);
            throw error;
        }
    }

    /**
     * Obtenir un token d'accès OAuth2 pour l'API Telus
     */
    async ensureValidAccessToken() {
        if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
            return; // Token encore valide
        }

        try {
            const tokenData = {
                grant_type: 'client_credentials',
                client_id: this.config.clientId,
                client_secret: this.config.clientSecret,
                scope: 'messaging:sms:send'
            };

            const response = await axios.post(
                `${this.config.apiUrl}/oauth2/token`,
                new URLSearchParams(tokenData),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    timeout: 10000
                }
            );

            if (response.data.access_token) {
                this.accessToken = response.data.access_token;
                this.tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000; // 1 minute de marge

                logger.info('Token d\'accès Telus obtenu avec succès');
            } else {
                throw new Error('Aucun token d\'accès reçu');
            }

        } catch (error) {
            logger.error('Erreur lors de l\'obtention du token Telus:', error);
            throw new Error(`Impossible d'obtenir le token Telus: ${error.message}`);
        }
    }

    /**
     * Formater le numéro de téléphone pour Telus
     */
    formatTelusPhoneNumber(phoneNumber) {
        let cleaned = phoneNumber.replace(/\D/g, '');
        
        // Numéros québécois avec 418
        if (cleaned.length === 10 && cleaned.startsWith('418')) {
            return `+1${cleaned}`;
        }
        
        // Numéros canadiens
        if (cleaned.length === 10) {
            return `+1${cleaned}`;
        }
        
        // Déjà formaté avec code pays
        if (cleaned.length === 11 && cleaned.startsWith('1')) {
            return `+${cleaned}`;
        }
        
        return `+1${cleaned}`;
    }

    /**
     * Formater le message pour les SMS
     */
    formatMessage(message) {
        // Limiter à 160 caractères pour SMS standard
        const prefix = '[EFC] ';
        const maxLength = 160 - prefix.length;
        
        let formattedMessage = message;
        if (formattedMessage.length > maxLength) {
            formattedMessage = formattedMessage.substring(0, maxLength - 3) + '...';
        }
        
        return prefix + formattedMessage;
    }

    /**
     * Tester la configuration
     */
    async testConfiguration() {
        const testMessage = `Test EFC Backup ${new Date().toLocaleTimeString('fr-CA')}`;
        
        try {
            const result = await this.sendSMS(testMessage);
            
            logger.info('Test SMS Telus réussi', result);
            
            return {
                success: true,
                message: 'Configuration SMS Telus fonctionnelle',
                provider: result.provider,
                details: result
            };

        } catch (error) {
            logger.error('Test SMS Telus échoué:', error);
            
            return {
                success: false,
                message: 'Configuration SMS Telus défaillante',
                error: error.message
            };
        }
    }

    /**
     * Obtenir le statut de la configuration
     */
    getConfigurationStatus() {
        const status = {
            officialAPI: !!(this.config.apiKey && this.config.clientId),
            webhook: !!this.config.webhookUrl,
            emailGateway: true, // Toujours disponible
            targetNumber: this.config.targetNumber
        };

        const availableMethods = Object.entries(status)
            .filter(([key, value]) => key !== 'targetNumber' && value)
            .map(([key]) => key);

        return {
            configured: availableMethods.length > 0,
            methods: availableMethods,
            status,
            recommendation: this.getRecommendation(status)
        };
    }

    getRecommendation(status) {
        if (status.officialAPI) {
            return 'Configuration optimale avec API officielle Telus';
        } else if (status.webhook) {
            return 'Configuration via webhook - fiable';
        } else if (status.emailGateway) {
            return 'Configuration de base via email gateway - peut avoir des délais';
        } else {
            return 'Aucune méthode SMS configurée';
        }
    }
}

// Instance singleton
const telusSMSService = new TelusSMSService();

module.exports = {
    telusSMSService,
    TelusSMSService
};