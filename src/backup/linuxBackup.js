const { Client } = require('ssh2');
const path = require('path');
const fs = require('fs');
const { createClientLogger } = require('../utils/logger');
const { addNetworkStats } = require('../utils/database');
const backupExclusions = require('../utils/backup-exclusions');
const { retrySshOperation, retryBackupOperation } = require('../utils/retry-helper');

class LinuxBackupClient {
    constructor(clientConfig) {
        this.config = clientConfig;
        this.logger = createClientLogger(clientConfig.name);
        this.sshClient = null;
        this.isConnected = false;
    }

    async connect() {
        return await retrySshOperation(async () => {
            return new Promise((resolve, reject) => {
                this.sshClient = new Client();
                
                this.sshClient.on('ready', () => {
                    this.isConnected = true;
                    this.logger.info('Connexion SSH établie avec succès');
                    resolve();
                });

                this.sshClient.on('error', (err) => {
                    this.logger.error(`Erreur de connexion SSH avec ${this.config.host}:`, err);
                    reject(err);
                });

                this.sshClient.connect({
                    host: this.config.host,
                    port: this.config.port || 22,
                    username: this.config.username,
                    password: this.config.password,
                    keepaliveInterval: 30000,
                    keepaliveCountMax: 3
                });
            });
        }, this.config);
    }

    async disconnect() {
        if (this.sshClient && this.isConnected) {
            this.sshClient.end();
            this.isConnected = false;
            this.logger.info('Connexion SSH fermée');
        }
    }

    async executeCommand(command, timeout = 30000) {
        if (!this.isConnected) {
            throw new Error('Client SSH non connecté');
        }

        return new Promise((resolve, reject) => {
            // Timeout de sécurité
            const timeoutId = setTimeout(() => {
                this.logger.warn(`Timeout lors de l'exécution de la commande: ${command}`);
                reject(new Error(`Command timeout after ${timeout}ms: ${command}`));
            }, timeout);

            this.sshClient.exec(command, (err, stream) => {
                if (err) {
                    clearTimeout(timeoutId);
                    reject(err);
                    return;
                }

                let stdout = '';
                let stderr = '';

                stream.on('close', (code, signal) => {
                    clearTimeout(timeoutId);
                    if (code === 0) {
                        resolve(stdout);
                    } else {
                        reject(new Error(`Command failed with exit code ${code}: ${stderr}`));
                    }
                });

                stream.on('data', (data) => {
                    stdout += data.toString();
                });

                stream.stderr.on('data', (data) => {
                    stderr += data.toString();
                });
            });
        });
    }

    async getSystemInfo() {
        try {
            const [hostname, osInfo, uptime, diskSpace, memory] = await Promise.all([
                this.executeCommand('hostname'),
                this.executeCommand('cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d "\\"" || uname -sr'),
                this.executeCommand('uptime -p'),
                this.executeCommand('df -h / | tail -1'),
                this.executeCommand('free -h | grep Mem')
            ]);

            return {
                hostname: hostname.trim(),
                os: osInfo.trim(),
                uptime: uptime.trim(),
                diskSpace: diskSpace.trim(),
                memory: memory.trim(),
                platform: 'linux'
            };
        } catch (error) {
            this.logger.error('Erreur lors de la récupération des informations système:', error);
            throw error;
        }
    }

    async createBackup(backupType = 'full', customFolders = null, backupIdParam = null, progressCallback = null) {
        try {
            this.logger.info(`Démarrage du backup ${backupType} pour ${this.config.name}`);
            
            // Variables pour le tracking réseau
            const backupStartTime = new Date();
            const backupId = backupIdParam || `backup_${Date.now()}`;
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupDir = `/tmp/efc-backup-${this.config.name}-${timestamp}`;
            
            // Dossiers par défaut à sauvegarder
            const defaultFolders = ['/home', '/etc', '/var/www', '/opt'];
            
            let foldersToBackup;
            if (customFolders) {
                foldersToBackup = Array.isArray(customFolders) ? customFolders : [customFolders];
            } else if (this.config.folders) {
                try {
                    // Essayer de parser comme JSON d'abord (nouveau format)
                    const parsedFolders = JSON.parse(this.config.folders);
                    if (Array.isArray(parsedFolders)) {
                        // Filtrer les dossiers activés et extraire les chemins
                        foldersToBackup = parsedFolders.filter(f => f.enabled).map(f => f.path);
                    } else {
                        foldersToBackup = defaultFolders;
                    }
                } catch (error) {
                    // Fallback vers l'ancien format (chaîne séparée par des virgules)
                    foldersToBackup = this.config.folders.split(',').map(f => f.trim()).filter(f => f.length > 0);
                }
            } else {
                foldersToBackup = defaultFolders;
            }
            
            this.logger.info(`Dossiers à sauvegarder: ${JSON.stringify(foldersToBackup)}`);

            // Créer le dossier de backup temporaire
            await this.executeCommand(`mkdir -p ${backupDir}`);
            this.logger.info(`Dossier de backup créé: ${backupDir}`);

            // Installer rsync si nécessaire
            try {
                await this.executeCommand('which rsync');
            } catch (error) {
                this.logger.info('Installation de rsync...');
                try {
                    await this.executeCommand('sudo apt-get update && sudo apt-get install -y rsync');
                } catch (installError) {
                    this.logger.warn('Impossible d\'installer rsync, tentative avec cp...');
                }
            }

            let totalSize = 0;
            let totalFilesCount = 0;
            const backupResults = [];

            // Backup de chaque dossier avec tracking
            for (let i = 0; i < foldersToBackup.length; i++) {
                const folder = foldersToBackup[i];
                if (!folder.trim()) continue;
                
                // Calculer la progression basée sur le dossier en cours
                const folderProgress = 40 + (i / foldersToBackup.length) * 40; // 40% à 80%
                if (progressCallback) {
                    progressCallback(`Sauvegarde: ${folder}`, folderProgress, { 
                        currentFolder: folder, 
                        folderIndex: i + 1, 
                        totalFolders: foldersToBackup.length 
                    });
                }
                
                try {
                    this.logger.info(`Backup du dossier: ${folder}`);
                    
                    // Vérifier si le dossier existe
                    await this.executeCommand(`test -d "${folder}"`);
                    
                    const folderName = folder.replace(/\//g, '_').replace(/^_/, '');
                    const targetDir = `${backupDir}/${folderName}`;
                    
                    const folderStartTime = new Date();
                    
                    // Utiliser rsync ou cp selon la disponibilité
                    let command;
                    try {
                        await this.executeCommand('which rsync');
                        command = `rsync -av --exclude='*.tmp' --exclude='*.swap' "${folder}/" "${targetDir}/"`;
                    } catch (error) {
                        command = `cp -rf "${folder}" "${targetDir}"`;
                    }
                    
                    await this.executeCommand(command);
                    
                    // Calculer la taille et le nombre de fichiers du backup
                    const sizeOutput = await this.executeCommand(`du -sb "${targetDir}" | cut -f1`);
                    const folderSize = parseInt(sizeOutput.trim()) || 0;
                    totalSize += folderSize;
                    
                    // Compter les fichiers
                    let filesCount = 0;
                    try {
                        const filesOutput = await this.executeCommand(`find "${targetDir}" -type f | wc -l`);
                        filesCount = parseInt(filesOutput.trim()) || 0;
                        totalFilesCount += filesCount;
                    } catch (error) {
                        this.logger.warn(`Impossible de compter les fichiers dans ${targetDir}:`, error);
                    }
                    
                    const folderDuration = (new Date() - folderStartTime) / 1000; // en secondes
                    const folderSpeedMbps = folderSize > 0 ? (folderSize * 8) / (folderDuration * 1024 * 1024) : 0;
                    
                    this.logger.info(`Backup terminé pour ${folder}: ${(folderSize / 1024 / 1024).toFixed(2)} MB, ${filesCount} fichiers, ${Math.round(folderSpeedMbps)} Mbps`);
                    backupResults.push({
                        folder,
                        size: folderSize,
                        filesCount: filesCount,
                        duration: folderDuration,
                        speedMbps: Math.round(folderSpeedMbps * 100) / 100,
                        status: 'success'
                    });
                    
                } catch (error) {
                    this.logger.error(`Erreur lors du backup de ${folder}:`, error);
                    backupResults.push({
                        folder,
                        size: 0,
                        filesCount: 0,
                        duration: 0,
                        speedMbps: 0,
                        status: 'error',
                        error: error.message
                    });
                }
            }

            // Backup des configurations système importantes
            try {
                if (progressCallback) {
                    progressCallback('Backup configurations système', 80);
                }
                this.logger.info('Backup des configurations système...');
                const configDir = `${backupDir}/system_config`;
                await this.executeCommand(`mkdir -p ${configDir}`);
                
                // Liste des fichiers de configuration importants
                const configFiles = [
                    '/etc/passwd',
                    '/etc/group',
                    '/etc/fstab',
                    '/etc/hosts',
                    '/etc/crontab'
                ];
                
                for (const configFile of configFiles) {
                    try {
                        await this.executeCommand(`test -f "${configFile}" && cp "${configFile}" "${configDir}/" || true`);
                    } catch (error) {
                        this.logger.warn(`Impossible de copier ${configFile}: ${error.message}`);
                    }
                }
                
                // Backup de la liste des packages installés
                try {
                    await this.executeCommand(`dpkg -l > ${configDir}/installed_packages.txt 2>/dev/null || rpm -qa > ${configDir}/installed_packages.txt 2>/dev/null || true`);
                } catch (error) {
                    this.logger.warn('Impossible de créer la liste des packages installés');
                }
                
                this.logger.info('Backup des configurations système terminé');
                
            } catch (error) {
                this.logger.warn('Erreur lors du backup des configurations système:', error);
            }

            // Créer une archive tar.gz
            const archiveName = `efc-backup-${this.config.name}-${timestamp}.tar.gz`;
            const permanentBackupDir = process.env.BACKUP_PATH || '/var/backups/efc-backup';
            const archivePath = `${permanentBackupDir}/${archiveName}`;
            
            if (progressCallback) {
                progressCallback('Création de l\'archive', 85);
            }
            this.logger.info('Création de l\'archive...');
            
            // Créer le dossier permanent LOCAL s'il n'existe pas
            const fs = require('fs').promises;
            try {
                await fs.mkdir(permanentBackupDir, { recursive: true });
            } catch (error) {
                if (error.code !== 'EEXIST') {
                    this.logger.warn(`Erreur lors de la création du dossier local: ${error.message}`);
                }
            }
            
            // Créer l'archive temporaire sur le client distant
            const tempArchivePath = `/tmp/${archiveName}`;
            await this.executeCommand(`cd /tmp && tar -czf ${tempArchivePath} -C ${backupDir} .`);
            
            // Télécharger l'archive vers le serveur local
            this.logger.info(`Téléchargement de l'archive vers ${archivePath}...`);
            await this.downloadBackup(tempArchivePath, archivePath);
            
            // Supprimer l'archive temporaire sur le client distant
            await this.executeCommand(`rm -f ${tempArchivePath}`);
            
            // Mettre à jour la progression après création de l'archive
            if (progressCallback) {
                progressCallback('Archive créée avec succès', 90);
            }
            
            // Calculer la taille finale de l'archive avec protection d'erreur
            let finalSize = 0;
            try {
                // Vérifier d'abord que l'archive existe
                await this.executeCommand(`test -f ${archivePath}`, 5000);
                
                // Obtenir la taille avec timeout court
                const archiveSize = await this.executeCommand(`stat -c%s ${archivePath}`, 10000);
                finalSize = parseInt(archiveSize.trim());
                
                if (isNaN(finalSize) || finalSize <= 0) {
                    this.logger.warn(`Taille d'archive invalide, utilisation de la commande de fallback`);
                    // Fallback: utiliser ls pour obtenir la taille
                    const lsOutput = await this.executeCommand(`ls -l ${archivePath} | awk '{print $5}'`, 5000);
                    finalSize = parseInt(lsOutput.trim()) || 0;
                }
            } catch (error) {
                this.logger.error(`Erreur lors du calcul de la taille de l'archive: ${error.message}`);
                this.logger.warn(`Utilisation d'une estimation de taille basée sur le contenu`);
                finalSize = Math.max(totalSize, 1024); // Estimation minimale
            }
            
            this.logger.info(`Archive créée: ${archiveName} (${(finalSize / 1024 / 1024).toFixed(2)} MB)`);
            this.logger.info(`Backup sauvegardé dans: ${archivePath}`);

            // Nettoyer le dossier temporaire
            await this.executeCommand(`rm -rf ${backupDir}`);
            
            // Calculer les statistiques réseau globales
            const backupEndTime = new Date();
            const totalDuration = (backupEndTime - backupStartTime) / 1000; // en secondes
            const avgSpeedMbps = totalSize > 0 ? (totalSize * 8) / (totalDuration * 1024 * 1024) : 0;

            // Sauvegarder les statistiques réseau
            if (totalSize > 0) {
                try {
                    await addNetworkStats({
                        backup_id: backupId,
                        client_name: this.config.name,
                        bytes_transferred: totalSize,
                        transfer_speed_mbps: Math.round(avgSpeedMbps * 100) / 100,
                        duration_seconds: Math.round(totalDuration),
                        files_count: totalFilesCount,
                        started_at: backupStartTime.toISOString(),
                        completed_at: backupEndTime.toISOString()
                    });
                    
                    this.logger.info(`Statistiques réseau sauvegardées: ${Math.round(totalSize / (1024 * 1024))} MB, ${Math.round(avgSpeedMbps)} Mbps, ${Math.round(totalDuration)}s, ${totalFilesCount} fichiers`);
                } catch (error) {
                    this.logger.warn(`Erreur lors de la sauvegarde des statistiques réseau:`, error);
                }
            }
            
            const result = {
                backupId,
                type: backupType,
                client: this.config.name,
                status: 'completed',
                startTime: backupStartTime,
                endTime: backupEndTime,
                size: finalSize,
                archivePath: archivePath,
                results: backupResults,
                totalFolders: foldersToBackup.length,
                successfulFolders: backupResults.filter(r => r.status === 'success').length,
                // Ajouter les statistiques réseau au résultat
                networkStats: {
                    bytesTransferred: totalSize,
                    transferSpeedMbps: Math.round(avgSpeedMbps * 100) / 100,
                    durationSeconds: Math.round(totalDuration),
                    filesCount: totalFilesCount
                }
            };

            // Callback final de progression - TOUJOURS appelé
            if (progressCallback) {
                try {
                    progressCallback('Backup terminé avec succès', 100, { 
                        totalSize: finalSize,
                        avgSpeed: Math.round(avgSpeedMbps),
                        duration: Math.round(totalDuration)
                    });
                } catch (callbackError) {
                    this.logger.warn('Erreur lors du callback de progression final:', callbackError);
                }
            }
            
            this.logger.info(`Backup terminé avec succès: ${(finalSize / 1024 / 1024).toFixed(2)} MB, vitesse moyenne: ${Math.round(avgSpeedMbps)} Mbps`);
            return result;

        } catch (error) {
            this.logger.error('Erreur lors du backup:', error);
            
            // Assurer que la progression atteint 100% même en cas d'erreur
            if (progressCallback) {
                try {
                    progressCallback('Backup terminé avec erreur', 100, { 
                        error: error.message,
                        totalSize: 0,
                        avgSpeed: 0,
                        duration: 0
                    });
                } catch (callbackError) {
                    this.logger.warn('Erreur lors du callback de progression d\'erreur:', callbackError);
                }
            }
            
            throw error;
        }
    }

    async downloadBackup(remotePath, localPath) {
        if (!this.isConnected) {
            throw new Error('Client SSH non connecté');
        }

        return new Promise((resolve, reject) => {
            this.sshClient.sftp((err, sftp) => {
                if (err) {
                    reject(err);
                    return;
                }

                const readStream = sftp.createReadStream(remotePath);
                const writeStream = fs.createWriteStream(localPath);

                let totalBytes = 0;
                
                readStream.on('data', (chunk) => {
                    totalBytes += chunk.length;
                });

                readStream.on('end', () => {
                    this.logger.info(`Téléchargement terminé: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
                    resolve(totalBytes);
                });

                readStream.on('error', (err) => {
                    this.logger.error('Erreur lors du téléchargement:', err);
                    reject(err);
                });

                writeStream.on('error', (err) => {
                    this.logger.error('Erreur lors de l\'écriture locale:', err);
                    reject(err);
                });

                readStream.pipe(writeStream);
            });
        });
    }

    async cleanupRemoteBackup(remotePath) {
        try {
            await this.executeCommand(`rm -f "${remotePath}"`);
            this.logger.info(`Fichier de backup distant supprimé: ${remotePath}`);
        } catch (error) {
            this.logger.warn(`Impossible de supprimer le fichier distant: ${error.message}`);
        }
    }

    async performFullBackup(options = {}) {
        const backupId = options.backupId || `backup_${this.config.name}_${Date.now()}`;
        const progressCallback = options.progressCallback || (() => {});
        
        try {
            progressCallback('Connexion SSH...', 30);
            await this.connect();
            
            progressCallback('Démarrage du backup', 35);
            const result = await this.createBackup('full', options.folders, backupId, progressCallback);
            await this.disconnect();
            
            return {
                success: true,
                backupId: backupId,
                metadata: {
                    size_mb: Math.round(result.size / (1024 * 1024)),
                    file_count: result.networkStats?.filesCount || 0,
                    duration_seconds: result.networkStats?.durationSeconds || 0,
                    speed_mbps: result.networkStats?.transferSpeedMbps || 0
                },
                path: result.archivePath,
                results: result.results
            };
        } catch (error) {
            this.logger.error('Erreur lors du backup complet:', error);
            throw error;
        }
    }

    async performIncrementalBackup(lastBackupPath, options = {}) {
        const backupId = options.backupId || `backup_${this.config.name}_${Date.now()}`;
        const progressCallback = options.progressCallback || (() => {});
        
        try {
            progressCallback('Connexion SSH...', 30);
            await this.connect();
            
            this.logger.info(`Démarrage du backup incrémentiel pour ${this.config.name}`);
            this.logger.info(`Backup de référence: ${lastBackupPath}`);
            
            // Lire les métadonnées du dernier backup pour obtenir le timestamp
            let lastBackupTime = null;
            let baseBackupId = null;
            
            try {
                const metadataPath = `${lastBackupPath}/backup_metadata.json`;
                const metadataResult = await this.executeCommand(`cat ${metadataPath}`);
                const metadata = JSON.parse(metadataResult);
                lastBackupTime = new Date(metadata.timestamp);
                baseBackupId = metadata.backupId;
                this.logger.info(`Référence backup: ${baseBackupId} du ${lastBackupTime.toISOString()}`);
            } catch (error) {
                this.logger.warn('Impossible de lire les métadonnées du backup précédent, utilisation du timestamp du dossier');
                const statResult = await this.executeCommand(`stat -c %Y ${lastBackupPath}`);
                const timestamp = parseInt(statResult.trim()) * 1000;
                lastBackupTime = new Date(timestamp);
            }
            
            // Créer le vrai backup incrémentiel avec rsync
            const result = await this.createIncrementalBackup(backupId, lastBackupTime, baseBackupId, options.folders, { progressCallback });
            
            await this.disconnect();
            
            return {
                success: true,
                backupId: backupId,
                type: 'incremental',
                baseBackup: baseBackupId,
                metadata: {
                    size_mb: Math.round(result.size / (1024 * 1024)),
                    file_count: result.networkStats?.filesCount || 0,
                    duration_seconds: result.networkStats?.durationSeconds || 0,
                    speed_mbps: result.networkStats?.transferSpeedMbps || 0,
                    files_changed: result.filesChanged || 0,
                    files_skipped: result.filesSkipped || 0
                },
                path: result.archivePath,
                results: result.results
            };
        } catch (error) {
            this.logger.error('Erreur lors du backup incrémentiel:', error);
            throw error;
        }
    }

    async createIncrementalBackup(backupId, lastBackupTime, baseBackupId, customFolders = null, options = {}) {
        const progressCallback = options.progressCallback || (() => {});
        try {
            this.logger.info(`Création du backup incrémentiel ${backupId}`);
            
            const backupStartTime = new Date();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupDir = `/tmp/efc-backup-incremental-${this.config.name}-${timestamp}`;
            
            // Dossiers par défaut à sauvegarder
            const defaultFolders = ['/home', '/etc', '/var/www', '/opt'];
            
            let foldersToBackup;
            if (customFolders) {
                foldersToBackup = Array.isArray(customFolders) ? customFolders : [customFolders];
            } else if (this.config.folders) {
                try {
                    // Essayer de parser comme JSON d'abord (nouveau format)
                    const parsedFolders = JSON.parse(this.config.folders);
                    if (Array.isArray(parsedFolders)) {
                        // Filtrer les dossiers activés et extraire les chemins
                        foldersToBackup = parsedFolders.filter(f => f.enabled).map(f => f.path);
                    } else {
                        foldersToBackup = defaultFolders;
                    }
                } catch (error) {
                    // Fallback vers l'ancien format (chaîne séparée par des virgules)
                    foldersToBackup = this.config.folders.split(',').map(f => f.trim()).filter(f => f.length > 0);
                }
            } else {
                foldersToBackup = defaultFolders;
            }
            
            // Obtenir les exclusions pour ce client Linux
            const clientExclusions = this.config.exclusions || {};
            const exclusions = backupExclusions.getExclusions('linux', clientExclusions, options.exclusionOptions);
            const exclusionStats = backupExclusions.getExclusionStats(exclusions);
            
            this.logger.info(`Backup incrémentiel des dossiers: ${JSON.stringify(foldersToBackup)}`);
            this.logger.info(`Fichiers modifiés depuis: ${lastBackupTime.toISOString()}`);
            this.logger.info(`Exclusions actives: ${exclusionStats.totalFolderExclusions} dossiers, ${exclusionStats.totalFileExtensionExclusions} extensions, économie estimée: ${exclusionStats.estimatedSpaceSavedPercent}%`);

            // Créer le dossier de backup temporaire
            await this.executeCommand(`mkdir -p ${backupDir}`);
            
            // S'assurer que rsync est installé
            await this.ensureRsyncInstalled();

            let totalSize = 0;
            let totalFilesCount = 0;
            let totalFilesChanged = 0;
            let totalFilesSkipped = 0;
            let totalFilesExcluded = 0;
            const backupResults = [];

            // Calculer les jours depuis le dernier backup pour find
            const daysSinceLastBackup = Math.ceil((new Date() - lastBackupTime) / (1000 * 60 * 60 * 24));
            
            // Backup incrémentiel de chaque dossier avec rsync
            for (let i = 0; i < foldersToBackup.length; i++) {
                const folder = foldersToBackup[i];
                if (!folder.trim()) continue;
                
                // Calculer la progression basée sur le dossier en cours
                const folderProgress = 40 + (i / foldersToBackup.length) * 40; // 40% à 80%
                if (progressCallback) {
                    progressCallback(`Backup incrémentiel: ${folder}`, folderProgress, { 
                        currentFolder: folder, 
                        folderIndex: i + 1, 
                        totalFolders: foldersToBackup.length 
                    });
                }
                
                try {
                    this.logger.info(`Backup incrémentiel du dossier: ${folder}`);
                    
                    // Vérifier si le dossier existe
                    await this.executeCommand(`test -d "${folder}"`);
                    
                    const folderName = folder.replace(/\//g, '_').replace(/^_/, '');
                    const targetDir = `${backupDir}/${folderName}`;
                    
                    const folderStartTime = new Date();
                    
                    // Trouver les fichiers modifiés avec exclusions appliquées
                    let modifiedFiles = [];
                    let excludedFiles = 0;
                    
                    try {
                        // Construire la commande find avec exclusions
                        const exclusionArgs = backupExclusions.getFindExclusions(exclusions);
                        const baseTimeFilter = `"${lastBackupTime.toISOString().split('T')[0]} ${lastBackupTime.toISOString().split('T')[1].split('.')[0]}"`;
                        
                        let findCommand = `find "${folder}" -type f -newermt ${baseTimeFilter} ${exclusionArgs} 2>/dev/null | head -10000`;
                        
                        this.logger.info(`Find avec exclusions: ${findCommand.substring(0, 100)}...`);
                        const findResult = await this.executeCommand(findCommand);
                        modifiedFiles = findResult.split('\n').filter(f => f.trim());
                        
                        // Compter aussi les fichiers exclus pour statistiques
                        try {
                            const allModifiedCommand = `find "${folder}" -type f -newermt ${baseTimeFilter} 2>/dev/null | wc -l`;
                            const allModifiedResult = await this.executeCommand(allModifiedCommand);
                            const allModified = parseInt(allModifiedResult.trim()) || 0;
                            excludedFiles = Math.max(0, allModified - modifiedFiles.length);
                        } catch (excludedError) {
                            // Ignorer l'erreur de comptage des exclusions
                        }
                        
                        this.logger.info(`${modifiedFiles.length} fichiers modifiés détectés dans ${folder} (${excludedFiles} exclus)`);
                    } catch (error) {
                        // Fallback: utiliser -mtime avec jours et exclusions
                        try {
                            const exclusionArgs = backupExclusions.getFindExclusions(exclusions);
                            const findCommand = `find "${folder}" -type f -mtime -${daysSinceLastBackup + 1} ${exclusionArgs} 2>/dev/null | head -10000`;
                            
                            this.logger.info(`Find fallback avec exclusions: ${findCommand.substring(0, 100)}...`);
                            const findResult = await this.executeCommand(findCommand);
                            modifiedFiles = findResult.split('\n').filter(f => f.trim());
                            this.logger.info(`${modifiedFiles.length} fichiers récents détectés dans ${folder} (fallback avec exclusions)`);
                        } catch (fallbackError) {
                            this.logger.warn(`Impossible de détecter les fichiers modifiés dans ${folder}:`, fallbackError);
                            modifiedFiles = [];
                        }
                    }
                    
                    let folderSize = 0;
                    let filesChanged = 0;
                    let filesSkipped = 0;
                    
                    if (modifiedFiles.length > 0) {
                        // Créer le dossier cible
                        await this.executeCommand(`mkdir -p "${targetDir}"`);
                        
                        // Utiliser rsync avec --files-from pour ne copier que les fichiers modifiés
                        const tempFileList = `/tmp/modified-files-${Date.now()}.txt`;
                        
                        // Créer la liste des fichiers modifiés (chemins relatifs)
                        const relativePaths = modifiedFiles
                            .filter(file => file.startsWith(folder))
                            .map(file => file.substring(folder.length + (folder.endsWith('/') ? 0 : 1)))
                            .filter(path => path.length > 0);
                        
                        if (relativePaths.length > 0) {
                            // Écrire la liste dans un fichier temporaire
                            await this.executeCommand(`cat > ${tempFileList} << 'EOF'\n${relativePaths.join('\n')}\nEOF`);
                            
                            // Utiliser rsync avec la liste de fichiers
                            const rsyncCommand = `rsync -avR --files-from="${tempFileList}" "${folder}/" "${targetDir}/" --stats 2>/dev/null || true`;
                            
                            this.logger.info(`Exécution: rsync pour ${relativePaths.length} fichiers modifiés`);
                            const rsyncResult = await this.executeCommand(rsyncCommand);
                            
                            // Parser les statistiques rsync
                            const stats = this.parseRsyncStats(rsyncResult);
                            filesChanged = stats.filesTransferred || relativePaths.length;
                            filesSkipped = stats.filesSkipped || 0;
                            
                            // Nettoyer le fichier temporaire
                            await this.executeCommand(`rm -f ${tempFileList}`).catch(err => {
                                this.logger.debug(`Impossible de supprimer le fichier temporaire ${tempFileList}:`, err.message);
                            });
                            
                            // Calculer la taille du dossier copié
                            try {
                                const sizeOutput = await this.executeCommand(`du -sb "${targetDir}" 2>/dev/null | cut -f1`);
                                folderSize = parseInt(sizeOutput.trim()) || 0;
                            } catch (error) {
                                this.logger.warn(`Impossible de calculer la taille de ${targetDir}`);
                                folderSize = 0;
                            }
                        }
                    } else {
                        this.logger.info(`Aucun changement détecté dans ${folder} depuis le dernier backup`);
                    }
                    
                    totalSize += folderSize;
                    totalFilesCount += filesChanged;
                    totalFilesChanged += filesChanged;
                    totalFilesSkipped += filesSkipped;
                    
                    const folderDuration = (new Date() - folderStartTime) / 1000;
                    const folderSpeedMbps = folderSize > 0 ? (folderSize * 8) / (folderDuration * 1024 * 1024) : 0;
                    
                    this.logger.info(`Backup incrémentiel terminé pour ${folder}: ${filesChanged} fichiers modifiés (${filesSkipped} ignorés), ${(folderSize / 1024 / 1024).toFixed(2)} MB`);
                    
                    backupResults.push({
                        folder,
                        size: folderSize,
                        filesCount: filesChanged,
                        filesSkipped: filesSkipped,
                        duration: folderDuration,
                        speedMbps: Math.round(folderSpeedMbps * 100) / 100,
                        status: filesChanged > 0 ? 'success' : 'no_changes'
                    });
                    
                } catch (error) {
                    this.logger.error(`Erreur lors du backup incrémentiel de ${folder}:`, error);
                    backupResults.push({
                        folder,
                        size: 0,
                        filesCount: 0,
                        filesSkipped: 0,
                        duration: 0,
                        speedMbps: 0,
                        status: 'error',
                        error: error.message
                    });
                }
            }

            // Créer une archive tar.gz seulement si des changements ont été détectés
            let archivePath = null;
            let finalSize = 0;
            
            if (totalFilesChanged > 0) {
                const archiveName = `efc-backup-incremental-${this.config.name}-${timestamp}.tar.gz`;
                const permanentBackupDir = process.env.BACKUP_PATH || '/var/backups/efc-backup';
                archivePath = `${permanentBackupDir}/${archiveName}`;
                
                if (progressCallback) {
                    progressCallback('Création de l\'archive incrémentielle', 85);
                }
                this.logger.info('Création de l\'archive incrémentielle...');
                
                // Créer le dossier permanent LOCAL s'il n'existe pas
                const fs = require('fs').promises;
                try {
                    await fs.mkdir(permanentBackupDir, { recursive: true });
                } catch (error) {
                    if (error.code !== 'EEXIST') {
                        this.logger.warn(`Erreur lors de la création du dossier local: ${error.message}`);
                    }
                }
                
                // Créer l'archive temporaire sur le client distant
                const tempArchivePath = `/tmp/${archiveName}`;
                await this.executeCommand(`cd /tmp && tar -czf ${tempArchivePath} -C ${backupDir} . 2>/dev/null`);
                
                // Télécharger l'archive vers le serveur local
                this.logger.info(`Téléchargement de l'archive incrémentielle vers ${archivePath}...`);
                await this.downloadBackup(tempArchivePath, archivePath);
                
                // Supprimer l'archive temporaire sur le client distant
                await this.executeCommand(`rm -f ${tempArchivePath}`);
                
                // Calculer la taille finale de l'archive avec protection d'erreur
                try {
                    // Vérifier d'abord que l'archive existe
                    await this.executeCommand(`test -f ${archivePath}`, 5000);
                    
                    // Obtenir la taille avec timeout court
                    const archiveSize = await this.executeCommand(`stat -c%s ${archivePath}`, 10000);
                    finalSize = parseInt(archiveSize.trim());
                    
                    if (isNaN(finalSize) || finalSize <= 0) {
                        this.logger.warn(`Taille d'archive incrémentielle invalide, utilisation de la commande de fallback`);
                        // Fallback: utiliser ls pour obtenir la taille
                        const lsOutput = await this.executeCommand(`ls -l ${archivePath} | awk '{print $5}'`, 5000);
                        finalSize = parseInt(lsOutput.trim()) || 0;
                    }
                } catch (error) {
                    this.logger.error(`Erreur lors du calcul de la taille de l'archive incrémentielle: ${error.message}`);
                    this.logger.warn(`Utilisation d'une estimation de taille basée sur le contenu`);
                    finalSize = Math.max(totalSize, 1024); // Estimation minimale
                }
                
                if (progressCallback) {
                    progressCallback('Archive incrémentielle créée', 90);
                }
                
                this.logger.info(`Archive incrémentielle créée: ${archiveName} (${(finalSize / 1024 / 1024).toFixed(2)} MB)`);
                this.logger.info(`Backup sauvegardé dans: ${archivePath}`);
            } else {
                this.logger.info('Aucun changement détecté, pas d\'archive créée');
                archivePath = null;
                finalSize = 0;
            }

            // Nettoyer le dossier temporaire
            await this.executeCommand(`rm -rf ${backupDir}`);
            
            // Calculer les statistiques réseau globales
            const backupEndTime = new Date();
            const totalDuration = (backupEndTime - backupStartTime) / 1000;
            const avgSpeedMbps = totalSize > 0 ? (totalSize * 8) / (totalDuration * 1024 * 1024) : 0;

            // Sauvegarder les statistiques réseau si des données ont été transférées
            if (totalSize > 0) {
                try {
                    await addNetworkStats({
                        backup_id: backupId,
                        client_name: this.config.name,
                        bytes_transferred: totalSize,
                        transfer_speed_mbps: Math.round(avgSpeedMbps * 100) / 100,
                        duration_seconds: Math.round(totalDuration),
                        files_count: totalFilesChanged,
                        started_at: backupStartTime.toISOString(),
                        completed_at: backupEndTime.toISOString()
                    });
                    
                    this.logger.info(`Statistiques incrémentiel sauvegardées: ${totalFilesChanged} fichiers modifiés, ${Math.round(totalSize / (1024 * 1024))} MB`);
                } catch (error) {
                    this.logger.warn(`Erreur lors de la sauvegarde des statistiques réseau:`, error);
                }
            }
            
            // Callback final de progression - TOUJOURS appelé
            if (progressCallback) {
                try {
                    const statusMessage = totalFilesChanged > 0 
                        ? `Backup incrémentiel terminé: ${totalFilesChanged} fichiers modifiés`
                        : 'Backup incrémentiel terminé: aucun changement';
                        
                    progressCallback(statusMessage, 100, { 
                        totalSize: finalSize,
                        filesChanged: totalFilesChanged,
                        avgSpeed: Math.round(avgSpeedMbps),
                        duration: Math.round(totalDuration)
                    });
                } catch (callbackError) {
                    this.logger.warn('Erreur lors du callback de progression incrémentiel final:', callbackError);
                }
            }
            
            return {
                backupId,
                type: 'incremental',
                baseBackup: baseBackupId,
                client: this.config.name,
                status: 'completed',
                startTime: backupStartTime,
                endTime: backupEndTime,
                size: finalSize,
                archivePath: archivePath,
                results: backupResults,
                totalFolders: foldersToBackup.length,
                successfulFolders: backupResults.filter(r => r.status === 'success').length,
                filesChanged: totalFilesChanged,
                filesSkipped: totalFilesSkipped,
                networkStats: {
                    bytesTransferred: totalSize,
                    transferSpeedMbps: Math.round(avgSpeedMbps * 100) / 100,
                    durationSeconds: Math.round(totalDuration),
                    filesCount: totalFilesChanged
                }
            };

        } catch (error) {
            this.logger.error('Erreur lors du backup incrémentiel:', error);
            
            // Assurer que la progression atteint 100% même en cas d'erreur
            if (progressCallback) {
                try {
                    progressCallback('Backup incrémentiel terminé avec erreur', 100, { 
                        error: error.message,
                        totalSize: 0,
                        filesChanged: 0,
                        avgSpeed: 0,
                        duration: 0
                    });
                } catch (callbackError) {
                    this.logger.warn('Erreur lors du callback de progression incrémentiel d\'erreur:', callbackError);
                }
            }
            
            throw error;
        }
    }

    async ensureRsyncInstalled() {
        try {
            await this.executeCommand('which rsync');
            this.logger.info('rsync disponible');
        } catch (error) {
            this.logger.info('Installation de rsync...');
            try {
                // Essayer différents gestionnaires de paquets
                await this.executeCommand('sudo apt-get update && sudo apt-get install -y rsync 2>/dev/null || sudo yum install -y rsync 2>/dev/null || sudo dnf install -y rsync 2>/dev/null');
                this.logger.info('rsync installé avec succès');
            } catch (installError) {
                throw new Error('Impossible d\'installer rsync, backup incrémentiel indisponible');
            }
        }
    }

    parseRsyncStats(rsyncOutput) {
        const stats = {
            filesTransferred: 0,
            filesSkipped: 0,
            totalFileSize: 0,
            bytesReceived: 0
        };

        try {
            // Parser la sortie rsync pour extraire les statistiques
            const lines = rsyncOutput.split('\n');
            
            for (const line of lines) {
                if (line.includes('Number of files transferred:')) {
                    const match = line.match(/(\d+)/);
                    if (match) stats.filesTransferred = parseInt(match[1]);
                }
                if (line.includes('Total file size:')) {
                    const match = line.match(/(\d+)/);
                    if (match) stats.totalFileSize = parseInt(match[1]);
                }
                if (line.includes('Total bytes received:')) {
                    const match = line.match(/(\d+)/);
                    if (match) stats.bytesReceived = parseInt(match[1]);
                }
            }
        } catch (error) {
            this.logger.warn('Impossible de parser les statistiques rsync:', error);
        }

        return stats;
    }
}

module.exports = LinuxBackupClient;