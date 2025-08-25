const express = require('express');
const bcrypt = require('bcrypt');
const { logger } = require('../utils/logger');
const AuthMiddleware = require('../middleware/auth');
const { PasswordValidator } = require('../utils/password-validator');
const { 
    getAllUsers, 
    createUser, 
    updateUser, 
    deleteUser, 
    getUserById,
    updateUserPassword,
    toggleUserStatus,
    getUserStats
} = require('../utils/database');

const router = express.Router();

// Middleware pour les logs d'API et sécurité
router.use(AuthMiddleware.securityLogger);

// Route pour obtenir la liste de tous les utilisateurs (admin seulement)
router.get('/', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        logger.info(`Liste utilisateurs demandée par ${req.user.username}`);
        
        const users = await getAllUsers();
        
        // Ne pas retourner les mots de passe
        const safeUsers = users.map(user => {
            const { password, ...safeUser } = user;
            return safeUser;
        });
        
        res.json(safeUsers);
        
    } catch (error) {
        logger.error('Erreur lors de la récupération des utilisateurs:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour obtenir les statistiques des utilisateurs (admin seulement)
router.get('/stats', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const stats = await getUserStats();
        res.json(stats);
        
    } catch (error) {
        logger.error('Erreur lors de la récupération des statistiques utilisateurs:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour créer un nouvel utilisateur (admin seulement)
router.post('/', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const { username, email, password, role, client_name, active = true, permissions = {} } = req.body;
        
        // Validation des champs obligatoires
        if (!username || !email || !password || !role) {
            return res.status(400).json({ 
                error: 'Nom d\'utilisateur, email, mot de passe et rôle sont obligatoires' 
            });
        }
        
        // Validation du nom d'utilisateur
        if (username.length < 3 || username.length > 50) {
            return res.status(400).json({ 
                error: 'Le nom d\'utilisateur doit faire entre 3 et 50 caractères' 
            });
        }
        
        // Validation de l'email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Format d\'email invalide' });
        }
        
        // Validation du mot de passe avec le validateur
        const passwordValidation = PasswordValidator.validate(password, username, {
            email: email,
            clientName: client_name
        });
        
        if (!passwordValidation.isValid) {
            return res.status(400).json({ 
                error: passwordValidation.errors[0], // Premier erreur
                allErrors: passwordValidation.errors,
                suggestions: PasswordValidator.generateSuggestions(password, passwordValidation)
            });
        }
        
        // Validation du rôle
        if (!['admin', 'client'].includes(role)) {
            return res.status(400).json({ error: 'Rôle invalide' });
        }
        
        // Vérifier l'unicité du nom d'utilisateur
        try {
            const existingUser = await getUserById(username);
            if (existingUser) {
                return res.status(409).json({ error: 'Nom d\'utilisateur déjà existant' });
            }
        } catch (error) {
            // Utilisateur n'existe pas, c'est OK
        }
        
        // Hasher le mot de passe de manière sécurisée
        const hashedPassword = await PasswordValidator.hash(password);
        
        // Créer l'utilisateur
        const userData = {
            username: username.trim(),
            email: email.trim().toLowerCase(),
            password: hashedPassword,
            role,
            client_name: role === 'client' ? client_name : null,
            active: Boolean(active),
            permissions: JSON.stringify(permissions),
            created_at: new Date().toISOString()
        };
        
        const newUser = await createUser(userData);
        
        logger.info(`Nouvel utilisateur créé: ${username} (${role}) par ${req.user.username}`);
        
        // Retourner l'utilisateur sans le mot de passe
        const { password: _, ...safeUser } = newUser;
        res.status(201).json(safeUser);
        
    } catch (error) {
        logger.error('Erreur lors de la création de l\'utilisateur:', error);
        
        if (error.message.includes('UNIQUE constraint')) {
            return res.status(409).json({ error: 'Nom d\'utilisateur ou email déjà existant' });
        }
        
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour obtenir un utilisateur spécifique (admin seulement)
router.get('/:id', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const user = await getUserById(id);
        
        if (!user) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }
        
        // Ne pas retourner le mot de passe
        const { password, ...safeUser } = user;
        res.json(safeUser);
        
    } catch (error) {
        logger.error('Erreur lors de la récupération de l\'utilisateur:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour modifier un utilisateur (admin seulement)
router.put('/:id', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { username, email, role, client_name, active, permissions = {} } = req.body;
        
        // Vérifier que l'utilisateur existe
        const existingUser = await getUserById(id);
        if (!existingUser) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }
        
        // Empêcher la modification de l'admin principal (ID 1)
        if (id === '1' && req.user.id !== 1) {
            return res.status(403).json({ error: 'Impossible de modifier l\'administrateur principal' });
        }
        
        // Validation des champs
        if (username && (username.length < 3 || username.length > 50)) {
            return res.status(400).json({ 
                error: 'Le nom d\'utilisateur doit faire entre 3 et 50 caractères' 
            });
        }
        
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'Format d\'email invalide' });
        }
        
        if (role && !['admin', 'client'].includes(role)) {
            return res.status(400).json({ error: 'Rôle invalide' });
        }
        
        // Préparer les données de mise à jour
        const updateData = {
            username: username ? username.trim() : existingUser.username,
            email: email ? email.trim().toLowerCase() : existingUser.email,
            role: role || existingUser.role,
            client_name: role === 'client' ? client_name : null,
            active: active !== undefined ? Boolean(active) : existingUser.active,
            permissions: JSON.stringify(permissions),
            updated_at: new Date().toISOString()
        };
        
        const updatedUser = await updateUser(id, updateData);
        
        logger.info(`Utilisateur modifié: ${updateData.username} par ${req.user.username}`);
        
        // Retourner l'utilisateur sans le mot de passe
        const { password, ...safeUser } = updatedUser;
        res.json(safeUser);
        
    } catch (error) {
        logger.error('Erreur lors de la modification de l\'utilisateur:', error);
        
        if (error.message.includes('UNIQUE constraint')) {
            return res.status(409).json({ error: 'Nom d\'utilisateur ou email déjà existant' });
        }
        
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour changer son propre mot de passe (utilisateur connecté)
router.put('/me/password', AuthMiddleware.authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        
        // Validation des champs
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ 
                error: 'Mot de passe actuel et nouveau mot de passe sont obligatoires' 
            });
        }
        
        // Vérifier l'utilisateur connecté
        const user = await getUserById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }
        
        // Validation du nouveau mot de passe
        const passwordValidation = PasswordValidator.validate(newPassword, user.username, {
            email: user.email,
            clientName: user.client_name
        });
        
        if (!passwordValidation.isValid) {
            return res.status(400).json({ 
                error: passwordValidation.errors[0],
                allErrors: passwordValidation.errors,
                suggestions: PasswordValidator.generateSuggestions(newPassword, passwordValidation)
            });
        }
        
        // Vérifier le mot de passe actuel
        const isCurrentPasswordValid = await PasswordValidator.compare(currentPassword, user.password_hash);
        if (!isCurrentPasswordValid) {
            return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
        }
        
        // Hasher le nouveau mot de passe
        const hashedPassword = await PasswordValidator.hash(newPassword);
        
        // Mettre à jour le mot de passe
        await updateUserPassword(req.user.id, hashedPassword, true);
        
        logger.info(`Mot de passe changé pour l'utilisateur ${user.username} par lui-même`);
        
        res.json({ 
            success: true, 
            message: 'Mot de passe changé avec succès',
            forceLogout: true
        });
        
    } catch (error) {
        logger.error('Erreur lors du changement de mot de passe utilisateur:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour changer le mot de passe d'un utilisateur (admin ou utilisateur lui-même)
router.put('/:id/password', AuthMiddleware.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { newPassword, forceLogout = true } = req.body;
        
        // Vérifier les permissions
        if (req.user.role !== 'admin' && req.user.id !== parseInt(id)) {
            return res.status(403).json({ error: 'Accès interdit' });
        }
        
        // Validation du mot de passe
        if (!newPassword) {
            return res.status(400).json({ 
                error: 'Le nouveau mot de passe est obligatoire' 
            });
        }
        
        // Récupérer l'utilisateur pour la validation
        const targetUser = await getUserById(id);
        if (!targetUser) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }
        
        const passwordValidation = PasswordValidator.validate(newPassword, targetUser.username, {
            email: targetUser.email,
            clientName: targetUser.client_name
        });
        
        if (!passwordValidation.isValid) {
            return res.status(400).json({ 
                error: passwordValidation.errors[0],
                allErrors: passwordValidation.errors,
                suggestions: PasswordValidator.generateSuggestions(newPassword, passwordValidation)
            });
        }
        
        // Hasher le nouveau mot de passe
        const hashedPassword = await PasswordValidator.hash(newPassword);
        
        // Mettre à jour le mot de passe
        await updateUserPassword(id, hashedPassword, forceLogout);
        
        logger.info(`Mot de passe changé pour l'utilisateur ${targetUser.username} par ${req.user.username}`);
        
        res.json({ 
            success: true, 
            message: 'Mot de passe changé avec succès',
            forceLogout 
        });
        
    } catch (error) {
        logger.error('Erreur lors du changement de mot de passe:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour activer/désactiver un utilisateur (admin seulement)
router.put('/:id/toggle', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Empêcher la désactivation de l'admin principal (ID 1)
        if (id === '1') {
            return res.status(403).json({ error: 'Impossible de désactiver l\'administrateur principal' });
        }
        
        // Vérifier que l'utilisateur existe
        const user = await getUserById(id);
        if (!user) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }
        
        // Inverser le statut
        const newStatus = !user.active;
        await toggleUserStatus(id, newStatus);
        
        logger.info(`Utilisateur ${user.username} ${newStatus ? 'activé' : 'désactivé'} par ${req.user.username}`);
        
        res.json({ 
            success: true, 
            message: `Utilisateur ${newStatus ? 'activé' : 'désactivé'} avec succès`,
            active: newStatus
        });
        
    } catch (error) {
        logger.error('Erreur lors du toggle du statut utilisateur:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour supprimer un utilisateur (admin seulement)
router.delete('/:id', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Empêcher la suppression de l'admin principal (ID 1)
        if (id === '1') {
            return res.status(403).json({ error: 'Impossible de supprimer l\'administrateur principal' });
        }
        
        // Empêcher la suppression de son propre compte
        if (req.user.id === parseInt(id)) {
            return res.status(403).json({ error: 'Impossible de supprimer son propre compte' });
        }
        
        // Vérifier que l'utilisateur existe
        const user = await getUserById(id);
        if (!user) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }
        
        // Supprimer l'utilisateur
        await deleteUser(id);
        
        logger.info(`Utilisateur ${user.username} supprimé par ${req.user.username}`);
        
        res.json({ 
            success: true, 
            message: 'Utilisateur supprimé avec succès' 
        });
        
    } catch (error) {
        logger.error('Erreur lors de la suppression de l\'utilisateur:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour exporter la liste des utilisateurs (admin seulement)
router.get('/export/csv', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        logger.info(`Export utilisateurs demandé par ${req.user.username}`);
        
        const users = await getAllUsers();
        
        // Préparer le CSV
        const csvHeader = 'ID,Nom d\'utilisateur,Email,Rôle,Client associé,Actif,Créé le,Dernière connexion\n';
        const csvData = users.map(user => {
            return [
                user.id,
                user.username,
                user.email,
                user.role,
                user.client_name || '',
                user.active ? 'Oui' : 'Non',
                user.created_at ? new Date(user.created_at).toLocaleString('fr-FR') : '',
                user.last_login ? new Date(user.last_login).toLocaleString('fr-FR') : 'Jamais'
            ].join(',');
        }).join('\n');
        
        const csv = csvHeader + csvData;
        
        // Définir les headers pour le téléchargement
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="efc-backup-users-${new Date().toISOString().split('T')[0]}.csv"`);
        res.setHeader('Content-Length', Buffer.byteLength(csv, 'utf8'));
        
        res.send(csv);
        
    } catch (error) {
        logger.error('Erreur lors de l\'export des utilisateurs:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

module.exports = router;