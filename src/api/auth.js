const express = require('express');
const AuthMiddleware = require('../middleware/auth');
const { 
    addUser, 
    getUserByUsername, 
    updateUserLoginInfo,
    getUsers,
    deleteUser 
} = require('../utils/database');
const { logger } = require('../utils/logger');

const router = express.Router();

// Route de connexion
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ 
                error: 'Nom d\'utilisateur et mot de passe requis' 
            });
        }

        // Récupérer l'utilisateur
        const user = await getUserByUsername(username);
        if (!user) {
            logger.warn(`Tentative de connexion avec utilisateur inexistant: ${username}`);
            return res.status(401).json({ error: 'Identifiants invalides' });
        }

        // Vérifier si le compte est verrouillé
        if (user.locked_until && new Date() < new Date(user.locked_until)) {
            logger.warn(`Tentative de connexion sur compte verrouillé: ${username}`);
            return res.status(423).json({ 
                error: 'Compte temporairement verrouillé. Réessayez plus tard.' 
            });
        }

        // Vérifier le mot de passe
        const isValidPassword = await AuthMiddleware.comparePassword(password, user.password_hash);
        
        if (!isValidPassword) {
            // Enregistrer la tentative échouée
            await updateUserLoginInfo(user.id, { success: false });
            logger.warn(`Échec de connexion pour: ${username}`);
            return res.status(401).json({ error: 'Identifiants invalides' });
        }

        // Connexion réussie
        await updateUserLoginInfo(user.id, { success: true });
        
        const token = AuthMiddleware.generateToken(user);
        
        // Set cookie avec options sécurisées
        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000 // 24 heures
        });

        logger.info(`Connexion réussie: ${username} (${user.role})`);
        
        res.json({
            success: true,
            message: 'Connexion réussie',
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                client_name: user.client_name,
                email: user.email
            }
        });
        
    } catch (error) {
        logger.error('Erreur lors de la connexion:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route de déconnexion
router.post('/logout', (req, res) => {
    try {
        res.clearCookie('auth_token');
        
        if (req.user) {
            logger.info(`Déconnexion: ${req.user.username}`);
        }
        
        res.json({ success: true, message: 'Déconnexion réussie' });
    } catch (error) {
        logger.error('Erreur lors de la déconnexion:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour vérifier l'authentification
router.get('/verify', AuthMiddleware.authenticateToken, (req, res) => {
    res.json({
        authenticated: true,
        user: {
            id: req.user.id,
            username: req.user.username,
            role: req.user.role,
            client_name: req.user.clientName
        }
    });
});

// Route pour créer un utilisateur (admin uniquement)
router.post('/users', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const { username, password, role, client_name, email, phone } = req.body;

        if (!username || !password || !role) {
            return res.status(400).json({ 
                error: 'Nom d\'utilisateur, mot de passe et rôle requis' 
            });
        }

        // Vérifier que l'utilisateur n'existe pas
        const existingUser = await getUserByUsername(username);
        if (existingUser) {
            return res.status(409).json({ error: 'Ce nom d\'utilisateur existe déjà' });
        }

        // Hash du mot de passe
        const password_hash = await AuthMiddleware.hashPassword(password);

        // Créer l'utilisateur
        const result = await addUser({
            username,
            password_hash,
            role,
            client_name: role === 'client' ? client_name : null,
            email,
            phone
        });

        logger.info(`Utilisateur créé: ${username} (${role}) par ${req.user.username}`);
        
        res.status(201).json({
            success: true,
            message: 'Utilisateur créé avec succès',
            userId: result.id
        });

    } catch (error) {
        logger.error('Erreur lors de la création d\'utilisateur:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour lister les utilisateurs (admin uniquement)
router.get('/users', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const { role, active } = req.query;
        
        const filters = {};
        if (role) filters.role = role;
        if (active !== undefined) filters.active = active === 'true';

        const users = await getUsers(filters);
        
        res.json({ users });

    } catch (error) {
        logger.error('Erreur lors de la récupération des utilisateurs:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour supprimer un utilisateur (admin uniquement)
router.delete('/users/:id', AuthMiddleware.requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Empêcher l'auto-suppression
        if (parseInt(id) === req.user.id) {
            return res.status(400).json({ error: 'Impossible de supprimer votre propre compte' });
        }

        const result = await deleteUser(id);
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }

        logger.info(`Utilisateur supprimé (ID: ${id}) par ${req.user.username}`);
        
        res.json({ success: true, message: 'Utilisateur supprimé avec succès' });

    } catch (error) {
        logger.error('Erreur lors de la suppression d\'utilisateur:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour changer son mot de passe
router.put('/password', AuthMiddleware.authenticateToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ 
                error: 'Mot de passe actuel et nouveau mot de passe requis' 
            });
        }

        // Récupérer l'utilisateur complet
        const user = await getUserByUsername(req.user.username);
        if (!user) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }

        // Vérifier le mot de passe actuel
        const isValidPassword = await AuthMiddleware.comparePassword(currentPassword, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
        }

        // Hash du nouveau mot de passe
        const newPasswordHash = await AuthMiddleware.hashPassword(newPassword);

        // Mettre à jour le mot de passe
        await updateUser(user.id, { password_hash: newPasswordHash });

        logger.info(`Mot de passe changé pour: ${user.username}`);
        
        res.json({ success: true, message: 'Mot de passe changé avec succès' });

    } catch (error) {
        logger.error('Erreur lors du changement de mot de passe:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

module.exports = router;