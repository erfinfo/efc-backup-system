const bcrypt = require('bcrypt');

// Configuration de sécurité des mots de passe
const PASSWORD_CONFIG = {
    minLength: 8,
    maxLength: 128,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    saltRounds: 12,
    maxAttempts: 5,
    lockoutDuration: 15 * 60 * 1000 // 15 minutes
};

// Mots de passe faibles interdits
const WEAK_PASSWORDS = [
    'password', 'password123', 'admin', 'admin123', 'administrator',
    '12345678', '123456789', '1234567890', 'qwerty123', 'azerty123',
    'motdepasse', 'password1', 'pass1234', 'backup123', 'server123',
    'root123', 'user123', 'test123', 'demo123', 'guest123'
];

// Patterns dangereux
const DANGEROUS_PATTERNS = [
    /(.)\1{3,}/, // 4+ caractères identiques consécutifs
    /^[0-9]+$/, // Que des chiffres
    /^[a-zA-Z]+$/, // Que des lettres
    /^.{1,7}$/, // Trop court
    /(123|abc|qwe|asd|zxc)/i // Séquences communes
];

class PasswordValidator {
    
    // Validation complète d'un mot de passe
    static validate(password, username = '', additionalContext = {}) {
        const errors = [];
        
        // Vérification de longueur
        if (!password || password.length < PASSWORD_CONFIG.minLength) {
            errors.push(`Le mot de passe doit faire au moins ${PASSWORD_CONFIG.minLength} caractères`);
        }
        
        if (password && password.length > PASSWORD_CONFIG.maxLength) {
            errors.push(`Le mot de passe doit faire maximum ${PASSWORD_CONFIG.maxLength} caractères`);
        }
        
        if (password) {
            // Vérification de complexité
            if (PASSWORD_CONFIG.requireLowercase && !/[a-z]/.test(password)) {
                errors.push('Le mot de passe doit contenir au moins une minuscule');
            }
            
            if (PASSWORD_CONFIG.requireUppercase && !/[A-Z]/.test(password)) {
                errors.push('Le mot de passe doit contenir au moins une majuscule');
            }
            
            if (PASSWORD_CONFIG.requireNumbers && !/\d/.test(password)) {
                errors.push('Le mot de passe doit contenir au moins un chiffre');
            }
            
            if (PASSWORD_CONFIG.requireSpecialChars && !/[@$!%*?&]/.test(password)) {
                errors.push('Le mot de passe doit contenir au moins un caractère spécial (@$!%*?&)');
            }
            
            // Vérifier les patterns dangereux
            for (const pattern of DANGEROUS_PATTERNS) {
                if (pattern.test(password)) {
                    errors.push('Le mot de passe contient un pattern non sécurisé');
                    break;
                }
            }
            
            // Vérifier les mots de passe faibles
            const lowerPassword = password.toLowerCase();
            for (const weak of WEAK_PASSWORDS) {
                if (lowerPassword.includes(weak.toLowerCase())) {
                    errors.push('Ce mot de passe est trop faible et couramment utilisé');
                    break;
                }
            }
            
            // Vérifier qu'il ne contient pas le nom d'utilisateur
            if (username && (
                lowerPassword.includes(username.toLowerCase()) || 
                username.toLowerCase().includes(lowerPassword)
            )) {
                errors.push('Le mot de passe ne peut pas contenir le nom d\'utilisateur');
            }
            
            // Vérifier qu'il ne contient pas l'email
            if (additionalContext.email) {
                const emailParts = additionalContext.email.toLowerCase().split('@')[0];
                if (lowerPassword.includes(emailParts) || emailParts.includes(lowerPassword)) {
                    errors.push('Le mot de passe ne peut pas contenir l\'adresse email');
                }
            }
            
            // Vérifier qu'il ne contient pas le nom du client
            if (additionalContext.clientName) {
                const clientName = additionalContext.clientName.toLowerCase();
                if (lowerPassword.includes(clientName) || clientName.includes(lowerPassword)) {
                    errors.push('Le mot de passe ne peut pas contenir le nom du client');
                }
            }
        }
        
        return {
            isValid: errors.length === 0,
            errors: errors,
            strength: this.calculateStrength(password)
        };
    }
    
    // Calculer la force d'un mot de passe
    static calculateStrength(password) {
        if (!password) return 0;
        
        let score = 0;
        
        // Longueur
        if (password.length >= 8) score += 1;
        if (password.length >= 12) score += 1;
        if (password.length >= 16) score += 1;
        
        // Variété de caractères
        if (/[a-z]/.test(password)) score += 1;
        if (/[A-Z]/.test(password)) score += 1;
        if (/\d/.test(password)) score += 1;
        if (/[@$!%*?&]/.test(password)) score += 1;
        
        // Bonus pour caractères spéciaux supplémentaires
        if (/[^a-zA-Z0-9@$!%*?&]/.test(password)) score += 1;
        
        // Pénalité pour patterns faibles
        if (DANGEROUS_PATTERNS.some(pattern => pattern.test(password))) {
            score = Math.max(0, score - 2);
        }
        
        // Normaliser sur 5
        return Math.min(5, score);
    }
    
    // Hasher un mot de passe de manière sécurisée
    static async hash(password) {
        try {
            return await bcrypt.hash(password, PASSWORD_CONFIG.saltRounds);
        } catch (error) {
            throw new Error('Erreur lors du hashage du mot de passe');
        }
    }
    
    // Comparer un mot de passe avec son hash
    static async compare(password, hashedPassword) {
        try {
            return await bcrypt.compare(password, hashedPassword);
        } catch (error) {
            throw new Error('Erreur lors de la comparaison du mot de passe');
        }
    }
    
    // Générer des suggestions pour améliorer un mot de passe
    static generateSuggestions(password, validationResult) {
        const suggestions = [];
        
        if (!validationResult.isValid) {
            if (password && password.length < PASSWORD_CONFIG.minLength) {
                suggestions.push(`Utilisez au moins ${PASSWORD_CONFIG.minLength} caractères`);
            }
            
            if (!/[a-z]/.test(password)) {
                suggestions.push('Ajoutez des lettres minuscules');
            }
            
            if (!/[A-Z]/.test(password)) {
                suggestions.push('Ajoutez des lettres majuscules');
            }
            
            if (!/\d/.test(password)) {
                suggestions.push('Ajoutez des chiffres');
            }
            
            if (!/[@$!%*?&]/.test(password)) {
                suggestions.push('Ajoutez des caractères spéciaux (@$!%*?&)');
            }
        }
        
        // Suggestions générales
        if (validationResult.strength < 4) {
            suggestions.push('Utilisez une phrase de passe avec des mots séparés par des caractères spéciaux');
            suggestions.push('Mélangez majuscules, minuscules, chiffres et symboles');
            suggestions.push('Évitez les informations personnelles');
        }
        
        return suggestions;
    }
    
    // Vérifier si un compte est verrouillé
    static isAccountLocked(failedAttempts, lockedUntil) {
        if (!lockedUntil) return false;
        
        const lockTime = new Date(lockedUntil);
        const now = new Date();
        
        return lockTime > now;
    }
    
    // Calculer le temps de déverrouillage restant
    static getRemainingLockTime(lockedUntil) {
        if (!lockedUntil) return 0;
        
        const lockTime = new Date(lockedUntil);
        const now = new Date();
        
        return Math.max(0, lockTime.getTime() - now.getTime());
    }
    
    // Générer un mot de passe sécurisé
    static generateSecurePassword(length = 16) {
        const lowercase = 'abcdefghijklmnopqrstuvwxyz';
        const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const numbers = '0123456789';
        const specials = '@$!%*?&';
        
        const allChars = lowercase + uppercase + numbers + specials;
        
        let password = '';
        
        // Garantir au moins un caractère de chaque type
        password += lowercase[Math.floor(Math.random() * lowercase.length)];
        password += uppercase[Math.floor(Math.random() * uppercase.length)];
        password += numbers[Math.floor(Math.random() * numbers.length)];
        password += specials[Math.floor(Math.random() * specials.length)];
        
        // Remplir le reste aléatoirement
        for (let i = password.length; i < length; i++) {
            password += allChars[Math.floor(Math.random() * allChars.length)];
        }
        
        // Mélanger les caractères
        return password.split('').sort(() => Math.random() - 0.5).join('');
    }
}

module.exports = {
    PasswordValidator,
    PASSWORD_CONFIG,
    WEAK_PASSWORDS
};