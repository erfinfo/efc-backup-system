/**
 * EFC Backup System - Internationalization Manager
 * Supports French Canadian (fr-CA) and English Canadian (en-CA)
 */

class I18nManager {
    constructor() {
        this.currentLanguage = 'fr-CA';
        this.translations = {};
        this.fallbackLanguage = 'fr-CA';
        this.supportedLanguages = ['fr-CA', 'en-CA'];
        
        // Language preferences key for localStorage
        this.storageKey = 'efc-backup-language';
        
        // Load translations on initialization
        this.loadTranslations();
    }

    /**
     * Load translations from JSON file
     */
    async loadTranslations() {
        try {
            const response = await fetch('/i18n/translations.json');
            this.translations = await response.json();
            
            // Detect and set initial language
            this.detectLanguage();
            
            // Apply translations to current page
            this.applyTranslations();
            
            console.log(`EFC i18n: Loaded translations for ${Object.keys(this.translations).join(', ')}`);
        } catch (error) {
            console.error('EFC i18n: Failed to load translations:', error);
            // Fallback to French if loading fails
            this.currentLanguage = this.fallbackLanguage;
        }
    }

    /**
     * Detect user's preferred language
     * Priority: localStorage > browser language > default
     */
    detectLanguage() {
        // Check localStorage first
        const savedLanguage = localStorage.getItem(this.storageKey);
        if (savedLanguage && this.supportedLanguages.includes(savedLanguage)) {
            this.currentLanguage = savedLanguage;
            return;
        }

        // Check browser language
        const browserLang = navigator.language || navigator.userLanguage;
        
        if (browserLang) {
            // Direct match (e.g., 'fr-CA')
            if (this.supportedLanguages.includes(browserLang)) {
                this.currentLanguage = browserLang;
                return;
            }
            
            // Partial match (e.g., 'fr' matches 'fr-CA')
            const langCode = browserLang.split('-')[0];
            const matchedLang = this.supportedLanguages.find(lang => lang.startsWith(langCode));
            if (matchedLang) {
                this.currentLanguage = matchedLang;
                return;
            }
        }

        // Default to French Canadian
        this.currentLanguage = this.fallbackLanguage;
    }

    /**
     * Get translation for a key
     * @param {string} key - Translation key (supports nested keys with dots)
     * @param {object} params - Parameters for string interpolation
     * @returns {string} Translated text
     */
    t(key, params = {}) {
        const translation = this.getNestedTranslation(key);
        
        if (!translation) {
            console.warn(`EFC i18n: Missing translation for key: ${key} (${this.currentLanguage})`);
            return key; // Return key as fallback
        }

        // Handle string interpolation
        return this.interpolate(translation, params);
    }

    /**
     * Get nested translation using dot notation
     * @param {string} key - Key with possible dots (e.g., 'notifications.backup_started')
     * @returns {string|null} Translation or null if not found
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
                const fallbackData = this.translations[this.fallbackLanguage];
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
     * @param {string} translation - Translation with placeholders
     * @param {object} params - Parameters to interpolate
     * @returns {string} Interpolated string
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
     * Change current language
     * @param {string} langCode - Language code (e.g., 'en-CA')
     */
    async setLanguage(langCode) {
        if (!this.supportedLanguages.includes(langCode)) {
            console.error(`EFC i18n: Unsupported language: ${langCode}`);
            return;
        }

        this.currentLanguage = langCode;
        
        // Save to localStorage
        localStorage.setItem(this.storageKey, langCode);
        
        // Apply translations to current page
        this.applyTranslations();
        
        // Trigger language change event
        window.dispatchEvent(new CustomEvent('languageChanged', { 
            detail: { language: langCode } 
        }));

        console.log(`EFC i18n: Language changed to ${langCode}`);
    }

    /**
     * Get current language
     * @returns {string} Current language code
     */
    getCurrentLanguage() {
        return this.currentLanguage;
    }

    /**
     * Get supported languages
     * @returns {array} Array of supported language codes
     */
    getSupportedLanguages() {
        return this.supportedLanguages;
    }

    /**
     * Get language name for display
     * @param {string} langCode - Language code
     * @returns {string} Human readable language name
     */
    getLanguageName(langCode) {
        const names = {
            'fr-CA': 'Français (Canada)',
            'en-CA': 'English (Canada)'
        };
        return names[langCode] || langCode;
    }

    /**
     * Apply translations to all elements with data-i18n attribute
     */
    applyTranslations() {
        // Translate elements with data-i18n attribute
        const elements = document.querySelectorAll('[data-i18n]');
        elements.forEach(element => {
            const key = element.getAttribute('data-i18n');
            const translation = this.t(key);
            
            // Check if element has data-i18n-attr for attribute translation
            const attrName = element.getAttribute('data-i18n-attr');
            if (attrName) {
                element.setAttribute(attrName, translation);
            } else {
                // Default to innerHTML
                element.innerHTML = translation;
            }
        });

        // Translate placeholders
        const placeholderElements = document.querySelectorAll('[data-i18n-placeholder]');
        placeholderElements.forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            const translation = this.t(key);
            element.setAttribute('placeholder', translation);
        });

        // Translate titles
        const titleElements = document.querySelectorAll('[data-i18n-title]');
        titleElements.forEach(element => {
            const key = element.getAttribute('data-i18n-title');
            const translation = this.t(key);
            element.setAttribute('title', translation);
        });

        // Update page title
        const pageTitleElement = document.querySelector('title');
        if (pageTitleElement) {
            pageTitleElement.textContent = this.t('app_name');
        }

        // Update language selector if exists
        this.updateLanguageSelector();
    }

    /**
     * Update language selector dropdown
     */
    updateLanguageSelector() {
        const selector = document.getElementById('language-selector');
        if (selector) {
            selector.value = this.currentLanguage;
        }
    }

    /**
     * Create and inject language selector into navbar
     */
    createLanguageSelector() {
        // Check if selector already exists
        if (document.getElementById('language-selector-container')) {
            return;
        }

        const container = document.createElement('div');
        container.id = 'language-selector-container';
        container.className = 'language-selector-container';
        container.innerHTML = `
            <select id="language-selector" class="language-selector" title="${this.t('select_language')}">
                <option value="fr-CA">🇨🇦 Français</option>
                <option value="en-CA">🇨🇦 English</option>
            </select>
        `;

        // Add to navbar
        const navbar = document.querySelector('.header .nav-right') || 
                     document.querySelector('.header') || 
                     document.querySelector('header');
        
        if (navbar) {
            navbar.appendChild(container);
            
            // Add event listener
            const selector = document.getElementById('language-selector');
            selector.addEventListener('change', (e) => {
                this.setLanguage(e.target.value);
            });
            
            // Set current value
            selector.value = this.currentLanguage;
        }
    }

    /**
     * Format date according to current locale
     * @param {Date|string} date - Date to format
     * @param {object} options - Intl.DateTimeFormat options
     * @returns {string} Formatted date
     */
    formatDate(date, options = {}) {
        const dateObj = typeof date === 'string' ? new Date(date) : date;
        const locale = this.currentLanguage;
        
        const defaultOptions = {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        };

        return new Intl.DateTimeFormat(locale, { ...defaultOptions, ...options })
            .format(dateObj);
    }

    /**
     * Format number according to current locale
     * @param {number} number - Number to format
     * @param {object} options - Intl.NumberFormat options
     * @returns {string} Formatted number
     */
    formatNumber(number, options = {}) {
        const locale = this.currentLanguage;
        return new Intl.NumberFormat(locale, options).format(number);
    }

    /**
     * Format file size with localized units
     * @param {number} bytes - Size in bytes
     * @returns {string} Formatted size
     */
    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        
        const units = this.currentLanguage === 'fr-CA' ? 
            ['o', 'Ko', 'Mo', 'Go', 'To'] : 
            ['B', 'KB', 'MB', 'GB', 'TB'];
        
        const k = 1024;
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        const size = (bytes / Math.pow(k, i)).toFixed(1);
        
        return `${this.formatNumber(parseFloat(size))} ${units[i]}`;
    }
}

// Create global instance
window.i18n = new I18nManager();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.i18n.createLanguageSelector();
    });
} else {
    window.i18n.createLanguageSelector();
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = I18nManager;
}