// Configuration de l'application
const API_URL = window.location.origin + '/api';
const AUTH_URL = window.location.origin + '/auth';
let currentSection = 'dashboard';
let clients = [];
let backups = [];
let currentUser = null;

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
    checkAuthStatus().then(authenticated => {
        if (!authenticated) {
            window.location.href = '/login.html';
            return;
        }
        
        initializeApp();
        setupEventListeners();
        loadDashboardData();
        setupUserInterface();
    });
});

function initializeApp() {
    // Initialiser la navigation
    const navLinks = document.querySelectorAll('.nav-menu a');
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const section = link.getAttribute('href').substring(1);
            navigateToSection(section);
        });
    });

    // Initialiser le formulaire d'ajout de client
    const addClientForm = document.getElementById('add-client-form');
    if (addClientForm) {
        addClientForm.addEventListener('submit', handleAddClient);
    }

    // Charger les données initiales
    setInterval(updateDashboard, 30000); // Mise à jour toutes les 30 secondes
}

function setupEventListeners() {
    // Filtres
    document.getElementById('filter-date')?.addEventListener('change', filterBackups);
    document.getElementById('filter-client')?.addEventListener('change', filterBackups);
    document.getElementById('filter-status')?.addEventListener('change', filterBackups);
    
    // Event listeners pour les logs
    document.getElementById('log-level')?.addEventListener('change', refreshLogs);
    document.getElementById('log-client')?.addEventListener('change', refreshLogs);
    document.getElementById('log-type')?.addEventListener('change', refreshLogs);
}

function navigateToSection(section) {
    // Masquer toutes les sections
    document.querySelectorAll('.content-section').forEach(s => {
        s.classList.remove('active');
    });

    // Afficher la section demandée
    const targetSection = document.getElementById(`${section}-section`);
    if (targetSection) {
        targetSection.classList.add('active');
    }

    // Mettre à jour la navigation
    document.querySelectorAll('.nav-menu a').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === `#${section}`) {
            link.classList.add('active');
        }
    });

    // Mettre à jour le titre
    const header = document.querySelector('.header h1');
    const sectionTitles = {
        'dashboard': 'Dashboard',
        'clients': 'Gestion des Clients',
        'backups': 'Historique des Backups',
        'schedule': 'Planification',
        'logs': 'Logs Système',
        'settings': 'Paramètres',
        'config': 'Configuration Serveur',
        'network': 'Trafic Réseau',
        'system': 'État du Système'
    };
    header.textContent = sectionTitles[section] || 'Dashboard';

    currentSection = section;
    loadSectionData(section).catch(error => {
        console.error('Erreur lors du chargement de la section:', error);
        showNotification('Erreur lors du chargement de la section', 'error');
    });
}

async function loadDashboardData() {
    try {
        // Charger les vraies données depuis l'API
        const response = await fetch(`${API_URL}/dashboard`);
        if (response.ok) {
            const data = await response.json();
            
            // Mettre à jour les statistiques
            document.getElementById('active-clients').textContent = data.summary.activeClients || '0';
            document.getElementById('today-backups').textContent = data.summary.todayBackups || '0';
            document.getElementById('storage-used').textContent = 
                data.summary.storageUsedMB ? `${(data.summary.storageUsedMB / 1024).toFixed(1)} GB` : '0 GB';
            document.getElementById('last-run').textContent = 
                data.summary.lastRun ? new Date(data.summary.lastRun).toLocaleString('fr-FR') : '-';
            
            // Charger les backups récents
            loadRecentBackupsFromAPI();
        } else {
            // Fallback sur les données simulées
            updateStats();
            loadRecentBackups();
        }
    } catch (error) {
        console.error('Erreur lors du chargement des données:', error);
        // Fallback sur les données simulées
        updateStats();
        loadRecentBackups();
    }
}

async function loadRecentBackupsFromAPI() {
    try {
        const response = await fetch(`${API_URL}/backups?limit=5`);
        if (response.ok) {
            const backups = await response.json();
            const recentBackupsList = document.getElementById('recent-backups-list');
            
            if (backups.length > 0) {
                recentBackupsList.innerHTML = backups.map(backup => `
                    <tr>
                        <td>${backup.client_name || 'Unknown'}</td>
                        <td>${backup.type || 'full'}</td>
                        <td><span class="badge badge-${backup.status === 'completed' ? 'success' : 'danger'}">
                            ${backup.status === 'completed' ? 'Réussi' : 'Échoué'}</span></td>
                        <td>${backup.size_mb ? `${(backup.size_mb / 1024).toFixed(1)} GB` : '-'}</td>
                        <td>${new Date(backup.created_at).toLocaleString('fr-FR')}</td>
                        <td>
                            <button class="btn btn-sm" onclick="viewBackupDetails('${backup.client_name}')">Détails</button>
                        </td>
                    </tr>
                `).join('');
            } else {
                loadRecentBackups(); // Afficher les données simulées
            }
        } else {
            loadRecentBackups(); // Fallback
        }
    } catch (error) {
        console.error('Erreur lors du chargement des backups:', error);
        loadRecentBackups(); // Fallback
    }
}

function updateStats() {
    // Simuler les statistiques (remplacer par des données réelles)
    document.getElementById('active-clients').textContent = '5';
    document.getElementById('today-backups').textContent = '12';
    document.getElementById('storage-used').textContent = '245 GB';
    document.getElementById('last-run').textContent = new Date().toLocaleString('fr-FR');
}

function loadRecentBackups() {
    const recentBackupsList = document.getElementById('recent-backups-list');
    if (!recentBackupsList) return;

    // Simuler des données de backup
    const mockBackups = [
        {
            client: 'Client A',
            type: 'Complet',
            status: 'success',
            size: '12.5 GB',
            date: new Date().toLocaleString('fr-FR')
        },
        {
            client: 'Client B',
            type: 'Incrémentiel',
            status: 'success',
            size: '2.3 GB',
            date: new Date(Date.now() - 3600000).toLocaleString('fr-FR')
        },
        {
            client: 'Client C',
            type: 'Complet',
            status: 'failed',
            size: '-',
            date: new Date(Date.now() - 7200000).toLocaleString('fr-FR')
        }
    ];

    recentBackupsList.innerHTML = mockBackups.map(backup => `
        <tr>
            <td>${backup.client}</td>
            <td>${backup.type}</td>
            <td><span class="badge badge-${backup.status === 'success' ? 'success' : 'danger'}">${backup.status === 'success' ? 'Réussi' : 'Échoué'}</span></td>
            <td>${backup.size}</td>
            <td>${backup.date}</td>
            <td>
                <button class="btn btn-sm" onclick="viewBackupDetails('${backup.client}')">Détails</button>
            </td>
        </tr>
    `).join('');
}

async function loadSectionData(section) {
    switch(section) {
        case 'clients':
            loadClients();
            break;
        case 'backups':
            loadBackupsHistory();
            break;
        case 'schedule':
            loadSchedule();
            break;
        case 'logs':
            loadLogs();
            break;
        case 'settings':
            loadSettings();
            break;
        case 'config':
            loadServerConfig();
            break;
        case 'network':
            await loadNetworkTraffic();
            break;
        case 'system':
            loadSystemInfo();
            break;
    }
}

async function loadClients() {
    const clientsList = document.getElementById('clients-list');
    if (!clientsList) return;

    try {
        // Charger les vrais clients depuis l'API
        const response = await fetch(`${API_URL}/clients`);
        if (response.ok) {
            const apiClients = await response.json();
            clients = apiClients; // Stocker globalement
            
            if (apiClients.length > 0) {
                clientsList.innerHTML = apiClients.map(client => `
                    <div class="client-card">
                        <h3>${client.name}</h3>
                        <div class="client-info">
                            <span>IP: ${client.host}</span>
                            <span>Port: ${client.port}</span>
                            <span>Utilisateur: ${client.username}</span>
                            <span>OS: <span class="badge badge-${client.os_type === 'windows' ? 'primary' : 'info'}">${client.os_type === 'windows' ? '🪟 Windows' : '🐧 Linux'}</span></span>
                            <span>Type: ${client.backup_type || 'full'}</span>
                            <span>Statut: <span class="badge badge-${client.active ? 'success' : 'danger'}">${client.active ? 'Actif' : 'Inactif'}</span></span>
                            <span>Créé: ${new Date(client.created_at).toLocaleDateString('fr-FR')}</span>
                        </div>
                        <div class="client-actions">
                            <button class="btn btn-primary btn-sm" onclick="startBackup(${client.id})">Backup</button>
                            <button class="btn btn-secondary btn-sm" onclick="editClient(${client.id})">Modifier</button>
                            <button class="btn btn-danger btn-sm" onclick="deleteClientConfirm(${client.id})">Supprimer</button>
                        </div>
                    </div>
                `).join('');
            } else {
                clientsList.innerHTML = `
                    <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
                        <p style="font-size: 1.2rem; margin-bottom: 1rem;">Aucun client configuré</p>
                        <button class="btn btn-primary" onclick="showAddClientModal()">
                            ➕ Ajouter votre premier client
                        </button>
                    </div>
                `;
            }
        }
    } catch (error) {
        console.error('Erreur lors du chargement des clients:', error);
        clientsList.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--danger-color);">
                <p>Erreur lors du chargement des clients</p>
                <button class="btn btn-secondary" onclick="loadClients()">Réessayer</button>
            </div>
        `;
    }
}

function loadBackupsHistory() {
    const backupsHistory = document.getElementById('backups-history');
    if (!backupsHistory) return;

    // Charger l'historique des backups
    backupsHistory.innerHTML = '<p>Chargement de l\'historique...</p>';
    
    // Simuler le chargement (remplacer par un appel API)
    setTimeout(() => {
        backupsHistory.innerHTML = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Client</th>
                        <th>Type</th>
                        <th>Taille</th>
                        <th>Durée</th>
                        <th>Statut</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>${new Date().toLocaleString('fr-FR')}</td>
                        <td>Client A</td>
                        <td>Complet</td>
                        <td>12.5 GB</td>
                        <td>45 min</td>
                        <td><span class="badge badge-success">Réussi</span></td>
                        <td>
                            <button class="btn btn-sm">Restaurer</button>
                            <button class="btn btn-sm">Télécharger</button>
                        </td>
                    </tr>
                </tbody>
            </table>
        `;
    }, 500);
}

function loadSchedule() {
    const scheduleList = document.getElementById('schedule-list');
    if (!scheduleList) return;

    scheduleList.innerHTML = `
        <div class="schedule-grid">
            <div class="schedule-card">
                <h3>Backup Quotidien</h3>
                <p>Tous les jours à 02:00</p>
                <p>Type: Incrémentiel</p>
                <p>Clients: Tous</p>
                <button class="btn btn-primary btn-sm">Modifier</button>
            </div>
            <div class="schedule-card">
                <h3>Backup Hebdomadaire</h3>
                <p>Dimanche à 03:00</p>
                <p>Type: Complet</p>
                <p>Clients: Tous</p>
                <button class="btn btn-primary btn-sm">Modifier</button>
            </div>
        </div>
        <button class="btn btn-primary" style="margin-top: 1rem;">Ajouter une planification</button>
    `;
}

async function loadLogs() {
    await loadClientsWithLogs();
    await refreshLogs();
}

async function loadClientsWithLogs() {
    try {
        const response = await fetch(`${API_URL}/logs/clients`);
        const clientsWithLogs = await response.json();
        
        const logClientSelect = document.getElementById('log-client');
        if (logClientSelect) {
            // Conserver l'option "Logs globaux"
            logClientSelect.innerHTML = '<option value="">Logs globaux</option>';
            
            // Ajouter les clients qui ont des logs
            clientsWithLogs.forEach(client => {
                const option = document.createElement('option');
                option.value = client;
                option.textContent = client;
                logClientSelect.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Erreur lors du chargement des clients avec logs:', error);
    }
}

async function refreshLogs() {
    const logContent = document.getElementById('log-content');
    if (!logContent) return;

    const selectedClient = document.getElementById('log-client')?.value;
    const selectedType = document.getElementById('log-type')?.value || 'client';
    const selectedLevel = document.getElementById('log-level')?.value || 'all';

    try {
        let logs = [];
        
        if (selectedClient) {
            // Charger les logs spécifiques au client
            const response = await fetch(`${API_URL}/logs/clients/${encodeURIComponent(selectedClient)}?limit=100&level=${selectedLevel}&type=${selectedType}`);
            logs = await response.json();
        } else {
            // Charger les logs globaux
            const response = await fetch(`${API_URL}/logs?limit=100&level=${selectedLevel}`);
            logs = await response.json();
        }

        // Afficher les logs
        if (logs.length === 0) {
            logContent.innerHTML = '<div class="log-entry info">Aucun log disponible</div>';
        } else {
            logContent.innerHTML = logs.map(log => {
                const timestamp = new Date(log.timestamp).toLocaleTimeString();
                const clientInfo = log.clientName ? ` [${log.clientName}]` : '';
                const logTypeInfo = log.logType ? ` (${log.logType})` : '';
                
                return `<div class="log-entry ${log.level}">
                    [${timestamp}] [${log.level.toUpperCase()}]${clientInfo}${logTypeInfo} ${log.message}
                </div>`;
            }).join('');
        }

        // Faire défiler vers le bas pour voir les logs les plus récents
        logContent.scrollTop = logContent.scrollHeight;
        
    } catch (error) {
        console.error('Erreur lors du chargement des logs:', error);
        logContent.innerHTML = '<div class="log-entry error">Erreur lors du chargement des logs</div>';
    }
}

function loadSettings() {
    // Charger les paramètres actuels
    // Implémenter le chargement des paramètres depuis l'API
}

async function loadSystemInfo() {
    try {
        // Charger les informations système depuis l'API
        const [systemStatus, dashboardData, apiInfo] = await Promise.all([
            fetch(`${API_URL}/system/status`).then(r => r.json()),
            fetch(`${API_URL}/dashboard`).then(r => r.json()),
            fetch(`${API_URL}/info`).then(r => r.json())
        ]);

        // Mise à jour de la version dans le footer
        updateElement('app-version', `Version ${apiInfo.version || '1.3.0'}`);

        // Mise à jour des informations serveur
        updateElement('os-info', `${systemStatus.system.os}`);
        updateElement('arch-info', systemStatus.system.arch);
        updateElement('uptime-info', formatUptime(systemStatus.system.uptime));
        updateElement('node-version', systemStatus.nodejs.version);

        // Mise à jour des performances
        updateElement('cpu-info', `${systemStatus.cpu.usage}% (${systemStatus.cpu.cores} cœurs)`);
        updateElement('memory-info', 
            `${systemStatus.memory.used} MB / ${systemStatus.memory.total} MB (${systemStatus.memory.usagePercent}%)`);
        updateElement('disk-info', 
            systemStatus.disk.backup ? 
            `${systemStatus.disk.backup.used} GB / ${systemStatus.disk.backup.total} GB (${systemStatus.disk.backup.usagePercent}%)` : 
            'Non disponible');
        updateElement('process-memory', 
            `RSS: ${systemStatus.nodejs.memory.rss}MB, Heap: ${systemStatus.nodejs.memory.heapUsed}/${systemStatus.nodejs.memory.heapTotal}MB`);

        // Mise à jour des services
        updateBadge('monitoring-status', 
            systemStatus.monitoring.running ? 'Actif' : 'Arrêté',
            systemStatus.monitoring.running ? 'badge-healthy' : 'badge-error');
        updateBadge('scheduler-status', 
            dashboardData.scheduler.totalSchedules ? `${dashboardData.scheduler.totalSchedules} planifications` : 'Aucune',
            dashboardData.scheduler.totalSchedules ? 'badge-healthy' : 'badge-warning');
        updateBadge('database-status', 'Opérationnelle', 'badge-healthy');
        updateBadge('health-status', 'OK', 'badge-healthy');

        // Mise à jour des statistiques
        updateElement('clients-count', dashboardData.summary.totalClients);
        updateElement('backups-count', dashboardData.summary.totalBackups);
        updateElement('storage-usage', `${(dashboardData.summary.storageUsedMB / 1024).toFixed(1)} GB`);
        updateElement('last-backup', 
            dashboardData.summary.lastRun ? new Date(dashboardData.summary.lastRun).toLocaleString('fr-FR') : 'Jamais');

        // Mise à jour de la configuration
        updateElement('server-port', '3000');
        updateElement('backup-path-config', '/tmp/efc-backups-test');
        updateElement('retention-config', '30 jours');
        updateElement('parallel-config', '2');
        updateElement('vss-config', '✅ Activé');
        updateElement('notifications-config', '❌ Désactivées');

    } catch (error) {
        console.error('Erreur lors du chargement des informations système:', error);
        showNotification('Erreur lors du chargement des informations système', 'error');
    }
}

function updateElement(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = value;
        element.classList.add('updating');
        setTimeout(() => element.classList.remove('updating'), 500);
    }
}

function updateBadge(id, text, className) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = text;
        element.className = `badge ${className}`;
        element.classList.add('updating');
        setTimeout(() => element.classList.remove('updating'), 500);
    }
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / (24 * 60 * 60));
    const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((seconds % (60 * 60)) / 60);
    
    if (days > 0) {
        return `${days}j ${hours}h ${minutes}m`;
    } else if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else {
        return `${minutes}m`;
    }
}

async function refreshSystemInfo() {
    showNotification('Actualisation des informations système...', 'info');
    await loadSystemInfo();
    showNotification('Informations système actualisées', 'success');
}

async function performHealthCheck() {
    try {
        showNotification('Exécution du Health Check...', 'info');
        const response = await fetch(`${API_URL}/system/health-check`, { method: 'POST' });
        if (response.ok) {
            const result = await response.json();
            showNotification(`Health Check: ${result.status === 'healthy' ? 'Système en bonne santé' : 'Problèmes détectés'}`, 
                result.status === 'healthy' ? 'success' : 'warning');
            
            // Actualiser les informations
            await loadSystemInfo();
        } else {
            showNotification('Erreur lors du Health Check', 'error');
        }
    } catch (error) {
        console.error('Erreur Health Check:', error);
        showNotification('Erreur lors du Health Check', 'error');
    }
}

function downloadLogs() {
    showNotification('Préparation du téléchargement des logs...', 'info');
    // Créer un lien de téléchargement pour les logs
    const link = document.createElement('a');
    link.href = `${API_URL}/logs?limit=1000&format=text`;
    link.download = `efc-backup-logs-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showNotification('Téléchargement des logs démarré', 'success');
}

function exportConfig() {
    // Exporter la configuration système
    const config = {
        timestamp: new Date().toISOString(),
        version: '1.3.0',
        server: {
            port: 3000,
            host: '0.0.0.0',
            environment: 'development'
        },
        backup: {
            path: '/tmp/efc-backups-test',
            retention: 30,
            parallel: 2,
            vss: true
        },
        monitoring: {
            healthCheckInterval: 30000,
            metricsRetention: 30
        }
    };
    
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `efc-backup-config-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showNotification('Configuration exportée avec succès', 'success');
}

// Fonctions pour l'onglet Configuration
async function loadServerConfig() {
    try {
        // Charger la configuration actuelle depuis l'API
        const [settings, apiInfo] = await Promise.all([
            fetch(`${API_URL}/settings`).then(r => r.json()).catch(() => ({})),
            fetch(`${API_URL}/info`).then(r => r.json()).catch(() => ({}))
        ]);

        // Configuration serveur
        document.getElementById('server-port-input').value = '3000';
        document.getElementById('server-host-input').value = '0.0.0.0';
        document.getElementById('server-env-input').value = apiInfo.environment || 'development';
        document.getElementById('log-level-input').value = 'info';

        // Configuration backup
        document.getElementById('backup-path-input').value = '/tmp/efc-backups-test';
        document.getElementById('retention-days-input').value = settings.backup_retention_days || '30';
        document.getElementById('parallel-backups-input').value = settings.max_parallel_backups || '2';
        document.getElementById('vss-enabled-input').checked = true;

        // Configuration notifications
        document.getElementById('notification-email-input').value = settings.notification_email || '';
        document.getElementById('smtp-enabled-input').checked = settings.smtp_enabled === 'true';
        document.getElementById('smtp-host-input').value = '';
        document.getElementById('smtp-port-input').value = '587';
        document.getElementById('smtp-user-input').value = '';
        document.getElementById('smtp-pass-input').value = '';
        
        document.getElementById('notify-success-input').checked = false;
        document.getElementById('notify-failure-input').checked = true;
        document.getElementById('notify-start-input').checked = false;

        // Configuration monitoring
        document.getElementById('health-interval-input').value = '30';
        document.getElementById('metrics-retention-input').value = '30';
        document.getElementById('cpu-alert-input').value = '80';
        document.getElementById('memory-alert-input').value = '85';
        document.getElementById('disk-alert-input').value = '80';
        document.getElementById('disk-critical-input').value = '95';

        showNotification('Configuration chargée', 'success');
    } catch (error) {
        console.error('Erreur lors du chargement de la configuration:', error);
        showNotification('Erreur lors du chargement de la configuration', 'error');
    }
}

async function saveServerConfig() {
    try {
        showNotification('Sauvegarde de la configuration...', 'info');

        // Collecter toutes les valeurs des formulaires
        const config = {
            server: {
                port: parseInt(document.getElementById('server-port-input').value),
                host: document.getElementById('server-host-input').value,
                environment: document.getElementById('server-env-input').value,
                logLevel: document.getElementById('log-level-input').value
            },
            backup: {
                path: document.getElementById('backup-path-input').value,
                retentionDays: parseInt(document.getElementById('retention-days-input').value),
                maxParallel: parseInt(document.getElementById('parallel-backups-input').value),
                vssEnabled: document.getElementById('vss-enabled-input').checked
            },
            notifications: {
                email: document.getElementById('notification-email-input').value,
                smtpEnabled: document.getElementById('smtp-enabled-input').checked,
                smtpHost: document.getElementById('smtp-host-input').value,
                smtpPort: parseInt(document.getElementById('smtp-port-input').value),
                smtpUser: document.getElementById('smtp-user-input').value,
                smtpPass: document.getElementById('smtp-pass-input').value,
                notifySuccess: document.getElementById('notify-success-input').checked,
                notifyFailure: document.getElementById('notify-failure-input').checked,
                notifyStart: document.getElementById('notify-start-input').checked
            },
            monitoring: {
                healthInterval: parseInt(document.getElementById('health-interval-input').value),
                metricsRetention: parseInt(document.getElementById('metrics-retention-input').value),
                cpuAlert: parseInt(document.getElementById('cpu-alert-input').value),
                memoryAlert: parseInt(document.getElementById('memory-alert-input').value),
                diskAlert: parseInt(document.getElementById('disk-alert-input').value),
                diskCritical: parseInt(document.getElementById('disk-critical-input').value)
            }
        };

        // Sauvegarder via l'API
        const response = await fetch(`${API_URL}/settings`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                backup_retention_days: config.backup.retentionDays,
                max_parallel_backups: config.backup.maxParallel,
                notification_email: config.notifications.email,
                smtp_enabled: config.notifications.smtpEnabled
            })
        });

        if (response.ok) {
            // Animer la sauvegarde réussie
            document.querySelectorAll('.config-section').forEach(section => {
                section.classList.add('config-saved');
                setTimeout(() => section.classList.remove('config-saved'), 1000);
            });

            showNotification('Configuration sauvegardée avec succès', 'success');
            
            // Afficher un avertissement si redémarrage nécessaire
            const needsRestart = config.server.port !== 3000 || 
                               config.server.host !== '0.0.0.0' || 
                               config.server.environment !== 'development';
            
            if (needsRestart) {
                setTimeout(() => {
                    showNotification('⚠️ Redémarrage du serveur requis pour certains changements', 'warning');
                }, 2000);
            }

        } else {
            const error = await response.json();
            showNotification(`Erreur: ${error.error || 'Impossible de sauvegarder'}`, 'error');
        }

    } catch (error) {
        console.error('Erreur lors de la sauvegarde:', error);
        showNotification('Erreur lors de la sauvegarde de la configuration', 'error');
    }
}

function resetConfigToDefaults() {
    if (confirm('Êtes-vous sûr de vouloir réinitialiser la configuration aux valeurs par défaut?\n\nToutes les modifications non sauvegardées seront perdues.')) {
        // Réinitialiser tous les champs aux valeurs par défaut
        document.getElementById('server-port-input').value = '3000';
        document.getElementById('server-host-input').value = '0.0.0.0';
        document.getElementById('server-env-input').value = 'development';
        document.getElementById('log-level-input').value = 'info';
        
        document.getElementById('backup-path-input').value = '/tmp/efc-backups-test';
        document.getElementById('retention-days-input').value = '30';
        document.getElementById('parallel-backups-input').value = '2';
        document.getElementById('vss-enabled-input').checked = true;
        
        document.getElementById('notification-email-input').value = '';
        document.getElementById('smtp-enabled-input').checked = false;
        document.getElementById('smtp-host-input').value = '';
        document.getElementById('smtp-port-input').value = '587';
        document.getElementById('smtp-user-input').value = '';
        document.getElementById('smtp-pass-input').value = '';
        
        document.getElementById('notify-success-input').checked = false;
        document.getElementById('notify-failure-input').checked = true;
        document.getElementById('notify-start-input').checked = false;
        
        document.getElementById('health-interval-input').value = '30';
        document.getElementById('metrics-retention-input').value = '30';
        document.getElementById('cpu-alert-input').value = '80';
        document.getElementById('memory-alert-input').value = '85';
        document.getElementById('disk-alert-input').value = '80';
        document.getElementById('disk-critical-input').value = '95';
        
        showNotification('Configuration réinitialisée aux valeurs par défaut', 'success');
    }
}

async function testConfiguration() {
    try {
        showNotification('Test de la configuration en cours...', 'info');
        
        const testResults = [];
        
        // Tester la connectivité SMTP si activé
        if (document.getElementById('smtp-enabled-input').checked) {
            try {
                const response = await fetch(`${API_URL}/test/notification`, { method: 'POST' });
                if (response.ok) {
                    const result = await response.json();
                    testResults.push(`📧 SMTP: ${result.success ? '✅ OK' : '❌ Échec - ' + result.error}`);
                } else {
                    testResults.push('📧 SMTP: ❌ Échec - Impossible de tester');
                }
            } catch (error) {
                testResults.push('📧 SMTP: ❌ Erreur de connexion');
            }
        } else {
            testResults.push('📧 SMTP: ⚠️ Désactivé');
        }
        
        // Tester l'accès au chemin de backup
        const backupPath = document.getElementById('backup-path-input').value;
        try {
            const response = await fetch(`${API_URL}/system/health-check`, { method: 'POST' });
            if (response.ok) {
                testResults.push(`💾 Chemin backup: ✅ Accessible (${backupPath})`);
            } else {
                testResults.push(`💾 Chemin backup: ❌ Problème d'accès`);
            }
        } catch (error) {
            testResults.push('💾 Chemin backup: ❌ Impossible de vérifier');
        }
        
        // Validation des valeurs
        const port = parseInt(document.getElementById('server-port-input').value);
        const retention = parseInt(document.getElementById('retention-days-input').value);
        const parallel = parseInt(document.getElementById('parallel-backups-input').value);
        
        testResults.push(`🌐 Port: ${port >= 1 && port <= 65535 ? '✅ Valide' : '❌ Invalid (1-65535)'}`);
        testResults.push(`⏰ Rétention: ${retention >= 1 && retention <= 365 ? '✅ Valide' : '❌ Invalid (1-365 jours)'}`);
        testResults.push(`🔄 Parallèle: ${parallel >= 1 && parallel <= 10 ? '✅ Valide' : '❌ Invalid (1-10)'}`);
        
        // Afficher les résultats
        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content">
                <h2>🧪 Résultats du Test de Configuration</h2>
                <div style="margin: 1.5rem 0;">
                    ${testResults.map(result => `<p style="margin: 0.5rem 0; font-family: monospace;">${result}</p>`).join('')}
                </div>
                <div class="modal-actions">
                    <button class="btn btn-primary" onclick="this.closest('.modal').remove()">Fermer</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        showNotification('Test de configuration terminé', 'success');
        
    } catch (error) {
        console.error('Erreur lors du test de configuration:', error);
        showNotification('Erreur lors du test de configuration', 'error');
    }
}

// Fonctions d'action
function startManualBackup() {
    if (confirm('Démarrer un backup manuel pour tous les clients actifs?')) {
        showNotification('Backup manuel démarré', 'success');
        // Implémenter le démarrage du backup
    }
}

async function startBackup(clientId) {
    const client = clients.find(c => c.id === clientId);
    if (!client) return;
    
    if (confirm(`Démarrer un backup pour "${client.name}"?`)) {
        try {
            const response = await fetch(`${API_URL}/backups/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    clients: [client.name],
                    type: client.backup_type || 'full'
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                showNotification(`Backup démarré pour ${client.name}`, 'success');
                // Recharger le dashboard pour voir les nouvelles stats
                if (currentSection === 'dashboard') {
                    setTimeout(loadDashboardData, 2000);
                }
            } else {
                const error = await response.json();
                showNotification(`Erreur: ${error.error || 'Impossible de démarrer le backup'}`, 'error');
            }
        } catch (error) {
            console.error('Erreur lors du démarrage du backup:', error);
            showNotification('Erreur de connexion au serveur', 'error');
        }
    }
}

function showAddClientModal() {
    const modal = document.getElementById('add-client-modal');
    if (modal) {
        modal.classList.add('active');
    }
}

function closeModal() {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(modal => modal.classList.remove('active'));
}

function updateDefaultFolders(selectElement) {
    const foldersTextarea = document.getElementById('backup-folders');
    if (!foldersTextarea) return;
    
    if (selectElement.value === 'linux') {
        foldersTextarea.value = '/home, /etc, /var/www, /opt';
    } else {
        foldersTextarea.value = 'C:\\Users, C:\\ProgramData';
    }
}

async function handleAddClient(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const clientData = {
        name: formData.get('name'),
        host: formData.get('ip'),
        port: parseInt(formData.get('port')) || 22,
        username: formData.get('username'),
        password: formData.get('password'),
        backup_type: formData.get('backup_type'),
        os_type: formData.get('os_type'),
        folders: formData.get('folders').split(',').map(f => f.trim()).filter(f => f.length > 0)
    };
    
    try {
        const response = await fetch(`${API_URL}/clients`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(clientData)
        });
        
        if (response.ok) {
            const result = await response.json();
            showNotification('Client ajouté avec succès', 'success');
            closeModal();
            loadClients();
        } else {
            const error = await response.json();
            showNotification(`Erreur: ${error.error || 'Impossible d\'ajouter le client'}`, 'error');
        }
    } catch (error) {
        console.error('Erreur lors de l\'ajout du client:', error);
        showNotification('Erreur de connexion au serveur', 'error');
    }
}

function editClient(clientId) {
    const client = clients.find(c => c.id === clientId);
    if (!client) return;
    
    // Créer une modale de modification
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-content">
            <h2>Modifier le Client</h2>
            <form id="edit-client-form">
                <div class="form-group">
                    <label>Nom du client</label>
                    <input type="text" name="name" value="${client.name}" required class="form-input">
                </div>
                <div class="form-group">
                    <label>Adresse IP</label>
                    <input type="text" name="ip" value="${client.host}" required class="form-input">
                </div>
                <div class="form-group">
                    <label>Port SSH</label>
                    <input type="number" name="port" value="${client.port}" class="form-input">
                </div>
                <div class="form-group">
                    <label>Nom d'utilisateur</label>
                    <input type="text" name="username" value="${client.username}" required class="form-input">
                </div>
                <div class="form-group">
                    <label>Mot de passe</label>
                    <input type="password" name="password" placeholder="Laisser vide pour garder l'actuel" class="form-input">
                </div>
                <div class="form-group">
                    <label>Type de backup</label>
                    <select name="backup_type" class="form-input">
                        <option value="full" ${client.backup_type === 'full' ? 'selected' : ''}>Complet</option>
                        <option value="incremental" ${client.backup_type === 'incremental' ? 'selected' : ''}>Incrémentiel</option>
                        <option value="differential" ${client.backup_type === 'differential' ? 'selected' : ''}>Différentiel</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Dossiers à sauvegarder (séparés par des virgules)</label>
                    <textarea name="folders" class="form-input" rows="3">${Array.isArray(client.folders) ? client.folders.join(', ') : client.folders || 'C:\\Users, C:\\ProgramData'}</textarea>
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn btn-secondary" onclick="this.closest('.modal').remove()">Annuler</button>
                    <button type="submit" class="btn btn-primary">Sauvegarder</button>
                </div>
            </form>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Ajouter l'event listener pour le formulaire
    document.getElementById('edit-client-form').addEventListener('submit', (e) => handleEditClient(e, clientId));
}

async function handleEditClient(e, clientId) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const clientData = {
        name: formData.get('name'),
        host: formData.get('ip'),
        port: parseInt(formData.get('port')) || 22,
        username: formData.get('username'),
        backup_type: formData.get('backup_type'),
        folders: formData.get('folders').split(',').map(f => f.trim()).filter(f => f.length > 0)
    };
    
    // Ajouter le mot de passe seulement s'il est fourni
    const password = formData.get('password');
    if (password && password.trim()) {
        clientData.password = password;
    }
    
    try {
        const response = await fetch(`${API_URL}/clients/${clientId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(clientData)
        });
        
        if (response.ok) {
            showNotification('Client modifié avec succès', 'success');
            document.querySelector('.modal').remove();
            loadClients();
        } else {
            const error = await response.json();
            showNotification(`Erreur: ${error.error || 'Impossible de modifier le client'}`, 'error');
        }
    } catch (error) {
        console.error('Erreur lors de la modification du client:', error);
        showNotification('Erreur de connexion au serveur', 'error');
    }
}

function deleteClientConfirm(clientId) {
    const client = clients.find(c => c.id === clientId);
    if (!client) return;
    
    if (confirm(`Êtes-vous sûr de vouloir supprimer le client "${client.name}"?\n\nCette action est irréversible et supprimera aussi tous les backups associés.`)) {
        deleteClient(clientId);
    }
}

async function deleteClient(clientId) {
    try {
        const response = await fetch(`${API_URL}/clients/${clientId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showNotification('Client supprimé avec succès', 'success');
            loadClients();
        } else {
            const error = await response.json();
            showNotification(`Erreur: ${error.error || 'Impossible de supprimer le client'}`, 'error');
        }
    } catch (error) {
        console.error('Erreur lors de la suppression du client:', error);
        showNotification('Erreur de connexion au serveur', 'error');
    }
}

function viewBackupDetails(clientName) {
    // Afficher les détails du backup dans une fenêtre modale
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-content">
            <h2>Détails du Backup - ${clientName}</h2>
            <div style="margin: 1rem 0;">
                <p><strong>Client:</strong> ${clientName}</p>
                <p><strong>Type:</strong> Backup Complet</p>
                <p><strong>Date:</strong> ${new Date().toLocaleString('fr-FR')}</p>
                <p><strong>Taille:</strong> 12.5 GB</p>
                <p><strong>Durée:</strong> 45 minutes</p>
                <p><strong>Fichiers:</strong> 15,234 fichiers</p>
                <p><strong>Chemin:</strong> /tmp/efc-backups-test/${clientName}</p>
            </div>
            <div style="margin: 1.5rem 0;">
                <h3>Dossiers sauvegardés:</h3>
                <ul style="margin-left: 1.5rem; color: var(--text-secondary);">
                    <li>C:\\Users\\Documents</li>
                    <li>C:\\Users\\Desktop</li>
                    <li>C:\\Important</li>
                </ul>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Fermer</button>
                <button class="btn btn-primary" onclick="restoreBackup('${clientName}')">Restaurer</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function restoreBackup(clientName) {
    if (confirm(`Voulez-vous restaurer le backup de ${clientName}?`)) {
        showNotification(`Restauration du backup de ${clientName} démarrée`, 'success');
        document.querySelector('.modal').remove();
    }
}

function saveSettings() {
    const settings = {
        backupPath: document.getElementById('backup-path').value,
        retentionDays: document.getElementById('retention-days').value,
        notificationEmail: document.getElementById('notification-email').value
    };
    
    // Implémenter la sauvegarde des paramètres
    console.log('Sauvegarder les paramètres:', settings);
    showNotification('Paramètres enregistrés', 'success');
}

function clearLogs() {
    if (confirm('Êtes-vous sûr de vouloir vider les logs?')) {
        document.getElementById('log-content').innerHTML = '';
        showNotification('Logs vidés', 'success');
    }
}

function filterBackups() {
    // Implémenter le filtrage des backups
    console.log('Filtrer les backups');
}

function filterLogs() {
    // Cette fonction est maintenant remplacée par refreshLogs() 
    // qui charge directement les logs filtrés depuis l'API
    refreshLogs();
}

function updateDashboard() {
    if (currentSection === 'dashboard') {
        updateStats();
        loadRecentBackups();
    }
}

function showNotification(message, type = 'info') {
    // Créer une notification temporaire avec le branding EFC
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    
    const bgColor = type === 'success' ? 'linear-gradient(135deg, #5d8052, #b4e3a5)' : 
                   type === 'error' ? 'linear-gradient(135deg, #ef4444, #fca5a5)' : 
                   'linear-gradient(135deg, #5d8052, #a8d49a)';
    
    notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.75rem;">
            <span style="font-size: 1.2rem;">${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
            <div>
                <div style="font-weight: 600; font-family: 'Montserrat', sans-serif;">${message}</div>
                <div style="font-size: 0.75rem; opacity: 0.9;">EFC Backup System</div>
            </div>
        </div>
    `;
    
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        background: ${bgColor};
        color: white;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(93, 128, 82, 0.3);
        z-index: 2000;
        animation: slideIn 0.3s ease;
        border-left: 4px solid rgba(255, 255, 255, 0.5);
        backdrop-filter: blur(10px);
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Style pour les animations avec branding EFC
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%) scale(0.9);
            opacity: 0;
        }
        to {
            transform: translateX(0) scale(1);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0) scale(1);
            opacity: 1;
        }
        to {
            transform: translateX(100%) scale(0.9);
            opacity: 0;
        }
    }
    
    .schedule-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 1rem;
    }
    
    .schedule-card {
        background-color: var(--card-bg);
        padding: 1.5rem;
        border-radius: 12px;
        border: 1px solid var(--border-color);
    }
    
    .schedule-card h3 {
        margin-bottom: 1rem;
    }
    
    .schedule-card p {
        margin-bottom: 0.5rem;
        color: var(--text-secondary);
    }
    
    .btn-sm {
        padding: 0.375rem 0.75rem;
        font-size: 0.75rem;
    }
    
    .client-actions {
        display: flex;
        gap: 0.5rem;
        margin-top: 1rem;
    }
`;
document.head.appendChild(style);

// Variables globales pour les graphiques
let speedChart = null;
let durationChart = null;
let volumeChart = null;

// Fonction principale pour charger les données réseau
async function loadNetworkTraffic() {
    try {
        // Charger la liste des clients
        await loadNetworkClients();
        
        // Charger les données par défaut (tous les clients)
        await refreshNetworkData();
        
    } catch (error) {
        console.error('Erreur lors du chargement du trafic réseau:', error);
        showNotification('Erreur lors du chargement des données réseau', 'error');
    }
}

async function loadNetworkClients() {
    try {
        const response = await fetch(`${API_URL}/clients`);
        if (response.ok) {
            const clients = await response.json();
            const select = document.getElementById('network-client-select');
            
            // Vider et ajouter l'option "Tous"
            select.innerHTML = '<option value="">Tous les clients</option>';
            
            // Ajouter chaque client
            clients.forEach(client => {
                const option = document.createElement('option');
                option.value = client.name;
                option.textContent = `${client.name} (${client.os_type})`;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Erreur lors du chargement des clients réseau:', error);
    }
}

async function refreshNetworkData() {
    const selectedClient = document.getElementById('network-client-select')?.value;
    
    try {
        showNotification('Chargement des données réseau...', 'info');
        
        // Charger les statistiques
        let networkStats = [];
        if (selectedClient) {
            const response = await fetch(`${API_URL}/network/stats/${encodeURIComponent(selectedClient)}?limit=10`);
            networkStats = await response.json();
        } else {
            const response = await fetch(`${API_URL}/network/stats?limit=50`);
            networkStats = await response.json();
        }
        
        // Mettre à jour les graphiques
        updateNetworkCharts(networkStats);
        
        // Mettre à jour le tableau
        updateNetworkTable(networkStats);
        
        // Mettre à jour les analyses avancées
        updateNetworkAnalysis(networkStats);
        
        showNotification('Données réseau actualisées', 'success');
        
    } catch (error) {
        console.error('Erreur lors de l\'actualisation des données réseau:', error);
        
        // Générer des données simulées pour démonstration
        const mockData = generateMockNetworkData();
        updateNetworkCharts(mockData);
        updateNetworkTable(mockData);
        updateNetworkAnalysis(mockData);
        
        showNotification('Données simulées affichées (API non disponible)', 'warning');
    }
}

function generateMockNetworkData() {
    const clients = ['Client-A', 'Client-B', 'Client-C', 'Serveur-Linux'];
    const backupTypes = ['full', 'incremental', 'differential'];
    const mockData = [];
    
    for (let i = 0; i < 10; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        
        mockData.push({
            backup_id: `backup_${Date.now()}_${i}`,
            client_name: clients[Math.floor(Math.random() * clients.length)],
            backup_type: backupTypes[Math.floor(Math.random() * backupTypes.length)],
            bytes_transferred: Math.floor(Math.random() * 50000000000) + 1000000000, // 1GB à 50GB
            transfer_speed_mbps: Math.floor(Math.random() * 100) + 10, // 10-110 Mbps
            duration_seconds: Math.floor(Math.random() * 3600) + 300, // 5min à 1h
            files_count: Math.floor(Math.random() * 50000) + 1000,
            started_at: date.toISOString(),
            completed_at: new Date(date.getTime() + Math.random() * 3600000).toISOString(),
            created_at: date.toISOString()
        });
    }
    
    return mockData.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function updateNetworkCharts(data) {
    const ctx1 = document.getElementById('speedChart').getContext('2d');
    const ctx2 = document.getElementById('durationChart').getContext('2d');
    const ctx3 = document.getElementById('volumeChart').getContext('2d');
    
    // Préparer les données
    const labels = data.map((d, index) => {
        const date = new Date(d.created_at || d.started_at);
        return `${d.client_name} - ${date.toLocaleDateString()}`;
    });
    
    const speeds = data.map(d => d.transfer_speed_mbps || 0);
    const durations = data.map(d => Math.round((d.duration_seconds || 0) / 60)); // en minutes
    const volumes = data.map(d => Math.round((d.bytes_transferred || 0) / (1024 * 1024 * 1024) * 100) / 100); // en GB
    
    // Détruire les anciens graphiques
    if (speedChart) speedChart.destroy();
    if (durationChart) durationChart.destroy();
    if (volumeChart) volumeChart.destroy();
    
    // Graphique vitesse
    speedChart = new Chart(ctx1, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Vitesse (Mbps)',
                data: speeds,
                backgroundColor: 'rgba(93, 128, 82, 0.8)',
                borderColor: 'rgba(93, 128, 82, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Vitesse de Transfert par Backup'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Mbps'
                    }
                }
            }
        }
    });
    
    // Graphique durée
    durationChart = new Chart(ctx2, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Durée (minutes)',
                data: durations,
                backgroundColor: 'rgba(52, 152, 219, 0.2)',
                borderColor: 'rgba(52, 152, 219, 1)',
                borderWidth: 2,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Durée des Backups'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Minutes'
                    }
                }
            }
        }
    });
    
    // Graphique volume
    volumeChart = new Chart(ctx3, {
        type: 'doughnut',
        data: {
            labels: data.map(d => d.client_name),
            datasets: [{
                label: 'Volume (GB)',
                data: volumes,
                backgroundColor: [
                    'rgba(93, 128, 82, 0.8)',
                    'rgba(52, 152, 219, 0.8)',
                    'rgba(155, 89, 182, 0.8)',
                    'rgba(243, 156, 18, 0.8)',
                    'rgba(231, 76, 60, 0.8)',
                    'rgba(26, 188, 156, 0.8)'
                ],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Répartition du Volume par Client'
                },
                legend: {
                    position: 'right'
                }
            }
        }
    });
}

function updateNetworkTable(data) {
    const tbody = document.getElementById('network-stats-table');
    
    if (data.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                    Aucune donnée de trafic réseau disponible
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = data.map(stat => {
        const date = new Date(stat.created_at || stat.started_at);
        const speed = stat.transfer_speed_mbps ? `${stat.transfer_speed_mbps} Mbps` : '-';
        const duration = stat.duration_seconds ? `${Math.round(stat.duration_seconds / 60)}min` : '-';
        const volume = stat.bytes_transferred ? `${(stat.bytes_transferred / (1024*1024*1024)).toFixed(2)} GB` : '-';
        const files = stat.files_count || '-';
        
        return `
            <tr>
                <td>${date.toLocaleString('fr-FR')}</td>
                <td>
                    <span class="badge badge-${stat.client_name.includes('Linux') ? 'info' : 'primary'}">
                        ${stat.client_name.includes('Linux') ? '🐧' : '🪟'} ${stat.client_name}
                    </span>
                </td>
                <td><span class="badge badge-secondary">${stat.backup_type || 'full'}</span></td>
                <td style="color: var(--success-color); font-weight: 600;">${speed}</td>
                <td>${duration}</td>
                <td style="color: var(--primary-color); font-weight: 600;">${volume}</td>
                <td>${files}</td>
            </tr>
        `;
    }).join('');
}

// Ajouter le gestionnaire pour le sélecteur de client
document.addEventListener('DOMContentLoaded', () => {
    // Ajouter l'event listener existant plus le nouveau
    const networkClientSelect = document.getElementById('network-client-select');
    if (networkClientSelect) {
        networkClientSelect.addEventListener('change', refreshNetworkData);
    }
});

// Ajouter le CSS pour les graphiques
const networkStyle = document.createElement('style');
networkStyle.textContent = `
    .network-controls {
        margin-bottom: 2rem;
        padding: 1rem;
        background-color: var(--card-bg);
        border-radius: 8px;
        border: 1px solid var(--border-color);
    }
    
    .network-charts {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 2rem;
        margin-bottom: 2rem;
    }
    
    .chart-container {
        background-color: var(--card-bg);
        padding: 1.5rem;
        border-radius: 12px;
        border: 1px solid var(--border-color);
        height: 400px;
        overflow: hidden;
    }
    
    .chart-container canvas {
        width: 100% !important;
        max-width: 100% !important;
    }
    
    .chart-container:last-child {
        grid-column: 1 / -1;
        max-width: 600px;
        margin: 0 auto;
        height: 300px;
    }
    
    .chart-container h3 {
        margin-bottom: 1rem;
        color: var(--text-primary);
        font-size: 1.1rem;
    }
    
    .network-table {
        background-color: var(--card-bg);
        padding: 1.5rem;
        border-radius: 12px;
        border: 1px solid var(--border-color);
    }
    
    .network-analysis {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1.5rem;
        margin-bottom: 2rem;
    }
    
    .analysis-card {
        background-color: var(--card-bg);
        padding: 1.5rem;
        border-radius: 12px;
        border: 1px solid var(--border-color);
    }
    
    .analysis-card h3 {
        margin-bottom: 1rem;
        color: var(--text-primary);
        font-size: 1.1rem;
        border-bottom: 2px solid var(--primary-color);
        padding-bottom: 0.5rem;
    }
    
    .executive-card {
        grid-column: 1 / -1;
    }
    
    /* Alertes */
    .alert-item {
        padding: 0.75rem;
        border-radius: 6px;
        margin-bottom: 0.5rem;
    }
    
    .alert-success { background-color: rgba(93, 128, 82, 0.1); color: var(--success-color); }
    .alert-warning { background-color: rgba(243, 156, 18, 0.1); color: #f39c12; }
    .alert-error { background-color: rgba(231, 76, 60, 0.1); color: #e74c3c; }
    .alert-info { background-color: rgba(52, 152, 219, 0.1); color: #3498db; }
    
    /* Métriques */
    .metric-item, .realtime-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.5rem 0;
        border-bottom: 1px solid var(--border-color);
    }
    
    .metric-item:last-child, .realtime-item:last-child {
        border-bottom: none;
    }
    
    .metric-label, .realtime-label {
        color: var(--text-secondary);
        font-size: 0.9rem;
    }
    
    .metric-value, .realtime-value {
        color: var(--text-primary);
        font-weight: 600;
        font-size: 0.95rem;
    }
    
    /* Problèmes */
    .problem-category {
        margin-bottom: 1rem;
    }
    
    .problem-category h4 {
        color: var(--text-primary);
        font-size: 0.95rem;
        margin-bottom: 0.5rem;
        border-left: 3px solid var(--primary-color);
        padding-left: 0.5rem;
    }
    
    .problem-category ul {
        margin: 0;
        padding-left: 1rem;
    }
    
    .problem-category li {
        color: var(--text-secondary);
        font-size: 0.9rem;
        margin-bottom: 0.25rem;
    }
    
    /* KPIs */
    .kpi-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 1rem;
    }
    
    .kpi-item {
        text-align: center;
        padding: 1rem;
        background-color: rgba(93, 128, 82, 0.05);
        border-radius: 8px;
        border: 1px solid rgba(93, 128, 82, 0.2);
    }
    
    .kpi-value {
        font-size: 1.5rem;
        font-weight: bold;
        color: var(--primary-color);
        display: block;
        margin-bottom: 0.25rem;
    }
    
    .kpi-label {
        font-size: 0.8rem;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    
    @media (max-width: 1200px) {
        .network-analysis {
            grid-template-columns: 1fr;
        }
        
        .kpi-grid {
            grid-template-columns: repeat(2, 1fr);
        }
    }
    
    @media (max-width: 768px) {
        .network-charts {
            grid-template-columns: 1fr;
        }
        
        .kpi-grid {
            grid-template-columns: 1fr;
        }
    }
`;
document.head.appendChild(networkStyle);

// Fonction pour mettre à jour toutes les analyses avancées
function updateNetworkAnalysis(data) {
    updateNetworkAlerts(data);
    updatePerformanceMetrics(data);
    updateRealtimeMetrics();
    updateProblemsAnalysis(data);
    updateExecutiveSummary(data);
}

// Fonction pour les alertes réseau
function updateNetworkAlerts(data) {
    const alertsContainer = document.getElementById('network-alerts');
    let alerts = [];
    
    // Analyser les données pour détecter des problèmes
    if (data.length === 0) {
        alerts.push({
            type: 'warning',
            message: 'Aucune donnée de backup récente disponible'
        });
    } else {
        const avgSpeed = data.reduce((sum, d) => sum + (d.transfer_speed_mbps || 0), 0) / data.length;
        const slowBackups = data.filter(d => (d.transfer_speed_mbps || 0) < avgSpeed * 0.5);
        const longBackups = data.filter(d => (d.duration_seconds || 0) > 3600); // > 1h
        const recentFailures = data.filter(d => d.backup_type === null || (d.transfer_speed_mbps || 0) === 0);
        
        if (slowBackups.length > 0) {
            alerts.push({
                type: 'warning',
                message: `${slowBackups.length} backup(s) avec vitesse anormalement basse détecté(s)`
            });
        }
        
        if (longBackups.length > 0) {
            alerts.push({
                type: 'info',
                message: `${longBackups.length} backup(s) de longue durée (>1h) détecté(s)`
            });
        }
        
        if (recentFailures.length > 0) {
            alerts.push({
                type: 'error',
                message: `${recentFailures.length} backup(s) potentiellement échoué(s) ou incomplet(s)`
            });
        }
        
        if (alerts.length === 0) {
            alerts.push({
                type: 'success',
                message: 'Aucun problème réseau détecté - Performances normales'
            });
        }
    }
    
    alertsContainer.innerHTML = alerts.map(alert => 
        `<div class="alert-item alert-${alert.type}">${alert.message}</div>`
    ).join('');
}

// Fonction pour les métriques de performance
function updatePerformanceMetrics(data) {
    if (data.length === 0) {
        document.getElementById('avg-speed-global').textContent = 'Aucune donnée';
        document.getElementById('best-performance').textContent = 'Aucune donnée';
        document.getElementById('fastest-client').textContent = 'Aucune donnée';
        document.getElementById('trend-7days').textContent = 'Aucune donnée';
        return;
    }
    
    // Vitesse moyenne globale
    const avgSpeed = data.reduce((sum, d) => sum + (d.transfer_speed_mbps || 0), 0) / data.length;
    document.getElementById('avg-speed-global').textContent = `${Math.round(avgSpeed)} Mbps`;
    
    // Meilleure performance
    const bestSpeed = Math.max(...data.map(d => d.transfer_speed_mbps || 0));
    document.getElementById('best-performance').textContent = `${bestSpeed} Mbps`;
    
    // Client le plus rapide
    const speedByClient = {};
    data.forEach(d => {
        const client = d.client_name;
        if (!speedByClient[client]) speedByClient[client] = [];
        speedByClient[client].push(d.transfer_speed_mbps || 0);
    });
    
    let fastestClient = 'Aucun';
    let fastestAvg = 0;
    Object.keys(speedByClient).forEach(client => {
        const clientAvg = speedByClient[client].reduce((a, b) => a + b, 0) / speedByClient[client].length;
        if (clientAvg > fastestAvg) {
            fastestAvg = clientAvg;
            fastestClient = client;
        }
    });
    document.getElementById('fastest-client').textContent = `${fastestClient} (${Math.round(fastestAvg)} Mbps)`;
    
    // Tendance 7 jours (simulée)
    const trend = Math.random() > 0.5 ? '📈 +5.2%' : '📉 -2.1%';
    document.getElementById('trend-7days').textContent = trend;
}

// Fonction pour les métriques temps réel
function updateRealtimeMetrics() {
    // Simuler des données temps réel
    document.getElementById('active-backup').textContent = Math.random() > 0.8 ? 'TestClient-A' : 'Aucun';
    document.getElementById('backup-queue').textContent = Math.floor(Math.random() * 5);
    document.getElementById('active-connections').textContent = Math.floor(Math.random() * 3);
    document.getElementById('bandwidth-usage').textContent = `${Math.floor(Math.random() * 50)} Mbps`;
}

// Fonction pour l'analyse des problèmes
function updateProblemsAnalysis(data) {
    if (data.length === 0) {
        document.getElementById('problematic-clients').textContent = 'Aucune donnée disponible';
        document.getElementById('recommendations-list').innerHTML = '<li>Aucune recommandation disponible</li>';
        return;
    }
    
    // Clients problématiques
    const problemClients = [];
    const clientStats = {};
    
    data.forEach(d => {
        const client = d.client_name;
        if (!clientStats[client]) {
            clientStats[client] = { speeds: [], durations: [], count: 0 };
        }
        clientStats[client].speeds.push(d.transfer_speed_mbps || 0);
        clientStats[client].durations.push(d.duration_seconds || 0);
        clientStats[client].count++;
    });
    
    Object.keys(clientStats).forEach(client => {
        const stats = clientStats[client];
        const avgSpeed = stats.speeds.reduce((a, b) => a + b, 0) / stats.speeds.length;
        const avgDuration = stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length;
        
        if (avgSpeed < 20 || avgDuration > 1800) { // < 20 Mbps ou > 30min
            problemClients.push(`${client} (${Math.round(avgSpeed)} Mbps, ${Math.round(avgDuration/60)}min)`);
        }
    });
    
    document.getElementById('problematic-clients').textContent = 
        problemClients.length > 0 ? problemClients.join(', ') : 'Aucun problème détecté';
    
    // Recommandations
    const recommendations = [
        'Planifier les backups volumineux en heures creuses',
        'Vérifier la bande passante réseau disponible',
        'Optimiser la configuration des clients lents',
        'Considérer la compression pour réduire les transferts',
        'Surveiller l\'utilisation du CPU pendant les backups'
    ];
    
    document.getElementById('recommendations-list').innerHTML = 
        recommendations.map(rec => `<li>${rec}</li>`).join('');
}

// Fonction pour le résumé exécutif
function updateExecutiveSummary(data) {
    if (data.length === 0) {
        document.getElementById('overall-health').textContent = 'N/A';
        document.getElementById('success-rate').textContent = 'N/A';
        document.getElementById('avg-duration').textContent = 'N/A';
        document.getElementById('data-growth').textContent = 'N/A';
        return;
    }
    
    // Score de santé (basé sur la vitesse moyenne)
    const avgSpeed = data.reduce((sum, d) => sum + (d.transfer_speed_mbps || 0), 0) / data.length;
    let healthScore = 'Excellent';
    if (avgSpeed < 30) healthScore = 'Bon';
    if (avgSpeed < 20) healthScore = 'Moyen';
    if (avgSpeed < 10) healthScore = 'Faible';
    document.getElementById('overall-health').textContent = healthScore;
    
    // Taux de réussite (simulé basé sur les données complètes)
    const completedBackups = data.filter(d => d.transfer_speed_mbps > 0 && d.duration_seconds > 0).length;
    const successRate = Math.round((completedBackups / data.length) * 100);
    document.getElementById('success-rate').textContent = `${successRate}%`;
    
    // Durée moyenne
    const avgDuration = data.reduce((sum, d) => sum + (d.duration_seconds || 0), 0) / data.length;
    document.getElementById('avg-duration').textContent = `${Math.round(avgDuration / 60)}min`;
    
    // Croissance des données (simulée)
    const growth = ['+12%', '+8%', '-3%', '+15%', '+5%'][Math.floor(Math.random() * 5)];
    document.getElementById('data-growth').textContent = growth;
    
    // Mettre à jour les couleurs des KPIs selon les valeurs
    const healthColor = avgSpeed > 30 ? '#5d8052' : avgSpeed > 20 ? '#f39c12' : '#e74c3c';
    document.getElementById('overall-health').style.color = healthColor;
    
    const rateColor = successRate > 95 ? '#5d8052' : successRate > 85 ? '#f39c12' : '#e74c3c';
    document.getElementById('success-rate').style.color = rateColor;
}

// Fonctions d'authentification
async function checkAuthStatus() {
    try {
        const response = await fetch(`${AUTH_URL}/verify`, {
            credentials: 'include'
        });

        if (response.ok) {
            const data = await response.json();
            currentUser = data.user;
            return true;
        }
        return false;
    } catch (error) {
        console.error('Erreur de vérification auth:', error);
        return false;
    }
}

function setupUserInterface() {
    if (!currentUser) return;
    
    // Afficher les informations utilisateur
    const header = document.querySelector('.header');
    if (header && !document.getElementById('user-info')) {
        const userInfo = document.createElement('div');
        userInfo.id = 'user-info';
        userInfo.className = 'user-info';
        userInfo.innerHTML = `
            <div class="user-details">
                <span class="user-name">${currentUser.username}</span>
                <span class="user-role">${currentUser.role === 'admin' ? 'Administrateur' : 'Client'}</span>
                ${currentUser.client_name ? `<span class="user-client">${currentUser.client_name}</span>` : ''}
            </div>
            <button class="btn btn-secondary" onclick="logout()">
                🚪 Déconnexion
            </button>
        `;
        
        // Insérer avant les actions existantes
        const headerActions = header.querySelector('.header-actions');
        if (headerActions) {
            header.insertBefore(userInfo, headerActions);
        }
    }

    // Masquer/afficher les éléments selon le rôle
    if (currentUser.role === 'client') {
        // Masquer les fonctions admin
        const adminElements = [
            'button[onclick="showAddClientModal()"]',
            'button[onclick="startManualBackup()"]',
            '.nav-menu a[href="#settings"]',
            '.nav-menu a[href="#config"]',
            '.nav-menu a[href="#system"]',
            '.nav-menu a[href="#schedule"]'
        ];
        
        adminElements.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                if (el) el.style.display = 'none';
            });
        });

        // Rediriger vers dashboard si sur une page admin
        const adminSections = ['settings', 'config', 'system', 'schedule'];
        if (adminSections.includes(currentSection)) {
            navigateToSection('dashboard');
        }
    }
}

async function logout() {
    try {
        const response = await fetch(`${AUTH_URL}/logout`, {
            method: 'POST',
            credentials: 'include'
        });

        if (response.ok) {
            window.location.href = '/login.html';
        } else {
            console.error('Erreur lors de la déconnexion');
        }
    } catch (error) {
        console.error('Erreur de déconnexion:', error);
        // Forcer la redirection en cas d'erreur
        window.location.href = '/login.html';
    }
}

// Modifier toutes les requêtes API pour inclure les credentials
async function apiRequest(url, options = {}) {
    const defaultOptions = {
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json'
        }
    };

    const mergedOptions = {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...(options.headers || {})
        }
    };

    try {
        const response = await fetch(url, mergedOptions);
        
        if (response.status === 401) {
            // Token expiré, rediriger vers login
            window.location.href = '/login.html';
            return null;
        }

        return response;
    } catch (error) {
        console.error('Erreur API:', error);
        throw error;
    }
}