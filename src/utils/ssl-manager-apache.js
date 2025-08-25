const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const { logger } = require('./logger');
const { getSetting, setSetting } = require('./database');

class ApacheSSLManager {
    constructor() {
        this.domain = 'backup.efcinfo.com';
        this.certPath = '/etc/letsencrypt/live/' + this.domain;
        this.certbotPath = 'certbot'; // ou '/usr/bin/certbot'
        this.apacheConfigPath = '/etc/apache2/sites-available/efc-backup.conf';
        this.apacheSSLConfigPath = '/etc/apache2/sites-available/efc-backup-ssl.conf';
        this.apacheSymlinkPath = '/etc/apache2/sites-enabled/efc-backup.conf';
        this.apacheSSLSymlinkPath = '/etc/apache2/sites-enabled/efc-backup-ssl.conf';
    }

    /**
     * Configuration complète SSL avec Let's Encrypt pour Apache
     */
    async setupSSL() {
        try {
            logger.info('🔒 Début de la configuration SSL Apache pour backup.efcinfo.com');

            // 1. Vérifier les prérequis
            await this.checkPrerequisites();

            // 2. Configurer Apache (HTTP initial)
            await this.configureApache();

            // 3. Obtenir le certificat Let's Encrypt
            const certResult = await this.obtainSSLCertificate();

            // 4. Configurer Apache avec SSL
            await this.configureApacheSSL();

            // 5. Activer le renouvellement automatique
            await this.setupAutoRenewal();

            // 6. Tester la configuration
            const testResult = await this.testSSLConfiguration();

            logger.info('✅ Configuration SSL Apache terminée avec succès');

            return {
                success: true,
                certificate: certResult,
                apache: true,
                autoRenewal: true,
                test: testResult
            };

        } catch (error) {
            logger.error('❌ Erreur lors de la configuration SSL Apache:', error);
            throw error;
        }
    }

    /**
     * Vérifier les prérequis système pour Apache
     */
    async checkPrerequisites() {
        logger.info('Vérification des prérequis SSL Apache...');

        // Vérifier que le domaine pointe vers ce serveur
        await this.checkDNSConfiguration();

        // Vérifier que Apache est installé
        await this.checkApacheInstallation();

        // Vérifier que Certbot est installé
        await this.checkCertbotInstallation();

        // Activer les modules Apache nécessaires
        await this.enableApacheModules();

        // Vérifier les ports 80 et 443
        await this.checkPorts();

        logger.info('✅ Prérequis SSL Apache vérifiés');
    }

    async checkDNSConfiguration() {
        try {
            return new Promise((resolve, reject) => {
                const nslookup = spawn('nslookup', [this.domain]);
                let output = '';

                nslookup.stdout.on('data', (data) => {
                    output += data.toString();
                });

                nslookup.on('close', (code) => {
                    if (code === 0) {
                        logger.info(`DNS résolu pour ${this.domain}`, { output });
                        resolve(true);
                    } else {
                        reject(new Error(`DNS non résolu pour ${this.domain}`));
                    }
                });
            });

        } catch (error) {
            logger.warn('Impossible de vérifier le DNS, continuons...', error);
        }
    }

    async checkApacheInstallation() {
        try {
            await this.runCommand('apache2', ['-v']);
            logger.info('✅ Apache2 est installé');
        } catch (error) {
            logger.info('📦 Installation d\'Apache2...');
            await this.runCommand('apt', ['update']);
            await this.runCommand('apt', ['install', '-y', 'apache2']);
            logger.info('✅ Apache2 installé');
        }
    }

    async checkCertbotInstallation() {
        try {
            await this.runCommand('certbot', ['--version']);
            logger.info('✅ Certbot est installé');
        } catch (error) {
            logger.info('📦 Installation de Certbot...');
            await this.runCommand('apt', ['update']);
            await this.runCommand('apt', ['install', '-y', 'certbot', 'python3-certbot-apache']);
            logger.info('✅ Certbot installé');
        }
    }

    async enableApacheModules() {
        logger.info('Activation des modules Apache nécessaires...');

        const modulesToEnable = [
            'ssl',
            'rewrite',
            'proxy',
            'proxy_http',
            'headers'
        ];

        for (const module of modulesToEnable) {
            try {
                await this.runCommand('a2enmod', [module]);
                logger.info(`✅ Module ${module} activé`);
            } catch (error) {
                logger.warn(`Module ${module} déjà activé ou erreur:`, error.message);
            }
        }

        // Redémarrer Apache pour charger les modules
        await this.runCommand('systemctl', ['restart', 'apache2']);
        logger.info('✅ Apache redémarré avec les nouveaux modules');
    }

    async checkPorts() {
        const portsToCheck = [80, 443];
        
        for (const port of portsToCheck) {
            try {
                await this.runCommand('lsof', ['-i', `:${port}`]);
                logger.info(`Port ${port} en cours d'utilisation (Apache probablement)`);
            } catch (error) {
                logger.info(`Port ${port} disponible`);
            }
        }
    }

    /**
     * Configurer Apache initial (HTTP seulement) - S'intègre à l'existant
     */
    async configureApache() {
        logger.info('Configuration initiale d\'Apache (intégration à l\'existant)...');

        const apacheConfig = this.generateApacheConfigHTTP();

        try {
            await fs.writeFile(this.apacheConfigPath, apacheConfig);
            logger.info(`Configuration Apache écrite dans ${this.apacheConfigPath}`);

            // NE PAS désactiver les sites existants - juste ajouter le nôtre
            logger.info('Préservation des sites Apache existants');

            // Activer notre site
            await this.runCommand('a2ensite', ['efc-backup.conf']);
            logger.info('Site EFC Backup activé (sans perturber les sites existants)');

            // Tester la configuration avant de recharger
            await this.runCommand('apache2ctl', ['configtest']);
            await this.runCommand('systemctl', ['reload', 'apache2']);

            logger.info('✅ Apache configuré et rechargé (sites existants préservés)');

        } catch (error) {
            logger.error('Erreur configuration Apache:', error);
            throw error;
        }
    }

    /**
     * Obtenir le certificat SSL Let's Encrypt pour Apache
     */
    async obtainSSLCertificate() {
        logger.info(`🔐 Obtention du certificat SSL pour ${this.domain} (Apache)...`);

        try {
            const certbotArgs = [
                'certonly',
                '--apache',
                '--non-interactive',
                '--agree-tos',
                '--email', 'erick@efcinfo.com',
                '--domains', this.domain
            ];

            const result = await this.runCommand('certbot', certbotArgs);
            
            logger.info('✅ Certificat SSL obtenu avec succès', { result });

            // Vérifier que les fichiers de certificat existent
            await this.verifyCertificateFiles();

            return {
                success: true,
                domain: this.domain,
                certPath: this.certPath,
                obtainedAt: new Date().toISOString()
            };

        } catch (error) {
            logger.error('❌ Erreur lors de l\'obtention du certificat:', error);
            throw new Error(`Impossible d'obtenir le certificat SSL: ${error.message}`);
        }
    }

    async verifyCertificateFiles() {
        const requiredFiles = [
            path.join(this.certPath, 'fullchain.pem'),
            path.join(this.certPath, 'privkey.pem')
        ];

        for (const file of requiredFiles) {
            try {
                await fs.access(file);
                logger.info(`✅ Fichier certificat trouvé: ${file}`);
            } catch (error) {
                throw new Error(`Fichier certificat manquant: ${file}`);
            }
        }
    }

    /**
     * Configurer Apache avec SSL
     */
    async configureApacheSSL() {
        logger.info('Configuration Apache avec SSL...');

        const apacheConfigSSL = this.generateApacheConfigSSL();

        try {
            await fs.writeFile(this.apacheSSLConfigPath, apacheConfigSSL);
            logger.info('Configuration Apache SSL écrite');

            // Activer le site SSL
            await this.runCommand('a2ensite', ['efc-backup-ssl.conf']);

            // Tester et recharger Apache
            await this.runCommand('apache2ctl', ['configtest']);
            await this.runCommand('systemctl', ['reload', 'apache2']);

            logger.info('✅ Apache configuré avec SSL');

        } catch (error) {
            logger.error('Erreur configuration Apache SSL:', error);
            throw error;
        }
    }

    /**
     * Configurer le renouvellement automatique
     */
    async setupAutoRenewal() {
        logger.info('Configuration du renouvellement automatique...');

        try {
            // Vérifier que le service de renouvellement automatique est actif
            await this.runCommand('systemctl', ['enable', 'certbot.timer']);
            await this.runCommand('systemctl', ['start', 'certbot.timer']);

            // Ajouter un hook pour recharger Apache après renouvellement
            const renewalHook = `#!/bin/bash
apache2ctl configtest && systemctl reload apache2
`;

            const hookPath = '/etc/letsencrypt/renewal-hooks/deploy/reload-apache.sh';
            await fs.writeFile(hookPath, renewalHook);
            await this.runCommand('chmod', ['+x', hookPath]);

            logger.info('✅ Renouvellement automatique configuré');

            // Tester le renouvellement (dry-run)
            try {
                await this.runCommand('certbot', ['renew', '--dry-run']);
                logger.info('✅ Test de renouvellement réussi');
            } catch (error) {
                logger.warn('Test de renouvellement échoué:', error);
            }

        } catch (error) {
            logger.error('Erreur configuration renouvellement:', error);
            throw error;
        }
    }

    /**
     * Tester la configuration SSL
     */
    async testSSLConfiguration() {
        logger.info('Test de la configuration SSL...');

        try {
            // Test local
            const localTest = await this.runCommand('curl', [
                '-k', '-I', `https://localhost:443`,
                '--connect-timeout', '10'
            ]);

            logger.info('✅ Test SSL local réussi');

            // Test externe (si possible)
            try {
                const externalTest = await this.runCommand('curl', [
                    '-I', `https://${this.domain}`,
                    '--connect-timeout', '10'
                ]);
                logger.info('✅ Test SSL externe réussi');
            } catch (error) {
                logger.warn('Test SSL externe échoué (normal si DNS non configuré)');
            }

            return {
                local: true,
                external: false, // Assumé false si DNS pas configuré
                testDate: new Date().toISOString()
            };

        } catch (error) {
            logger.error('Erreur test SSL:', error);
            throw error;
        }
    }

    /**
     * Générer la configuration Apache HTTP (pour l'obtention du certificat)
     * S'intègre aux sites existants via ServerName spécifique
     */
    generateApacheConfigHTTP() {
        return `# Configuration initiale EFC Backup System (HTTP) - Apache
# S'intègre aux sites existants via ServerName backup.efcinfo.com
<VirtualHost *:80>
    ServerName ${this.domain}
    # Pas de DocumentRoot pour éviter les conflits

    # Let's Encrypt validation seulement pour ce domaine
    Alias "/.well-known/acme-challenge/" "/var/www/html/.well-known/acme-challenge/"
    <Directory "/var/www/html/.well-known/acme-challenge/">
        Options None
        AllowOverride None
        Require all granted
    </Directory>

    # Proxy vers l'application EFC Backup seulement pour backup.efcinfo.com
    ProxyPreserveHost On
    ProxyRequests Off
    
    # Exclure Let's Encrypt du proxy
    ProxyPass /.well-known/acme-challenge/ !
    
    # Proxy toutes les autres requêtes vers Node.js
    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/

    # Logs spécifiques pour EFC Backup
    LogLevel warn
    ErrorLog \${APACHE_LOG_DIR}/efc-backup-error.log
    CustomLog \${APACHE_LOG_DIR}/efc-backup-access.log combined
</VirtualHost>
`;
    }

    /**
     * Générer la configuration Apache avec SSL
     * Mise à jour de la config HTTP existante + ajout HTTPS
     */
    generateApacheConfigSSL() {
        return `# Configuration SSL EFC Backup System - Apache
# S'intègre aux sites existants

# HTTP VirtualHost modifié - Redirection HTTPS pour backup.efcinfo.com seulement
<VirtualHost *:80>
    ServerName ${this.domain}
    
    # Redirection HTTPS obligatoire SEULEMENT pour backup.efcinfo.com
    RewriteEngine On
    RewriteCond %{HTTP_HOST} ^${this.domain}$ [NC]
    RewriteCond %{HTTPS} !=on
    RewriteRule ^/?(.*) https://%{SERVER_NAME}/$1 [R=301,L]
    
    # Let's Encrypt validation toujours accessible
    Alias "/.well-known/acme-challenge/" "/var/www/html/.well-known/acme-challenge/"
    <Directory "/var/www/html/.well-known/acme-challenge/">
        Options None
        AllowOverride None
        Require all granted
    </Directory>

    # Proxy pour backup.efcinfo.com seulement (si pas de redirection HTTPS)
    ProxyPreserveHost On
    ProxyRequests Off
    ProxyPass /.well-known/acme-challenge/ !
    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/

    # Logs spécifiques pour EFC Backup
    ErrorLog \${APACHE_LOG_DIR}/efc-backup-error.log
    CustomLog \${APACHE_LOG_DIR}/efc-backup-access.log combined
</VirtualHost>

# HTTPS VirtualHost - NOUVEAU
<VirtualHost *:443>
    ServerName ${this.domain}

    # Certificats SSL Let's Encrypt
    SSLEngine on
    SSLCertificateFile ${this.certPath}/fullchain.pem
    SSLCertificateKeyFile ${this.certPath}/privkey.pem

    # Configuration SSL moderne et sécurisée
    SSLProtocol all -SSLv3 -TLSv1 -TLSv1.1
    SSLCipherSuite ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384
    SSLHonorCipherOrder off
    SSLSessionTickets off

    # Sécurité supplémentaire
    Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
    Header always set X-Frame-Options DENY
    Header always set X-Content-Type-Options nosniff
    Header always set X-XSS-Protection "1; mode=block"
    Header always set Referrer-Policy "strict-origin-when-cross-origin"

    # Configuration du proxy vers l'application EFC Backup
    ProxyPreserveHost On
    ProxyRequests Off
    
    # Support WebSocket pour les mises à jour en temps réel
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule /(.*) ws://localhost:3000/$1 [P,L]
    
    # Proxy vers Node.js
    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/
    
    # Timeouts
    ProxyTimeout 300
    
    # Taille maximale des uploads
    LimitRequestBody 104857600  # 100MB

    # Logs spécifiques SSL
    LogLevel warn
    ErrorLog \${APACHE_LOG_DIR}/efc-backup-ssl-error.log
    CustomLog \${APACHE_LOG_DIR}/efc-backup-ssl-access.log combined
</VirtualHost>
`;
    }

    /**
     * Obtenir le statut SSL actuel pour Apache
     */
    async getSSLStatus() {
        try {
            const status = {
                certificateExists: false,
                certificateValid: false,
                apacheConfigured: false,
                sslSiteEnabled: false,
                autoRenewalActive: false,
                expiryDate: null
            };

            // Vérifier l'existence du certificat
            try {
                await fs.access(path.join(this.certPath, 'fullchain.pem'));
                status.certificateExists = true;

                // Vérifier la validité et la date d'expiration
                const certInfo = await this.runCommand('openssl', [
                    'x509', '-in', path.join(this.certPath, 'fullchain.pem'),
                    '-noout', '-dates'
                ]);

                status.certificateValid = true;
                
                // Extraire la date d'expiration
                const expiryMatch = certInfo.match(/notAfter=(.+)/);
                if (expiryMatch) {
                    status.expiryDate = new Date(expiryMatch[1]).toISOString();
                }

            } catch (error) {
                // Certificat n'existe pas ou invalide
            }

            // Vérifier la configuration Apache
            try {
                await fs.access(this.apacheSSLConfigPath);
                status.apacheConfigured = true;
            } catch (error) {
                // Configuration Apache SSL n'existe pas
            }

            // Vérifier que le site SSL est activé
            try {
                await fs.access('/etc/apache2/sites-enabled/efc-backup-ssl.conf');
                status.sslSiteEnabled = true;
            } catch (error) {
                // Site SSL non activé
            }

            // Vérifier le renouvellement automatique
            try {
                const timerStatus = await this.runCommand('systemctl', ['is-active', 'certbot.timer']);
                status.autoRenewalActive = timerStatus.trim() === 'active';
            } catch (error) {
                // Timer non actif
            }

            return status;

        } catch (error) {
            logger.error('Erreur lors de la vérification du statut SSL Apache:', error);
            throw error;
        }
    }

    /**
     * Renouveler manuellement le certificat
     */
    async renewCertificate() {
        try {
            logger.info('🔄 Renouvellement manuel du certificat SSL...');

            const result = await this.runCommand('certbot', ['renew', '--force-renewal']);
            
            // Recharger Apache
            await this.runCommand('systemctl', ['reload', 'apache2']);

            logger.info('✅ Certificat renouvelé avec succès');

            return {
                success: true,
                renewedAt: new Date().toISOString(),
                result
            };

        } catch (error) {
            logger.error('❌ Erreur lors du renouvellement:', error);
            throw error;
        }
    }

    /**
     * Utilitaire pour exécuter des commandes shell
     */
    async runCommand(command, args = [], options = {}) {
        return new Promise((resolve, reject) => {
            const child = spawn(command, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                ...options
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`Command failed with code ${code}: ${stderr}`));
                }
            });

            child.on('error', (error) => {
                reject(error);
            });
        });
    }
}

// Instance singleton
const apacheSSLManager = new ApacheSSLManager();

module.exports = {
    apacheSSLManager,
    ApacheSSLManager
};