const { NodeSSH } = require('node-ssh');
const fs = require('fs').promises;
const path = require('path');
const { logger, createClientLogger, createBackupLogger } = require('../utils/logger');
const { addNetworkStats } = require('../utils/database');
const backupExclusions = require('../utils/backup-exclusions');
const { retrySshOperation, retryBackupOperation } = require('../utils/retry-helper');

class WindowsBackupClient {
    constructor(config) {
        this.config = config;
        this.ssh = new NodeSSH();
        this.clientLogger = createClientLogger(config.name);
        this.backupLogger = null; // Sera initialisé lors du backup avec l'ID
    }

    async connect() {
        return await retrySshOperation(async () => {
            this.clientLogger.info(`🔄 Tentative de connexion SSH vers ${this.config.host}:${this.config.port || 22}`);
            this.clientLogger.info(`👤 Utilisateur: ${this.config.username}`);
            
            try {
                await this.ssh.connect({
                    host: this.config.host,
                    port: this.config.port || 22,
                    username: this.config.username,
                    password: this.config.password
                });
                
                this.clientLogger.info(`✅ Connexion SSH établie avec succès vers ${this.config.host}`);
                if (this.backupLogger) {
                    this.backupLogger.info(`✅ Connexion SSH réussie vers ${this.config.host}:${this.config.port || 22}`);
                }
                logger.info(`Connexion SSH établie avec ${this.config.host}`);
                return true;
            } catch (error) {
                const errorMsg = this.getSSHErrorMessage(error);
                this.clientLogger.error(`❌ Échec connexion SSH: ${errorMsg}`);
                if (this.backupLogger) {
                    this.backupLogger.error(`❌ CONNEXION SSH ÉCHOUÉE`);
                    this.backupLogger.error(`🚨 Host: ${this.config.host}:${this.config.port || 22}`);
                    this.backupLogger.error(`👤 Utilisateur: ${this.config.username}`);
                    this.backupLogger.error(`💥 Erreur: ${errorMsg}`);
                    this.backupLogger.error(`📍 Détail technique: ${error.message}`);
                }
                throw new Error(`Connexion SSH impossible: ${errorMsg}`);
            }
        }, this.config);
    }

    getSSHErrorMessage(error) {
        if (error.code === 'ENOTFOUND') {
            return `Host introuvable (${this.config.host})`;
        } else if (error.code === 'ECONNREFUSED') {
            return `Connexion refusée (port ${this.config.port || 22} fermé ?)`;
        } else if (error.code === 'ETIMEDOUT') {
            return `Timeout de connexion (host inaccessible ou pare-feu)`;
        } else if (error.message.includes('Authentication failure')) {
            return `Authentification échouée (vérifier utilisateur/mot de passe)`;
        } else if (error.message.includes('Host key verification failed')) {
            return `Vérification de clé d'hôte échouée`;
        } else {
            return error.message || 'Erreur inconnue';
        }
    }

    async disconnect() {
        this.ssh.dispose();
        this.clientLogger.info(`🔌 Connexion SSH fermée avec ${this.config.host}`);
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

    async backupFolders(folders, localDestination, backupId = null, options = {}) {
        const backupResults = [];
        
        // Variables pour le tracking réseau
        const backupStartTime = new Date();
        let totalBytesTransferred = 0;
        let totalFilesCount = 0;
        let totalFilesExcluded = 0;
        
        // Obtenir les exclusions pour ce client Windows
        const clientExclusions = this.config.exclusions || {};
        const exclusions = backupExclusions.getExclusions('windows', clientExclusions, options.exclusionOptions);
        const exclusionStats = backupExclusions.getExclusionStats(exclusions);
        
        logger.info(`Exclusions actives pour backup: ${exclusionStats.totalFolderExclusions} dossiers, ${exclusionStats.totalFileExtensionExclusions} extensions`);
        
        for (const folder of folders) {
            try {
                logger.info(`Backup du dossier ${folder} depuis ${this.config.host}`);
                
                // Créer le dossier de destination local
                const folderName = path.basename(folder);
                const destPath = path.join(localDestination, this.config.name, folderName);
                await fs.mkdir(destPath, { recursive: true });

                // Variables pour tracker ce dossier spécifique
                const folderStartTime = new Date();
                let folderBytes = 0;
                let folderFiles = 0;

                // Utiliser SCP pour copier les fichiers avec tracking et exclusions
                await this.ssh.getDirectory(destPath, folder, {
                    recursive: true,
                    concurrency: 10,
                    validate: (itemPath) => {
                        // Appliquer les exclusions
                        const result = backupExclusions.shouldExclude(itemPath, exclusions, 'windows');
                        if (result.exclude) {
                            totalFilesExcluded++;
                            logger.debug(`Exclusion: ${itemPath} - ${result.reason}`);
                            return false;
                        }
                        return true;
                    },
                    tick: (localPath, remotePath, error) => {
                        if (error) {
                            logger.warn(`Erreur lors de la copie de ${remotePath}:`, error);
                        } else {
                            // Compter les fichiers transférés
                            folderFiles++;
                            totalFilesCount++;
                        }
                    }
                });

                // Calculer la taille du dossier copié
                folderBytes = await this.calculateDirectorySize(destPath);
                totalBytesTransferred += folderBytes;

                const folderDuration = (new Date() - folderStartTime) / 1000; // en secondes
                const folderSpeedMbps = folderBytes > 0 ? (folderBytes * 8) / (folderDuration * 1024 * 1024) : 0;

                backupResults.push({
                    folder,
                    status: 'success',
                    destination: destPath,
                    bytesTransferred: folderBytes,
                    filesCount: folderFiles,
                    duration: folderDuration,
                    speedMbps: Math.round(folderSpeedMbps * 100) / 100
                });
                
                logger.info(`Backup réussi pour ${folder} - ${Math.round(folderBytes / (1024 * 1024))} MB, ${folderFiles} fichiers transférés, ${Math.round(folderSpeedMbps)} Mbps`);
            } catch (error) {
                logger.error(`Erreur lors du backup de ${folder}:`, error);
                backupResults.push({
                    folder,
                    status: 'failed',
                    error: error.message,
                    bytesTransferred: 0,
                    filesCount: 0,
                    duration: 0,
                    speedMbps: 0
                });
            }
        }

        // Calculer les statistiques globales
        const backupEndTime = new Date();
        const totalDuration = (backupEndTime - backupStartTime) / 1000; // en secondes
        const avgSpeedMbps = totalBytesTransferred > 0 ? (totalBytesTransferred * 8) / (totalDuration * 1024 * 1024) : 0;

        // Sauvegarder les statistiques réseau si un backupId est fourni
        if (backupId && totalBytesTransferred > 0) {
            try {
                await addNetworkStats({
                    backup_id: backupId,
                    client_name: this.config.name,
                    bytes_transferred: totalBytesTransferred,
                    transfer_speed_mbps: Math.round(avgSpeedMbps * 100) / 100,
                    duration_seconds: Math.round(totalDuration),
                    files_count: totalFilesCount,
                    started_at: backupStartTime.toISOString(),
                    completed_at: backupEndTime.toISOString()
                });
                
                logger.info(`Statistiques réseau sauvegardées pour ${this.config.name}: ${Math.round(totalBytesTransferred / (1024 * 1024))} MB, ${Math.round(avgSpeedMbps)} Mbps, ${Math.round(totalDuration)}s`);
            } catch (error) {
                logger.warn(`Erreur lors de la sauvegarde des statistiques réseau:`, error);
            }
        }
        
        if (totalFilesExcluded > 0) {
            logger.info(`Total de fichiers exclus: ${totalFilesExcluded} (économie estimée: ${exclusionStats.estimatedSpaceSavedPercent}%)`);
        }

        return backupResults;
    }

    async calculateDirectorySize(dirPath) {
        let totalSize = 0;
        
        try {
            const stats = await fs.stat(dirPath);
            if (stats.isFile()) {
                return stats.size;
            } else if (stats.isDirectory()) {
                const files = await fs.readdir(dirPath);
                for (const file of files) {
                    const filePath = path.join(dirPath, file);
                    totalSize += await this.calculateDirectorySize(filePath);
                }
            }
        } catch (error) {
            logger.warn(`Erreur lors du calcul de la taille de ${dirPath}:`, error);
        }
        
        return totalSize;
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
            logger.info(`Collecte des informations système pour ${this.config.host}`);
            
            const systemInfo = {};

            // 1. Hostname (reste en commande simple)
            try {
                const result = await this.ssh.execCommand('hostname');
                if (result.code === 0) {
                    systemInfo.hostname = result.stdout.trim();
                }
            } catch (error) {
                logger.warn('Impossible de récupérer le hostname:', error);
                systemInfo.hostname = 'Unknown';
            }

            // 2. Informations OS avec PowerShell moderne
            try {
                const osCommand = `powershell -Command "
                    $os = Get-CimInstance Win32_OperatingSystem
                    [PSCustomObject]@{
                        Caption = $os.Caption
                        Version = $os.Version
                        BuildNumber = $os.BuildNumber
                        Architecture = $os.OSArchitecture
                        InstallDate = $os.InstallDate
                        LastBootUpTime = $os.LastBootUpTime
                        TotalVisibleMemorySize = $os.TotalVisibleMemorySize
                        FreePhysicalMemory = $os.FreePhysicalMemory
                        ServicePackMajorVersion = $os.ServicePackMajorVersion
                        ServicePackMinorVersion = $os.ServicePackMinorVersion
                    } | ConvertTo-Json -Compress
                "`;

                const osResult = await this.ssh.execCommand(osCommand);
                if (osResult.code === 0 && osResult.stdout.trim()) {
                    const osData = JSON.parse(osResult.stdout);
                    systemInfo.os = {
                        name: osData.Caption || 'Unknown',
                        version: osData.Version || 'Unknown',
                        buildNumber: osData.BuildNumber || 'Unknown',
                        architecture: osData.Architecture || 'Unknown',
                        installDate: osData.InstallDate || null,
                        lastBootUpTime: osData.LastBootUpTime || null,
                        servicePackMajor: osData.ServicePackMajorVersion || 0,
                        servicePackMinor: osData.ServicePackMinorVersion || 0
                    };
                } else {
                    throw new Error('PowerShell OS command failed');
                }
            } catch (error) {
                logger.warn('PowerShell OS info failed, using wmic fallback:', error);
                try {
                    const wmicResult = await this.ssh.execCommand('wmic os get Caption,Version /value');
                    systemInfo.os = wmicResult.code === 0 ? wmicResult.stdout.trim() : 'Unknown';
                } catch (wmicError) {
                    systemInfo.os = 'Unknown';
                }
            }

            // 3. Informations mémoire avec PowerShell moderne  
            try {
                const memoryCommand = `powershell -Command "
                    $cs = Get-CimInstance Win32_ComputerSystem
                    $mem = Get-CimInstance Win32_PhysicalMemory | Measure-Object Capacity -Sum
                    [PSCustomObject]@{
                        TotalPhysicalMemoryGB = [math]::Round($cs.TotalPhysicalMemory / 1GB, 2)
                        PhysicalMemorySlots = ($mem.Count)
                        TotalInstalledMemoryGB = [math]::Round($mem.Sum / 1GB, 2)
                        Manufacturer = $cs.Manufacturer
                        Model = $cs.Model
                        SystemType = $cs.SystemType
                        NumberOfProcessors = $cs.NumberOfProcessors
                        NumberOfLogicalProcessors = $cs.NumberOfLogicalProcessors
                    } | ConvertTo-Json -Compress
                "`;

                const memResult = await this.ssh.execCommand(memoryCommand);
                if (memResult.code === 0 && memResult.stdout.trim()) {
                    const memData = JSON.parse(memResult.stdout);
                    systemInfo.memory = {
                        totalPhysicalGB: memData.TotalPhysicalMemoryGB || 0,
                        installedMemoryGB: memData.TotalInstalledMemoryGB || 0,
                        physicalSlots: memData.PhysicalMemorySlots || 0
                    };
                    systemInfo.hardware = {
                        manufacturer: memData.Manufacturer || 'Unknown',
                        model: memData.Model || 'Unknown',
                        systemType: memData.SystemType || 'Unknown',
                        processors: memData.NumberOfProcessors || 0,
                        logicalProcessors: memData.NumberOfLogicalProcessors || 0
                    };
                } else {
                    throw new Error('PowerShell memory command failed');
                }
            } catch (error) {
                logger.warn('PowerShell memory info failed, using wmic fallback:', error);
                try {
                    const wmicResult = await this.ssh.execCommand('wmic computersystem get TotalPhysicalMemory /value');
                    systemInfo.memory = wmicResult.code === 0 ? wmicResult.stdout.trim() : 'Unknown';
                } catch (wmicError) {
                    systemInfo.memory = 'Unknown';
                }
            }

            // 4. Informations processeur avec PowerShell moderne
            try {
                const cpuCommand = `powershell -Command "
                    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
                    [PSCustomObject]@{
                        Name = $cpu.Name
                        Manufacturer = $cpu.Manufacturer
                        MaxClockSpeed = $cpu.MaxClockSpeed
                        NumberOfCores = $cpu.NumberOfCores  
                        NumberOfLogicalProcessors = $cpu.NumberOfLogicalProcessors
                        Architecture = $cpu.Architecture
                        Family = $cpu.Family
                        Model = $cpu.Model
                        Stepping = $cpu.Stepping
                        ProcessorId = $cpu.ProcessorId
                    } | ConvertTo-Json -Compress
                "`;

                const cpuResult = await this.ssh.execCommand(cpuCommand);
                if (cpuResult.code === 0 && cpuResult.stdout.trim()) {
                    const cpuData = JSON.parse(cpuResult.stdout);
                    systemInfo.processor = {
                        name: cpuData.Name || 'Unknown',
                        manufacturer: cpuData.Manufacturer || 'Unknown',
                        maxClockSpeedMHz: cpuData.MaxClockSpeed || 0,
                        cores: cpuData.NumberOfCores || 0,
                        logicalProcessors: cpuData.NumberOfLogicalProcessors || 0,
                        architecture: this.getCpuArchitectureName(cpuData.Architecture) || 'Unknown',
                        family: cpuData.Family || 0,
                        model: cpuData.Model || 0,
                        stepping: cpuData.Stepping || 0,
                        processorId: cpuData.ProcessorId || 'Unknown'
                    };
                }
            } catch (error) {
                logger.warn('Impossible de récupérer les informations processeur:', error);
                systemInfo.processor = { name: 'Unknown', cores: 0 };
            }

            // 5. Informations réseau avec PowerShell moderne
            try {
                const networkCommand = `powershell -Command "
                    Get-NetAdapter | Where-Object {$_.Status -eq 'Up'} | ForEach-Object {
                        [PSCustomObject]@{
                            Name = $_.Name
                            InterfaceDescription = $_.InterfaceDescription
                            LinkSpeed = $_.LinkSpeed
                            MacAddress = $_.MacAddress
                            Status = $_.Status
                            InterfaceType = $_.InterfaceType
                        }
                    } | ConvertTo-Json -Compress
                "`;

                const networkResult = await this.ssh.execCommand(networkCommand);
                if (networkResult.code === 0 && networkResult.stdout.trim()) {
                    const networkData = JSON.parse(networkResult.stdout);
                    systemInfo.network = Array.isArray(networkData) ? networkData : [networkData];
                } else {
                    systemInfo.network = [];
                }
            } catch (error) {
                logger.warn('Impossible de récupérer les informations réseau:', error);
                systemInfo.network = [];
            }

            // 6. Ajouter la détection dynamique des volumes (déjà en PowerShell)
            try {
                const volumes = await this.detectVolumes();
                systemInfo.volumes = volumes;
                logger.info(`${volumes.length} volumes intégrés dans les infos système`);
            } catch (error) {
                logger.warn('Impossible de détecter les volumes:', error);
                systemInfo.volumes = [];
            }

            // 7. Timestamp et métadonnées
            systemInfo.collectedAt = new Date().toISOString();
            systemInfo.collectionMethod = 'PowerShell-Modern';

            logger.info(`Informations système collectées avec succès pour ${systemInfo.hostname || this.config.host}`);
            return systemInfo;

        } catch (error) {
            logger.error(`Erreur lors de la récupération des informations système:`, error);
            throw error;
        }
    }

    getCpuArchitectureName(architecture) {
        const architectures = {
            0: 'x86',
            1: 'MIPS',  
            2: 'Alpha',
            3: 'PowerPC',
            5: 'ARM',
            6: 'ia64',
            9: 'x64'
        };
        return architectures[architecture] || 'Unknown';
    }

    async detectVolumes() {
        try {
            logger.info(`Détection des volumes disponibles sur ${this.config.host}`);
            
            // Utiliser PowerShell pour obtenir des informations détaillées sur tous les volumes
            const volumeCommand = `powershell -Command "
                Get-Volume | Where-Object {$_.DriveLetter -ne $null} | ForEach-Object {
                    [PSCustomObject]@{
                        DriveLetter = $_.DriveLetter
                        Label = $_.FileSystemLabel
                        FileSystem = $_.FileSystem  
                        SizeGB = [math]::Round($_.Size / 1GB, 2)
                        FreeSpaceGB = [math]::Round($_.SizeRemaining / 1GB, 2)
                        HealthStatus = $_.HealthStatus
                        DriveType = $_.DriveType
                        OperationalStatus = $_.OperationalStatus
                    }
                } | ConvertTo-Json -Compress
            "`;

            const result = await this.ssh.execCommand(volumeCommand);
            
            if (result.code !== 0) {
                throw new Error(`Erreur PowerShell: ${result.stderr}`);
            }

            let volumes = [];
            
            if (result.stdout.trim()) {
                try {
                    const volumeData = JSON.parse(result.stdout);
                    volumes = Array.isArray(volumeData) ? volumeData : [volumeData];
                } catch (parseError) {
                    logger.warn('Erreur parsing JSON des volumes, utilisation fallback');
                    volumes = await this.detectVolumesFallback();
                }
            }

            // Enrichir avec des informations sur les disques réseau
            const networkDrives = await this.detectNetworkDrives();
            volumes = volumes.concat(networkDrives);

            // Catégoriser les volumes
            const categorizedVolumes = this.categorizeVolumes(volumes);
            
            logger.info(`${volumes.length} volumes détectés: ${volumes.map(v => v.DriveLetter + ':').join(', ')}`);
            
            return categorizedVolumes;

        } catch (error) {
            logger.error('Erreur lors de la détection des volumes:', error);
            return await this.detectVolumesFallback();
        }
    }

    async detectVolumesFallback() {
        try {
            logger.info('Utilisation de la méthode PowerShell alternative pour les volumes');
            
            // Méthode PowerShell alternative (plus compatible que Get-Volume)
            const diskCommand = `powershell -Command "
                Get-WmiObject Win32_LogicalDisk | ForEach-Object {
                    [PSCustomObject]@{
                        DriveLetter = $_.DeviceID.Replace(':', '')
                        Label = if ($_.VolumeName) { $_.VolumeName } else { 'Unlabeled' }
                        FileSystem = $_.FileSystem
                        SizeGB = if ($_.Size) { [math]::Round($_.Size / 1GB, 2) } else { 0 }
                        FreeSpaceGB = if ($_.FreeSpace) { [math]::Round($_.FreeSpace / 1GB, 2) } else { 0 }
                        DriveType = $_.DriveType
                        HealthStatus = 'Unknown'
                        OperationalStatus = 'OK'
                    }
                } | ConvertTo-Json -Compress
            "`;

            const result = await this.ssh.execCommand(diskCommand);
            
            if (result.code === 0 && result.stdout.trim()) {
                try {
                    const diskData = JSON.parse(result.stdout);
                    const volumes = Array.isArray(diskData) ? diskData : [diskData];
                    
                    // Convertir DriveType numérique en nom
                    const convertedVolumes = volumes.map(vol => ({
                        ...vol,
                        DriveType: this.getDriveTypeName(vol.DriveType)
                    }));
                    
                    logger.info(`Détection PowerShell alternative réussie: ${convertedVolumes.length} volumes`);
                    return this.categorizeVolumes(convertedVolumes);
                } catch (parseError) {
                    logger.warn('Erreur parsing PowerShell alternative:', parseError);
                }
            }

            // Dernier fallback avec wmic si PowerShell échoue complètement
            logger.warn('PowerShell indisponible, utilisation wmic en dernier recours');
            return await this.detectVolumesWmicFallback();

        } catch (error) {
            logger.warn('Fallback PowerShell échoué:', error);
            return await this.detectVolumesWmicFallback();
        }
    }

    async detectVolumesWmicFallback() {
        try {
            const diskCommand = 'wmic logicaldisk get DeviceID,FileSystem,Size,FreeSpace,VolumeName,DriveType /format:csv';
            const result = await this.ssh.execCommand(diskCommand);
            
            if (result.code !== 0) {
                return [{ 
                    DriveLetter: 'C', 
                    Label: 'System', 
                    FileSystem: 'NTFS', 
                    Category: 'system',
                    ShouldBackup: true,
                    Priority: 'high'
                }];
            }

            const lines = result.stdout.split('\n').filter(line => line.trim() && !line.startsWith('Node'));
            const volumes = [];

            for (const line of lines) {
                const parts = line.split(',');
                if (parts.length >= 6) {
                    const deviceId = parts[1]?.trim();
                    const driveType = parseInt(parts[2]?.trim()) || 0;
                    const fileSystem = parts[3]?.trim();
                    const freeSpace = parseInt(parts[4]?.trim()) || 0;
                    const size = parseInt(parts[5]?.trim()) || 0;
                    const volumeName = parts[6]?.trim();

                    if (deviceId && deviceId.includes(':')) {
                        volumes.push({
                            DriveLetter: deviceId.replace(':', ''),
                            Label: volumeName || 'Unknown',
                            FileSystem: fileSystem || 'Unknown',
                            SizeGB: Math.round(size / (1024 * 1024 * 1024) * 100) / 100,
                            FreeSpaceGB: Math.round(freeSpace / (1024 * 1024 * 1024) * 100) / 100,
                            DriveType: this.getDriveTypeName(driveType),
                            HealthStatus: 'Unknown',
                            OperationalStatus: 'Unknown'
                        });
                    }
                }
            }

            logger.info(`Détection wmic réussie: ${volumes.length} volumes (mode compatibilité)`);
            return this.categorizeVolumes(volumes);

        } catch (error) {
            logger.error('Tous les fallbacks de détection volumes ont échoué:', error);
            return [{
                DriveLetter: 'C',
                Label: 'System',
                FileSystem: 'NTFS',
                SizeGB: 0,
                FreeSpaceGB: 0,
                Category: 'system',
                HealthStatus: 'Unknown',
                ShouldBackup: true,
                Priority: 'high',
                DefaultFolders: ['C:\\Users', 'C:\\ProgramData', 'C:\\Windows\\System32\\config'],
                BackupRecommended: true
            }];
        }
    }

    async detectNetworkDrives() {
        try {
            const networkCommand = `powershell -Command "
                Get-PSDrive | Where-Object {$_.Provider.Name -eq 'FileSystem' -and $_.DisplayRoot -ne $null} | ForEach-Object {
                    [PSCustomObject]@{
                        DriveLetter = $_.Name
                        Label = 'Network Drive'
                        FileSystem = 'Network'
                        SizeGB = 'Unknown'
                        FreeSpaceGB = 'Unknown'
                        HealthStatus = 'Unknown'
                        DriveType = 'Network'
                        OperationalStatus = 'OK'
                        NetworkPath = $_.DisplayRoot
                    }
                } | ConvertTo-Json -Compress
            "`;

            const result = await this.ssh.execCommand(networkCommand);
            
            if (result.code === 0 && result.stdout.trim()) {
                try {
                    const networkData = JSON.parse(result.stdout);
                    const drives = Array.isArray(networkData) ? networkData : [networkData];
                    logger.info(`${drives.length} disques réseau détectés`);
                    return drives;
                } catch (parseError) {
                    logger.warn('Erreur parsing des disques réseau');
                }
            }

            return [];
        } catch (error) {
            logger.warn('Impossible de détecter les disques réseau:', error);
            return [];
        }
    }

    categorizeVolumes(volumes) {
        return volumes.map(volume => {
            let category = 'data';
            let shouldBackup = true;
            let priority = 'normal';

            // Catégoriser selon la lettre de lecteur et les caractéristiques
            if (volume.DriveLetter === 'C') {
                category = 'system';
                priority = 'high';
            } else if (['D', 'E', 'F', 'G'].includes(volume.DriveLetter)) {
                if (volume.Label && volume.Label.toLowerCase().includes('system')) {
                    category = 'system';
                    priority = 'high';
                } else {
                    category = 'data';
                    priority = 'normal';
                }
            } else if (volume.DriveType === 'Network') {
                category = 'network';
                priority = 'low';
                shouldBackup = false; // Par défaut, ne pas backup les disques réseau
            } else if (volume.DriveType === 'Removable' || volume.DriveType === 'CD-ROM') {
                category = 'removable';
                shouldBackup = false;
                priority = 'low';
            }

            // Déterminer les dossiers par défaut à sauvegarder
            let defaultFolders = [];
            if (category === 'system') {
                defaultFolders = [
                    `${volume.DriveLetter}:\\Users`,
                    `${volume.DriveLetter}:\\ProgramData`,
                    `${volume.DriveLetter}:\\Windows\\System32\\config`
                ];
            } else if (category === 'data') {
                defaultFolders = [
                    `${volume.DriveLetter}:\\Data`,
                    `${volume.DriveLetter}:\\Documents`,
                    `${volume.DriveLetter}:\\Shared`
                ];
            }

            return {
                ...volume,
                Category: category,
                ShouldBackup: shouldBackup,
                Priority: priority,
                DefaultFolders: defaultFolders,
                BackupRecommended: shouldBackup && volume.HealthStatus !== 'Unhealthy'
            };
        });
    }

    getDriveTypeName(driveType) {
        const types = {
            0: 'Unknown',
            1: 'No Root Directory',
            2: 'Removable',
            3: 'Local Disk',
            4: 'Network',
            5: 'CD-ROM',
            6: 'RAM Disk'
        };
        return types[driveType] || 'Unknown';
    }

    async getDynamicFolders(options = {}) {
        try {
            const systemInfo = await this.getSystemInfo();
            const volumes = systemInfo.volumes || [];
            
            let allFolders = [];
            
            // Si des dossiers spécifiques sont demandés, les utiliser
            if (options.folders && options.folders.length > 0) {
                allFolders = options.folders;
            } else if (this.config.folders && this.config.folders.length > 0) {
                allFolders = this.config.folders;
            } else {
                // Sinon, utiliser la détection automatique
                for (const volume of volumes) {
                    if (volume.ShouldBackup && volume.BackupRecommended) {
                        allFolders = allFolders.concat(volume.DefaultFolders);
                    }
                }
                
                // Fallback si aucun volume détecté
                if (allFolders.length === 0) {
                    allFolders = [
                        'C:\\Users',
                        'C:\\ProgramData',
                        'C:\\Windows\\System32\\config'
                    ];
                }
            }

            // Vérifier que les dossiers existent avant de les ajouter
            const validFolders = [];
            for (const folder of allFolders) {
                try {
                    const testResult = await this.ssh.execCommand(`powershell -Command "Test-Path '${folder}'"`);
                    if (testResult.code === 0 && testResult.stdout.trim().toLowerCase() === 'true') {
                        validFolders.push(folder);
                    } else {
                        logger.info(`Dossier ignoré (inexistant): ${folder}`);
                    }
                } catch (error) {
                    logger.warn(`Impossible de vérifier le dossier ${folder}:`, error);
                }
            }

            logger.info(`Dossiers sélectionnés pour backup: ${validFolders.join(', ')}`);
            return validFolders;

        } catch (error) {
            logger.error('Erreur lors de la détection dynamique des dossiers:', error);
            return [
                'C:\\Users',
                'C:\\ProgramData',
                'C:\\Windows\\System32\\config'
            ];
        }
    }

    async performFullBackup(options = {}) {
        const backupId = options.backupId || `backup_${this.config.name}_${Date.now()}`;
        const backupPath = path.join(options.backupPath || '/backup', this.config.name, backupId);
        
        // Initialiser le logger spécifique au backup
        this.backupLogger = createBackupLogger(this.config.name, backupId);
        
        try {
            await fs.mkdir(backupPath, { recursive: true });
            
            this.backupLogger.info(`🚀 =================================`);
            this.backupLogger.info(`🚀 DÉMARRAGE BACKUP COMPLET`);
            this.backupLogger.info(`🚀 =================================`);
            this.backupLogger.info(`📋 Client: ${this.config.name}`);
            this.backupLogger.info(`🆔 Backup ID: ${backupId}`);
            this.backupLogger.info(`📁 Destination: ${backupPath}`);
            this.backupLogger.info(`🖥️ Host: ${this.config.host}:${this.config.port || 22}`);
            this.backupLogger.info(`👤 Utilisateur: ${this.config.username}`);
            this.backupLogger.info(`📂 Dossiers: ${this.config.folders || 'Auto-détection'}`);
            
            logger.info(`Démarrage du backup complet pour ${this.config.name}`);
            
            // 1. Connexion SSH
            this.backupLogger.info(`🔌 Étape 1/7: Connexion SSH`);
            await this.connect();
            
            // 2. Obtenir les informations système
            this.backupLogger.info(`ℹ️ Étape 2/7: Collecte des informations système`);
            const systemInfo = await this.getSystemInfo();
            this.backupLogger.info(`💻 OS: ${systemInfo.osVersion || 'N/A'}`);
            this.backupLogger.info(`🏠 Nom machine: ${systemInfo.computerName || 'N/A'}`);
            this.backupLogger.info(`👥 Utilisateurs: ${systemInfo.users ? systemInfo.users.length : 0}`);
            
            await fs.writeFile(
                path.join(backupPath, 'system_info.json'),
                JSON.stringify(systemInfo, null, 2)
            );
            this.backupLogger.info(`✅ Informations système sauvegardées`);
            
            // 3. Créer un snapshot VSS si possible
            this.backupLogger.info(`📷 Étape 3/7: Création snapshot VSS`);
            let shadowId = null;
            if (options.useVSS !== false) {
                try {
                    shadowId = await this.createVSSSnapshot();
                    if (shadowId) {
                        this.backupLogger.info(`✅ Snapshot VSS créé: ${shadowId}`);
                    }
                } catch (error) {
                    this.backupLogger.warn(`⚠️ VSS non disponible: ${error.message}`);
                    logger.warn('VSS non disponible, backup sans snapshot');
                }
            } else {
                this.backupLogger.info(`🚫 VSS désactivé par configuration`);
            }
            
            // 4. Backup des dossiers importants avec détection dynamique
            this.backupLogger.info(`📂 Étape 4/7: Backup des dossiers`);
            const folders = await this.getDynamicFolders(options);
            this.backupLogger.info(`📋 Dossiers détectés: ${folders.join(', ')}`);
            
            const folderResults = await this.backupFolders(folders, backupPath, backupId, options);
            
            // 5. Backup du registre
            this.backupLogger.info(`📝 Étape 5/7: Backup du registre Windows`);
            const registryPath = path.join(backupPath, 'registry');
            await fs.mkdir(registryPath, { recursive: true });
            await this.backupRegistry(registryPath);
            this.backupLogger.info(`✅ Registre Windows sauvegardé`);
            
            // 6. Créer une image système si demandé
            if (options.createImage) {
                this.backupLogger.info(`💿 Étape 6/7: Création image système`);
                await this.createSystemImage(backupPath);
                this.backupLogger.info(`✅ Image système créée`);
            } else {
                this.backupLogger.info(`🚫 Étape 6/7: Image système non demandée`);
            }
            
            // 7. Créer un fichier de métadonnées
            this.backupLogger.info(`📄 Étape 7/7: Création des métadonnées`);
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
            
            // Calculer les statistiques finales
            const totalSize = folderResults.reduce((sum, folder) => sum + (folder.sizeBytes || 0), 0);
            const totalFiles = folderResults.reduce((sum, folder) => sum + (folder.filesCount || 0), 0);
            
            this.backupLogger.info(`🎉 =================================`);
            this.backupLogger.info(`🎉 BACKUP COMPLET TERMINÉ AVEC SUCCÈS`);
            this.backupLogger.info(`🎉 =================================`);
            this.backupLogger.info(`📊 Taille totale: ${Math.round(totalSize / (1024 * 1024))} MB`);
            this.backupLogger.info(`📁 Nombre de fichiers: ${totalFiles}`);
            this.backupLogger.info(`⏱️ Durée: ${Math.round((Date.now() - Date.parse(metadata.timestamp)) / 1000)}s`);
            this.backupLogger.info(`💾 Chemin: ${backupPath}`);
            
            logger.info(`Backup complet terminé avec succès pour ${this.config.name}`);
            
            return {
                success: true,
                backupId,
                path: backupPath,
                metadata
            };
            
        } catch (error) {
            this.backupLogger.error(`❌ =================================`);
            this.backupLogger.error(`❌ ÉCHEC DU BACKUP COMPLET`);
            this.backupLogger.error(`❌ =================================`);
            this.backupLogger.error(`🚨 Erreur: ${error.message}`);
            this.backupLogger.error(`📍 Stack trace: ${error.stack}`);
            this.backupLogger.error(`⏰ Heure échec: ${new Date().toISOString()}`);
            
            logger.error(`Erreur lors du backup complet:`, error);
            throw error;
        } finally {
            if (this.backupLogger) {
                this.backupLogger.info(`🔌 Fermeture de la connexion SSH`);
            }
            await this.disconnect();
        }
    }

    async performIncrementalBackup(lastBackupPath, options = {}) {
        const backupId = options.backupId || `backup_${this.config.name}_${Date.now()}`;
        const backupPath = path.join(options.backupPath || '/backup', this.config.name, backupId);
        
        try {
            await fs.mkdir(backupPath, { recursive: true });
            
            logger.info(`Démarrage du backup incrémentiel pour ${this.config.name}`);
            logger.info(`Backup de base: ${lastBackupPath}`);
            
            // Lire les métadonnées du dernier backup
            const lastMetadata = JSON.parse(
                await fs.readFile(path.join(lastBackupPath, 'backup_metadata.json'), 'utf8')
            );
            
            const lastBackupTime = new Date(lastMetadata.timestamp);
            logger.info(`Recherche des fichiers modifiés depuis: ${lastBackupTime.toISOString()}`);
            
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
                    logger.warn('VSS non disponible pour backup incrémentiel');
                }
            }
            
            // 4. Backup incrémentiel des dossiers avec détection dynamique
            const folders = await this.getDynamicFolders(options);
            
            const folderResults = await this.performIncrementalFolderBackup(
                folders, backupPath, lastBackupPath, lastBackupTime, backupId
            );
            
            // 5. Backup du registre (seulement si modifié)
            const registryPath = path.join(backupPath, 'registry');
            await fs.mkdir(registryPath, { recursive: true });
            await this.backupRegistry(registryPath);
            
            // 6. Créer un fichier de métadonnées
            const metadata = {
                backupId,
                clientName: this.config.name,
                clientHost: this.config.host,
                timestamp: new Date().toISOString(),
                type: 'incremental',
                baseBackup: lastMetadata.backupId,
                baseBackupTime: lastBackupTime.toISOString(),
                folders: folderResults,
                systemInfo,
                shadowId
            };
            
            await fs.writeFile(
                path.join(backupPath, 'backup_metadata.json'),
                JSON.stringify(metadata, null, 2)
            );
            
            // 7. Calculer les statistiques
            const totalFiles = folderResults.reduce((sum, f) => sum + (f.filesCount || 0), 0);
            const totalBytes = folderResults.reduce((sum, f) => sum + (f.bytesTransferred || 0), 0);
            
            logger.info(`Backup incrémentiel terminé: ${totalFiles} fichiers modifiés, ${Math.round(totalBytes / (1024 * 1024))} MB`);
            
            return {
                success: true,
                backupId,
                path: backupPath,
                type: 'incremental',
                baseBackup: lastMetadata.backupId,
                metadata: {
                    ...metadata,
                    totalFiles,
                    totalBytes,
                    sizeMB: Math.round(totalBytes / (1024 * 1024))
                }
            };
            
        } catch (error) {
            logger.error(`Erreur lors du backup incrémentiel:`, error);
            throw error;
        } finally {
            await this.disconnect();
        }
    }

    async performIncrementalFolderBackup(folders, backupPath, lastBackupPath, lastBackupTime, backupId, options = {}) {
        const backupResults = [];
        const backupStartTime = new Date();
        let totalBytesTransferred = 0;
        let totalFilesCount = 0;
        let totalFilesExcluded = 0;

        // Obtenir les exclusions pour ce client Windows
        const clientExclusions = this.config.exclusions || {};
        const exclusions = backupExclusions.getExclusions('windows', clientExclusions, options.exclusionOptions);
        const exclusionStats = backupExclusions.getExclusionStats(exclusions);
        
        logger.info(`Exclusions actives: ${exclusionStats.totalFolderExclusions} dossiers, ${exclusionStats.totalFileExtensionExclusions} extensions, économie estimée: ${exclusionStats.estimatedSpaceSavedPercent}%`);

        // Convertir le timestamp en format Windows (YYYYMMDD-HHMM)
        const windowsTimestamp = lastBackupTime.toISOString()
            .replace(/[-:]/g, '')
            .replace('T', '-')
            .substring(0, 13);
        
        for (const folder of folders) {
            try {
                logger.info(`Backup incrémentiel du dossier ${folder} depuis ${this.config.host}`);
                
                const folderName = path.basename(folder);
                const destPath = path.join(backupPath, this.config.name, folderName);
                await fs.mkdir(destPath, { recursive: true });

                const folderStartTime = new Date();
                let folderBytes = 0;
                let folderFiles = 0;
                let folderExcluded = 0;

                // Calculer les jours depuis le dernier backup
                const daysSinceLastBackup = Math.ceil((new Date() - lastBackupTime) / (1000 * 60 * 60 * 24)) + 1;
                
                // Construire la commande robocopy avec exclusions
                let robocopyCommand = `robocopy "${folder}" "${destPath}" /E /XO /MAXAGE:${daysSinceLastBackup} /R:3 /W:5 /MT:8`;
                
                // Ajouter les exclusions robocopy
                const exclusionArgs = backupExclusions.getRobocopyExclusions(exclusions);
                if (exclusionArgs) {
                    robocopyCommand += exclusionArgs;
                    logger.info(`Exclusions appliquées: ${exclusionArgs}`);
                }
                
                // Ajouter les options de logging pour compter les fichiers exclus
                robocopyCommand += ' /V /NP /NS /NC /NFL /NDL';
                
                logger.info(`Exécution robocopy avec exclusions: ${robocopyCommand.substring(0, 100)}...`);
                
                const result = await this.ssh.execCommand(robocopyCommand, {
                    execOptions: { pty: true }
                });

                // Robocopy exit codes: 0-7 sont des succès, 8+ sont des erreurs
                if (result.code > 7) {
                    throw new Error(`Robocopy error code ${result.code}: ${result.stderr}`);
                }

                // Parser la sortie robocopy pour obtenir les statistiques
                const robocopyStats = this.parseRobocopyOutput(result.stdout);
                folderFiles = robocopyStats.filesTransferred || 0;
                folderExcluded = robocopyStats.filesSkipped || 0;

                // Compter les fichiers copiés si les stats robocopy ne sont pas disponibles
                if (folderFiles === 0 && result.code <= 7) {
                    try {
                        const countResult = await this.ssh.execCommand(`powershell -Command "(Get-ChildItem -Path '${destPath}' -Recurse -File | Measure-Object).Count"`);
                        if (countResult.code === 0) {
                            folderFiles = parseInt(countResult.stdout.trim()) || 0;
                        }
                    } catch (error) {
                        logger.warn(`Impossible de compter les fichiers pour ${folder}:`, error);
                    }
                }

                // Calculer la taille du dossier copié
                if (folderFiles > 0) {
                    folderBytes = await this.calculateDirectorySize(destPath);
                }
                
                totalBytesTransferred += folderBytes;
                totalFilesCount += folderFiles;
                totalFilesExcluded += folderExcluded;

                const folderDuration = (new Date() - folderStartTime) / 1000;
                const folderSpeedMbps = folderBytes > 0 ? (folderBytes * 8) / (folderDuration * 1024 * 1024) : 0;

                backupResults.push({
                    folder,
                    status: folderFiles > 0 ? 'success' : 'no_changes',
                    destination: destPath,
                    bytesTransferred: folderBytes,
                    filesCount: folderFiles,
                    filesExcluded: folderExcluded,
                    exclusionsApplied: exclusions.folders.length + exclusions.fileExtensions.length,
                    duration: folderDuration,
                    speedMbps: Math.round(folderSpeedMbps * 100) / 100
                });
                
                if (folderFiles > 0) {
                    logger.info(`Backup incrémentiel réussi pour ${folder}: ${folderFiles} fichiers modifiés, ${folderExcluded} exclus, ${Math.round(folderBytes / (1024 * 1024))} MB`);
                } else {
                    logger.info(`Aucun changement détecté pour ${folder} depuis le dernier backup (${folderExcluded} fichiers exclus)`);
                }
                
            } catch (error) {
                logger.error(`Erreur lors du backup incrémentiel de ${folder}:`, error);
                backupResults.push({
                    folder,
                    status: 'failed',
                    error: error.message,
                    bytesTransferred: 0,
                    filesCount: 0,
                    duration: 0,
                    speedMbps: 0
                });
            }
        }

        // Sauvegarder les statistiques réseau si des données ont été transférées
        if (backupId && totalBytesTransferred > 0) {
            try {
                const backupEndTime = new Date();
                const totalDuration = (backupEndTime - backupStartTime) / 1000;
                const avgSpeedMbps = (totalBytesTransferred * 8) / (totalDuration * 1024 * 1024);

                await addNetworkStats({
                    backup_id: backupId,
                    client_name: this.config.name,
                    bytes_transferred: totalBytesTransferred,
                    transfer_speed_mbps: Math.round(avgSpeedMbps * 100) / 100,
                    duration_seconds: Math.round(totalDuration),
                    files_count: totalFilesCount,
                    started_at: backupStartTime.toISOString(),
                    completed_at: backupEndTime.toISOString()
                });
                
                logger.info(`Statistiques incrémentiel sauvegardées: ${totalFilesCount} fichiers, ${Math.round(totalBytesTransferred / (1024 * 1024))} MB`);
            } catch (error) {
                logger.warn(`Erreur lors de la sauvegarde des statistiques incrémentiel:`, error);
            }
        }

        // Sauvegarder les statistiques globales avec exclusions
        if (backupId && totalBytesTransferred > 0) {
            try {
                const backupEndTime = new Date();
                const totalDuration = (backupEndTime - backupStartTime) / 1000;
                const avgSpeedMbps = (totalBytesTransferred * 8) / (totalDuration * 1024 * 1024);

                await addNetworkStats({
                    backup_id: backupId,
                    client_name: this.config.name,
                    bytes_transferred: totalBytesTransferred,
                    transfer_speed_mbps: Math.round(avgSpeedMbps * 100) / 100,
                    duration_seconds: Math.round(totalDuration),
                    files_count: totalFilesCount,
                    files_excluded: totalFilesExcluded,
                    exclusions_stats: JSON.stringify(exclusionStats),
                    started_at: backupStartTime.toISOString(),
                    completed_at: backupEndTime.toISOString()
                });
                
                logger.info(`Statistiques sauvegardées: ${totalFilesCount} fichiers, ${totalFilesExcluded} exclus, ${Math.round(totalBytesTransferred / (1024 * 1024))} MB`);
            } catch (error) {
                logger.warn(`Erreur lors de la sauvegarde des statistiques:`, error);
            }
        }

        return backupResults;
    }

    /**
     * Parser la sortie robocopy pour extraire les statistiques
     */
    parseRobocopyOutput(output) {
        const stats = {
            filesTransferred: 0,
            filesSkipped: 0,
            dirsTransferred: 0,
            bytesTransferred: 0
        };

        try {
            const lines = output.split('\n');
            
            // Chercher les lignes de statistiques robocopy
            for (const line of lines) {
                const trimmedLine = line.trim();
                
                // Files : XXX copied
                if (trimmedLine.includes('Files :') && trimmedLine.includes('Copied')) {
                    const match = trimmedLine.match(/Files\s*:\s*(\d+)/);
                    if (match) {
                        stats.filesTransferred = parseInt(match[1]);
                    }
                }
                
                // Files : XXX skipped
                if (trimmedLine.includes('Files :') && trimmedLine.includes('Skipped')) {
                    const match = trimmedLine.match(/Skipped\s*(\d+)/);
                    if (match) {
                        stats.filesSkipped = parseInt(match[1]);
                    }
                }

                // Total Copied
                if (trimmedLine.includes('Total') && trimmedLine.includes('Copied')) {
                    const match = trimmedLine.match(/(\d+(?:\.\d+)?)\s*[kmgt]?b/i);
                    if (match) {
                        let size = parseFloat(match[1]);
                        const unit = trimmedLine.toLowerCase();
                        
                        if (unit.includes('kb')) size *= 1024;
                        else if (unit.includes('mb')) size *= 1024 * 1024;
                        else if (unit.includes('gb')) size *= 1024 * 1024 * 1024;
                        else if (unit.includes('tb')) size *= 1024 * 1024 * 1024 * 1024;
                        
                        stats.bytesTransferred = Math.round(size);
                    }
                }
            }

            logger.debug(`Robocopy stats parsed: ${stats.filesTransferred} transferred, ${stats.filesSkipped} skipped`);
            
        } catch (error) {
            logger.warn('Erreur lors du parsing de la sortie robocopy:', error);
        }

        return stats;
    }
}

module.exports = WindowsBackupClient;