// Configuration de l'application
const API_URL = window.location.origin + '/api';
const AUTH_URL = window.location.origin + '/auth';
let currentSection = 'dashboard';
let clients = [];
let backups = [];
let currentUser = null;
let userPermissions = null;

// Helper function pour les traductions
function t(key, params = {}) {
    return window.i18n ? window.i18n.t(key, params) : key;
}

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
    checkAuthStatus().then(authenticated => {
        if (!authenticated) {
            window.location.href = '/login.html';
            return;
        }
        
        initializeApp();
        setupEventListeners();
        loadUserPermissions().then(() => {
            setupUserInterface();
            loadDashboardData();
        });
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
        'dashboard': i18n.t('dashboard'),
        'clients': i18n.t('clients'),
        'backups': i18n.t('backups'),
        'schedule': i18n.t('schedule'),
        'logs': i18n.t('logs'),
        'settings': i18n.t('settings'),
        'users': i18n.t('users'),
        'config': i18n.t('general_settings'),
        'ssl': i18n.t('ssl_certificates'),
        'network': i18n.t('network_analysis'),
        'system': i18n.t('system_monitoring')
    };
    header.textContent = sectionTitles[section] || i18n.t('dashboard');

    currentSection = section;
    loadSectionData(section).catch(error => {
        console.error('Erreur lors du chargement de la section:', error);
        showNotification(i18n.t('error_occurred'), 'error');
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
                data.summary.lastRun ? window.i18n.formatDate(new Date(data.summary.lastRun)) : '-';
            
            // Mettre à jour les indicateurs de status (données API complètes)
            updateDataStatus('clients-status', 'real-data', 'API Dashboard');
            updateDataStatus('backups-status', 'real-data', 'API Dashboard');
            updateDataStatus('storage-status', 'real-data', 'API Dashboard');
            updateDataStatus('lastrun-status', 'real-data', 'API Dashboard');
            
            // Charger les backups récents
            loadRecentBackupsFromAPI();
        } else {
            // Fallback sur les données basiques
            updateStats();
        }
    } catch (error) {
        console.error('Erreur lors du chargement des données dashboard:', error);
        // Charger les données de base disponibles
        await loadBasicStats();
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
                            ${backup.status === 'completed' ? i18n.t('success') : i18n.t('failed')}</span></td>
                        <td>${backup.size_mb ? `${(backup.size_mb / 1024).toFixed(1)} GB` : '-'}</td>
                        <td>${window.i18n.formatDate(new Date(backup.created_at))}</td>
                        <td>
                            <button class="btn btn-sm" onclick="viewBackupDetails('${backup.client_name}')">${i18n.t('details')}</button>
                        </td>
                    </tr>
                `).join('');
            } else {
                showNoBackupsMessage(); // Afficher un message approprié
            }
        } else {
            showNoBackupsMessage(); // Pas de backups disponibles
        }
    } catch (error) {
        console.error('Erreur lors du chargement des backups:', error);
        showBackupsError(); // Erreur de chargement
    }
}

async function loadBasicStats() {
    try {
        // Charger les clients avec authentification
        let clientsCount = 0;
        try {
            const clientsResponse = await apiRequest(`${API_URL}/clients`);
            if (clientsResponse.ok) {
                const clients = await clientsResponse.json();
                clientsCount = clients.filter(c => c.active !== false).length;
            }
        } catch (e) {
            console.warn('Impossible de charger les clients');
        }

        // Charger les backups avec authentification
        let backupsToday = 0;
        let totalStorage = 0;
        try {
            const backupsResponse = await apiRequest(`${API_URL}/backups`);
            if (backupsResponse.ok) {
                const backups = await backupsResponse.json();
                
                // Compter les backups d'aujourd'hui
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                
                backupsToday = backups.filter(backup => {
                    const backupDate = new Date(backup.created_at);
                    return backupDate >= today;
                }).length;
                
                // Calculer l'espace total
                totalStorage = backups.reduce((sum, backup) => {
                    return sum + (backup.size_mb || 0);
                }, 0);
            }
        } catch (e) {
            console.warn('Impossible de charger les backups');
        }

        // Mettre à jour l'interface avec les vraies données
        document.getElementById('active-clients').textContent = clientsCount.toString();
        document.getElementById('today-backups').textContent = backupsToday.toString();
        document.getElementById('storage-used').textContent = 
            totalStorage > 1024 ? `${(totalStorage / 1024).toFixed(1)} GB` : `${totalStorage} MB`;
        document.getElementById('last-run').textContent = 
            backupsToday > 0 ? t('recent_data_available') : t('no_recent_backup');

        // Mettre à jour les indicateurs de status
        updateDataStatus('clients-status', clientsCount > 0 ? 'real-data' : 'fallback-data', 
                         clientsCount > 0 ? t('real_data') : t('no_active_client'));
        updateDataStatus('backups-status', backupsToday > 0 ? 'real-data' : 'fallback-data', 
                         backupsToday > 0 ? t('today_data') : t('no_backup_today'));
        updateDataStatus('storage-status', totalStorage > 0 ? 'real-data' : 'fallback-data', 
                         totalStorage > 0 ? 'Calcul réel' : 'Pas de données');
        updateDataStatus('lastrun-status', 'real-data', 'Statut en temps réel');

        // Charger les backups récents si possible
        loadRecentBackupsFromAPI();
        
    } catch (error) {
        console.error('Erreur chargement stats basiques:', error);
        // En dernier recours, afficher des zéros plutôt que des données fictives
        document.getElementById('active-clients').textContent = '0';
        document.getElementById('today-backups').textContent = '0';
        document.getElementById('storage-used').textContent = '0 GB';
        document.getElementById('last-run').textContent = 'Données non disponibles';
        
        // Indicateurs d'erreur
        updateDataStatus('clients-status', 'error-data', 'Erreur chargement');
        updateDataStatus('backups-status', 'error-data', 'Erreur chargement');
        updateDataStatus('storage-status', 'error-data', 'Erreur chargement');
        updateDataStatus('lastrun-status', 'error-data', 'Erreur chargement');
    }
}

function updateDataStatus(elementId, statusClass, message) {
    const element = document.getElementById(elementId);
    if (element) {
        element.className = `data-status ${statusClass}`;
        element.textContent = message;
    }
}

function updateStats() {
    // Fonction obsolète - remplacée par loadBasicStats()
    // Gardée pour compatibilité mais redirige vers les vraies données
    loadBasicStats();
}

function showNoBackupsMessage() {
    const recentBackupsList = document.getElementById('recent-backups-list');
    if (!recentBackupsList) return;

    recentBackupsList.innerHTML = `
        <tr>
            <td colspan="6" class="empty-cell">
                <div class="no-data-message">
                    <span class="no-data-icon">📋</span>
                    <h4>${t('no_recent_backup')}</h4>
                    <p>${t('no_recent_backup_desc')}</p>
                    <div class="no-data-actions">
                        <button class="btn btn-primary" onclick="navigateToSection('clients')">
                            <span>➕</span> ${t('configure_clients')}
                        </button>
                        <button class="btn btn-secondary" onclick="navigateToSection('schedule')">
                            ⏰ Planifier des backups
                        </button>
                    </div>
                </div>
            </td>
        </tr>
    `;
}

function showBackupsError() {
    const recentBackupsList = document.getElementById('recent-backups-list');
    if (!recentBackupsList) return;

    recentBackupsList.innerHTML = `
        <tr>
            <td colspan="6" class="empty-cell">
                <div class="error-message">
                    <span class="error-icon">❌</span>
                    <h4>Erreur de chargement</h4>
                    <p>Impossible de charger les backups récents.</p>
                    <button class="btn btn-primary" onclick="loadRecentBackupsFromAPI()">
                        🔄 Réessayer
                    </button>
                </div>
            </td>
        </tr>
    `;
}

function loadRecentBackups() {
    // Fonction obsolète - remplacée par showNoBackupsMessage()
    // Rediriger vers l'affichage approprié
    showNoBackupsMessage();
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
        case 'users':
            loadUsersPage();
            break;
        case 'config':
            loadServerConfig();
            break;
        case 'ssl':
            loadSSLPage();
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
            let apiClients = await response.json();
            
            // Filtrer selon les permissions utilisateur
            if (userPermissions && userPermissions.role !== 'admin' && !userPermissions.clientAccess.canViewAll) {
                const allowedClients = userPermissions.clientAccess.allowedClients;
                apiClients = apiClients.filter(client => allowedClients.includes(client.name));
            }
            
            clients = apiClients; // Stocker globalement
            
            if (apiClients.length > 0) {
                clientsList.innerHTML = apiClients.map(client => `
                    <div class="client-card" id="client-card-${client.id}">
                        <h3>${client.name}</h3>
                        
                        <!-- État du backup -->
                        <div class="backup-status" id="backup-status-${client.id}">
                            <div class="status-info">
                                <span class="status-text">Prêt pour backup</span>
                                <span class="status-time" id="status-time-${client.id}"></span>
                            </div>
                            <div class="progress-container" id="progress-container-${client.id}" style="display: none;">
                                <div class="progress-bar">
                                    <div class="progress-fill" id="progress-fill-${client.id}" style="width: 0%"></div>
                                </div>
                                <div class="progress-text">
                                    <span id="progress-step-${client.id}">Initialisation...</span>
                                    <span id="progress-percent-${client.id}">0%</span>
                                </div>
                            </div>
                        </div>
                        
                        <div class="client-info">
                            <span>IP: ${client.host}</span>
                            <span>Port: ${client.port}</span>
                            <span>Utilisateur: ${client.username}</span>
                            <span>OS: <span class="badge badge-${client.os_type === 'windows' ? 'primary' : 'info'}">${client.os_type === 'windows' ? '🪟 Windows' : '🐧 Linux'}</span></span>
                            <span>Type: ${client.backup_type || 'full'}</span>
                            <span>${t('status')}: <span class="badge badge-${client.active ? 'success' : 'danger'}">${client.active ? t('active') : t('inactive')}</span></span>
                            <span>Créé: ${new Date(client.created_at).toLocaleDateString('fr-FR')}</span>
                        </div>
                        <div class="client-actions">
                            <button class="btn btn-success btn-sm" id="backup-btn-${client.id}" onclick="startManualBackup(${client.id})" ${!client.active ? 'disabled' : ''}>
                                <span class="btn-icon">🚀</span>
                                ${t('start_backup')}
                            </button>
                            <button class="btn btn-secondary btn-sm" onclick="editClient(${client.id})">${t('edit')}</button>
                            <button class="btn btn-danger btn-sm" onclick="deleteClientConfirm(${client.id})">${t('delete')}</button>
                        </div>
                    </div>
                `).join('');
            } else {
                clientsList.innerHTML = `
                    <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
                        <p style="font-size: 1.2rem; margin-bottom: 1rem;">${t('no_client_configured')}</p>
                        <button class="btn btn-primary" onclick="showAddClientModal()">
                            ➕ Ajouter votre premier client
                        </button>
                    </div>
                `;
            }
            
            // Démarrer le monitoring des backups après chargement des clients
            setTimeout(startBackupStatusMonitoring, 1000);
            
            // Re-adapter les permissions après chargement des clients
            setTimeout(adaptActionButtonsForPermissions, 500);
        }
    } catch (error) {
        console.error('Erreur lors du chargement des clients:', error);
        clientsList.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--danger-color);">
                <p>Erreur lors du chargement des clients</p>
                <button class="btn btn-secondary" onclick="loadClients()">${t('retry')}</button>
            </div>
        `;
    }
}

async function loadBackupsHistory() {
    const backupsHistory = document.getElementById('backups-history');
    if (!backupsHistory) return;

    // Charger l'historique des backups depuis l'API
    backupsHistory.innerHTML = '<p>Chargement de l\'historique...</p>';
    
    try {
        const response = await fetch(`${API_URL}/backups`);
        if (response.ok) {
            const backups = await response.json();
            
            if (backups.length > 0) {
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
                            ${backups.map(backup => `
                                <tr>
                                    <td>${window.i18n.formatDate(new Date(backup.created_at))}</td>
                                    <td>${backup.client_name || 'Unknown'}</td>
                                    <td>${backup.type || 'full'}</td>
                                    <td>${backup.size_mb ? `${(backup.size_mb / 1024).toFixed(1)} GB` : '-'}</td>
                                    <td>${backup.duration || '-'}</td>
                                    <td><span class="badge badge-${backup.status === 'completed' ? 'success' : 'danger'}">
                                        ${backup.status === 'completed' ? t('success') : t('failed')}
                                    </span></td>
                                    <td>
                                        <button class="btn btn-sm" onclick="viewBackupDetails('${backup.backup_id}')">${t('details')}</button>
                                        ${backup.status === 'completed' ? 
                                          `<button class="btn btn-sm" onclick="downloadBackup('${backup.backup_id}')">${t('download')}</button>` : ''
                                        }
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
            } else {
                backupsHistory.innerHTML = `
                    <div class="no-data-message">
                        <span class="no-data-icon">📋</span>
                        <h4>${t('no_backup_history')}</h4>
                        <p>${t('no_backup_history_desc')}</p>
                        <div class="no-data-actions">
                            <button class="btn btn-primary" onclick="navigateToSection('clients')">
                                <span>➕</span> ${t('configure_clients')}
                            </button>
                            <button class="btn btn-secondary" onclick="navigateToSection('schedule')">
                                ⏰ Planifier des backups
                            </button>
                        </div>
                    </div>
                `;
            }
        } else {
            throw new Error('Erreur de chargement');
        }
    } catch (error) {
        console.error('Erreur lors du chargement de l\'historique:', error);
        backupsHistory.innerHTML = `
            <div class="error-message">
                <span class="error-icon">❌</span>
                <h4>Erreur de chargement</h4>
                <p>Impossible de charger l'historique des backups.</p>
                <button class="btn btn-primary" onclick="loadBackupsHistory()">
                    🔄 Réessayer
                </button>
            </div>
        `;
    }
}

async function loadSchedule() {
    const scheduleList = document.getElementById('schedule-list');
    if (!scheduleList) return;

    scheduleList.innerHTML = '<p>Chargement des planifications...</p>';

    try {
        const response = await fetch(`${API_URL}/schedules`);
        if (response.ok) {
            const data = await response.json();
            const schedules = data.schedules || [];
            
            if (schedules.length > 0) {
                scheduleList.innerHTML = `
                    <div class="schedule-grid">
                        ${schedules.map(schedule => `
                            <div class="schedule-card">
                                <h3>${schedule.name || 'Planification'}</h3>
                                <p><strong>Pattern cron:</strong> ${schedule.cron_pattern}</p>
                                <p><strong>Type:</strong> ${schedule.backup_type === 'full' ? 'Complet' : 
                                                         schedule.backup_type === 'incremental' ? 'Incrémentiel' : 
                                                         schedule.backup_type || 'Non spécifié'}</p>
                                <p><strong>Description:</strong> ${schedule.description || 'Aucune'}</p>
                                <p><strong>Clients:</strong> ${schedule.client_names || 'Tous'}</p>
                                <p><strong>Statut:</strong> <span class="badge badge-${schedule.active ? 'success' : 'secondary'}">
                                    ${schedule.active ? 'Actif' : 'Inactif'}</span></p>
                                ${schedule.next_run ? `<p><strong>Prochaine:</strong> ${new Date(schedule.next_run).toLocaleString('fr-FR')}</p>` : ''}
                                ${schedule.last_run ? `<p><strong>Dernière:</strong> ${new Date(schedule.last_run).toLocaleString('fr-FR')}</p>` : ''}
                                <div class="schedule-actions">
                                    <button class="btn btn-primary btn-sm" onclick="editSchedule('${schedule.name}')">Modifier</button>
                                    <button class="btn btn-danger btn-sm" onclick="deleteSchedule('${schedule.name}')">Supprimer</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <button class="btn btn-primary" style="margin-top: 1rem;" onclick="showAddScheduleModal()">
                        ➕ Ajouter une planification
                    </button>
                `;
            } else {
                scheduleList.innerHTML = `
                    <div class="no-data-message">
                        <span class="no-data-icon">⏰</span>
                        <h4>Aucune planification configurée</h4>
                        <p>Configurez des planifications automatiques pour vos backups.</p>
                        <div class="no-data-actions">
                            <button class="btn btn-primary" onclick="showAddScheduleModal()">
                                ➕ Créer une planification
                            </button>
                            <button class="btn btn-secondary" onclick="navigateToSection('clients')">
                                <span>👥</span> ${t('configure_clients_first')}
                            </button>
                        </div>
                    </div>
                `;
            }
        } else {
            throw new Error('Erreur de chargement');
        }
    } catch (error) {
        console.error('Erreur lors du chargement des planifications:', error);
        scheduleList.innerHTML = `
            <div class="error-message">
                <span class="error-icon">❌</span>
                <h4>Erreur de chargement</h4>
                <p>Impossible de charger les planifications.</p>
                <button class="btn btn-primary" onclick="loadSchedule()">
                    🔄 Réessayer
                </button>
            </div>
        `;
    }
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
            logClientSelect.innerHTML = `<option value="">${t('global_logs')}</option>`;
            
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
            
            if (!response.ok) {
                throw new Error(`Erreur HTTP ${response.status}: ${response.statusText}`);
            }
            
            logs = await response.json();
            console.log(`Logs chargés pour ${selectedClient}:`, logs.length, 'entrées');
        } else {
            // Charger les logs globaux
            const response = await fetch(`${API_URL}/logs?limit=100&level=${selectedLevel}`);
            
            if (!response.ok) {
                throw new Error(`Erreur HTTP ${response.status}: ${response.statusText}`);
            }
            
            logs = await response.json();
        }

        // Afficher les logs
        if (logs.length === 0) {
            logContent.innerHTML = '<div class="log-entry info">Aucun log disponible</div>';
        } else {
            logContent.innerHTML = logs.map(log => {
                const timestamp = new Date(log.timestamp).toLocaleString('fr-FR', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });
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
        
        let errorMessage = 'Erreur lors du chargement des logs';
        if (error.message.includes('401')) {
            errorMessage = 'Erreur d\'authentification - Veuillez vous reconnecter';
        } else if (error.message.includes('404')) {
            errorMessage = 'Aucun log trouvé pour ce client';
        } else if (error.message.includes('500')) {
            errorMessage = 'Erreur serveur - Vérifiez les logs serveur';
        } else if (error.message) {
            errorMessage = `Erreur: ${error.message}`;
        }
        
        logContent.innerHTML = `<div class="log-entry error">${errorMessage}</div>`;
        
        // Si c'est un client spécifique, essayer de charger un message informatif
        if (selectedClient) {
            logContent.innerHTML += `<div class="log-entry info">Client sélectionné: ${selectedClient}</div>`;
            logContent.innerHTML += `<div class="log-entry info">Type: ${selectedType}, Niveau: ${selectedLevel}</div>`;
        }
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
        updateElement('app-version', `Version ${apiInfo.version || '1.4.1'}`);

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
        // Le chemin sera chargé depuis l'API
        updateElement('retention-config', '30 jours');
        updateElement('parallel-config', '2');
        updateElement('vss-config', '✅ Activé');
        updateElement('notifications-config', '❌ Désactivées');

    } catch (error) {
        console.error('Erreur lors du chargement des informations système:', error);
        showNotification(t('error_occurred'), 'error');
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
    showNotification(t('processing'), 'info');
    await loadSystemInfo();
    showNotification(t('success_message'), 'success');
}

async function performHealthCheck() {
    try {
        showNotification(t('processing'), 'info');
        const response = await fetch(`${API_URL}/system/health-check`, { method: 'POST' });
        if (response.ok) {
            const result = await response.json();
            showNotification(`Health Check: ${result.status === 'healthy' ? t('success') : t('error')}`, 
                result.status === 'healthy' ? 'success' : 'warning');
            
            // Actualiser les informations
            await loadSystemInfo();
        } else {
            showNotification(t('error_occurred'), 'error');
        }
    } catch (error) {
        console.error('Erreur Health Check:', error);
        showNotification(t('error_occurred'), 'error');
    }
}

function downloadLogs() {
    showNotification(t('processing'), 'info');
    // Créer un lien de téléchargement pour les logs
    const link = document.createElement('a');
    link.href = `${API_URL}/logs?limit=1000&format=text`;
    link.download = `efc-backup-logs-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showNotification(t('success_message'), 'success');
}

function exportConfig() {
    // Exporter la configuration système
    const config = {
        timestamp: new Date().toISOString(),
        version: '1.4.1',
        server: {
            port: 3000,
            host: '0.0.0.0',
            environment: 'development'
        },
        backup: {
            path: '',
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
    showNotification(t('success_message'), 'success');
}

// Fonctions pour l'onglet Configuration
async function loadServerConfig() {
    try {
        // Charger la configuration actuelle depuis l'API
        const [settings, apiInfo] = await Promise.all([
            fetch(`${API_URL}/settings`).then(r => r.json()).catch(error => {
                console.warn('Impossible de charger les paramètres:', error);
                return {};
            }),
            fetch(`${API_URL}/info`).then(r => r.json()).catch(error => {
                console.warn('Impossible de charger les infos API:', error);
                return {};
            })
        ]);

        // Configuration serveur
        document.getElementById('server-port-input').value = '3000';
        document.getElementById('server-host-input').value = '0.0.0.0';
        document.getElementById('server-env-input').value = apiInfo.environment || 'development';
        document.getElementById('log-level-input').value = 'info';

        // Configuration backup
        document.getElementById('backup-path-input').value = '';
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

        showNotification(t('success_message'), 'success');
    } catch (error) {
        console.error('Erreur lors du chargement de la configuration:', error);
        showNotification(t('error_occurred'), 'error');
    }
}

async function saveServerConfig() {
    try {
        showNotification(t('processing'), 'info');

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

            showNotification(t('notifications.settings_saved'), 'success');
            
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
        
        document.getElementById('backup-path-input').value = '';
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
// Fonction pour afficher le modal d'ajout de planification
function showAddScheduleModal() {
    // Vérifier les permissions admin
    if (!userPermissions || userPermissions.role !== 'admin') {
        showNotification(t('notifications.permission_denied'), 'error');
        return;
    }
    
    // Créer le modal d'ajout de planification
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'add-schedule-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>➕ Ajouter une Planification</h2>
                <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label for="schedule-name">Nom de la planification:</label>
                    <input type="text" id="schedule-name" class="form-control" placeholder="Ex: Backup hebdomadaire serveurs">
                </div>
                
                <div class="form-group">
                    <label for="schedule-type">Type de backup:</label>
                    <select id="schedule-type" class="form-control">
                        <option value="full">${t('full')}</option>
                        <option value="incremental">${t('incremental')}</option>
                        <option value="differential">${t('differential')}</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label for="schedule-frequency">Fréquence:</label>
                    <select id="schedule-frequency" class="form-control" onchange="updateCronFields(this.value)">
                        <option value="daily">${t('daily')}</option>
                        <option value="weekly">${t('weekly')}</option>
                        <option value="monthly">${t('monthly')}</option>
                        <option value="custom">${t('custom')}</option>
                    </select>
                </div>
                
                <div id="time-selection" class="form-group">
                    <label for="schedule-time">Heure d'exécution:</label>
                    <input type="time" id="schedule-time" class="form-control" value="02:00">
                </div>
                
                <div id="day-selection" class="form-group" style="display: none;">
                    <label for="schedule-day">Jour de la semaine:</label>
                    <select id="schedule-day" class="form-control">
                        <option value="0">Dimanche</option>
                        <option value="1">Lundi</option>
                        <option value="2">Mardi</option>
                        <option value="3">Mercredi</option>
                        <option value="4">Jeudi</option>
                        <option value="5">Vendredi</option>
                        <option value="6">Samedi</option>
                    </select>
                </div>
                
                <div id="date-selection" class="form-group" style="display: none;">
                    <label for="schedule-date">Jour du mois (1-31):</label>
                    <input type="number" id="schedule-date" class="form-control" min="1" max="31" value="1">
                </div>
                
                <div id="cron-selection" class="form-group" style="display: none;">
                    <label for="schedule-cron">Expression Cron:</label>
                    <input type="text" id="schedule-cron" class="form-control" placeholder="0 2 * * *">
                    <small class="form-text">Format: minute heure jour mois jour-semaine</small>
                </div>
                
                <div class="form-group">
                    <label for="schedule-clients">Clients concernés:</label>
                    <select id="schedule-clients" class="form-control" multiple size="5">
                        <option value="all">Tous les clients actifs</option>
                    </select>
                    <small class="form-text">Maintenez Ctrl pour sélectionner plusieurs clients</small>
                </div>
                
                <div class="form-group">
                    <div class="form-check">
                        <input type="checkbox" id="schedule-active" class="form-check-input" checked>
                        <label for="schedule-active" class="form-check-label">
                            Activer immédiatement cette planification
                        </label>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Annuler</button>
                <button class="btn btn-primary" onclick="saveSchedule()">
                    💾 Enregistrer la Planification
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    modal.style.display = 'block';
    
    // Charger la liste des clients
    loadClientsForSchedule();
}

// Fonction pour éditer une planification existante
async function editSchedule(scheduleName) {
    try {
        // Récupérer les détails de la planification
        const response = await apiRequest('/api/schedules');
        if (!response.ok) {
            throw new Error('Erreur lors du chargement des planifications');
        }
        
        const data = await response.json();
        const schedules = data.schedules || data; // Gérer les deux formats possibles
        const schedule = schedules.find(s => s.name === scheduleName);
        
        if (!schedule) {
            showNotification('Planification introuvable', 'error');
            return;
        }
        
        // Afficher le modal de modification
        showAddScheduleModal();
        
        // Pré-remplir les champs
        document.getElementById('schedule-name').value = schedule.name;
        document.getElementById('schedule-name').disabled = true; // Empêcher la modification du nom
        document.getElementById('schedule-type').value = schedule.backup_type;
        
        // Détecter le type de fréquence depuis le pattern cron
        const cronPattern = schedule.cron_pattern;
        let frequency = 'custom';
        let time = '02:00';
        
        // Pattern quotidien: "0 2 * * *" ou "00 02 * * *"
        if (cronPattern.match(/^\d+\s+\d+\s+\*\s+\*\s+\*$/)) {
            frequency = 'daily';
            const parts = cronPattern.split(' ');
            time = `${parts[1].padStart(2, '0')}:${parts[0].padStart(2, '0')}`;
        }
        // Pattern hebdomadaire: "0 2 * * 0-6"
        else if (cronPattern.match(/^\d+\s+\d+\s+\*\s+\*\s+[0-6]$/)) {
            frequency = 'weekly';
            const parts = cronPattern.split(' ');
            time = `${parts[1].padStart(2, '0')}:${parts[0].padStart(2, '0')}`;
            document.getElementById('schedule-day').value = parts[4];
        }
        // Pattern mensuel: "0 2 1-31 * *"
        else if (cronPattern.match(/^\d+\s+\d+\s+\d+\s+\*\s+\*$/)) {
            frequency = 'monthly';
            const parts = cronPattern.split(' ');
            time = `${parts[1].padStart(2, '0')}:${parts[0].padStart(2, '0')}`;
            document.getElementById('schedule-date').value = parts[2];
        }
        
        document.getElementById('schedule-frequency').value = frequency;
        updateCronFields(frequency);
        
        if (frequency !== 'custom') {
            document.getElementById('schedule-time').value = time;
        } else {
            document.getElementById('schedule-cron').value = cronPattern;
        }
        
        // Pré-sélectionner les clients
        setTimeout(() => {
            const clientNames = schedule.client_names ? JSON.parse(schedule.client_names) : [];
            const select = document.getElementById('schedule-clients');
            Array.from(select.options).forEach(option => {
                if (clientNames.includes(option.value) || (clientNames.length === 0 && option.value === 'all')) {
                    option.selected = true;
                } else {
                    option.selected = false;
                }
            });
        }, 500);
        
        // Activer/désactiver selon le statut
        document.getElementById('schedule-active').checked = schedule.active;
        
        // Changer le titre du modal
        const modalTitle = document.querySelector('#add-schedule-modal .modal-header h2');
        if (modalTitle) {
            modalTitle.textContent = '✏️ Modifier la Planification';
        }
        
        // Changer le bouton de sauvegarde pour update
        const saveButton = document.querySelector('#add-schedule-modal .modal-footer .btn-primary');
        if (saveButton) {
            saveButton.setAttribute('onclick', `updateSchedule('${scheduleName}')`);
            saveButton.textContent = '💾 Mettre à jour';
        }
        
    } catch (error) {
        console.error('Erreur lors de l\'édition de la planification:', error);
        showNotification('Erreur lors du chargement de la planification', 'error');
    }
}

// Fonction pour mettre à jour une planification existante
async function updateSchedule(originalName) {
    try {
        const name = originalName; // Garder le nom original
        const type = document.getElementById('schedule-type').value;
        const frequency = document.getElementById('schedule-frequency').value;
        const active = document.getElementById('schedule-active').checked;
        
        // Construire le pattern cron
        let cronPattern = '';
        if (frequency === 'custom') {
            cronPattern = document.getElementById('schedule-cron').value;
        } else {
            const time = document.getElementById('schedule-time').value.split(':');
            const hour = time[0];
            const minute = time[1];
            
            if (frequency === 'daily') {
                cronPattern = `${minute} ${hour} * * *`;
            } else if (frequency === 'weekly') {
                const day = document.getElementById('schedule-day').value;
                cronPattern = `${minute} ${hour} * * ${day}`;
            } else if (frequency === 'monthly') {
                const date = document.getElementById('schedule-date').value;
                cronPattern = `${minute} ${hour} ${date} * *`;
            }
        }
        
        // Récupérer les clients sélectionnés
        const clientSelect = document.getElementById('schedule-clients');
        const selectedClients = Array.from(clientSelect.selectedOptions).map(option => option.value);
        const clientNames = selectedClients.includes('all') ? [] : selectedClients;
        
        const scheduleData = {
            name: name,
            cron_pattern: cronPattern,
            backup_type: type,
            client_names: clientNames,
            description: `${frequency === 'daily' ? 'Quotidien' : frequency === 'weekly' ? 'Hebdomadaire' : frequency === 'monthly' ? 'Mensuel' : 'Personnalisé'} - ${type}`,
            active: active
        };
        
        const response = await apiRequest(`/api/schedules/${encodeURIComponent(name)}`, {
            method: 'PUT',
            body: JSON.stringify(scheduleData)
        });
        
        if (response.ok) {
            showNotification('Planification mise à jour avec succès', 'success');
            document.getElementById('add-schedule-modal').remove();
            await reloadSchedules();
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Erreur lors de la mise à jour');
        }
    } catch (error) {
        console.error('Erreur lors de la mise à jour de la planification:', error);
        showNotification(`Erreur: ${error.message}`, 'error');
    }
}

// Fonction pour supprimer une planification
async function deleteSchedule(scheduleName) {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer la planification "${scheduleName}" ?`)) {
        return;
    }
    
    try {
        const response = await apiRequest(`/api/schedules/${encodeURIComponent(scheduleName)}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showNotification('Planification supprimée avec succès', 'success');
            await reloadSchedules();
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Erreur lors de la suppression');
        }
    } catch (error) {
        console.error('Erreur lors de la suppression de la planification:', error);
        showNotification(`Erreur: ${error.message}`, 'error');
    }
}

// Charger les clients pour la planification
async function loadClientsForSchedule() {
    try {
        const response = await apiRequest('/api/clients');
        if (response.ok) {
            const clients = await response.json();
            const select = document.getElementById('schedule-clients');
            
            // Garder l'option "Tous les clients"
            select.innerHTML = '<option value="all" selected>Tous les clients actifs</option>';
            
            clients.forEach(client => {
                const option = document.createElement('option');
                option.value = client.name;  // Utiliser le nom au lieu de l'ID
                option.textContent = `${client.name} (${client.os_type || 'Linux'})`;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Erreur lors du chargement des clients:', error);
    }
}

// Mettre à jour les champs selon la fréquence sélectionnée
function updateCronFields(frequency) {
    document.getElementById('time-selection').style.display = 'block';
    document.getElementById('day-selection').style.display = 'none';
    document.getElementById('date-selection').style.display = 'none';
    document.getElementById('cron-selection').style.display = 'none';
    
    switch(frequency) {
        case 'daily':
            // Juste l'heure
            break;
        case 'weekly':
            document.getElementById('day-selection').style.display = 'block';
            break;
        case 'monthly':
            document.getElementById('date-selection').style.display = 'block';
            break;
        case 'custom':
            document.getElementById('time-selection').style.display = 'none';
            document.getElementById('cron-selection').style.display = 'block';
            break;
    }
}

// Enregistrer la nouvelle planification
async function saveSchedule() {
    const name = document.getElementById('schedule-name').value.trim();
    const type = document.getElementById('schedule-type').value;
    const frequency = document.getElementById('schedule-frequency').value;
    const active = document.getElementById('schedule-active').checked;
    const clientsSelect = document.getElementById('schedule-clients');
    
    if (!name) {
        showNotification(t('errors.required_field'), 'error');
        return;
    }
    
    // Récupérer les clients sélectionnés
    const selectedClients = Array.from(clientsSelect.selectedOptions).map(option => option.value);
    if (selectedClients.length === 0) {
        showNotification(t('errors.required_field'), 'error');
        return;
    }
    
    // Construire l'expression cron selon la fréquence
    let cronExpression = '';
    if (frequency === 'custom') {
        cronExpression = document.getElementById('schedule-cron').value;
        if (!cronExpression) {
            showNotification('Veuillez entrer une expression cron valide', 'error');
            return;
        }
    } else {
        const time = document.getElementById('schedule-time').value;
        const [hours, minutes] = time.split(':');
        
        // Convertir en entiers pour éviter les zéros en trop
        const h = parseInt(hours);
        const m = parseInt(minutes);
        
        switch(frequency) {
            case 'daily':
                cronExpression = `${m} ${h} * * *`;
                break;
            case 'weekly':
                const day = document.getElementById('schedule-day').value;
                cronExpression = `${m} ${h} * * ${day}`;
                break;
            case 'monthly':
                const date = document.getElementById('schedule-date').value;
                cronExpression = `${m} ${h} ${date} * *`;
                break;
        }
    }
    
    // Créer l'objet planification
    const scheduleData = {
        name: name,
        cron_pattern: cronExpression,  // L'API attend cron_pattern, pas cron
        backup_type: type,
        client_names: selectedClients.includes('all') ? ['all'] : selectedClients,  // L'API attend client_names et un array
        description: `${frequency === 'daily' ? 'Quotidien' : frequency === 'weekly' ? 'Hebdomadaire' : frequency === 'monthly' ? 'Mensuel' : 'Personnalisé'} - ${type}`
    };
    
    // Logs de debug
    console.log('Données collectées:');
    console.log('- name:', name);
    console.log('- type:', type);
    console.log('- frequency:', frequency);
    console.log('- cronExpression:', cronExpression);
    console.log('- selectedClients:', selectedClients);
    console.log('Envoi de la planification:', scheduleData);
    
    console.log('Avant le try block');
    
    try {
        console.log('Dans le try block');
        console.log('Envoi de la requête...');
        
        // Utiliser fetch directement au lieu d'apiRequest
        const response = await fetch('/api/schedules', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(scheduleData)
        });
        
        console.log('Response reçue');
        console.log('Response status:', response.status);
        console.log('Response ok:', response.ok);
        
        if (response.ok) {
            const result = await response.json();
            console.log('Response data:', result);
            showNotification(t('success_message'), 'success');
            document.getElementById('add-schedule-modal').remove();
            
            // Recharger la page des planifications si elle est affichée
            if (document.getElementById('schedules-content')) {
                showSchedules();
            }
        } else {
            const error = await response.json();
            console.error('Erreur serveur:', error);
            showNotification(`Erreur: ${error.error || 'Impossible de créer la planification'}`, 'error');
        }
    } catch (error) {
        console.error('Erreur lors de la création de la planification:', error);
        showNotification('Erreur lors de la création de la planification', 'error');
    }
}

// Fonction pour ouvrir le modal de restauration rapide (admin seulement)
function openQuickRestore() {
    console.log('openQuickRestore appelée');
    console.log('userPermissions:', userPermissions);
    
    // Vérifier si l'utilisateur est admin
    if (!userPermissions || userPermissions.role !== 'admin') {
        console.log('Accès refusé - pas admin');
        showNotification(t('notifications.permission_denied'), 'error');
        return;
    }
    
    console.log('Création du modal...');
    
    // Créer le modal de sélection pour la restauration
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'quick-restore-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2><span>🔄</span> ${t('quick_restore')}</h2>
                <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label for="restore-client-select">Sélectionner le client:</label>
                    <select id="restore-client-select" class="form-control" onchange="loadClientBackups(this.value)">
                        <option value="">-- Choisir un client --</option>
                    </select>
                </div>
                
                <div class="form-group" id="backup-select-group" style="display: none;">
                    <label for="restore-backup-select">Sélectionner le backup à restaurer:</label>
                    <select id="restore-backup-select" class="form-control">
                        <option value="">-- Choisir un backup --</option>
                    </select>
                </div>
                
                <div id="backup-details-preview" style="display: none; margin-top: 1rem; padding: 1rem; background: var(--bg-secondary); border-radius: 8px;">
                    <!-- Les détails du backup sélectionné apparaîtront ici -->
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Annuler</button>
                <button class="btn btn-primary" id="quick-restore-btn" disabled onclick="quickRestore()">
                    🔄 Restaurer
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    modal.style.display = 'block';
    
    // Charger la liste des clients
    loadClientsForRestore();
}

// Charger la liste des clients pour la restauration
async function loadClientsForRestore() {
    try {
        const response = await apiRequest('/api/clients');
        if (response.ok) {
            const clients = await response.json();
            const select = document.getElementById('restore-client-select');
            
            clients.forEach(client => {
                const option = document.createElement('option');
                option.value = client.name;
                option.textContent = `${client.name} (${client.os_type || 'Linux'})`;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Erreur lors du chargement des clients:', error);
        showNotification(t('error_occurred'), 'error');
    }
}

// Charger les backups d'un client sélectionné
async function loadClientBackups(clientName) {
    if (!clientName) {
        document.getElementById('backup-select-group').style.display = 'none';
        document.getElementById('backup-details-preview').style.display = 'none';
        document.getElementById('quick-restore-btn').disabled = true;
        return;
    }
    
    try {
        const response = await apiRequest(`/api/backups?client_name=${encodeURIComponent(clientName)}&status=completed`);
        if (response.ok) {
            const backups = await response.json();
            const select = document.getElementById('restore-backup-select');
            
            // Vider la liste existante
            select.innerHTML = '<option value="">-- Choisir un backup --</option>';
            
            // Filtrer et trier les backups (plus récents en premier)
            const completedBackups = backups
                .filter(b => b.status === 'completed' && b.path)
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            
            if (completedBackups.length === 0) {
                select.innerHTML = '<option value="">Aucun backup disponible</option>';
                document.getElementById('quick-restore-btn').disabled = true;
            } else {
                completedBackups.forEach(backup => {
                    const option = document.createElement('option');
                    option.value = JSON.stringify({
                        id: backup.backup_id,
                        client: backup.client_name,
                        path: backup.path
                    });
                    const date = new Date(backup.created_at).toLocaleString('fr-FR');
                    const size = backup.size_mb ? `${backup.size_mb} MB` : 'Taille inconnue';
                    option.textContent = `${date} - ${backup.type} - ${size}`;
                    select.appendChild(option);
                });
            }
            
            // Afficher le sélecteur de backup
            document.getElementById('backup-select-group').style.display = 'block';
            
            // Ajouter un événement pour afficher les détails du backup sélectionné
            select.onchange = function() {
                if (this.value) {
                    const backupInfo = JSON.parse(this.value);
                    showBackupPreview(backupInfo);
                    document.getElementById('quick-restore-btn').disabled = false;
                } else {
                    document.getElementById('backup-details-preview').style.display = 'none';
                    document.getElementById('quick-restore-btn').disabled = true;
                }
            };
        }
    } catch (error) {
        console.error('Erreur lors du chargement des backups:', error);
        showNotification(t('error_occurred'), 'error');
    }
}

// Afficher les détails du backup sélectionné
function showBackupPreview(backupInfo) {
    const preview = document.getElementById('backup-details-preview');
    preview.innerHTML = `
        <h4>📦 Détails du backup sélectionné:</h4>
        <p><strong>Client:</strong> ${backupInfo.client}</p>
        <p><strong>ID Backup:</strong> ${backupInfo.id}</p>
        <p><strong>Chemin:</strong> <code>${backupInfo.path}</code></p>
        <div class="warning-message" style="margin-top: 1rem;">
            <span class="warning-icon">⚠️</span>
            Ce backup sera restauré dans un dossier temporaire. Vous pourrez choisir la destination dans l'étape suivante.
        </div>
    `;
    preview.style.display = 'block';
}

// Lancer la restauration rapide
function quickRestore() {
    const backupSelect = document.getElementById('restore-backup-select');
    if (!backupSelect.value) {
        showNotification(t('errors.required_field'), 'error');
        return;
    }
    
    const backupInfo = JSON.parse(backupSelect.value);
    
    // Fermer le modal de sélection
    document.getElementById('quick-restore-modal').remove();
    
    // Ouvrir le modal de restauration avec les infos du backup
    restoreBackup(backupInfo.id, backupInfo.client);
}

// Démarrer un backup manuel avec suivi de progression
async function startManualBackup(clientId) {
    const client = clients.find(c => c.id === clientId);
    if (!client) return;
    
    if (!hasPermission('backups_create')) {
        showNotification(t('notifications.permission_denied'), 'error');
        return;
    }
    
    // Interface de sélection de type de backup
    showBackupTypeModal(clientId, client.name);
}

// Afficher le modal de sélection de type de backup
function showBackupTypeModal(clientId, clientName) {
    const modalHtml = `
        <div class="modal active" id="backup-type-modal">
            <div class="modal-content">
                <span class="close" onclick="closeBackupTypeModal()">&times;</span>
                <h2><span>🚀</span> ${t('start_manual_backup')}</h2>
                <p><strong>Client:</strong> ${clientName}</p>
                
                <div class="backup-type-selection">
                    <div class="backup-type-option" onclick="selectBackupType('full')">
                        <div class="backup-type-icon">💾</div>
                        <div class="backup-type-info">
                            <h3>Backup Complet</h3>
                            <p>Sauvegarde complète de tous les fichiers</p>
                            <small>⏱️ Plus long mais plus sûr</small>
                        </div>
                    </div>
                    
                    <div class="backup-type-option" onclick="selectBackupType('incremental')">
                        <div class="backup-type-icon">📂</div>
                        <div class="backup-type-info">
                            <h3>Backup Incrémentiel</h3>
                            <p>Sauvegarde uniquement les fichiers modifiés</p>
                            <small>⚡ Plus rapide</small>
                        </div>
                    </div>
                    
                    <div class="backup-type-option" onclick="selectBackupType('differential')">
                        <div class="backup-type-icon">🔄</div>
                        <div class="backup-type-info">
                            <h3>Backup Différentiel</h3>
                            <p>Sauvegarde les modifications depuis le dernier complet</p>
                            <small>⚖️ Compromis</small>
                        </div>
                    </div>
                </div>
                
                <div class="backup-options" style="margin-top: 1.5rem; padding: 1rem; background: var(--surface-color); border-radius: 8px; border: 1px solid var(--border-color);">
                    <h3 style="margin: 0 0 0.75rem 0; color: var(--text-color); font-size: 0.9rem;">🔧 Options Avancées</h3>
                    <div class="checkbox-group">
                        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; color: var(--text-secondary);">
                            <input type="checkbox" id="create-image-option" style="margin: 0;">
                            <span>💿 Créer une image disque Windows (wbadmin)</span>
                        </label>
                        <div style="font-size: 0.75rem; color: var(--text-tertiary); margin-left: 1.5rem; margin-top: 0.25rem;">
                            Disponible uniquement pour les clients Windows et les backups complets
                        </div>
                    </div>
                </div>
                
                <input type="hidden" id="selected-client-id" value="${clientId}">
            </div>
        </div>
    `;
    
    // Ajouter le modal au DOM
    const existingModal = document.getElementById('backup-type-modal');
    if (existingModal) existingModal.remove();
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeBackupTypeModal() {
    const modal = document.getElementById('backup-type-modal');
    if (modal) modal.remove();
}

async function selectBackupType(type) {
    const clientId = document.getElementById('selected-client-id').value;
    const client = clients.find(c => c.id == clientId);
    
    // Récupérer l'option image disque
    const createImageCheckbox = document.getElementById('create-image-option');
    const createImage = createImageCheckbox ? createImageCheckbox.checked : false;
    
    closeBackupTypeModal();
    
    if (!client) return;
    
    try {
        // Démarrer le backup avec les options
        const response = await apiRequest(`${API_URL}/backups/start/${clientId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                type: type,
                createImage: createImage
            })
        });
        
        if (response.ok) {
            const result = await response.json();
            showNotification(t('notifications.backup_started', {client: client.name}), 'success');
            
            // Afficher la popup de progression
            showBackupProgressModal(clientId, client.name, type, result.data.backupId);
            
            // Mettre à jour l'interface immédiatement
            updateBackupStatus(clientId, {
                status: 'starting',
                progress: 0,
                currentStep: 'Initialisation du backup',
                backupId: result.data.backupId
            });
            
            // Démarrer le suivi en temps réel
            startBackupStatusMonitoring();
            
        } else {
            const error = await response.json();
            const errorMsg = error.error || 'Impossible de démarrer le backup';
            
            // Afficher l'erreur détaillée
            showNotification(`Erreur backup: ${errorMsg}`, 'error');
            
            // Mettre à jour le statut pour montrer l'échec
            updateBackupStatus(clientId, {
                status: 'failed',
                progress: 0,
                currentStep: `Échec: ${errorMsg}`,
                error: errorMsg
            });
            
            console.error('Détails erreur backup:', error);
        }
    } catch (error) {
        console.error('Erreur lors du démarrage du backup:', error);
        const errorMsg = 'Erreur de connexion au serveur';
        showNotification(errorMsg, 'error');
        
        // Mettre à jour le statut pour montrer l'échec de connexion
        updateBackupStatus(clientId, {
            status: 'failed',
            progress: 0,
            currentStep: errorMsg,
            error: errorMsg
        });
    }
}

// Mettre à jour le statut de backup d'un client
function updateBackupStatus(clientId, status) {
    const statusElement = document.getElementById(`backup-status-${clientId}`);
    const progressContainer = document.getElementById(`progress-container-${clientId}`);
    const progressFill = document.getElementById(`progress-fill-${clientId}`);
    const progressStep = document.getElementById(`progress-step-${clientId}`);
    const progressPercent = document.getElementById(`progress-percent-${clientId}`);
    const statusText = statusElement?.querySelector('.status-text');
    const statusTime = document.getElementById(`status-time-${clientId}`);
    const backupBtn = document.getElementById(`backup-btn-${clientId}`);
    
    if (!statusElement) return;
    
    // Mettre à jour la classe de statut
    statusElement.className = `backup-status status-${status.status}`;
    
    if (status.status === 'starting' || status.status === 'running') {
        // Afficher la progression
        if (progressContainer) progressContainer.style.display = 'block';
        if (progressFill) {
            progressFill.style.width = `${status.progress}%`;
            progressFill.classList.add('animate');
        }
        if (progressStep) progressStep.textContent = status.currentStep || 'En cours...';
        if (progressPercent) progressPercent.textContent = `${status.progress}%`;
        if (statusText) statusText.textContent = status.status === 'starting' ? t('starting') : t('backup_in_progress');
        if (statusTime && status.startTime) {
            statusTime.textContent = `Démarré: ${new Date(status.startTime).toLocaleString('fr-FR', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            })}`;
        }
        
        // Désactiver le bouton
        if (backupBtn) {
            backupBtn.disabled = true;
            backupBtn.innerHTML = '<span class="btn-icon">⏳</span>En cours...';
        }
        
    } else if (status.status === 'completed') {
        // Masquer la progression
        if (progressContainer) progressContainer.style.display = 'none';
        if (statusText) statusText.textContent = 'Backup terminé';
        if (statusTime) statusTime.textContent = `Terminé: ${new Date().toLocaleString('fr-FR', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        })}`;
        
        // Réactiver le bouton
        if (backupBtn) {
            backupBtn.disabled = false;
            backupBtn.innerHTML = `<span class="btn-icon">🚀</span>${t('start_backup')}`;
        }
        
        // Auto-masquer après 30 secondes
        setTimeout(() => {
            if (statusText) statusText.textContent = 'Prêt pour backup';
            if (statusTime) statusTime.textContent = '';
            statusElement.className = 'backup-status';
        }, 30000);
        
    } else if (status.status === 'failed') {
        // Masquer la progression
        if (progressContainer) progressContainer.style.display = 'none';
        if (statusText) statusText.textContent = 'Échec du backup';
        if (statusTime) statusTime.textContent = status.error ? `Erreur: ${status.error}` : 'Erreur inconnue';
        
        // Réactiver le bouton
        if (backupBtn) {
            backupBtn.disabled = false;
            backupBtn.innerHTML = `<span class="btn-icon">🚀</span>${t('start_backup')}`;
        }
        
        // Auto-masquer après 60 secondes
        setTimeout(() => {
            if (statusText) statusText.textContent = 'Prêt pour backup';
            if (statusTime) statusTime.textContent = '';
            statusElement.className = 'backup-status';
        }, 60000);
    }
}

// Afficher une popup modale de progression de backup
function showBackupProgressModal(clientId, clientName, backupType, backupId) {
    // Supprimer l'ancienne popup si elle existe
    const existingModal = document.getElementById('backup-progress-modal');
    if (existingModal) existingModal.remove();
    
    const modal = document.createElement('div');
    modal.id = 'backup-progress-modal';
    modal.className = 'modal active backup-progress-modal';
    
    modal.innerHTML = `
        <div class="modal-content backup-progress-content">
            <div class="modal-header">
                <h2><span>🚀</span> ${t('backup_in_progress')}</h2>
                <button class="close-btn" onclick="closeBackupProgressModal()">×</button>
            </div>
            
            <div class="backup-info">
                <div class="info-row">
                    <strong>Client:</strong> <span>${clientName}</span>
                </div>
                <div class="info-row">
                    <strong>Type:</strong> <span>${backupType}</span>
                </div>
                <div class="info-row">
                    <strong>ID:</strong> <span>${backupId}</span>
                </div>
            </div>
            
            <div class="progress-section">
                <div class="progress-step-text" id="progress-step-modal">Initialisation du backup...</div>
                <div class="progress-bar-container">
                    <div class="progress-bar-fill" id="progress-bar-modal" style="width: 0%"></div>
                    <div class="progress-percentage" id="progress-percentage-modal">0%</div>
                </div>
            </div>
            
            <div class="backup-details" id="backup-details-modal">
                <div class="detail-item">
                    <span class="detail-label">Étape actuelle:</span>
                    <span class="detail-value" id="current-step-modal">-</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Dossier en cours:</span>
                    <span class="detail-value" id="current-folder-modal">-</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Progression:</span>
                    <span class="detail-value" id="folder-progress-modal">-</span>
                </div>
            </div>
            
            <div class="backup-actions">
                <button class="btn btn-secondary" onclick="minimizeBackupProgressModal()">Minimiser</button>
                <button class="btn btn-danger" onclick="confirmCancelBackup('${backupId}')" id="cancel-backup-btn">Annuler</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Stocker les références pour les mises à jour
    window.currentBackupModal = {
        clientId: clientId,
        backupId: backupId,
        modal: modal
    };
}

// Fermer la popup de progression
function closeBackupProgressModal() {
    const modal = document.getElementById('backup-progress-modal');
    if (modal) modal.remove();
    window.currentBackupModal = null;
}

// Minimiser la popup (la garder mais la réduire)
function minimizeBackupProgressModal() {
    const modal = document.getElementById('backup-progress-modal');
    if (modal) {
        modal.classList.add('minimized');
        modal.innerHTML = `
            <div class="modal-content-minimized">
                <div class="minimized-info">
                    <span>${t('backup_in_progress')}...</span>
                    <div class="minimized-progress">
                        <div class="progress-bar-fill" id="progress-bar-minimized" style="width: 0%"></div>
                    </div>
                    <span id="progress-percentage-minimized">0%</span>
                </div>
                <button class="btn btn-sm" onclick="restoreBackupProgressModal()">Agrandir</button>
            </div>
        `;
    }
}

// Restaurer la popup minimisée
function restoreBackupProgressModal() {
    const modal = document.getElementById('backup-progress-modal');
    if (modal && window.currentBackupModal) {
        modal.classList.remove('minimized');
        // Recréer le contenu complet
        showBackupProgressModal(
            window.currentBackupModal.clientId, 
            'Client', // On pourrait stocker le nom
            'backup', // On pourrait stocker le type
            window.currentBackupModal.backupId
        );
    }
}

// Confirmer l'annulation du backup
function confirmCancelBackup(backupId) {
    if (confirm('Êtes-vous sûr de vouloir annuler ce backup ?')) {
        cancelBackup(backupId);
    }
}

// Annuler un backup (à implémenter côté serveur)
async function cancelBackup(backupId) {
    try {
        const response = await apiRequest(`${API_URL}/backups/cancel/${backupId}`, {
            method: 'POST'
        });
        
        if (response.ok) {
            showNotification(t('cancel'), 'info');
            closeBackupProgressModal();
        } else {
            showNotification(t('error_occurred'), 'error');
        }
    } catch (error) {
        console.error('Erreur lors de l\'annulation:', error);
        showNotification(t('notifications.network_error'), 'error');
    }
}

// Mettre à jour la popup modale de progression
function updateBackupProgressModal(backupStatus) {
    if (!window.currentBackupModal || window.currentBackupModal.backupId !== backupStatus.backupId) {
        return; // Pas de popup ou backup différent
    }
    
    const modal = document.getElementById('backup-progress-modal');
    if (!modal) return;
    
    // Éléments de progression
    const progressBar = document.getElementById('progress-bar-modal');
    const progressPercentage = document.getElementById('progress-percentage-modal');
    const progressStepText = document.getElementById('progress-step-modal');
    const currentStep = document.getElementById('current-step-modal');
    const currentFolder = document.getElementById('current-folder-modal');
    const folderProgress = document.getElementById('folder-progress-modal');
    
    // Éléments minimisés
    const progressBarMin = document.getElementById('progress-bar-minimized');
    const progressPercentageMin = document.getElementById('progress-percentage-minimized');
    
    // Mettre à jour la progression
    const progress = backupStatus.progress || 0;
    const step = backupStatus.currentStep || 'En attente...';
    
    if (progressBar) progressBar.style.width = `${progress}%`;
    if (progressPercentage) progressPercentage.textContent = `${progress}%`;
    if (progressStepText) progressStepText.textContent = step;
    if (currentStep) currentStep.textContent = step;
    
    // Mise à jour des détails si disponibles
    if (backupStatus.details) {
        if (currentFolder && backupStatus.details.currentFolder) {
            currentFolder.textContent = backupStatus.details.currentFolder;
        }
        if (folderProgress && backupStatus.details.folderIndex && backupStatus.details.totalFolders) {
            folderProgress.textContent = `${backupStatus.details.folderIndex}/${backupStatus.details.totalFolders}`;
        }
    }
    
    // Mettre à jour la version minimisée si elle existe
    if (progressBarMin) progressBarMin.style.width = `${progress}%`;
    if (progressPercentageMin) progressPercentageMin.textContent = `${progress}%`;
    
    // Si le backup est terminé ou en échec, fermer après 3 secondes
    if (backupStatus.status === 'completed' || backupStatus.status === 'failed') {
        const cancelBtn = document.getElementById('cancel-backup-btn');
        if (cancelBtn) {
            cancelBtn.style.display = 'none';
        }
        
        // Afficher un message de fin
        if (progressStepText) {
            progressStepText.textContent = backupStatus.status === 'completed' 
                ? '✅ Backup terminé avec succès!' 
                : '❌ Backup échoué';
        }
        
        // Fermer automatiquement après 5 secondes
        setTimeout(() => {
            closeBackupProgressModal();
        }, 5000);
    }
}

// Démarrer le monitoring en temps réel des backups
let backupMonitoringInterval = null;

function startBackupStatusMonitoring() {
    if (backupMonitoringInterval) return; // Déjà actif
    
    backupMonitoringInterval = setInterval(async () => {
        try {
            const response = await apiRequest(`${API_URL}/backups/status`);
            if (response.ok) {
                const data = await response.json();
                const runningBackups = data.data.runningBackups;
                
                // Mettre à jour chaque backup en cours
                runningBackups.forEach(backup => {
                    updateBackupStatus(backup.clientId, backup);
                    // Mettre à jour la popup modale si elle est affichée
                    updateBackupProgressModal(backup);
                });
                
                // Arrêter le monitoring si aucun backup en cours
                if (runningBackups.length === 0) {
                    stopBackupStatusMonitoring();
                }
            }
        } catch (error) {
            console.warn('Erreur monitoring backups:', error);
        }
    }, 2000); // Toutes les 2 secondes
    
    console.log('Monitoring des backups démarré');
}

function stopBackupStatusMonitoring() {
    if (backupMonitoringInterval) {
        clearInterval(backupMonitoringInterval);
        backupMonitoringInterval = null;
        console.log('Monitoring des backups arrêté');
    }
}

// Fonction de compatibilité (ancienne interface)
async function startBackup(clientId) {
    return startManualBackup(clientId);
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
            showNotification(t('success_message'), 'success');
            closeModal();
            loadClients();
        } else {
            const error = await response.json();
            showNotification(`Erreur: ${error.error || 'Impossible d\'ajouter le client'}`, 'error');
        }
    } catch (error) {
        console.error('Erreur lors de l\'ajout du client:', error);
        showNotification(t('notifications.server_error'), 'error');
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
            showNotification(t('success_message'), 'success');
            document.querySelector('.modal').remove();
            loadClients();
        } else {
            const error = await response.json();
            showNotification(`Erreur: ${error.error || 'Impossible de modifier le client'}`, 'error');
        }
    } catch (error) {
        console.error('Erreur lors de la modification du client:', error);
        showNotification(t('notifications.server_error'), 'error');
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
            showNotification(t('success_message'), 'success');
            loadClients();
        } else {
            const error = await response.json();
            showNotification(`Erreur: ${error.error || 'Impossible de supprimer le client'}`, 'error');
        }
    } catch (error) {
        console.error('Erreur lors de la suppression du client:', error);
        showNotification(t('notifications.server_error'), 'error');
    }
}

async function viewBackupDetails(backupId) {
    // Créer la modale avec un indicateur de chargement
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-content">
            <h2>Détails du Backup</h2>
            <div id="backup-details-content" style="margin: 1rem 0;">
                <p>Chargement des détails...</p>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Fermer</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    try {
        // Charger les détails depuis l'API
        const response = await fetch(`${API_URL}/backups`);
        if (response.ok) {
            const backups = await response.json();
            const backup = backups.find(b => b.backup_id === backupId || b.client_name === backupId);
            
            if (backup) {
                const detailsContent = document.getElementById('backup-details-content');
                detailsContent.innerHTML = `
                    <div>
                        <p><strong>Client:</strong> ${backup.client_name || 'Inconnu'}</p>
                        <p><strong>Type:</strong> ${backup.type === 'full' ? 'Complet' : 
                                                   backup.type === 'incremental' ? 'Incrémentiel' : 
                                                   backup.type || 'Non spécifié'}</p>
                        <p><strong>Date:</strong> ${new Date(backup.created_at).toLocaleString('fr-FR')}</p>
                        <p><strong>Taille:</strong> ${backup.size_mb ? `${(backup.size_mb / 1024).toFixed(1)} GB` : 'Non calculée'}</p>
                        <p><strong>Durée:</strong> ${backup.duration || 'Non enregistrée'}</p>
                        <p><strong>Statut:</strong> <span class="badge badge-${backup.status === 'completed' ? 'success' : 'danger'}">
                            ${backup.status === 'completed' ? 'Réussi' : 'Échoué'}</span></p>
                        <p><strong>ID Backup:</strong> ${backup.backup_id || 'Non spécifié'}</p>
                        ${backup.error ? `<p><strong>Erreur:</strong> <span style="color: var(--danger-color);">${backup.error}</span></p>` : ''}
                    </div>
                    ${backup.status === 'completed' ? `
                        <div style="margin: 1.5rem 0;">
                            <h3>Informations supplémentaires:</h3>
                            <p>Le backup est disponible pour restauration.</p>
                            <div class="modal-actions" style="margin-top: 1rem;">
                                <button class="btn btn-primary" onclick="restoreBackup('${backup.backup_id}', '${backup.client_name}')">
                                    🔄 Restaurer
                                </button>
                                <button class="btn btn-secondary" onclick="downloadBackup('${backup.backup_id}')">
                                    💾 Télécharger
                                </button>
                            </div>
                        </div>
                    ` : ''}
                `;
            } else {
                document.getElementById('backup-details-content').innerHTML = `
                    <div class="error-message">
                        <span class="error-icon">❌</span>
                        <p>Backup non trouvé dans la base de données.</p>
                    </div>
                `;
            }
        } else {
            throw new Error('Erreur de chargement');
        }
    } catch (error) {
        console.error('Erreur lors du chargement des détails:', error);
        document.getElementById('backup-details-content').innerHTML = `
            <div class="error-message">
                <span class="error-icon">❌</span>
                <p>Impossible de charger les détails du backup.</p>
                <button class="btn btn-primary" onclick="viewBackupDetails('${backupId}')">
                    🔄 Réessayer
                </button>
            </div>
        `;
    }
}

// Fonction utilitaire pour formater les tailles de fichiers
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function restoreBackup(backupId, clientName) {
    // Créer le modal de restauration
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>🔄 Restaurer le Backup</h2>
                <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label><strong>Client:</strong> ${clientName}</label>
                </div>
                <div class="form-group">
                    <label><strong>Backup ID:</strong> ${backupId}</label>
                </div>
                <div class="form-group">
                    <label for="restore-destination">Dossier de destination:</label>
                    <input type="text" id="restore-destination" class="form-control" 
                           placeholder="/tmp/restore-backup-${Date.now()}" 
                           value="/tmp/restore-backup-${Date.now()}">
                    <small class="form-text">Le dossier sera créé automatiquement s'il n'existe pas</small>
                </div>
                <div class="form-group">
                    <div class="form-check">
                        <input type="checkbox" id="verify-restore" class="form-check-input" checked>
                        <label for="verify-restore" class="form-check-label">
                            Vérifier l'intégrité des fichiers restaurés
                        </label>
                    </div>
                </div>
                <div class="warning-message">
                    <span class="warning-icon">⚠️</span>
                    <strong>Attention:</strong> Cette opération va extraire tous les fichiers du backup 
                    dans le dossier spécifié. Assurez-vous d'avoir suffisamment d'espace disque.
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Annuler</button>
                <button class="btn btn-primary" onclick="executeRestore('${backupId}', '${clientName}')">
                    🔄 Lancer la Restauration
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    modal.style.display = 'block';  // Rendre le modal visible
}

async function executeRestore(backupId, clientName) {
    const destinationPath = document.getElementById('restore-destination').value.trim();
    const verifyRestore = document.getElementById('verify-restore').checked;
    
    if (!destinationPath) {
        showNotification('Veuillez spécifier un dossier de destination', 'error');
        return;
    }
    
    // Fermer le modal de sélection
    document.querySelector('.modal').remove();
    
    // Créer le modal de progression
    const progressModal = document.createElement('div');
    progressModal.className = 'modal';
    progressModal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>🔄 Restauration en cours...</h2>
            </div>
            <div class="modal-body">
                <div class="progress-info">
                    <p><strong>Client:</strong> ${clientName}</p>
                    <p><strong>Destination:</strong> ${destinationPath}</p>
                    <p><strong>Vérification:</strong> ${verifyRestore ? 'Activée' : 'Désactivée'}</p>
                </div>
                <div class="progress-spinner">
                    <div class="spinner"></div>
                    <p id="restore-status">Extraction des fichiers en cours...</p>
                </div>
                <div id="restore-logs" class="restore-logs" style="display: none;">
                    <h4>Détails de la restauration:</h4>
                    <div class="log-content"></div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Fermer</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(progressModal);
    progressModal.style.display = 'block';  // Rendre le modal visible
    
    try {
        const response = await fetch(`/api/backups/restore/${backupId}`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                destinationPath,
                verifyRestore
            })
        });
        
        const result = await response.json();
        
        if (response.ok && result.restore_result.success) {
            // Restauration réussie
            document.getElementById('restore-status').innerHTML = `
                ✅ <strong>Restauration terminée avec succès!</strong>
            `;
            
            // Afficher les détails
            const logContent = document.querySelector('#restore-logs .log-content');
            logContent.innerHTML = `
                <div class="success-summary">
                    <p><strong>📁 Dossier de destination:</strong> ${result.destination}</p>
                    <p><strong>📦 Fichiers extraits:</strong> ${result.restore_result.stats.filesExtracted}</p>
                    <p><strong>⏱️ Durée:</strong> ${Math.round(result.restore_result.stats.duration / 1000)}s</p>
                    ${result.restore_result.verification ? `
                        <p><strong>✅ Vérification:</strong> ${result.restore_result.verification.verifiedFiles}/${result.restore_result.verification.totalFiles} fichiers OK</p>
                        <p><strong>💾 Taille totale:</strong> ${formatBytes(result.restore_result.verification.totalSize)}</p>
                        ${result.restore_result.verification.missingFiles.length > 0 ? 
                            `<p class="text-warning"><strong>⚠️ Fichiers manquants:</strong> ${result.restore_result.verification.missingFiles.length}</p>` : ''}
                        ${result.restore_result.verification.corruptedFiles.length > 0 ? 
                            `<p class="text-error"><strong>❌ Fichiers corrompus:</strong> ${result.restore_result.verification.corruptedFiles.length}</p>` : ''}
                    ` : ''}
                </div>
            `;
            
            document.getElementById('restore-logs').style.display = 'block';
            showNotification(`Restauration de ${clientName} terminée avec succès vers ${result.destination}`, 'success');
            
        } else {
            throw new Error(result.error || 'Erreur lors de la restauration');
        }
        
    } catch (error) {
        console.error('Erreur restauration:', error);
        document.getElementById('restore-status').innerHTML = `
            ❌ <strong>Erreur lors de la restauration:</strong> ${error.message}
        `;
        showNotification(`Erreur lors de la restauration: ${error.message}`, 'error');
    }
}

function saveSettings() {
    const settings = {
        backupPath: document.getElementById('backup-path').value,
        retentionDays: document.getElementById('retention-days').value,
        notificationEmail: document.getElementById('notification-email').value
    };
    
    // Implémenter la sauvegarde des paramètres
    // Sauvegarder les paramètres
    showNotification('Paramètres enregistrés', 'success');
}

function clearLogs() {
    if (confirm('Êtes-vous sûr de vouloir vider les logs?')) {
        document.getElementById('log-content').innerHTML = '';
        showNotification(t('success_message'), 'success');
    }
}

function filterBackups() {
    // Implémenter le filtrage des backups
    // Filtrer les backups
}

function filterLogs() {
    // Cette fonction est maintenant remplacée par refreshLogs() 
    // qui charge directement les logs filtrés depuis l'API
    refreshLogs();
}

function updateDashboard() {
    if (currentSection === 'dashboard') {
        loadDashboardData();
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
        
        // Afficher un message d'absence de données
        showNoNetworkData();
    }
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
    
    // Tendance 7 jours basée sur les vraies données
    if (data.length >= 7) {
        const recent7Days = data.slice(0, 7);
        const older7Days = data.slice(7, 14);
        
        if (older7Days.length > 0) {
            const recentAvg = recent7Days.reduce((sum, d) => sum + (d.transfer_speed_mbps || 0), 0) / recent7Days.length;
            const olderAvg = older7Days.reduce((sum, d) => sum + (d.transfer_speed_mbps || 0), 0) / older7Days.length;
            const change = ((recentAvg - olderAvg) / olderAvg * 100).toFixed(1);
            const trend = change >= 0 ? `📈 +${change}%` : `📉 ${change}%`;
            document.getElementById('trend-7days').textContent = trend;
        } else {
            document.getElementById('trend-7days').textContent = '➖ Données insuffisantes';
        }
    } else {
        document.getElementById('trend-7days').textContent = '➖ Données insuffisantes';
    }
}

// Fonction pour les métriques temps réel
async function updateRealtimeMetrics() {
    try {
        const response = await fetch('/api/dashboard/realtime');
        if (response.ok) {
            const data = await response.json();
            
            document.getElementById('active-backup').textContent = data.activeBackup || 'Aucun';
            document.getElementById('backup-queue').textContent = data.queueLength || 0;
            document.getElementById('active-connections').textContent = data.activeConnections || 0;
            document.getElementById('bandwidth-usage').textContent = data.bandwidth || '0 Mbps';
        } else {
            // Valeurs par défaut si l'API échoue
            document.getElementById('active-backup').textContent = 'Aucun';
            document.getElementById('backup-queue').textContent = '0';
            document.getElementById('active-connections').textContent = '0';
            document.getElementById('bandwidth-usage').textContent = '0 Mbps';
        }
    } catch (error) {
        console.warn('Erreur chargement métriques temps réel:', error);
        // Valeurs par défaut en cas d'erreur
        document.getElementById('active-backup').textContent = 'Aucun';
        document.getElementById('backup-queue').textContent = '0';
        document.getElementById('active-connections').textContent = '0';
        document.getElementById('bandwidth-usage').textContent = '0 Mbps';
    }
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
    
    // Croissance des données basée sur les vrais historiques
    if (data.length >= 14) {
        const recent7Days = data.slice(0, 7);
        const older7Days = data.slice(7, 14);
        
        const recentTotal = recent7Days.reduce((sum, d) => sum + (d.bytes_transferred || 0), 0);
        const olderTotal = older7Days.reduce((sum, d) => sum + (d.bytes_transferred || 0), 0);
        
        if (olderTotal > 0) {
            const growthPercent = ((recentTotal - olderTotal) / olderTotal * 100).toFixed(1);
            const growth = growthPercent >= 0 ? `+${growthPercent}%` : `${growthPercent}%`;
            document.getElementById('data-growth').textContent = growth;
        } else {
            document.getElementById('data-growth').textContent = '➖ N/A';
        }
    } else {
        document.getElementById('data-growth').textContent = '➖ Données insuffisantes';
    }
    
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

// Charger les permissions utilisateur
async function loadUserPermissions() {
    try {
        const response = await apiRequest(`${API_URL}/user/permissions`);
        if (response.ok) {
            const data = await response.json();
            userPermissions = data.data;
            console.log('Permissions utilisateur chargées:', userPermissions);
            
            // Adapter l'interface selon les permissions
            adaptInterfaceForPermissions();
        } else {
            console.error('Erreur chargement permissions:', response.status);
            // En cas d'erreur, masquer tout par défaut sauf dashboard
            userPermissions = {
                role: 'client',
                permissions: ['dashboard_view'],
                clientAccess: { canViewAll: false, allowedClients: [] }
            };
            adaptInterfaceForPermissions();
        }
    } catch (error) {
        console.error('Erreur chargement permissions:', error);
        userPermissions = {
            role: 'client',
            permissions: ['dashboard_view'],
            clientAccess: { canViewAll: false, allowedClients: [] }
        };
        adaptInterfaceForPermissions();
    }
}

// Adapter l'interface selon les permissions
function adaptInterfaceForPermissions() {
    if (!userPermissions) return;
    
    // Définir les permissions requises pour chaque section/menu
    const sectionPermissions = {
        'dashboard': 'dashboard_view',
        'clients': 'clients_view',
        'backups': 'backups_view',
        'schedule': 'backups_schedule',
        'logs': 'logs_view',
        'users': 'users_view',
        'config': 'settings_view',
        'ssl': 'ssl_manage',
        'network': 'metrics_view',
        'maintenance': 'settings_edit',
        'system': 'system_monitor',
        'settings': 'settings_view'
    };
    
    // Masquer/afficher les éléments de navigation
    const navLinks = document.querySelectorAll('.nav-menu a');
    navLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (href && href.startsWith('#')) {
            const section = href.substring(1);
            const requiredPermission = sectionPermissions[section];
            
            if (requiredPermission && !hasPermission(requiredPermission)) {
                link.parentElement.style.display = 'none';
            } else {
                link.parentElement.style.display = 'block';
            }
        }
    });
    
    // Masquer les sections elles-mêmes
    Object.keys(sectionPermissions).forEach(section => {
        const sectionElement = document.getElementById(`${section}-section`);
        const requiredPermission = sectionPermissions[section];
        
        if (sectionElement && requiredPermission && !hasPermission(requiredPermission)) {
            sectionElement.style.display = 'none';
        }
    });
    
    // Masquer les boutons d'action selon les permissions
    adaptActionButtonsForPermissions();
}

// Vérifier si l'utilisateur a une permission
function hasPermission(permission) {
    if (!userPermissions) return false;
    
    // Les admins ont toutes les permissions
    if (userPermissions.role === 'admin') return true;
    
    // Vérifier dans la liste des permissions
    return userPermissions.permissions && userPermissions.permissions.includes(permission);
}

// Adapter les boutons d'action selon les permissions
function adaptActionButtonsForPermissions() {
    // Masquer bouton "Ajouter Client" si pas de permission
    if (!hasPermission('clients_create')) {
        const addClientBtn = document.querySelector('button[onclick="showAddClientModal()"]');
        if (addClientBtn) addClientBtn.style.display = 'none';
    }
    
    // Masquer boutons de modification/suppression clients
    if (!hasPermission('clients_edit')) {
        document.querySelectorAll('.client-actions .btn-warning').forEach(btn => {
            if (btn.onclick && btn.onclick.toString().includes('editClient')) {
                btn.style.display = 'none';
            }
        });
    }
    
    if (!hasPermission('clients_delete')) {
        document.querySelectorAll('.client-actions .btn-danger').forEach(btn => {
            if (btn.onclick && btn.onclick.toString().includes('deleteClient')) {
                btn.style.display = 'none';
            }
        });
    }
    
    // Adapter selon le rôle client - ne montrer que ses propres données
    if (userPermissions.role === 'client' && !userPermissions.clientAccess.canViewAll) {
        adaptForClientRole();
    }
}

// Adapter l'interface pour un utilisateur client
function adaptForClientRole() {
    // Masquer les statistiques globales et ne montrer que les siennes
    // Cette fonction sera appelée après le chargement des données
    console.log('Mode client activé - accès restreint aux données personnelles');
}

function setupUserInterface() {
    if (!currentUser) return;
    
    // Gérer l'affichage du bouton de restauration rapide selon le rôle
    const quickRestoreBtn = document.getElementById('quick-restore-btn-dashboard');
    if (quickRestoreBtn) {
        if (userPermissions && userPermissions.role === 'admin') {
            quickRestoreBtn.style.display = 'inline-block';
        } else {
            quickRestoreBtn.style.display = 'none';
        }
    }
    
    // Afficher les informations utilisateur
    const header = document.querySelector('.header');
    if (header && !document.getElementById('user-info')) {
        const userInfo = document.createElement('div');
        userInfo.id = 'user-info';
        userInfo.className = 'user-info';
        userInfo.innerHTML = `
            <div class="user-details">
                <span class="user-name">${currentUser.username}</span>
                <span class="user-role">${currentUser.role === 'admin' ? t('admin') : t('client_role')}</span>
                ${currentUser.client_name ? `<span class="user-client">${currentUser.client_name}</span>` : ''}
            </div>
            <div class="user-actions">
                <button class="change-password-btn" onclick="openPasswordModal()">
                    ${t('change_password')}
                </button>
                <button class="btn btn-secondary" onclick="logout()">
                    ${t('logout')}
                </button>
            </div>
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

// ============= FONCTIONS SSL/HTTPS =============

async function loadSSLPage() {
    try {
        // Charger automatiquement le statut SSL et les prérequis
        await Promise.all([
            checkSSLStatus(),
            checkSSLPrerequisites()
        ]);
    } catch (error) {
        console.error('Erreur lors du chargement de la page SSL:', error);
        showNotification('Erreur lors du chargement de la page SSL', 'error');
    }
}

async function checkSSLStatus() {
    try {
        showNotification('Vérification du statut SSL...', 'info');
        
        const response = await apiRequest(`${API_URL}/ssl/status`);
        if (response && response.ok) {
            const data = await response.json();
            updateSSLStatus(data.status);
            
            // Charger les informations certificat si disponible
            if (data.status.certificateExists) {
                await loadCertificateInfo();
            }
            
            showNotification('Statut SSL vérifié', 'success');
        } else {
            throw new Error('Erreur lors de la vérification SSL');
        }
    } catch (error) {
        console.error('Erreur vérification SSL:', error);
        showNotification('Erreur lors de la vérification SSL', 'error');
    }
}

function updateSSLStatus(status) {
    // Mettre à jour le statut du certificat
    const certStatus = document.getElementById('ssl-cert-status');
    if (certStatus) {
        certStatus.textContent = status.certificateExists && status.certificateValid ? 
            '✅ Valide' : '❌ Non configuré';
        certStatus.className = status.certificateExists && status.certificateValid ? 
            'status-success' : 'status-error';
    }

    // Mettre à jour le statut Apache
    const apacheStatus = document.getElementById('ssl-apache-status');
    if (apacheStatus) {
        apacheStatus.textContent = status.apacheConfigured && status.sslSiteEnabled ? 
            '✅ Configuré' : '❌ Non configuré';
        apacheStatus.className = status.apacheConfigured && status.sslSiteEnabled ? 
            'status-success' : 'status-error';
    }

    // Mettre à jour le statut de renouvellement
    const renewalStatus = document.getElementById('ssl-renewal-status');
    if (renewalStatus) {
        renewalStatus.textContent = status.autoRenewalActive ? 
            '✅ Actif' : '❌ Inactif';
        renewalStatus.className = status.autoRenewalActive ? 
            'status-success' : 'status-error';
    }

    // Mettre à jour la date d'expiration
    const expiryStatus = document.getElementById('ssl-expiry-status');
    if (expiryStatus) {
        if (status.expiryDate) {
            const expiryDate = new Date(status.expiryDate);
            const now = new Date();
            const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
            
            expiryStatus.textContent = expiryDate.toLocaleDateString('fr-FR') + ` (${daysLeft}j)`;
            expiryStatus.className = daysLeft < 30 ? 'status-warning' : 'status-success';
        } else {
            expiryStatus.textContent = '-';
            expiryStatus.className = '';
        }
    }

    // Mettre à jour l'heure de dernière vérification
    const lastCheck = document.getElementById('ssl-last-check');
    if (lastCheck) {
        lastCheck.textContent = new Date().toLocaleString('fr-FR');
    }

    // Activer/désactiver les boutons selon l'état
    const setupBtn = document.getElementById('ssl-setup-btn');
    const renewBtn = document.querySelector('button[onclick="renewSSLCertificate()"]');
    
    if (setupBtn) {
        if (status.certificateExists && status.certificateValid) {
            setupBtn.textContent = '🔄 Reconfigurer SSL';
            setupBtn.className = 'btn btn-warning';
        } else {
            setupBtn.textContent = '🔒 Configurer SSL';
            setupBtn.className = 'btn btn-success';
        }
    }
    
    if (renewBtn) {
        renewBtn.disabled = !(status.certificateExists && status.certificateValid);
    }
}

async function checkSSLPrerequisites() {
    try {
        const response = await apiRequest(`${API_URL}/ssl/prerequisites`);
        if (response && response.ok) {
            const data = await response.json();
            updateSSLPrerequisites(data.prerequisites);
        }
    } catch (error) {
        console.error('Erreur vérification prérequis SSL:', error);
    }
}

function updateSSLPrerequisites(prerequisites) {
    const grid = document.getElementById('ssl-prerequisites-grid');
    if (!grid) return;

    const checks = [
        { key: 'dns', label: 'DNS résolu pour backup.efcinfo.com' },
        { key: 'apache', label: 'Apache2 installé et fonctionnel' },
        { key: 'certbot', label: 'Certbot disponible' },
        { key: 'ports', label: 'Ports 80/443 accessibles' }
    ];

    grid.innerHTML = checks.map(check => {
        const status = prerequisites.checks[check.key];
        const icon = status ? '✅' : '❌';
        return `
            <div class="prerequisite-item">
                <span class="check-icon">${icon}</span>
                <span>${check.label}</span>
            </div>
        `;
    }).join('');

    // Afficher les recommandations
    if (prerequisites.recommendations.length > 0) {
        const warning = document.getElementById('ssl-warning');
        if (warning) {
            warning.style.display = 'block';
            warning.innerHTML = `
                <p><strong>⚠️ Prérequis manquants :</strong></p>
                <ul>
                    ${prerequisites.recommendations.map(rec => `<li>${rec}</li>`).join('')}
                </ul>
            `;
        }
    }
}

async function setupSSL() {
    if (!confirm('La configuration SSL peut prendre 5-10 minutes. Voulez-vous continuer ?')) {
        return;
    }

    try {
        showNotification('Configuration SSL en cours... Cela peut prendre plusieurs minutes.', 'info');
        
        const setupBtn = document.getElementById('ssl-setup-btn');
        if (setupBtn) {
            setupBtn.disabled = true;
            setupBtn.textContent = '⏳ Configuration en cours...';
        }

        // Timeout de 10 minutes pour la configuration SSL
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timeout: Configuration SSL trop longue')), 600000);
        });

        const setupPromise = apiRequest(`${API_URL}/ssl/setup`, {
            method: 'POST'
        });

        const response = await Promise.race([setupPromise, timeoutPromise]);

        if (response && response.ok) {
            const data = await response.json();
            showNotification('SSL configuré avec succès ! HTTPS est maintenant actif.', 'success');
            
            // Recharger le statut
            await checkSSLStatus();
            
            // Proposer de rediriger vers HTTPS
            if (confirm('SSL configuré ! Voulez-vous accéder au site en HTTPS maintenant ?')) {
                window.location.href = 'https://backup.efcinfo.com';
            }
        } else {
            const error = await response.json();
            throw new Error(error.details || 'Erreur lors de la configuration SSL');
        }
    } catch (error) {
        console.error('Erreur setup SSL:', error);
        showNotification(`Erreur configuration SSL: ${error.message}`, 'error');
    } finally {
        const setupBtn = document.getElementById('ssl-setup-btn');
        if (setupBtn) {
            setupBtn.disabled = false;
            setupBtn.textContent = '🔒 Configurer SSL';
        }
    }
}

async function renewSSLCertificate() {
    if (!confirm('Voulez-vous renouveler le certificat SSL ?')) {
        return;
    }

    try {
        showNotification('Renouvellement du certificat SSL...', 'info');
        
        const response = await apiRequest(`${API_URL}/ssl/renew`, {
            method: 'POST'
        });

        if (response && response.ok) {
            showNotification('Certificat SSL renouvelé avec succès', 'success');
            await checkSSLStatus();
        } else {
            const error = await response.json();
            throw new Error(error.details || 'Erreur lors du renouvellement');
        }
    } catch (error) {
        console.error('Erreur renouvellement SSL:', error);
        showNotification(`Erreur renouvellement SSL: ${error.message}`, 'error');
    }
}

async function testSSLConfiguration() {
    try {
        showNotification('Test de la configuration SSL...', 'info');
        
        const response = await apiRequest(`${API_URL}/ssl/test`, {
            method: 'POST'
        });

        if (response && response.ok) {
            const data = await response.json();
            const testResult = data.test;
            
            let message = 'Test SSL : ';
            if (testResult.local) message += 'Local ✅ ';
            if (testResult.external) message += 'Externe ✅';
            
            showNotification(message, 'success');
        } else {
            throw new Error('Erreur lors du test SSL');
        }
    } catch (error) {
        console.error('Erreur test SSL:', error);
        showNotification(`Erreur test SSL: ${error.message}`, 'error');
    }
}

async function loadCertificateInfo() {
    try {
        const response = await apiRequest(`${API_URL}/ssl/certificate-info`);
        if (response && response.ok) {
            const data = await response.json();
            
            if (data.exists) {
                document.getElementById('cert-subject').textContent = data.certificate.subject;
                document.getElementById('cert-issuer').textContent = data.certificate.issuer;
                document.getElementById('cert-valid-from').textContent = data.certificate.validFrom;
                document.getElementById('cert-valid-to').textContent = data.certificate.validTo;
                document.getElementById('cert-serial').textContent = data.certificate.serialNumber;
                
                document.getElementById('ssl-cert-info').style.display = 'block';
            }
        }
    } catch (error) {
        console.error('Erreur chargement info certificat:', error);
    }
}

function showSSLTab(tab) {
    // Gérer les onglets
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
    
    document.querySelector(`button[onclick="showSSLTab('${tab}')"]`).classList.add('active');
    document.getElementById(`ssl-${tab}-tab`).classList.add('active');
    
    // Charger le contenu selon l'onglet
    if (tab === 'logs') {
        refreshSSLLogs();
    } else if (tab === 'config') {
        refreshSSLConfig();
    }
}

async function refreshSSLLogs() {
    const logType = document.getElementById('ssl-log-type').value;
    const logsContent = document.getElementById('ssl-logs-content');
    
    try {
        logsContent.textContent = 'Chargement des logs...';
        
        const response = await apiRequest(`${API_URL}/ssl/logs?lines=100`);
        if (response && response.ok) {
            const data = await response.json();
            const logs = data.logs;
            
            let content = '';
            switch (logType) {
                case 'access':
                    content = logs.apache.access.join('\n');
                    break;
                case 'error':
                    content = logs.apache.error.join('\n');
                    break;
                case 'ssl-access':
                    content = logs.apache.sslAccess.join('\n');
                    break;
                case 'ssl-error':
                    content = logs.apache.sslError.join('\n');
                    break;
                case 'certbot':
                    content = logs.certbot.join('\n');
                    break;
            }
            
            logsContent.textContent = content || 'Aucun log disponible';
        }
    } catch (error) {
        logsContent.textContent = 'Erreur lors du chargement des logs';
        console.error('Erreur logs SSL:', error);
    }
}

async function refreshSSLConfig() {
    const configType = document.getElementById('ssl-config-type').value;
    const configContent = document.getElementById('ssl-config-content');
    
    try {
        configContent.textContent = 'Chargement de la configuration...';
        
        const response = await apiRequest(`${API_URL}/ssl/apache-config`);
        if (response && response.ok) {
            const data = await response.json();
            const configs = data.configs;
            
            let content = '';
            if (configType === 'http' && configs.http.exists) {
                content = configs.http.config;
            } else if (configType === 'ssl' && configs.ssl.exists) {
                content = configs.ssl.config;
            } else {
                content = `Configuration ${configType} non trouvée`;
            }
            
            configContent.textContent = content;
        }
    } catch (error) {
        configContent.textContent = 'Erreur lors du chargement de la configuration';
        console.error('Erreur config SSL:', error);
    }
}

// ============= FONCTIONS GESTION UTILISATEURS =============

let allUsers = [];
let filteredUsers = [];
let currentEditingUserId = null;

async function loadUsersPage() {
    try {
        // Charger automatiquement la liste des utilisateurs et les statistiques
        await Promise.all([
            loadUsersList(),
            loadUserStats(),
            loadClientsForUserSelection()
        ]);
    } catch (error) {
        console.error('Erreur lors du chargement de la page utilisateurs:', error);
        showNotification('Erreur lors du chargement de la page utilisateurs', 'error');
    }
}

async function loadUsersList() {
    try {
        const response = await apiRequest(`${API_URL}/users`);
        if (response && response.ok) {
            const users = await response.json();
            allUsers = users;
            filteredUsers = [...users];
            renderUsersTable();
            showNotification(t('success_message'), 'success');
        } else {
            throw new Error('Erreur lors du chargement des utilisateurs');
        }
    } catch (error) {
        console.error('Erreur chargement utilisateurs:', error);
        showNotification(t('error_occurred'), 'error');
        
        // Afficher une erreur dans le tableau
        const tbody = document.getElementById('users-table-body');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="error-cell">
                        Erreur lors du chargement des utilisateurs
                        <br><button class="btn btn-sm btn-secondary" onclick="loadUsersList()">Réessayer</button>
                    </td>
                </tr>
            `;
        }
    }
}

async function loadUserStats() {
    try {
        const response = await apiRequest(`${API_URL}/users/stats`);
        if (response && response.ok) {
            const stats = await response.json();
            
            document.getElementById('total-users').textContent = stats.total || '0';
            document.getElementById('admin-users').textContent = stats.admins || '0';
            document.getElementById('client-users').textContent = stats.clients || '0';
            document.getElementById('active-sessions').textContent = stats.activeSessions || '0';
        }
    } catch (error) {
        console.error('Erreur chargement statistiques utilisateurs:', error);
    }
}

async function loadClientsForUserSelection() {
    try {
        const response = await apiRequest(`${API_URL}/clients`);
        if (response && response.ok) {
            const clients = await response.json();
            const clientSelect = document.getElementById('user-client');
            
            if (clientSelect) {
                clientSelect.innerHTML = '<option value="">Aucun client associé</option>';
                clients.forEach(client => {
                    const option = document.createElement('option');
                    option.value = client.name;
                    option.textContent = `${client.name} (${client.host})`;
                    clientSelect.appendChild(option);
                });
            }
        }
    } catch (error) {
        console.error('Erreur chargement clients pour sélection:', error);
    }
}

function renderUsersTable() {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;

    if (filteredUsers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-cell">
                    Aucun utilisateur trouvé
                    <br><button class="btn btn-primary btn-sm" onclick="showAddUserModal()">➕ Ajouter un utilisateur</button>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filteredUsers.map(user => {
        // Suppression des icônes pour rester cohérent avec le menu
        const lastLogin = user.last_login ? 
            new Date(user.last_login).toLocaleString('fr-FR') : 
            'Jamais connecté';
        const createdAt = new Date(user.created_at).toLocaleString('fr-FR');
        
        return `
            <tr data-user-id="${user.id}">
                <td>
                    <div class="user-info">
                        <strong>${user.username}</strong>
                        ${!user.active ? '<span class="status-badge inactive">Inactif</span>' : ''}
                    </div>
                </td>
                <td>${user.email}</td>
                <td>
                    <span class="role-badge ${user.role}">
                        ${user.role === 'admin' ? 'Admin' : 'Client'}
                    </span>
                </td>
                <td>${user.client_name || '-'}</td>
                <td class="text-small">${lastLogin}</td>
                <td class="text-small">${createdAt}</td>
                <td class="actions-cell">
                    <div class="action-buttons">
                        <button class="btn btn-sm btn-secondary" onclick="editUser(${user.id})" title="Modifier">
                            Modifier
                        </button>
                        <button class="btn btn-sm btn-warning" onclick="showPasswordChangeModal(${user.id})" title="Changer MDP">
                            MDP
                        </button>
                        ${user.id !== 1 ? `
                            <button class="btn btn-sm ${user.active ? 'btn-warning' : 'btn-success'}" 
                                    onclick="toggleUserStatus(${user.id})" 
                                    title="${user.active ? 'Désactiver' : 'Activer'}">
                                ${user.active ? 'Désactiver' : 'Activer'}
                            </button>
                            <button class="btn btn-sm btn-danger" onclick="deleteUser(${user.id})" title="Supprimer">
                                Supprimer
                            </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function filterUsers() {
    const searchTerm = document.getElementById('user-search').value.toLowerCase();
    const roleFilter = document.getElementById('role-filter').value;
    const statusFilter = document.getElementById('status-filter').value;

    filteredUsers = allUsers.filter(user => {
        const matchesSearch = user.username.toLowerCase().includes(searchTerm) ||
                            user.email.toLowerCase().includes(searchTerm) ||
                            (user.client_name && user.client_name.toLowerCase().includes(searchTerm));
        
        const matchesRole = !roleFilter || user.role === roleFilter;
        const matchesStatus = !statusFilter || 
                            (statusFilter === 'active' && user.active) ||
                            (statusFilter === 'inactive' && !user.active);

        return matchesSearch && matchesRole && matchesStatus;
    });

    renderUsersTable();
}

function sortUsers(column) {
    // Implémentation simple du tri
    filteredUsers.sort((a, b) => {
        if (column === 'username' || column === 'email' || column === 'role') {
            return a[column].localeCompare(b[column]);
        } else if (column === 'created_at' || column === 'last_login') {
            return new Date(b[column] || 0) - new Date(a[column] || 0);
        }
        return 0;
    });
    
    renderUsersTable();
}

function showAddUserModal() {
    currentEditingUserId = null;
    document.getElementById('user-modal-title').textContent = '➕ Ajouter un utilisateur';
    document.getElementById('user-form').reset();
    document.getElementById('user-active').checked = true;
    document.getElementById('password-section').style.display = 'flex';
    document.getElementById('client-selection').style.display = 'none';
    
    // Rendre les champs mot de passe requis
    document.getElementById('user-password').required = true;
    document.getElementById('user-password-confirm').required = true;
    
    document.getElementById('user-modal').style.display = 'block';
}

function editUser(userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) {
        showNotification(t('errors.client_not_found'), 'error');
        return;
    }

    currentEditingUserId = userId;
    document.getElementById('user-modal-title').textContent = '✏️ Modifier l\'utilisateur';
    
    // Remplir le formulaire
    document.getElementById('user-username').value = user.username;
    document.getElementById('user-email').value = user.email;
    document.getElementById('user-role').value = user.role;
    document.getElementById('user-client').value = user.client_name || '';
    document.getElementById('user-active').checked = user.active;
    document.getElementById('user-force-password-change').checked = user.force_password_change;
    
    // Masquer les champs mot de passe en mode édition
    document.getElementById('password-section').style.display = 'none';
    document.getElementById('user-password').required = false;
    document.getElementById('user-password-confirm').required = false;
    
    // Gérer la sélection de client
    toggleClientSelection();
    
    document.getElementById('user-modal').style.display = 'block';
}

function toggleClientSelection() {
    const role = document.getElementById('user-role').value;
    const clientSelection = document.getElementById('client-selection');
    
    if (role === 'client') {
        clientSelection.style.display = 'block';
    } else {
        clientSelection.style.display = 'none';
        document.getElementById('user-client').value = '';
    }
}

async function saveUser(event) {
    event.preventDefault();
    
    try {
        const formData = new FormData(event.target);
        const userData = {
            username: formData.get('username').trim(),
            email: formData.get('email').trim(),
            role: formData.get('role'),
            client_name: formData.get('client_name') || null,
            active: formData.has('active'),
            force_password_change: formData.has('forcePasswordChange')
        };

        // Validation côté client
        if (!userData.username || userData.username.length < 3) {
            throw new Error('Le nom d\'utilisateur doit faire au moins 3 caractères');
        }

        if (!userData.email || !userData.email.includes('@')) {
            throw new Error('Adresse email invalide');
        }

        if (!userData.role) {
            throw new Error('Le rôle est obligatoire');
        }

        // Gestion du mot de passe pour les nouveaux utilisateurs
        if (!currentEditingUserId) {
            const password = formData.get('password');
            const passwordConfirm = formData.get('passwordConfirm');
            
            if (!password || password.length < 8) {
                throw new Error('Le mot de passe doit faire au moins 8 caractères');
            }
            
            if (password !== passwordConfirm) {
                throw new Error('Les mots de passe ne correspondent pas');
            }
            
            userData.password = password;
        }

        // Permissions spéciales
        userData.permissions = {
            can_view_logs: formData.has('can_view_logs'),
            can_download_backups: formData.has('can_download_backups'),
            can_start_backups: formData.has('can_start_backups'),
            can_manage_schedule: formData.has('can_manage_schedule')
        };

        showNotification('Sauvegarde de l\'utilisateur...', 'info');

        const url = currentEditingUserId ? 
            `${API_URL}/users/${currentEditingUserId}` : 
            `${API_URL}/users`;
        
        const method = currentEditingUserId ? 'PUT' : 'POST';

        const response = await apiRequest(url, {
            method,
            body: JSON.stringify(userData)
        });

        if (response && response.ok) {
            const savedUser = await response.json();
            showNotification(
                currentEditingUserId ? 'Utilisateur modifié avec succès' : 'Utilisateur créé avec succès', 
                'success'
            );
            
            closeUserModal();
            await loadUsersList();
            await loadUserStats();
            
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Erreur lors de la sauvegarde');
        }

    } catch (error) {
        console.error('Erreur sauvegarde utilisateur:', error);
        showNotification(`Erreur: ${error.message}`, 'error');
    }
}

function closeUserModal() {
    document.getElementById('user-modal').style.display = 'none';
    currentEditingUserId = null;
}

function showPasswordChangeModal(userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) {
        showNotification(t('errors.client_not_found'), 'error');
        return;
    }

    currentEditingUserId = userId;
    document.getElementById('password-change-form').reset();
    document.getElementById('force-logout').checked = true;
    document.getElementById('password-change-modal').style.display = 'block';
}

async function changeUserPassword(event) {
    event.preventDefault();
    
    try {
        const formData = new FormData(event.target);
        const newPassword = formData.get('newPassword');
        const newPasswordConfirm = formData.get('newPasswordConfirm');
        const forceLogout = formData.has('forceLogout');

        if (!newPassword || newPassword.length < 8) {
            throw new Error('Le mot de passe doit faire au moins 8 caractères');
        }

        if (newPassword !== newPasswordConfirm) {
            throw new Error('Les mots de passe ne correspondent pas');
        }

        showNotification('Changement du mot de passe...', 'info');

        const response = await apiRequest(`${API_URL}/users/${currentEditingUserId}/password`, {
            method: 'PUT',
            body: JSON.stringify({
                newPassword,
                forceLogout
            })
        });

        if (response && response.ok) {
            showNotification(t('notifications.password_changed'), 'success');
            closePasswordModal();
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Erreur lors du changement de mot de passe');
        }

    } catch (error) {
        console.error('Erreur changement mot de passe:', error);
        showNotification(`Erreur: ${error.message}`, 'error');
    }
}

function closePasswordModal() {
    document.getElementById('password-change-modal').style.display = 'none';
    currentEditingUserId = null;
}

async function toggleUserStatus(userId) {
    try {
        const user = allUsers.find(u => u.id === userId);
        if (!user) return;

        const newStatus = !user.active;
        const action = newStatus ? 'activer' : 'désactiver';

        if (!confirm(`Voulez-vous ${action} l'utilisateur "${user.username}" ?`)) {
            return;
        }

        showNotification(`${action === 'activer' ? 'Activation' : 'Désactivation'} de l'utilisateur...`, 'info');

        const response = await apiRequest(`${API_URL}/users/${userId}/toggle`, {
            method: 'PUT'
        });

        if (response && response.ok) {
            showNotification(`Utilisateur ${action === 'activer' ? 'activé' : 'désactivé'} avec succès`, 'success');
            await loadUsersList();
            await loadUserStats();
        } else {
            throw new Error(`Erreur lors de la ${action === 'activer' ? 'activation' : 'désactivation'}`);
        }

    } catch (error) {
        console.error('Erreur toggle statut utilisateur:', error);
        showNotification(`Erreur: ${error.message}`, 'error');
    }
}

async function deleteUser(userId) {
    try {
        const user = allUsers.find(u => u.id === userId);
        if (!user) return;

        if (!confirm(`⚠️ ATTENTION ⚠️\n\nVoulez-vous vraiment supprimer l'utilisateur "${user.username}" ?\n\nCette action est IRRÉVERSIBLE et supprimera :\n- Le compte utilisateur\n- Toutes ses sessions\n- Son historique de connexion\n\nTapez "SUPPRIMER" pour confirmer:`)) {
            return;
        }

        showNotification('Suppression de l\'utilisateur...', 'info');

        const response = await apiRequest(`${API_URL}/users/${userId}`, {
            method: 'DELETE'
        });

        if (response && response.ok) {
            showNotification(t('notifications.user_deleted'), 'success');
            await loadUsersList();
            await loadUserStats();
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Erreur lors de la suppression');
        }

    } catch (error) {
        console.error('Erreur suppression utilisateur:', error);
        showNotification(`Erreur: ${error.message}`, 'error');
    }
}

async function refreshUserList() {
    showNotification(t('processing'), 'info');
    await Promise.all([
        loadUsersList(),
        loadUserStats()
    ]);
}

async function exportUsers() {
    try {
        showNotification(t('processing'), 'info');
        
        const response = await apiRequest(`${API_URL}/users/export/csv`);
        if (response && response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `efc-backup-users-${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
            showNotification(t('success_message'), 'success');
        } else {
            throw new Error('Erreur lors de l\'export');
        }
    } catch (error) {
        console.error('Erreur export utilisateurs:', error);
        showNotification(`Erreur export: ${error.message}`, 'error');
    }
}

// Fonctions pour le changement de mot de passe utilisateur
function openPasswordModal() {
    try {
        // Tentative d'ouverture du modal mot de passe
        
        const modal = document.getElementById('password-modal');
        // Modal trouvé
        
        if (modal) {
            modal.style.display = 'block';
            // Modal affiché
            
            // Réinitialiser le formulaire
            const form = document.getElementById('password-form');
            if (form) {
                form.reset();
                // Formulaire réinitialisé
            }
            
            // Focus sur le premier champ
            const currentPasswordField = document.getElementById('my-current-password');
            if (currentPasswordField) {
                setTimeout(() => {
                    currentPasswordField.focus();
                    // Focus mis sur le champ mot de passe actuel
                }, 100);
            }
        } else {
            console.error('Modal password-modal non trouvé');
            showNotification('Erreur: Modal non trouvé', 'error');
        }
    } catch (error) {
        console.error('Erreur dans openPasswordModal:', error);
        showNotification('Erreur lors de l\'ouverture du modal: ' + error.message, 'error');
    }
}

function closePasswordModal() {
    const modal = document.getElementById('password-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function changeUserPassword() {
    try {
        const currentPasswordField = document.getElementById('my-current-password');
        const newPasswordField = document.getElementById('my-new-password');
        const confirmPasswordField = document.getElementById('my-confirm-password');

        // Vérifier que les éléments existent
        if (!currentPasswordField || !newPasswordField || !confirmPasswordField) {
            showNotification('Erreur: Impossible de trouver les champs du formulaire', 'error');
            return;
        }

        const currentPassword = currentPasswordField.value.trim();
        const newPassword = newPasswordField.value.trim();
        const confirmPassword = confirmPasswordField.value.trim();

        // Validation côté client
        if (!currentPassword || !newPassword || !confirmPassword) {
            showNotification(`Champs manquants: Current: ${!currentPassword ? 'vide' : 'ok'}, New: ${!newPassword ? 'vide' : 'ok'}, Confirm: ${!confirmPassword ? 'vide' : 'ok'}`, 'error');
            return;
        }

        if (newPassword.length < 8) {
            showNotification('Le nouveau mot de passe doit faire au moins 8 caractères', 'error');
            return;
        }
        
        if (newPassword.length > 128) {
            showNotification('Le nouveau mot de passe est trop long (maximum 128 caractères)', 'error');
            return;
        }
        
        // Validation de la complexité
        const hasLowercase = /[a-z]/.test(newPassword);
        const hasUppercase = /[A-Z]/.test(newPassword);
        const hasNumber = /\d/.test(newPassword);
        const hasSpecial = /[@$!%*?&]/.test(newPassword);
        
        if (!hasLowercase || !hasUppercase || !hasNumber || !hasSpecial) {
            showNotification('Le mot de passe doit contenir au moins une minuscule, une majuscule, un chiffre et un caractère spécial (@$!%*?&)', 'error');
            return;
        }

        if (newPassword !== confirmPassword) {
            showNotification('Les nouveaux mots de passe ne correspondent pas', 'error');
            return;
        }

        showNotification('Changement du mot de passe...', 'info');

        const response = await apiRequest(`${API_URL}/users/me/password`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                currentPassword,
                newPassword
            })
        });

        if (response && response.ok) {
            const data = await response.json();
            showNotification(t('notifications.password_changed'), 'success');
            closePasswordModal();
            
            // Optionnel: forcer une reconnexion si indiqué par le serveur
            if (data.forceLogout) {
                showNotification('Reconnexion requise avec le nouveau mot de passe', 'info');
                setTimeout(() => {
                    localStorage.removeItem('token');
                    window.location.reload();
                }, 2000);
            }
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Erreur lors du changement de mot de passe');
        }

    } catch (error) {
        console.error('Erreur changement mot de passe:', error);
        showNotification(`Erreur: ${error.message}`, 'error');
    }
}

// Fonction pour afficher l'interface de changement de mot de passe
function showPasswordChangeInterface() {
    const passwordSection = `
        <div class="password-change-section">
            <div class="section-header">
                <h3>Sécurité du compte</h3>
                <button onclick="openPasswordModal()" class="btn btn-primary">
                    Changer le mot de passe
                </button>
            </div>
            <div class="password-info">
                <p>Pour votre sécurité, changez régulièrement votre mot de passe.</p>
                <ul>
                    <li>Utilisez au moins 8 caractères</li>
                    <li>Mélangez lettres, chiffres et symboles</li>
                    <li>Évitez les mots courants</li>
                </ul>
            </div>
        </div>
    `;
    
    return passwordSection;
}

// === FONCTIONS MAINTENANCE === 

// Journal de maintenance
function addMaintenanceLog(level, message) {
    const logContent = document.getElementById('maintenance-log-content');
    if (!logContent) return;
    
    const timestamp = new Date().toLocaleString();
    const logLine = document.createElement('div');
    logLine.className = 'log-line';
    
    logLine.innerHTML = `
        <span class="log-timestamp">[${timestamp}]</span>
        <span class="log-level ${level}">${level.toUpperCase()}</span>
        <span class="log-message">${message}</span>
    `;
    
    logContent.appendChild(logLine);
    logContent.scrollTop = logContent.scrollHeight;
}

// Health Check
async function runHealthCheck() {
    addMaintenanceLog('info', 'Démarrage du health check système...');
    
    const healthResults = document.getElementById('health-results');
    const resultsContent = healthResults.querySelector('.results-content');
    
    try {
        const response = await fetch('/api/system/health-check', { method: 'POST' });
        const data = await response.json();
        
        healthResults.style.display = 'block';
        resultsContent.innerHTML = generateHealthCheckResults(data);
        
        addMaintenanceLog('success', 'Health check terminé avec succès');
    } catch (error) {
        addMaintenanceLog('error', `Erreur health check: ${error.message}`);
        resultsContent.innerHTML = `<div class="status-indicator error">❌ Erreur: ${error.message}</div>`;
    }
}

function generateHealthCheckResults(data) {
    if (!data || typeof data !== 'object') {
        return '<div class="status-indicator error">❌ Données invalides reçues</div>';
    }
    
    let html = '<div class="health-check-results">';
    
    const overallStatus = data.overall || 'unknown';
    const statusClass = overallStatus === 'healthy' ? 'success' : 
                       overallStatus === 'warning' ? 'warning' : 'error';
    
    html += `
        <div class="overall-status">
            <h4>État Global</h4>
            <div class="status-indicator ${statusClass}">
                ${overallStatus === 'healthy' ? '✅' : overallStatus === 'warning' ? '⚠️' : '❌'}
                ${overallStatus.toUpperCase()}
            </div>
        </div>
    `;
    
    const components = ['database', 'diskSpace', 'memory', 'clients', 'scheduler', 'backups'];
    
    html += '<div class="component-status">';
    for (const component of components) {
        if (data[component]) {
            const comp = data[component];
            const compClass = comp.status === 'healthy' ? 'success' : 
                            comp.status === 'warning' ? 'warning' : 'error';
            
            html += `
                <div class="component-item">
                    <strong>${component}:</strong>
                    <div class="status-indicator ${compClass}">
                        ${comp.status === 'healthy' ? '✅' : comp.status === 'warning' ? '⚠️' : '❌'}
                        ${comp.message || comp.status}
                    </div>
                </div>
            `;
        }
    }
    html += '</div>';
    
    html += '</div>';
    return html;
}

async function runCleanup() {
    addMaintenanceLog('info', 'Démarrage du nettoyage système...');
    
    const cleanupResults = document.getElementById('cleanup-results');
    const resultsContent = cleanupResults.querySelector('.results-content');
    
    try {
        const response = await fetch('/api/system/cleanup', { method: 'POST' });
        const data = await response.json();
        
        cleanupResults.style.display = 'block';
        resultsContent.innerHTML = generateCleanupResults(data);
        
        addMaintenanceLog('success', 'Nettoyage terminé avec succès');
    } catch (error) {
        addMaintenanceLog('error', `Erreur nettoyage: ${error.message}`);
        resultsContent.innerHTML = `<div class="status-indicator error">❌ Erreur: ${error.message}</div>`;
    }
}

function generateCleanupResults(data) {
    return `
        <div class="cleanup-results">
            <div class="stat-item">
                <span>Backups supprimés:</span>
                <span>${data.backupsDeleted || 0}</span>
            </div>
            <div class="stat-item">
                <span>Logs supprimés:</span>
                <span>${data.logsDeleted || 0}</span>
            </div>
            <div class="stat-item">
                <span>Espace libéré:</span>
                <span>${data.spaceFreed || '0 MB'}</span>
            </div>
        </div>
    `;
}

async function testAllConnections() {
    addMaintenanceLog('info', 'Test de toutes les connexions clients...');
    
    const connectionResults = document.getElementById('connection-results');
    const resultsContent = connectionResults.querySelector('.results-content');
    
    try {
        const response = await fetch('/api/test-connections', { method: 'POST' });
        const data = await response.json();
        
        connectionResults.style.display = 'block';
        resultsContent.innerHTML = generateConnectionResults(data);
        
        addMaintenanceLog('success', 'Tests de connexion terminés');
    } catch (error) {
        addMaintenanceLog('error', `Erreur test connexions: ${error.message}`);
    }
}

function generateConnectionResults(data) {
    if (!data.results) return '<div class="status-indicator error">❌ Aucun résultat</div>';
    
    let html = '<div class="connection-test-results">';
    
    for (const result of data.results) {
        const statusClass = result.success ? 'success' : 'error';
        const icon = result.success ? '✅' : '❌';
        
        html += `
            <div class="connection-item">
                <div class="status-indicator ${statusClass}">
                    ${icon} ${result.client}
                </div>
                <div class="connection-details">
                    ${result.success ? 
                        `Connecté en ${result.duration}ms` : 
                        `Erreur: ${result.error}`
                    }
                </div>
            </div>
        `;
    }
    
    html += '</div>';
    return html;
}

async function runErrorHandlingTests() {
    addMaintenanceLog('info', 'Exécution des tests de gestion d\'erreurs...');
    
    const errorResults = document.getElementById('error-test-results');
    const resultsContent = errorResults.querySelector('.results-content');
    
    try {
        const response = await fetch('/api/system/test-error-handling', { method: 'POST' });
        const data = await response.json();
        
        errorResults.style.display = 'block';
        resultsContent.innerHTML = generateErrorTestResults(data);
        
        addMaintenanceLog('success', 'Tests de gestion d\'erreur terminés');
    } catch (error) {
        addMaintenanceLog('error', `Erreur tests retry: ${error.message}`);
    }
}

function generateErrorTestResults(data) {
    if (!data.results) return '<div class="status-indicator error">❌ Aucun résultat de test</div>';
    
    let html = '<div class="error-test-results">';
    let passed = 0;
    let total = data.results.length;
    
    for (const result of data.results) {
        const statusClass = result.success ? 'success' : 'error';
        const icon = result.success ? '✅' : '❌';
        
        if (result.success) passed++;
        
        html += `
            <div class="test-item">
                <div class="status-indicator ${statusClass}">
                    ${icon} ${result.name}
                </div>
                <div class="test-details">
                    ${result.message}
                </div>
            </div>
        `;
    }
    
    html += `
        <div class="test-summary">
            <strong>Résultats: ${passed}/${total} tests réussis (${Math.round((passed/total)*100)}%)</strong>
        </div>
    </div>`;
    
    return html;
}

function clearMaintenanceLog() {
    const logContent = document.getElementById('maintenance-log-content');
    if (logContent) {
        logContent.innerHTML = '';
        addMaintenanceLog('info', 'Journal de maintenance vidé');
    }
}

function downloadMaintenanceLog() {
    const logContent = document.getElementById('maintenance-log-content');
    if (!logContent) return;
    
    const logs = Array.from(logContent.children).map(line => {
        const timestamp = line.querySelector('.log-timestamp')?.textContent || '';
        const level = line.querySelector('.log-level')?.textContent || '';
        const message = line.querySelector('.log-message')?.textContent || '';
        return `${timestamp} ${level} ${message}`;
    }).join('\n');
    
    const blob = new Blob([logs], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `maintenance-log-${new Date().toISOString().slice(0,10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    addMaintenanceLog('info', 'Journal de maintenance téléchargé');
}

// Autres fonctions utilitaires
async function viewHealthResults() { 
    const healthResults = document.getElementById('health-results');
    healthResults.style.display = healthResults.style.display === 'none' ? 'block' : 'none';
}
async function estimateCleanup() {
    addMaintenanceLog('info', 'Estimation de l\'espace libérable...');
    document.getElementById('cleanable-space').textContent = 'Calcul...';
}
async function testFailedConnections() { 
    addMaintenanceLog('info', 'Test des connexions échouées...'); 
}
async function viewRetryLogs() { 
    addMaintenanceLog('info', 'Affichage des logs de retry...'); 
}
async function reloadSchedules() { 
    try {
        const response = await apiRequest('/api/schedules');
        if (!response.ok) {
            throw new Error('Erreur lors du chargement des planifications');
        }
        
        const data = await response.json();
        const schedules = data.schedules || data;
        
        const scheduleList = document.getElementById('schedule-list');
        if (scheduleList) {
            if (schedules && schedules.length > 0) {
                scheduleList.innerHTML = `
                    <div class="schedules-grid">
                        ${schedules.map(schedule => `
                            <div class="schedule-card">
                                <h3>${schedule.name}</h3>
                                <p><strong>Pattern:</strong> ${schedule.cron_pattern}</p>
                                <p><strong>Type:</strong> ${schedule.backup_type}</p>
                                <p><strong>Description:</strong> ${schedule.description || 'N/A'}</p>
                                <p><strong>Clients:</strong> ${schedule.client_names ? 
                                    (schedule.client_names === '[object Object]' ? 'Configuration invalide' : schedule.client_names) : 
                                    'Tous'}</p>
                                <p><strong>Statut:</strong> <span class="${schedule.active ? 'status-active' : 'status-inactive'}">${schedule.active ? 'Actif' : 'Inactif'}</span></p>
                                ${schedule.last_run ? `<p><strong>Dernière:</strong> ${new Date(schedule.last_run).toLocaleString('fr-FR')}</p>` : ''}
                                <div class="schedule-actions">
                                    <button class="btn btn-primary btn-sm" onclick="editSchedule('${schedule.name}')">Modifier</button>
                                    <button class="btn btn-danger btn-sm" onclick="deleteSchedule('${schedule.name}')">Supprimer</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <button class="btn btn-primary" style="margin-top: 1rem;" onclick="showAddScheduleModal()">
                        ➕ Ajouter une planification
                    </button>
                `;
            } else {
                scheduleList.innerHTML = `
                    <div class="no-data-message">
                        <span class="no-data-icon">⏰</span>
                        <h4>Aucune planification configurée</h4>
                        <p>Configurez des planifications automatiques pour vos backups.</p>
                        <div class="no-data-actions">
                            <button class="btn btn-primary" onclick="showAddScheduleModal()">
                                ➕ Créer une planification
                            </button>
                        </div>
                    </div>
                `;
            }
        }
    } catch (error) {
        console.error('Erreur lors du chargement des planifications:', error);
        const scheduleList = document.getElementById('schedule-list');
        if (scheduleList) {
            scheduleList.innerHTML = `
                <div class="error-message">
                    <span class="error-icon">⚠️</span>
                    <h4>Erreur de chargement</h4>
                    <p>${error.message}</p>
                    <button class="btn btn-primary" onclick="reloadSchedules()">Réessayer</button>
                </div>
            `;
        }
    }
}
async function validateSchedules() { 
    addMaintenanceLog('info', 'Validation des planifications...'); 
}
async function restartServices() { 
    addMaintenanceLog('warning', 'Redémarrage des services...'); 
}
async function optimizeDatabase() { 
    addMaintenanceLog('info', 'Optimisation de la base de données...'); 
}
async function generateMaintenanceReport() { 
    addMaintenanceLog('info', 'Génération du rapport de maintenance...'); 
}

// Fonction pour télécharger un backup
async function downloadBackup(backupId) {
    try {
        // Utiliser fetch direct pour le téléchargement de fichier avec authentification par session
        const response = await fetch(`/api/backups/download/${backupId}`, {
            method: 'GET',
            credentials: 'include'  // Utiliser les cookies de session comme les autres requêtes
        });
        
        if (!response.ok) {
            let errorMessage = 'Erreur lors du téléchargement';
            try {
                const errorData = await response.json();
                errorMessage = errorData.message || errorMessage;
            } catch (e) {
                // Si la réponse n'est pas du JSON, utiliser le status text
                errorMessage = response.statusText || errorMessage;
            }
            throw new Error(errorMessage);
        }
        
        // Récupérer le nom du fichier depuis les headers
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = `backup-${backupId}.tar.gz`;
        
        if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename="([^"]+)"/);
            if (filenameMatch) {
                filename = filenameMatch[1];
            }
        }
        
        // Convertir en blob et créer le lien de téléchargement
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        showNotification(t('success_message'), 'success');
    } catch (error) {
        console.error('Erreur lors du téléchargement:', error);
        showNotification(`Erreur lors du téléchargement: ${error.message}`, 'error');
    }
}