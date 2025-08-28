#!/usr/bin/env node

/**
 * Script de test pour le système d'internationalisation EFC Backup
 */

const http = require('http');

class I18nTester {
    constructor() {
        this.baseUrl = 'http://localhost:3001';
        this.results = {
            passed: 0,
            failed: 0,
            details: []
        };
    }

    /**
     * Test HTTP request
     */
    async makeRequest(path, headers = {}) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: '127.0.0.1',
                port: 3001,
                path: path,
                method: 'GET',
                headers: {
                    'User-Agent': 'EFC-I18n-Tester/1.0',
                    ...headers
                }
            };

            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: data
                    });
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.end();
        });
    }

    /**
     * Test page HTML avec français
     */
    async testFrenchHTML() {
        try {
            const response = await this.makeRequest('/', {
                'Accept-Language': 'fr-CA'
            });

            const hasFrenchTitle = response.body.includes('data-i18n="app_name"');
            const hasI18nElements = response.body.includes('data-i18n="dashboard"');
            const hasI18nScript = response.body.includes('i18n/i18n.js');

            return {
                success: hasFrenchTitle && hasI18nElements && hasI18nScript,
                message: `Page HTML - Elements i18n: ${hasI18nElements}, Script: ${hasI18nScript}`,
                details: { hasFrenchTitle, hasI18nElements, hasI18nScript }
            };
        } catch (error) {
            return {
                success: false,
                message: `Erreur page HTML: ${error.message}`,
                error: error
            };
        }
    }

    /**
     * Test page HTML avec anglais
     */
    async testEnglishHTML() {
        try {
            const response = await this.makeRequest('/', {
                'Accept-Language': 'en-CA'
            });

            const hasI18nElements = response.body.includes('data-i18n="clients"');
            const hasI18nScript = response.body.includes('i18n/i18n.js');

            return {
                success: hasI18nElements && hasI18nScript,
                message: `Page HTML anglaise - Elements: ${hasI18nElements}, Script: ${hasI18nScript}`,
                details: { hasI18nElements, hasI18nScript }
            };
        } catch (error) {
            return {
                success: false,
                message: `Erreur page HTML anglaise: ${error.message}`,
                error: error
            };
        }
    }

    /**
     * Test fichier translations JSON
     */
    async testTranslationsJSON() {
        try {
            const response = await this.makeRequest('/i18n/translations.json');

            if (response.statusCode !== 200) {
                return {
                    success: false,
                    message: `Fichier translations non accessible: ${response.statusCode}`
                };
            }

            const translations = JSON.parse(response.body);
            const hasFrench = translations['fr-CA'] && translations['fr-CA'].dashboard;
            const hasEnglish = translations['en-CA'] && translations['en-CA'].dashboard;
            const hasNotifications = translations['fr-CA'].notifications && translations['en-CA'].notifications;

            return {
                success: hasFrench && hasEnglish && hasNotifications,
                message: `Fichier JSON - FR: ${!!hasFrench}, EN: ${!!hasEnglish}, Notifications: ${!!hasNotifications}`,
                details: { hasFrench, hasEnglish, hasNotifications }
            };
        } catch (error) {
            return {
                success: false,
                message: `Erreur fichier JSON: ${error.message}`,
                error: error
            };
        }
    }

    /**
     * Test script i18n JavaScript
     */
    async testI18nScript() {
        try {
            const response = await this.makeRequest('/i18n/i18n.js');

            if (response.statusCode !== 200) {
                return {
                    success: false,
                    message: `Script i18n non accessible: ${response.statusCode}`
                };
            }

            const hasI18nManager = response.body.includes('class I18nManager');
            const hasTranslationMethod = response.body.includes('function t(key');
            const hasLanguageDetection = response.body.includes('detectLanguage');

            return {
                success: hasI18nManager && hasLanguageDetection,
                message: `Script i18n - Classe: ${!!hasI18nManager}, Detection: ${!!hasLanguageDetection}`,
                details: { hasI18nManager, hasTranslationMethod, hasLanguageDetection }
            };
        } catch (error) {
            return {
                success: false,
                message: `Erreur script i18n: ${error.message}`,
                error: error
            };
        }
    }

    /**
     * Ajouter un test
     */
    addResult(name, result) {
        if (result.success) {
            this.results.passed++;
            console.log(`✅ ${name}: ${result.message}`);
        } else {
            this.results.failed++;
            console.log(`❌ ${name}: ${result.message}`);
        }

        this.results.details.push({
            name,
            success: result.success,
            message: result.message,
            details: result.details || null
        });
    }

    /**
     * Exécuter tous les tests
     */
    async runAllTests() {
        console.log('🧪 Tests du système d\'internationalisation EFC Backup');
        console.log('=' .repeat(60));

        // Test 1: Page HTML française
        console.log('\n📝 Test page HTML française...');
        const frenchTest = await this.testFrenchHTML();
        this.addResult('Page HTML Française', frenchTest);

        // Test 2: Page HTML anglaise  
        console.log('\n📝 Test page HTML anglaise...');
        const englishTest = await this.testEnglishHTML();
        this.addResult('Page HTML Anglaise', englishTest);

        // Test 3: Fichier translations JSON
        console.log('\n📝 Test fichier translations JSON...');
        const jsonTest = await this.testTranslationsJSON();
        this.addResult('Fichier Translations JSON', jsonTest);

        // Test 4: Script i18n JavaScript
        console.log('\n📝 Test script i18n JavaScript...');
        const scriptTest = await this.testI18nScript();
        this.addResult('Script I18n JavaScript', scriptTest);

        // Rapport final
        this.generateReport();
    }

    /**
     * Générer le rapport final
     */
    generateReport() {
        console.log('\n' + '=' .repeat(60));
        console.log('📊 RAPPORT FINAL - SYSTÈME I18N');
        console.log('=' .repeat(60));

        const total = this.results.passed + this.results.failed;
        const successRate = Math.round((this.results.passed / total) * 100);

        console.log(`Tests exécutés: ${total}`);
        console.log(`Réussis: ${this.results.passed}`);
        console.log(`Échoués: ${this.results.failed}`);
        console.log(`Taux de réussite: ${successRate}%`);

        console.log('\n' + '-' .repeat(40));
        console.log('DÉTAILS:');
        this.results.details.forEach(detail => {
            const status = detail.success ? '✅' : '❌';
            console.log(`${status} ${detail.name}`);
        });

        console.log('\n' + '=' .repeat(60));
        
        if (this.results.failed > 0) {
            console.log('⚠️  Certains tests ont échoué.');
            console.log('💡 Vérifiez que le serveur est démarré sur le port 3001');
            process.exit(1);
        } else {
            console.log('🎉 Système d\'internationalisation opérationnel !');
            console.log('🌍 Le système EFC Backup supporte maintenant fr-CA et en-CA');
            process.exit(0);
        }
    }
}

// Exécution
if (require.main === module) {
    const tester = new I18nTester();
    
    // Attendre un peu que le serveur soit prêt
    setTimeout(() => {
        tester.runAllTests().catch(error => {
            console.error('❌ Erreur fatale lors des tests:', error);
            process.exit(1);
        });
    }, 1000);
}

module.exports = I18nTester;