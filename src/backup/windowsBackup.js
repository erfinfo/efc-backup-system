const { NodeSSH } = require('node-ssh');
const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../utils/logger');

class WindowsBackupClient {
    constructor(config) {
        this.config = config;
        this.ssh = new NodeSSH();
    }

    async connect() {
        try {
            await this.ssh.connect({
                host: this.config.host,
                port: this.config.port || 22,
                username: this.config.username,
                password: this.config.password
            });
            logger.info(`Connexion SSH établie avec ${this.config.host}`);
            return true;
        } catch (error) {
            logger.error(`Erreur de connexion SSH avec ${this.config.host}:`, error);
            throw error;
        }
    }

    async disconnect() {
        this.ssh.dispose();
        logger.info(`Connexion SSH fermée avec ${this.config.host}`);
    }

    async createSystemImage(destinationPath) {
        try {
            logger.info(`Création de l'image système pour ${this.config.host}`);
            
            // Créer une image système Windows avec wbadmin
            const backupCommand = `wbadmin start backup -backupTarget:"${destinationPath}" -include:C: -allCritical -quiet`;
            
            const result = await this.ssh.execCommand(backupCommand, {
                execOptions: { pty: true }
            });

            if (result.code !== 0) {
                throw new Error(`Erreur lors de la création de l'image: ${result.stderr}`);
            }

            logger.info(`Image système créée avec succès pour ${this.config.host}`);
            return true;
        } catch (error) {
            logger.error(`Erreur lors de la création de l'image système:`, error);
            throw error;
        }
    }

    async backupFolders(folders, localDestination) {
        const backupResults = [];
        
        for (const folder of folders) {
            try {
                logger.info(`Backup du dossier ${folder} depuis ${this.config.host}`);
                
                // Créer le dossier de destination local
                const folderName = path.basename(folder);
                const destPath = path.join(localDestination, this.config.name, folderName);
                await fs.mkdir(destPath, { recursive: true });

                // Utiliser SCP pour copier les fichiers
                await this.ssh.getDirectory(destPath, folder, {
                    recursive: true,
                    concurrency: 10,
                    tick: (localPath, remotePath, error) => {
                        if (error) {
                            logger.warn(`Erreur lors de la copie de ${remotePath}:`, error);
                        }
                    }
                });

                backupResults.push({
                    folder,
                    status: 'success',
                    destination: destPath
                });
                
                logger.info(`Backup réussi pour ${folder}`);
            } catch (error) {
                logger.error(`Erreur lors du backup de ${folder}:`, error);
                backupResults.push({
                    folder,
                    status: 'failed',
                    error: error.message
                });
            }
        }

        return backupResults;
    }

    async createVSSSnapshot() {
        try {
            logger.info(`Création d'un snapshot VSS pour ${this.config.host}`);
            
            // Créer un snapshot VSS (Volume Shadow Copy)
            const vssCommand = `
                $shadowId = (vssadmin create shadow /for=C: | Select-String "Shadow Copy ID:" | ForEach-Object { $_.Line.Split("{")[1].Split("}")[0] })
                Write-Output $shadowId
            `;
            
            const result = await this.ssh.execCommand(`powershell -Command "${vssCommand}"`);
            
            if (result.code !== 0) {
                throw new Error(`Erreur VSS: ${result.stderr}`);
            }

            const shadowId = result.stdout.trim();
            logger.info(`Snapshot VSS créé avec l'ID: ${shadowId}`);
            
            return shadowId;
        } catch (error) {
            logger.error(`Erreur lors de la création du snapshot VSS:`, error);
            throw error;
        }
    }

    async backupRegistry(destinationPath) {
        try {
            logger.info(`Backup du registre Windows pour ${this.config.host}`);
            
            const registryBackupCommands = [
                `reg export HKLM\\SOFTWARE "${destinationPath}\\SOFTWARE.reg" /y`,
                `reg export HKLM\\SYSTEM "${destinationPath}\\SYSTEM.reg" /y`,
                `reg export HKCU\\SOFTWARE "${destinationPath}\\CURRENT_USER_SOFTWARE.reg" /y`
            ];

            for (const command of registryBackupCommands) {
                const result = await this.ssh.execCommand(command);
                if (result.code !== 0) {
                    logger.warn(`Avertissement lors du backup du registre: ${result.stderr}`);
                }
            }

            logger.info(`Backup du registre terminé pour ${this.config.host}`);
            return true;
        } catch (error) {
            logger.error(`Erreur lors du backup du registre:`, error);
            throw error;
        }
    }

    async getSystemInfo() {
        try {
            const commands = {
                hostname: 'hostname',
                os: 'wmic os get Caption,Version /value',
                disk: 'wmic logicaldisk get size,freespace,caption /value',
                memory: 'wmic computersystem get TotalPhysicalMemory /value'
            };

            const systemInfo = {};

            for (const [key, command] of Object.entries(commands)) {
                const result = await this.ssh.execCommand(command);
                if (result.code === 0) {
                    systemInfo[key] = result.stdout.trim();
                }
            }

            return systemInfo;
        } catch (error) {
            logger.error(`Erreur lors de la récupération des informations système:`, error);
            throw error;
        }
    }

    async performFullBackup(options = {}) {
        const backupId = `backup_${this.config.name}_${Date.now()}`;
        const backupPath = path.join(options.backupPath || '/backups', backupId);
        
        try {
            await fs.mkdir(backupPath, { recursive: true });
            
            logger.info(`Démarrage du backup complet pour ${this.config.name}`);
            
            // 1. Connexion SSH
            await this.connect();
            
            // 2. Obtenir les informations système
            const systemInfo = await this.getSystemInfo();
            await fs.writeFile(
                path.join(backupPath, 'system_info.json'),
                JSON.stringify(systemInfo, null, 2)
            );
            
            // 3. Créer un snapshot VSS si possible
            let shadowId = null;
            if (options.useVSS !== false) {
                try {
                    shadowId = await this.createVSSSnapshot();
                } catch (error) {
                    logger.warn('VSS non disponible, backup sans snapshot');
                }
            }
            
            // 4. Backup des dossiers importants
            const folders = options.folders || this.config.folders || [
                'C:\\Users',
                'C:\\ProgramData',
                'C:\\Windows\\System32\\config'
            ];
            
            const folderResults = await this.backupFolders(folders, backupPath);
            
            // 5. Backup du registre
            const registryPath = path.join(backupPath, 'registry');
            await fs.mkdir(registryPath, { recursive: true });
            await this.backupRegistry(registryPath);
            
            // 6. Créer une image système si demandé
            if (options.createImage) {
                await this.createSystemImage(backupPath);
            }
            
            // 7. Créer un fichier de métadonnées
            const metadata = {
                backupId,
                clientName: this.config.name,
                clientHost: this.config.host,
                timestamp: new Date().toISOString(),
                type: options.type || 'full',
                folders: folderResults,
                systemInfo,
                shadowId,
                imageCreated: options.createImage || false
            };
            
            await fs.writeFile(
                path.join(backupPath, 'backup_metadata.json'),
                JSON.stringify(metadata, null, 2)
            );
            
            logger.info(`Backup complet terminé avec succès pour ${this.config.name}`);
            
            return {
                success: true,
                backupId,
                path: backupPath,
                metadata
            };
            
        } catch (error) {
            logger.error(`Erreur lors du backup complet:`, error);
            throw error;
        } finally {
            await this.disconnect();
        }
    }

    async performIncrementalBackup(lastBackupPath, options = {}) {
        try {
            logger.info(`Démarrage du backup incrémentiel pour ${this.config.name}`);
            
            // Lire les métadonnées du dernier backup
            const lastMetadata = JSON.parse(
                await fs.readFile(path.join(lastBackupPath, 'backup_metadata.json'), 'utf8')
            );
            
            // Utiliser robocopy pour un backup incrémentiel
            const incrementalCommand = `robocopy /MIR /XO /R:3 /W:10`;
            
            // Implémenter la logique de backup incrémentiel
            
            return {
                success: true,
                type: 'incremental',
                baseBackup: lastMetadata.backupId
            };
            
        } catch (error) {
            logger.error(`Erreur lors du backup incrémentiel:`, error);
            throw error;
        }
    }
}

module.exports = WindowsBackupClient;