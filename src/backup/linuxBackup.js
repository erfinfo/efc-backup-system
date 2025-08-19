const { Client } = require('ssh2');
const path = require('path');
const fs = require('fs');
const { createClientLogger } = require('../utils/logger');

class LinuxBackupClient {
    constructor(clientConfig) {
        this.config = clientConfig;
        this.logger = createClientLogger(clientConfig.name);
        this.sshClient = null;
        this.isConnected = false;
    }

    async connect() {
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
    }

    async disconnect() {
        if (this.sshClient && this.isConnected) {
            this.sshClient.end();
            this.isConnected = false;
            this.logger.info('Connexion SSH fermée');
        }
    }

    async executeCommand(command) {
        if (!this.isConnected) {
            throw new Error('Client SSH non connecté');
        }

        return new Promise((resolve, reject) => {
            this.sshClient.exec(command, (err, stream) => {
                if (err) {
                    reject(err);
                    return;
                }

                let stdout = '';
                let stderr = '';

                stream.on('close', (code, signal) => {
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

    async createBackup(backupType = 'full', customFolders = null) {
        try {
            this.logger.info(`Démarrage du backup ${backupType} pour ${this.config.name}`);
            
            const backupId = `backup_${Date.now()}`;
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupDir = `/tmp/efc-backup-${this.config.name}-${timestamp}`;
            
            // Dossiers par défaut à sauvegarder
            const defaultFolders = ['/home', '/etc', '/var/www', '/opt'];
            const foldersToBackup = customFolders || this.config.folders?.split(',').map(f => f.trim()) || defaultFolders;
            
            this.logger.info(`Dossiers à sauvegarder: ${foldersToBackup.join(', ')}`);

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
            const backupResults = [];

            // Backup de chaque dossier
            for (const folder of foldersToBackup) {
                if (!folder.trim()) continue;
                
                try {
                    this.logger.info(`Backup du dossier: ${folder}`);
                    
                    // Vérifier si le dossier existe
                    await this.executeCommand(`test -d "${folder}"`);
                    
                    const folderName = folder.replace(/\//g, '_').replace(/^_/, '');
                    const targetDir = `${backupDir}/${folderName}`;
                    
                    // Utiliser rsync ou cp selon la disponibilité
                    let command;
                    try {
                        await this.executeCommand('which rsync');
                        command = `rsync -av --exclude='*.tmp' --exclude='*.swap' "${folder}/" "${targetDir}/"`;
                    } catch (error) {
                        command = `cp -rf "${folder}" "${targetDir}"`;
                    }
                    
                    await this.executeCommand(command);
                    
                    // Calculer la taille du backup
                    const sizeOutput = await this.executeCommand(`du -sb "${targetDir}" | cut -f1`);
                    const folderSize = parseInt(sizeOutput.trim()) || 0;
                    totalSize += folderSize;
                    
                    this.logger.info(`Backup terminé pour ${folder}: ${(folderSize / 1024 / 1024).toFixed(2)} MB`);
                    backupResults.push({
                        folder,
                        size: folderSize,
                        status: 'success'
                    });
                    
                } catch (error) {
                    this.logger.error(`Erreur lors du backup de ${folder}:`, error);
                    backupResults.push({
                        folder,
                        status: 'error',
                        error: error.message
                    });
                }
            }

            // Backup des configurations système importantes
            try {
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
            this.logger.info('Création de l\'archive...');
            
            await this.executeCommand(`cd /tmp && tar -czf ${archiveName} -C ${backupDir} .`);
            
            // Calculer la taille finale de l'archive
            const archiveSize = await this.executeCommand(`stat -c%s /tmp/${archiveName}`);
            const finalSize = parseInt(archiveSize.trim());
            
            this.logger.info(`Archive créée: ${archiveName} (${(finalSize / 1024 / 1024).toFixed(2)} MB)`);

            // Nettoyer le dossier temporaire
            await this.executeCommand(`rm -rf ${backupDir}`);
            
            const result = {
                backupId,
                type: backupType,
                client: this.config.name,
                status: 'completed',
                startTime: new Date(),
                endTime: new Date(),
                size: finalSize,
                archivePath: `/tmp/${archiveName}`,
                results: backupResults,
                totalFolders: foldersToBackup.length,
                successfulFolders: backupResults.filter(r => r.status === 'success').length
            };

            this.logger.info(`Backup terminé avec succès: ${(finalSize / 1024 / 1024).toFixed(2)} MB`);
            return result;

        } catch (error) {
            this.logger.error('Erreur lors du backup:', error);
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
}

module.exports = LinuxBackupClient;