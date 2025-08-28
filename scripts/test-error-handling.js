#!/usr/bin/env node

/**
 * Script de test pour valider la gestion d'erreur et retry
 * - Teste les connexions SSH avec retry
 * - Simule des pannes réseau
 * - Valide les logs d'erreur
 */

const { retrySshOperation, retryBackupOperation } = require('../src/utils/retry-helper');
const { logger } = require('../src/utils/logger');
const WindowsBackupClient = require('../src/backup/windowsBackup');
const LinuxBackupClient = require('../src/backup/linuxBackup');

class ErrorHandlingTester {
    constructor() {
        this.tests = [];
        this.results = {
            passed: 0,
            failed: 0,
            details: []
        };
    }

    /**
     * Ajouter un test à exécuter
     */
    addTest(name, testFn) {
        this.tests.push({ name, testFn });
    }

    /**
     * Simuler une connexion SSH qui échoue puis réussit
     */
    async testSshRetry() {
        let attemptCount = 0;
        
        const mockSshOperation = async () => {
            attemptCount++;
            
            if (attemptCount < 3) {
                const error = new Error('Connection refused');
                error.code = 'ECONNREFUSED';
                throw error;
            }
            
            return { connected: true, attempt: attemptCount };
        };

        const fakeClient = { name: 'test-client', host: '192.168.1.100' };
        const result = await retrySshOperation(mockSshOperation, fakeClient, {
            maxRetries: 3,
            initialDelay: 100, // Réduire pour les tests
            operation: 'test SSH retry'
        });

        return {
            success: result.connected && result.attempt === 3,
            message: `SSH retry réussi après ${result.attempt} tentatives`,
            result
        };
    }

    /**
     * Tester une opération qui échoue définitivement
     */
    async testPermanentFailure() {
        const mockFailingOperation = async () => {
            const error = new Error('Host unreachable');
            error.code = 'EHOSTUNREACH';
            throw error;
        };

        const fakeClient = { name: 'unreachable-client', host: '192.168.1.999' };
        
        try {
            await retrySshOperation(mockFailingOperation, fakeClient, {
                maxRetries: 2,
                initialDelay: 50
            });
            
            return {
                success: false,
                message: 'L\'opération aurait dû échouer définitivement'
            };
        } catch (error) {
            return {
                success: error.code === 'EHOSTUNREACH',
                message: `Échec attendu avec code: ${error.code}`,
                error: error.message
            };
        }
    }

    /**
     * Tester une erreur non-retryable
     */
    async testNonRetryableError() {
        let attemptCount = 0;
        
        const mockAuthError = async () => {
            attemptCount++;
            const error = new Error('Authentication failed');
            error.code = 'AUTH_FAILED';
            throw error;
        };

        const fakeClient = { name: 'auth-fail-client', host: '192.168.1.50' };
        
        try {
            await retrySshOperation(mockAuthError, fakeClient, {
                maxRetries: 3,
                initialDelay: 50
            });
            
            return {
                success: false,
                message: 'L\'opération aurait dû échouer immédiatement'
            };
        } catch (error) {
            return {
                success: attemptCount === 1 && error.code === 'AUTH_FAILED',
                message: `Échec immédiat pour erreur non-retryable (${attemptCount} tentative)`,
                attempts: attemptCount
            };
        }
    }

    /**
     * Tester le retry pour les opérations de backup
     */
    async testBackupRetry() {
        let attemptCount = 0;
        
        const mockBackupOperation = async () => {
            attemptCount++;
            
            if (attemptCount < 2) {
                const error = new Error('Network timeout');
                error.code = 'ETIMEDOUT';
                throw error;
            }
            
            return {
                backupId: `backup_${Date.now()}`,
                size: 1024,
                files: 150,
                attempt: attemptCount
            };
        };

        const fakeClient = { name: 'backup-client', host: '192.168.1.10' };
        const result = await retryBackupOperation(mockBackupOperation, fakeClient, {
            maxRetries: 2,
            initialDelay: 100
        });

        return {
            success: result.attempt === 2 && result.backupId,
            message: `Backup retry réussi après ${result.attempt} tentatives`,
            result
        };
    }

    /**
     * Simuler un test de connectivité client réel
     */
    async testRealClientConnectivity() {
        // Configuration pour un client qui n'existe probablement pas
        const testConfig = {
            name: 'test-connectivity',
            host: '192.168.1.254', // Adresse probablement non utilisée
            port: 22,
            username: 'test',
            password: 'test'
        };

        try {
            const windowsClient = new WindowsBackupClient(testConfig);
            await windowsClient.connect();
            await windowsClient.disconnect();
            
            return {
                success: false,
                message: 'La connexion au client test aurait dû échouer'
            };
        } catch (error) {
            return {
                success: error.code === 'ECONNREFUSED' || error.code === 'EHOSTUNREACH' || error.code === 'ETIMEDOUT',
                message: `Échec de connexion attendu: ${error.code}`,
                errorCode: error.code
            };
        }
    }

    /**
     * Exécuter tous les tests
     */
    async runAllTests() {
        logger.info('=== Démarrage des tests de gestion d\'erreur ===');

        // Définir les tests
        this.addTest('SSH Retry Success', this.testSshRetry.bind(this));
        this.addTest('Permanent Failure', this.testPermanentFailure.bind(this));
        this.addTest('Non-Retryable Error', this.testNonRetryableError.bind(this));
        this.addTest('Backup Retry', this.testBackupRetry.bind(this));
        this.addTest('Real Client Connectivity', this.testRealClientConnectivity.bind(this));

        // Exécuter chaque test
        for (const test of this.tests) {
            try {
                logger.info(`Exécution du test: ${test.name}`);
                const result = await test.testFn();
                
                if (result.success) {
                    this.results.passed++;
                    logger.info(`✅ ${test.name}: ${result.message}`);
                } else {
                    this.results.failed++;
                    logger.error(`❌ ${test.name}: ${result.message}`);
                }
                
                this.results.details.push({
                    name: test.name,
                    success: result.success,
                    message: result.message,
                    data: result
                });

            } catch (error) {
                this.results.failed++;
                logger.error(`💥 ${test.name}: Erreur inattendue:`, error);
                
                this.results.details.push({
                    name: test.name,
                    success: false,
                    message: `Erreur inattendue: ${error.message}`,
                    error: error.stack
                });
            }
        }

        this.generateReport();
    }

    /**
     * Générer le rapport de test
     */
    generateReport() {
        console.log('\n' + '='.repeat(60));
        console.log('📋 RAPPORT DE TESTS - GESTION D\'ERREUR');
        console.log('='.repeat(60));
        
        const total = this.results.passed + this.results.failed;
        const successRate = Math.round((this.results.passed / total) * 100);
        
        console.log(`Tests exécutés: ${total}`);
        console.log(`Réussis: ${this.results.passed}`);
        console.log(`Échoués: ${this.results.failed}`);
        console.log(`Taux de réussite: ${successRate}%`);
        
        console.log('\n' + '-'.repeat(60));
        console.log('DÉTAILS DES TESTS:');
        
        for (const detail of this.results.details) {
            const status = detail.success ? '✅' : '❌';
            console.log(`${status} ${detail.name}: ${detail.message}`);
        }
        
        console.log('\n' + '='.repeat(60));
        
        if (this.results.failed > 0) {
            console.log('⚠️  Certains tests ont échoué. Vérifiez les logs ci-dessus.');
            process.exit(1);
        } else {
            console.log('🎉 Tous les tests de gestion d\'erreur ont réussi !');
            process.exit(0);
        }
    }
}

// Exécution si appelé directement
if (require.main === module) {
    const tester = new ErrorHandlingTester();
    tester.runAllTests().catch(error => {
        logger.error('Erreur fatale lors des tests:', error);
        process.exit(1);
    });
}

module.exports = ErrorHandlingTester;