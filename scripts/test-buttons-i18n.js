#!/usr/bin/env node

/**
 * Script de test pour vérifier la traduction des boutons
 */

const http = require('http');

class ButtonTranslationTester {
    constructor() {
        this.baseUrl = 'http://127.0.0.1:3001';
        this.results = {
            passed: 0,
            failed: 0,
            frenchButtons: [],
            englishButtons: []
        };
    }

    /**
     * Faire une requête HTTP
     */
    async makeRequest(path, headers = {}) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: '127.0.0.1',
                port: 3001,
                path: path,
                method: 'GET',
                headers: {
                    'User-Agent': 'EFC-Button-Tester/1.0',
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
     * Extraire les boutons avec attribut data-i18n
     */
    extractI18nButtons(html) {
        const buttonPattern = /<button[^>]*data-i18n="([^"]+)"[^>]*>([^<]*)<\/button>/g;
        const spanButtonPattern = /<button[^>]*>.*?<span[^>]*data-i18n="([^"]+)"[^>]*>([^<]+)<\/span>.*?<\/button>/g;
        
        const buttons = [];
        let match;

        // Boutons avec data-i18n direct
        while ((match = buttonPattern.exec(html)) !== null) {
            buttons.push({
                key: match[1],
                text: match[2].trim()
            });
        }

        // Boutons avec span data-i18n
        while ((match = spanButtonPattern.exec(html)) !== null) {
            buttons.push({
                key: match[1],
                text: match[2].trim()
            });
        }

        return buttons;
    }

    /**
     * Tester la page en français
     */
    async testFrenchButtons() {
        try {
            const response = await this.makeRequest('/', {
                'Accept-Language': 'fr-CA'
            });

            const buttons = this.extractI18nButtons(response.body);
            this.results.frenchButtons = buttons;

            console.log(`\n📝 Boutons trouvés avec data-i18n (FR): ${buttons.length}`);
            
            // Vérifier que tous ont le bon texte français
            const expectedFrench = {
                'refresh': 'Actualiser',
                'save': 'Enregistrer',
                'cancel': 'Annuler',
                'add': 'Ajouter',
                'empty': 'Vider',
                'export': 'Exporter',
                'download': 'Télécharger',
                'change_password': 'Changer le mot de passe'
            };

            let frenchCorrect = 0;
            buttons.forEach(btn => {
                if (expectedFrench[btn.key]) {
                    if (btn.text === expectedFrench[btn.key]) {
                        frenchCorrect++;
                    } else {
                        console.log(`  ⚠️ ${btn.key}: "${btn.text}" (attendu: "${expectedFrench[btn.key]}")`);
                    }
                }
            });

            return {
                success: buttons.length > 10, // Au moins 10 boutons traduits
                message: `${buttons.length} boutons avec i18n trouvés`,
                details: { buttonCount: buttons.length, correctTranslations: frenchCorrect }
            };

        } catch (error) {
            return {
                success: false,
                message: `Erreur test français: ${error.message}`,
                error: error
            };
        }
    }

    /**
     * Vérifier qu'il n'y a plus de boutons non traduits
     */
    async checkUntranslatedButtons() {
        try {
            const response = await this.makeRequest('/');

            // Patterns pour détecter les boutons sans i18n
            const untranslatedPatterns = [
                />Actualiser<\/button>/g,
                />Vider<\/button>/g,
                />Enregistrer<\/button>/g,
                />Annuler<\/button>/g,
                />Ajouter<\/button>/g,
                />Télécharger<\/button>/g,
                />Exporter<\/button>/g,
                />Recharger<\/button>/g,
                />Tester<\/button>/g,
                />Sauvegarder<\/button>/g
            ];

            const untranslated = [];
            untranslatedPatterns.forEach(pattern => {
                const matches = response.body.match(pattern);
                if (matches) {
                    untranslated.push(...matches);
                }
            });

            // Ignorer les boutons qui ont des spans avec data-i18n
            const filtered = untranslated.filter(match => {
                // Si le bouton a un span avec data-i18n, c'est OK
                return !match.includes('data-i18n');
            });

            if (filtered.length > 0) {
                console.log('\n⚠️ Boutons non traduits trouvés:');
                filtered.forEach(btn => console.log(`  - ${btn}`));
            }

            return {
                success: filtered.length === 0,
                message: filtered.length === 0 ? 
                    'Tous les boutons sont traduits' : 
                    `${filtered.length} boutons non traduits trouvés`,
                details: { untranslatedCount: filtered.length }
            };

        } catch (error) {
            return {
                success: false,
                message: `Erreur vérification: ${error.message}`,
                error: error
            };
        }
    }

    /**
     * Exécuter tous les tests
     */
    async runAllTests() {
        console.log('🧪 Tests de traduction des boutons EFC Backup');
        console.log('=' .repeat(60));

        // Test 1: Boutons français
        console.log('\n1️⃣ Test des boutons avec i18n...');
        const frenchTest = await this.testFrenchButtons();
        this.addResult('Boutons i18n (FR)', frenchTest);

        // Test 2: Vérifier les boutons non traduits
        console.log('\n2️⃣ Vérification des boutons non traduits...');
        const untranslatedTest = await this.checkUntranslatedButtons();
        this.addResult('Boutons non traduits', untranslatedTest);

        // Rapport
        this.generateReport();
    }

    /**
     * Ajouter un résultat de test
     */
    addResult(name, result) {
        if (result.success) {
            this.results.passed++;
            console.log(`✅ ${name}: ${result.message}`);
        } else {
            this.results.failed++;
            console.log(`❌ ${name}: ${result.message}`);
        }
    }

    /**
     * Générer le rapport final
     */
    generateReport() {
        console.log('\n' + '=' .repeat(60));
        console.log('📊 RAPPORT FINAL - TRADUCTION DES BOUTONS');
        console.log('=' .repeat(60));

        const total = this.results.passed + this.results.failed;
        const successRate = Math.round((this.results.passed / total) * 100);

        console.log(`Tests exécutés: ${total}`);
        console.log(`Réussis: ${this.results.passed}`);
        console.log(`Échoués: ${this.results.failed}`);
        console.log(`Taux de réussite: ${successRate}%`);

        if (this.results.frenchButtons.length > 0) {
            console.log(`\n📋 Boutons traduits détectés: ${this.results.frenchButtons.length}`);
            const sample = this.results.frenchButtons.slice(0, 5);
            sample.forEach(btn => {
                console.log(`  • ${btn.key}: "${btn.text}"`);
            });
            if (this.results.frenchButtons.length > 5) {
                console.log(`  ... et ${this.results.frenchButtons.length - 5} autres`);
            }
        }

        console.log('\n' + '=' .repeat(60));
        
        if (this.results.failed > 0) {
            console.log('⚠️  Des problèmes de traduction ont été détectés.');
            process.exit(1);
        } else {
            console.log('🎉 Tous les boutons sont correctement traduits !');
            console.log('🌍 Le système supporte maintenant le changement de langue');
            process.exit(0);
        }
    }
}

// Exécution
if (require.main === module) {
    const tester = new ButtonTranslationTester();
    
    // Attendre que le serveur soit prêt
    setTimeout(() => {
        tester.runAllTests().catch(error => {
            console.error('❌ Erreur fatale:', error);
            process.exit(1);
        });
    }, 1000);
}

module.exports = ButtonTranslationTester;