const { logger } = require('./logger');
const path = require('path');

class BackupExclusions {
    constructor() {
        // Exclusions par défaut Windows
        this.defaultWindowsExclusions = {
            folders: [
                'C:\\Windows\\Temp',
                'C:\\Windows\\System32\\config\\systemprofile\\AppData\\Local\\Temp',
                'C:\\Users\\*\\AppData\\Local\\Temp',
                'C:\\Users\\*\\AppData\\Local\\Microsoft\\Windows\\Temporary Internet Files',
                'C:\\Users\\*\\AppData\\Local\\Microsoft\\Windows\\INetCache',
                'C:\\Users\\*\\AppData\\Local\\Google\\Chrome\\User Data\\*\\Cache',
                'C:\\Users\\*\\AppData\\Local\\Mozilla\\Firefox\\Profiles\\*\\cache2',
                'C:\\Users\\*\\AppData\\Roaming\\Microsoft\\Windows\\Recent',
                'C:\\$Recycle.Bin',
                'C:\\pagefile.sys',
                'C:\\hiberfil.sys',
                'C:\\swapfile.sys',
                'C:\\System Volume Information'
            ],
            fileExtensions: [
                '*.tmp', '*.temp', '*.cache', '*.bak', '*.old',
                '*.log', '*.dmp', '*.chk', '*.gid', '*.ftg',
                '*.~*', '*.thumbnail'
            ],
            filePatterns: [
                'thumbs.db', 'desktop.ini', '.DS_Store',
                'Thumbs.db', 'ehthumbs.db', 'ehthumbs_vista.db'
            ]
        };

        // Exclusions par défaut Linux  
        this.defaultLinuxExclusions = {
            folders: [
                '/tmp',
                '/var/tmp', 
                '/var/cache',
                '/var/log',
                '/var/run',
                '/var/lock',
                '/proc',
                '/sys',
                '/dev',
                '/media',
                '/mnt',
                '/run',
                '/snap',
                '/home/*/.cache',
                '/home/*/.thumbnails',
                '/home/*/.local/share/Trash',
                '/home/*/.mozilla/*/Cache',
                '/home/*/.config/google-chrome/*/Cache',
                '/home/*/.npm/_cacache',
                '/root/.cache',
                '/root/.thumbnails'
            ],
            fileExtensions: [
                '*.tmp', '*.temp', '*.cache', '*.bak', '*.old',
                '*.log', '*.pid', '*.lock', '*.swap', '*.swp',
                '*~', '*.~*', '.#*'
            ],
            filePatterns: [
                '.DS_Store', 'thumbs.db', 'Thumbs.db',
                'core', 'core.*', '*.core'
            ]
        };

        // Exclusions globales (s'appliquent partout)
        this.globalExclusions = {
            folders: [],
            fileExtensions: [
                '*.iso', '*.img', '*.vdi', '*.vmdk', '*.ova',
                '*.avi', '*.mkv', '*.mp4', '*.mov', '*.wmv'
            ],
            filePatterns: [],
            maxFileSize: 2 * 1024 * 1024 * 1024 // 2 GB par défaut
        };
    }

    /**
     * Obtenir les exclusions pour un système donné
     * @param {string} osType - 'windows' ou 'linux'
     * @param {Object} clientExclusions - Exclusions spécifiques au client
     * @param {Object} options - Options de configuration
     */
    getExclusions(osType, clientExclusions = {}, options = {}) {
        const baseExclusions = osType === 'windows' 
            ? this.defaultWindowsExclusions 
            : this.defaultLinuxExclusions;

        // Fusionner avec les exclusions globales
        const mergedExclusions = {
            folders: [
                ...baseExclusions.folders,
                ...this.globalExclusions.folders,
                ...(clientExclusions.folders || [])
            ],
            fileExtensions: [
                ...baseExclusions.fileExtensions,
                ...this.globalExclusions.fileExtensions,
                ...(clientExclusions.fileExtensions || [])
            ],
            filePatterns: [
                ...baseExclusions.filePatterns,
                ...this.globalExclusions.filePatterns,
                ...(clientExclusions.filePatterns || [])
            ],
            maxFileSize: clientExclusions.maxFileSize || this.globalExclusions.maxFileSize
        };

        // Appliquer les options de configuration
        if (options.excludeLogs === false) {
            mergedExclusions.fileExtensions = mergedExclusions.fileExtensions.filter(ext => ext !== '*.log');
        }

        if (options.excludeMedia === false) {
            mergedExclusions.fileExtensions = mergedExclusions.fileExtensions.filter(ext => 
                !['*.iso', '*.img', '*.avi', '*.mkv', '*.mp4', '*.mov', '*.wmv'].includes(ext)
            );
        }

        if (options.includeTemp === true) {
            mergedExclusions.folders = mergedExclusions.folders.filter(folder => 
                !folder.toLowerCase().includes('temp') && !folder.toLowerCase().includes('tmp')
            );
        }

        logger.debug(`Exclusions générées pour ${osType}: ${mergedExclusions.folders.length} dossiers, ${mergedExclusions.fileExtensions.length} extensions`);
        
        return mergedExclusions;
    }

    /**
     * Générer les options d'exclusion pour robocopy (Windows)
     */
    getRobocopyExclusions(exclusions) {
        let robocopyArgs = '';

        // Exclusions de dossiers
        if (exclusions.folders.length > 0) {
            const windowsFolders = exclusions.folders
                .filter(folder => folder.includes('\\'))
                .map(folder => path.basename(folder))
                .filter((value, index, self) => self.indexOf(value) === index); // Remove duplicates
            
            if (windowsFolders.length > 0) {
                robocopyArgs += ` /XD "${windowsFolders.join('" "')}"`;
            }
        }

        // Exclusions de fichiers
        if (exclusions.fileExtensions.length > 0) {
            const fileExts = exclusions.fileExtensions
                .map(ext => ext.replace('*.', ''))
                .join(' ');
            robocopyArgs += ` /XF *.${fileExts.replace(/ /g, ' *.')}`;
        }

        // Exclusions par patterns
        if (exclusions.filePatterns.length > 0) {
            robocopyArgs += ` /XF "${exclusions.filePatterns.join('" "')}"`;
        }

        // Taille maximale (robocopy utilise des octets)
        if (exclusions.maxFileSize) {
            robocopyArgs += ` /MAX:${exclusions.maxFileSize}`;
        }

        return robocopyArgs;
    }

    /**
     * Générer les options d'exclusion pour rsync (Linux)
     */
    getRsyncExclusions(exclusions) {
        let rsyncArgs = '';

        // Exclusions de dossiers
        if (exclusions.folders.length > 0) {
            exclusions.folders.forEach(folder => {
                // Convertir les chemins absolus en patterns relatifs
                let pattern = folder;
                if (folder.startsWith('/')) {
                    pattern = folder.substring(1);
                }
                // Gérer les wildcards
                if (pattern.includes('*')) {
                    rsyncArgs += ` --exclude="${pattern}"`;
                } else {
                    rsyncArgs += ` --exclude="${pattern}"`;
                }
            });
        }

        // Exclusions d'extensions de fichiers
        if (exclusions.fileExtensions.length > 0) {
            exclusions.fileExtensions.forEach(ext => {
                rsyncArgs += ` --exclude="${ext}"`;
            });
        }

        // Exclusions par patterns
        if (exclusions.filePatterns.length > 0) {
            exclusions.filePatterns.forEach(pattern => {
                rsyncArgs += ` --exclude="${pattern}"`;
            });
        }

        // Taille maximale (rsync)
        if (exclusions.maxFileSize) {
            const sizeMB = Math.floor(exclusions.maxFileSize / (1024 * 1024));
            rsyncArgs += ` --max-size=${sizeMB}M`;
        }

        return rsyncArgs;
    }

    /**
     * Générer un filtre find pour les fichiers modifiés (Linux incrémentiel)
     */
    getFindExclusions(exclusions) {
        let findArgs = '';

        // Exclusions de dossiers avec -not -path
        if (exclusions.folders.length > 0) {
            exclusions.folders.forEach(folder => {
                let pattern = folder;
                if (folder.includes('*')) {
                    // Gérer les wildcards dans find
                    pattern = folder.replace(/\*/g, '*');
                }
                findArgs += ` -not -path "${pattern}/*"`;
            });
        }

        // Exclusions d'extensions avec -not -name
        if (exclusions.fileExtensions.length > 0) {
            exclusions.fileExtensions.forEach(ext => {
                findArgs += ` -not -name "${ext}"`;
            });
        }

        // Exclusions par patterns
        if (exclusions.filePatterns.length > 0) {
            exclusions.filePatterns.forEach(pattern => {
                findArgs += ` -not -name "${pattern}"`;
            });
        }

        // Taille maximale
        if (exclusions.maxFileSize) {
            const sizeKB = Math.floor(exclusions.maxFileSize / 1024);
            findArgs += ` -size -${sizeKB}k`;
        }

        return findArgs;
    }

    /**
     * Vérifier si un fichier/dossier doit être exclu
     */
    shouldExclude(filePath, exclusions, osType = 'linux') {
        const normalizedPath = osType === 'windows' 
            ? filePath.replace(/\//g, '\\') 
            : filePath.replace(/\\/g, '/');

        // Vérifier exclusions de dossiers
        for (const excludeFolder of exclusions.folders) {
            const pattern = excludeFolder.replace(/\*/g, '.*');
            const regex = new RegExp(pattern, 'i');
            if (regex.test(normalizedPath)) {
                return { exclude: true, reason: `Folder exclusion: ${excludeFolder}` };
            }
        }

        // Vérifier exclusions d'extensions
        for (const excludeExt of exclusions.fileExtensions) {
            const pattern = excludeExt.replace(/\*/g, '.*').replace(/\./g, '\\.');
            const regex = new RegExp(pattern + '$', 'i');
            if (regex.test(path.basename(normalizedPath))) {
                return { exclude: true, reason: `Extension exclusion: ${excludeExt}` };
            }
        }

        // Vérifier exclusions par patterns
        for (const excludePattern of exclusions.filePatterns) {
            const pattern = excludePattern.replace(/\*/g, '.*');
            const regex = new RegExp(pattern, 'i');
            if (regex.test(path.basename(normalizedPath))) {
                return { exclude: true, reason: `Pattern exclusion: ${excludePattern}` };
            }
        }

        return { exclude: false };
    }

    /**
     * Obtenir les statistiques d'exclusions
     */
    getExclusionStats(exclusions) {
        return {
            totalFolderExclusions: exclusions.folders.length,
            totalFileExtensionExclusions: exclusions.fileExtensions.length,
            totalPatternExclusions: exclusions.filePatterns.length,
            maxFileSizeMB: exclusions.maxFileSize ? Math.round(exclusions.maxFileSize / (1024 * 1024)) : null,
            estimatedSpaceSavedPercent: this.estimateSpaceSaving(exclusions)
        };
    }

    /**
     * Estimer l'économie d'espace des exclusions
     */
    estimateSpaceSaving(exclusions) {
        let savingPercent = 0;
        
        // Estimation basée sur les types d'exclusions
        if (exclusions.folders.some(f => f.includes('temp') || f.includes('Temp'))) {
            savingPercent += 15; // Temp folders ~15%
        }
        if (exclusions.folders.some(f => f.includes('cache') || f.includes('Cache'))) {
            savingPercent += 10; // Cache folders ~10%
        }
        if (exclusions.fileExtensions.some(e => ['*.log', '*.tmp'].includes(e))) {
            savingPercent += 5; // Log/tmp files ~5%
        }
        if (exclusions.fileExtensions.some(e => ['*.iso', '*.img', '*.avi', '*.mkv'].includes(e))) {
            savingPercent += 25; // Large media files ~25%
        }

        return Math.min(savingPercent, 60); // Cap à 60%
    }

    /**
     * Créer des exclusions personnalisées à partir d'une configuration
     */
    createCustomExclusions(config) {
        return {
            folders: config.excludeFolders || [],
            fileExtensions: config.excludeExtensions || [],
            filePatterns: config.excludePatterns || [],
            maxFileSize: config.maxFileSize || this.globalExclusions.maxFileSize
        };
    }

    /**
     * Valider une configuration d'exclusions
     */
    validateExclusions(exclusions) {
        const errors = [];

        // Valider les dossiers
        if (exclusions.folders) {
            exclusions.folders.forEach((folder, index) => {
                if (typeof folder !== 'string' || folder.trim().length === 0) {
                    errors.push(`Folder exclusion ${index}: Must be a non-empty string`);
                }
            });
        }

        // Valider les extensions
        if (exclusions.fileExtensions) {
            exclusions.fileExtensions.forEach((ext, index) => {
                if (typeof ext !== 'string' || !ext.includes('.')) {
                    errors.push(`File extension ${index}: Must contain a dot (e.g., *.txt)`);
                }
            });
        }

        // Valider la taille max
        if (exclusions.maxFileSize && (typeof exclusions.maxFileSize !== 'number' || exclusions.maxFileSize <= 0)) {
            errors.push('maxFileSize: Must be a positive number');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }
}

// Instance singleton
const backupExclusions = new BackupExclusions();

module.exports = backupExclusions;