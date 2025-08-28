/**
 * EFC Backup System - Server-side Internationalization
 * Lightweight i18n for backend error messages and API responses
 */

const fs = require('fs');
const path = require('path');

class ServerI18n {
    constructor() {
        this.translations = {};
        this.defaultLanguage = 'fr-CA';
        this.currentLanguage = 'fr-CA';
        this.loadTranslations();
    }

    /**
     * Load translations from frontend JSON file
     */
    loadTranslations() {
        try {
            const translationPath = path.join(__dirname, '../../web/i18n/translations.json');
            const data = fs.readFileSync(translationPath, 'utf8');
            this.translations = JSON.parse(data);
            console.log('EFC i18n Server: Loaded translations for', Object.keys(this.translations).join(', '));
        } catch (error) {
            console.error('EFC i18n Server: Failed to load translations:', error.message);
            // Fallback translations in case file is missing
            this.translations = {
                'fr-CA': {
                    'error_occurred': 'Une erreur s\'est produite',
                    'success_message': 'Opération réussie',
                    'processing': 'Traitement...',
                    'notifications': {
                        'backup_started': 'Sauvegarde démarrée pour {client}',
                        'backup_completed': 'Sauvegarde terminée avec succès',
                        'backup_failed': 'Échec de la sauvegarde',
                        'connection_test_success': 'Test de connexion réussi',
                        'connection_test_failed': 'Échec du test de connexion',
                        'settings_saved': 'Paramètres sauvegardés avec succès',
                        'invalid_credentials': 'Identifiants invalides',
                        'permission_denied': 'Permission refusée',
                        'network_error': 'Erreur de réseau',
                        'server_error': 'Erreur serveur'
                    },
                    'errors': {
                        'required_field': 'Ce champ est obligatoire',
                        'invalid_email': 'Adresse courriel invalide',
                        'password_too_short': 'Mot de passe trop court',
                        'client_not_found': 'Client non trouvé',
                        'authentication_failed': 'Échec de l\'authentification'
                    }
                },
                'en-CA': {
                    'error_occurred': 'An error occurred',
                    'success_message': 'Operation successful',
                    'processing': 'Processing...',
                    'notifications': {
                        'backup_started': 'Backup started for {client}',
                        'backup_completed': 'Backup completed successfully',
                        'backup_failed': 'Backup failed',
                        'connection_test_success': 'Connection test successful',
                        'connection_test_failed': 'Connection test failed',
                        'settings_saved': 'Settings saved successfully',
                        'invalid_credentials': 'Invalid credentials',
                        'permission_denied': 'Permission denied',
                        'network_error': 'Network error',
                        'server_error': 'Server error'
                    },
                    'errors': {
                        'required_field': 'This field is required',
                        'invalid_email': 'Invalid email address',
                        'password_too_short': 'Password too short',
                        'client_not_found': 'Client not found',
                        'authentication_failed': 'Authentication failed'
                    }
                }
            };
        }
    }

    /**
     * Set current language based on request headers or parameter
     */
    setLanguage(langCode) {
        if (this.translations[langCode]) {
            this.currentLanguage = langCode;
        } else {
            this.currentLanguage = this.defaultLanguage;
        }
    }

    /**
     * Detect language from HTTP request
     */
    detectLanguageFromRequest(req) {
        // Check query parameter first
        if (req.query.lang && this.translations[req.query.lang]) {
            return req.query.lang;
        }

        // Check Accept-Language header
        const acceptLanguage = req.get('Accept-Language');
        if (acceptLanguage) {
            // Simple parsing - look for fr or en
            if (acceptLanguage.includes('fr')) {
                return 'fr-CA';
            }
            if (acceptLanguage.includes('en')) {
                return 'en-CA';
            }
        }

        return this.defaultLanguage;
    }

    /**
     * Get translation for a key
     */
    t(key, params = {}) {
        const translation = this.getNestedTranslation(key);
        
        if (!translation) {
            console.warn(`EFC i18n Server: Missing translation for key: ${key} (${this.currentLanguage})`);
            return key;
        }

        return this.interpolate(translation, params);
    }

    /**
     * Get nested translation using dot notation
     */
    getNestedTranslation(key) {
        const langData = this.translations[this.currentLanguage];
        if (!langData) return null;

        const keys = key.split('.');
        let current = langData;

        for (const k of keys) {
            if (current && typeof current === 'object' && k in current) {
                current = current[k];
            } else {
                // Try fallback language
                const fallbackData = this.translations[this.defaultLanguage];
                if (fallbackData) {
                    let fallbackCurrent = fallbackData;
                    for (const fk of keys) {
                        if (fallbackCurrent && typeof fallbackCurrent === 'object' && fk in fallbackCurrent) {
                            fallbackCurrent = fallbackCurrent[fk];
                        } else {
                            return null;
                        }
                    }
                    return fallbackCurrent;
                }
                return null;
            }
        }

        return current;
    }

    /**
     * Interpolate parameters into translation string
     */
    interpolate(translation, params) {
        if (!params || Object.keys(params).length === 0) {
            return translation;
        }

        return translation.replace(/\{(\w+)\}/g, (match, key) => {
            return params[key] !== undefined ? params[key] : match;
        });
    }

    /**
     * Create middleware for Express.js
     */
    middleware() {
        return (req, res, next) => {
            // Detect language from request
            const detectedLang = this.detectLanguageFromRequest(req);
            this.setLanguage(detectedLang);
            
            // Add translation function to request
            req.t = (key, params = {}) => this.t(key, params);
            
            // Add language info to request
            req.language = this.currentLanguage;
            
            next();
        };
    }
}

// Create global instance
const serverI18n = new ServerI18n();

module.exports = serverI18n;