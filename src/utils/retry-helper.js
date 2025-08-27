/**
 * Utilitaire de retry avec backoff exponentiel
 * Aide à gérer les échecs temporaires de connexion SSH, réseau, etc.
 */

const { logger } = require('./logger');

/**
 * Exécute une fonction avec retry automatique
 * @param {Function} fn - Fonction à exécuter
 * @param {Object} options - Options de retry
 * @param {number} options.maxRetries - Nombre maximum de tentatives (défaut: 3)
 * @param {number} options.initialDelay - Délai initial en ms (défaut: 1000)
 * @param {number} options.maxDelay - Délai maximum en ms (défaut: 30000)
 * @param {number} options.backoffMultiplier - Multiplicateur du délai (défaut: 2)
 * @param {Array} options.retryableErrors - Types d'erreurs qui déclenchent un retry
 * @param {string} options.operation - Nom de l'opération pour les logs
 * @returns {Promise} Résultat de la fonction ou erreur finale
 */
async function retryOperation(fn, options = {}) {
    const {
        maxRetries = 3,
        initialDelay = 1000,
        maxDelay = 30000,
        backoffMultiplier = 2,
        retryableErrors = ['ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH'],
        operation = 'operation'
    } = options;

    let lastError;
    let delay = initialDelay;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
            const result = await fn();
            
            // Si succès après échecs, le mentionner dans les logs
            if (attempt > 1) {
                logger.info(`${operation} réussie à la tentative ${attempt}/${maxRetries + 1}`);
            }
            
            return result;
        } catch (error) {
            lastError = error;
            
            // Vérifier si l'erreur est retryable
            const isRetryable = isErrorRetryable(error, retryableErrors);
            
            if (attempt <= maxRetries && isRetryable) {
                logger.warn(`${operation} échouée (tentative ${attempt}/${maxRetries + 1}): ${error.message}. Retry dans ${delay}ms`);
                
                // Attendre avant le prochain essai
                await sleep(delay);
                
                // Augmenter le délai pour le prochain essai (backoff exponentiel)
                delay = Math.min(delay * backoffMultiplier, maxDelay);
            } else {
                // Pas de retry possible ou toutes les tentatives épuisées
                if (isRetryable) {
                    logger.error(`${operation} définitivement échouée après ${attempt} tentatives: ${error.message}`);
                } else {
                    logger.error(`${operation} échouée (erreur non retryable): ${error.message}`);
                }
                throw error;
            }
        }
    }
    
    // Ne devrait jamais être atteint
    throw lastError;
}

/**
 * Détermine si une erreur est retryable
 * @param {Error} error - L'erreur à analyser
 * @param {Array} retryableErrors - Liste des codes d'erreur retryables
 * @returns {boolean} True si l'erreur est retryable
 */
function isErrorRetryable(error, retryableErrors) {
    if (!error) return false;
    
    // Vérifier le code d'erreur
    if (error.code && retryableErrors.includes(error.code)) {
        return true;
    }
    
    // Vérifier le message d'erreur pour des patterns connus
    const message = error.message?.toLowerCase() || '';
    
    const retryablePatterns = [
        'connection reset',
        'connection refused',
        'timeout',
        'network unreachable',
        'host unreachable',
        'temporary failure',
        'service unavailable',
        'socket hang up'
    ];
    
    return retryablePatterns.some(pattern => message.includes(pattern));
}

/**
 * Fonction utilitaire pour attendre
 * @param {number} ms - Temps d'attente en millisecondes
 * @returns {Promise} Promise qui se résout après le délai
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wrapper spécialisé pour les opérations SSH
 * @param {Function} sshOperation - Fonction SSH à exécuter
 * @param {Object} clientInfo - Info du client pour les logs
 * @param {Object} options - Options de retry supplémentaires
 * @returns {Promise} Résultat de l'opération SSH
 */
async function retrySshOperation(sshOperation, clientInfo = {}, options = {}) {
    const clientName = clientInfo.name || clientInfo.host || 'client inconnu';
    
    const sshOptions = {
        maxRetries: 3,
        initialDelay: 2000, // SSH peut prendre du temps
        maxDelay: 10000,
        operation: `connexion SSH vers ${clientName}`,
        retryableErrors: [
            'ECONNRESET',
            'ENOTFOUND', 
            'ECONNREFUSED',
            'ETIMEDOUT',
            'EHOSTUNREACH',
            'ENETUNREACH',
            'ECONNABORTED'
        ],
        ...options
    };
    
    return await retryOperation(sshOperation, sshOptions);
}

/**
 * Wrapper spécialisé pour les opérations de backup
 * @param {Function} backupOperation - Fonction de backup à exécuter
 * @param {Object} clientInfo - Info du client pour les logs
 * @param {Object} options - Options de retry supplémentaires
 * @returns {Promise} Résultat de l'opération de backup
 */
async function retryBackupOperation(backupOperation, clientInfo = {}, options = {}) {
    const clientName = clientInfo.name || clientInfo.host || 'client inconnu';
    
    const backupOptions = {
        maxRetries: 2, // Moins de retries pour les backups (plus longs)
        initialDelay: 5000,
        maxDelay: 30000,
        operation: `backup ${clientName}`,
        retryableErrors: [
            'ECONNRESET',
            'ETIMEDOUT', 
            'ENETUNREACH',
            'EHOSTUNREACH'
        ],
        ...options
    };
    
    return await retryOperation(backupOperation, backupOptions);
}

module.exports = {
    retryOperation,
    retrySshOperation,
    retryBackupOperation,
    isErrorRetryable,
    sleep
};