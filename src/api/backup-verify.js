const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const archiver = require('archiver');
const { NodeSSH } = require('node-ssh');
const { logger } = require('../utils/logger');
const { getBackups, getClient } = require('../utils/database');
const AuthMiddleware = require('../middleware/auth');

const router = express.Router();

// Route pour lister les backups d'un client avec vérification
router.get('/client/:clientName', AuthMiddleware.requireClientAccess, async (req, res) => {
    try {
        const { clientName } = req.params;
        
        // Vérifier que le client peut accéder à ses propres backups
        if (req.user.role === 'client' && req.user.clientName !== clientName) {
            return res.status(403).json({ error: 'Accès non autorisé' });
        }

        const backups = await getBackups({ client_name: clientName, status: 'completed' });
        
        // Vérifier l'existence des fichiers de backup
        const verifiedBackups = await Promise.all(
            backups.map(async (backup) => {
                let verified = false;
                let size = 0;
                let fileCount = 0;

                if (backup.path) {
                    try {
                        const stats = await fs.stat(backup.path);
                        verified = stats.isFile() || stats.isDirectory();
                        
                        if (stats.isFile()) {
                            size = stats.size;
                            fileCount = 1;
                        } else if (stats.isDirectory()) {
                            const dirStats = await getDirectoryStats(backup.path);
                            size = dirStats.size;
                            fileCount = dirStats.fileCount;
                        }
                    } catch (error) {
                        logger.warn(`Backup file not found: ${backup.path}`, { backup_id: backup.backup_id });
                    }
                }

                return {
                    ...backup,
                    verified,
                    actual_size: size,
                    actual_file_count: fileCount,
                    size_match: Math.abs(size - (backup.size_mb * 1024 * 1024)) < 1024 * 1024, // 1MB tolerance
                    file_count_match: fileCount === backup.file_count
                };
            })
        );

        res.json({ backups: verifiedBackups });

    } catch (error) {
        logger.error('Erreur lors de la vérification des backups:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour télécharger un backup
router.get('/download/:backupId', AuthMiddleware.requireClientAccess, async (req, res) => {
    try {
        const { backupId } = req.params;

        // Récupérer les informations du backup
        const backups = await getBackups({ backup_id: backupId });
        const backup = backups[0];

        if (!backup) {
            return res.status(404).json({ error: 'Backup non trouvé' });
        }

        // Vérifier que le client peut accéder à ce backup
        if (req.user.role === 'client' && req.user.clientName !== backup.client_name) {
            return res.status(403).json({ error: 'Accès non autorisé' });
        }

        if (!backup.path) {
            return res.status(404).json({ error: 'Fichier de backup non trouvé' });
        }

        try {
            const stats = await fs.stat(backup.path);
            
            if (stats.isFile()) {
                // Fichier simple - téléchargement direct
                res.download(backup.path, `${backup.client_name}_${backup.backup_id}.backup`, (err) => {
                    if (err) {
                        logger.error('Erreur lors du téléchargement:', err);
                        if (!res.headersSent) {
                            res.status(500).json({ error: 'Erreur lors du téléchargement' });
                        }
                    } else {
                        logger.info(`Backup téléchargé: ${backupId} par ${req.user.username}`);
                    }
                });
            } else if (stats.isDirectory()) {
                // Dossier - créer un ZIP à la volée
                const zipName = `${backup.client_name}_${backup.backup_id}.zip`;
                
                res.setHeader('Content-Type', 'application/zip');
                res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

                const archive = archiver('zip', {
                    zlib: { level: 9 }
                });

                archive.on('error', (err) => {
                    logger.error('Erreur lors de la compression:', err);
                    if (!res.headersSent) {
                        res.status(500).json({ error: 'Erreur lors de la compression' });
                    }
                });

                archive.pipe(res);
                archive.directory(backup.path, false);
                archive.finalize();

                logger.info(`Backup compressé et téléchargé: ${backupId} par ${req.user.username}`);
            } else {
                return res.status(404).json({ error: 'Type de fichier non supporté' });
            }

        } catch (error) {
            return res.status(404).json({ error: 'Fichier de backup non accessible' });
        }

    } catch (error) {
        logger.error('Erreur lors du téléchargement du backup:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour vérifier l'intégrité d'un backup
router.get('/verify/:backupId', AuthMiddleware.requireClientAccess, async (req, res) => {
    try {
        const { backupId } = req.params;

        const backups = await getBackups({ backup_id: backupId });
        const backup = backups[0];

        if (!backup) {
            return res.status(404).json({ error: 'Backup non trouvé' });
        }

        // Vérifier que le client peut accéder à ce backup
        if (req.user.role === 'client' && req.user.clientName !== backup.client_name) {
            return res.status(403).json({ error: 'Accès non autorisé' });
        }

        const verification = await verifyBackupIntegrity(backup);
        
        res.json({
            backup_id: backupId,
            client_name: backup.client_name,
            verification
        });

    } catch (error) {
        logger.error('Erreur lors de la vérification du backup:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Route pour tester la restauration (simulation)
router.post('/test-restore/:backupId', AuthMiddleware.requireClientAccess, async (req, res) => {
    try {
        const { backupId } = req.params;
        const { testPath } = req.body;

        const backups = await getBackups({ backup_id: backupId });
        const backup = backups[0];

        if (!backup) {
            return res.status(404).json({ error: 'Backup non trouvé' });
        }

        // Vérifier que le client peut accéder à ce backup
        if (req.user.role === 'client' && req.user.clientName !== backup.client_name) {
            return res.status(403).json({ error: 'Accès non autorisé' });
        }

        // Simuler un test de restauration
        const testResult = await simulateRestore(backup, testPath);
        
        logger.info(`Test de restauration effectué: ${backupId} par ${req.user.username}`);
        
        res.json({
            backup_id: backupId,
            test_result: testResult
        });

    } catch (error) {
        logger.error('Erreur lors du test de restauration:', error);
        res.status(500).json({ error: 'Erreur interne du serveur' });
    }
});

// Fonctions utilitaires

async function getDirectoryStats(dirPath) {
    let totalSize = 0;
    let fileCount = 0;

    async function walkDirectory(dir) {
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isDirectory()) {
                    await walkDirectory(fullPath);
                } else if (entry.isFile()) {
                    const stats = await fs.stat(fullPath);
                    totalSize += stats.size;
                    fileCount++;
                }
            }
        } catch (error) {
            logger.warn(`Erreur lors du parcours du dossier ${dir}:`, error);
        }
    }

    await walkDirectory(dirPath);
    return { size: totalSize, fileCount };
}

async function verifyBackupIntegrity(backup) {
    const verification = {
        exists: false,
        readable: false,
        size_match: false,
        file_count_match: false,
        structure_valid: false,
        errors: []
    };

    try {
        if (!backup.path) {
            verification.errors.push('Chemin de backup non défini');
            return verification;
        }

        // Vérifier l'existence
        const stats = await fs.stat(backup.path);
        verification.exists = true;

        // Vérifier la lisibilité
        await fs.access(backup.path, fs.constants.R_OK);
        verification.readable = true;

        if (stats.isFile()) {
            // Fichier simple
            verification.size_match = Math.abs(stats.size - (backup.size_mb * 1024 * 1024)) < 1024 * 1024;
            verification.file_count_match = backup.file_count === 1;
            verification.structure_valid = true;
        } else if (stats.isDirectory()) {
            // Dossier
            const dirStats = await getDirectoryStats(backup.path);
            verification.size_match = Math.abs(dirStats.size - (backup.size_mb * 1024 * 1024)) < 1024 * 1024;
            verification.file_count_match = dirStats.fileCount === backup.file_count;
            verification.structure_valid = true;

            // Vérifier quelques fichiers clés
            const sampleFiles = await getSampleFiles(backup.path, 5);
            for (const file of sampleFiles) {
                try {
                    await fs.access(file, fs.constants.R_OK);
                } catch (error) {
                    verification.errors.push(`Fichier inaccessible: ${file}`);
                }
            }
        }

    } catch (error) {
        verification.errors.push(`Erreur de vérification: ${error.message}`);
    }

    return verification;
}

async function getSampleFiles(dirPath, maxFiles = 5) {
    const files = [];
    
    async function collectFiles(dir, depth = 0) {
        if (files.length >= maxFiles || depth > 3) return;
        
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            
            for (const entry of entries) {
                if (files.length >= maxFiles) break;
                
                const fullPath = path.join(dir, entry.name);
                
                if (entry.isFile()) {
                    files.push(fullPath);
                } else if (entry.isDirectory() && depth < 2) {
                    await collectFiles(fullPath, depth + 1);
                }
            }
        } catch (error) {
            // Ignorer les erreurs d'accès
        }
    }

    await collectFiles(dirPath);
    return files;
}

async function simulateRestore(backup, testPath = null) {
    const result = {
        feasible: false,
        estimated_time: 0,
        required_space: 0,
        warnings: [],
        recommendations: []
    };

    try {
        // Vérifier l'espace disponible
        if (backup.path) {
            const stats = await fs.stat(backup.path);
            result.required_space = stats.isFile() ? stats.size : (await getDirectoryStats(backup.path)).size;
            result.estimated_time = Math.ceil(result.required_space / (50 * 1024 * 1024)); // 50 MB/s estimé
        }

        // Vérifications de faisabilité
        result.feasible = backup.status === 'completed' && backup.path;

        if (!result.feasible) {
            result.warnings.push('Backup incomplet ou non accessible');
        }

        // Recommandations
        if (result.required_space > 10 * 1024 * 1024 * 1024) { // > 10GB
            result.recommendations.push('Restauration volumineuse - planifier en heures creuses');
        }

        if (backup.type === 'incremental') {
            result.recommendations.push('Backup incrémentiel - restauration complète nécessite les backups précédents');
        }

        result.recommendations.push('Vérifier l\'espace disque disponible avant la restauration');
        result.recommendations.push('Effectuer un test sur une copie avant la restauration finale');

    } catch (error) {
        result.warnings.push(`Erreur lors de l'analyse: ${error.message}`);
    }

    return result;
}

module.exports = router;