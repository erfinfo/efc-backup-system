const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const { logger } = require('./logger');
const { getSetting, setSetting } = require('./database');

class SSLManager {
    constructor() {
        this.domain = 'backup.efcinfo.com';
        this.certPath = '/etc/letsencrypt/live/' + this.domain;
        this.certbotPath = 'certbot'; // ou '/usr/bin/certbot'
        this.nginxConfigPath = '/etc/nginx/sites-available/efc-backup';
        this.nginxSymlinkPath = '/etc/nginx/sites-enabled/efc-backup';
    }

    /**
     * Configuration complète SSL avec Let's Encrypt
     */
    async setupSSL() {
        try {
            logger.info('🔒 Début de la configuration SSL pour backup.efcinfo.com');

            // 1. Vérifier les prérequis
            await this.checkPrerequisites();

            // 2. Configurer Nginx
            await this.configureNginx();

            // 3. Obtenir le certificat Let's Encrypt
            const certResult = await this.obtainSSLCertificate();

            // 4. Configurer Nginx avec SSL
            await this.configureNginxSSL();

            // 5. Activer le renouvellement automatique
            await this.setupAutoRenewal();

            // 6. Tester la configuration
            const testResult = await this.testSSLConfiguration();

            logger.info('✅ Configuration SSL terminée avec succès');

            return {
                success: true,
                certificate: certResult,
                nginx: true,
                autoRenewal: true,
                test: testResult
            };

        } catch (error) {
            logger.error('❌ Erreur lors de la configuration SSL:', error);
            throw error;
        }
    }

    /**
     * Vérifier les prérequis système
     */
    async checkPrerequisites() {
        logger.info('Vérification des prérequis SSL...');

        // Vérifier que le domaine pointe vers ce serveur
        await this.checkDNSConfiguration();

        // Vérifier que Nginx est installé
        await this.checkNginxInstallation();

        // Vérifier que Certbot est installé
        await this.checkCertbotInstallation();

        // Vérifier les ports 80 et 443
        await this.checkPorts();

        logger.info('✅ Prérequis SSL vérifiés');
    }

    async checkDNSConfiguration() {
        try {
            const { spawn } = require('child_process');
            
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

    async checkNginxInstallation() {
        try {
            await this.runCommand('nginx', ['-v']);
            logger.info('✅ Nginx est installé');
        } catch (error) {
            logger.info('📦 Installation de Nginx...');
            await this.runCommand('apt', ['update']);
            await this.runCommand('apt', ['install', '-y', 'nginx']);
            logger.info('✅ Nginx installé');
        }
    }

    async checkCertbotInstallation() {
        try {
            await this.runCommand('certbot', ['--version']);
            logger.info('✅ Certbot est installé');
        } catch (error) {
            logger.info('📦 Installation de Certbot...');
            await this.runCommand('apt', ['update']);
            await this.runCommand('apt', ['install', '-y', 'certbot', 'python3-certbot-nginx']);
            logger.info('✅ Certbot installé');
        }
    }

    async checkPorts() {
        // Vérifier que les ports 80 et 443 sont disponibles
        const portsToCheck = [80, 443];
        
        for (const port of portsToCheck) {
            try {
                await this.runCommand('lsof', ['-i', `:${port}`]);
                logger.info(`Port ${port} en cours d'utilisation`);
            } catch (error) {
                logger.info(`Port ${port} disponible`);
            }
        }
    }

    /**
     * Configurer Nginx initial (HTTP seulement)
     */
    async configureNginx() {
        logger.info('Configuration initiale de Nginx...');

        const nginxConfig = this.generateNginxConfigHTTP();

        try {
            await fs.writeFile(this.nginxConfigPath, nginxConfig);
            logger.info(`Configuration Nginx écrite dans ${this.nginxConfigPath}`);

            // Créer le lien symbolique
            try {
                await fs.unlink(this.nginxSymlinkPath);
            } catch (error) {
                // Le lien n'existe pas, c'est normal
            }

            await fs.symlink(this.nginxConfigPath, this.nginxSymlinkPath);
            logger.info('Lien symbolique Nginx créé');

            // Tester et recharger Nginx
            await this.runCommand('nginx', ['-t']);
            await this.runCommand('systemctl', ['reload', 'nginx']);

            logger.info('✅ Nginx configuré et rechargé');

        } catch (error) {
            logger.error('Erreur configuration Nginx:', error);
            throw error;
        }
    }

    /**
     * Obtenir le certificat SSL Let's Encrypt
     */
    async obtainSSLCertificate() {
        logger.info(`🔐 Obtention du certificat SSL pour ${this.domain}...`);

        try {
            const certbotArgs = [
                'certonly',
                '--nginx',
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
     * Configurer Nginx avec SSL
     */
    async configureNginxSSL() {
        logger.info('Configuration Nginx avec SSL...');

        const nginxConfigSSL = this.generateNginxConfigSSL();

        try {
            await fs.writeFile(this.nginxConfigPath, nginxConfigSSL);
            logger.info('Configuration Nginx SSL écrite');

            // Tester et recharger Nginx
            await this.runCommand('nginx', ['-t']);
            await this.runCommand('systemctl', ['reload', 'nginx']);

            logger.info('✅ Nginx configuré avec SSL');

        } catch (error) {
            logger.error('Erreur configuration Nginx SSL:', error);
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

            // Ajouter un hook pour recharger Nginx après renouvellement
            const renewalHook = `#!/bin/bash
nginx -t && systemctl reload nginx
`;

            const hookPath = '/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh';
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
     * Générer la configuration Nginx HTTP (pour l'obtention du certificat)
     */
    generateNginxConfigHTTP() {
        return `# Configuration initiale EFC Backup System (HTTP)
server {
    listen 80;
    server_name ${this.domain};

    # Let's Encrypt validation
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Redirection temporaire vers le serveur EFC Backup
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`;
    }

    /**
     * Générer la configuration Nginx avec SSL
     */
    generateNginxConfigSSL() {
        return `# Configuration SSL EFC Backup System
server {
    listen 80;
    server_name ${this.domain};
    
    # Redirection HTTPS obligatoire
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${this.domain};

    # Certificats SSL Let's Encrypt
    ssl_certificate ${this.certPath}/fullchain.pem;
    ssl_certificate_key ${this.certPath}/privkey.pem;
    
    # Configuration SSL moderne et sécurisée
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # Sécurité supplémentaire
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Referrer-Policy "strict-origin-when-cross-origin";
    
    # Taille maximale des uploads
    client_max_body_size 100M;
    
    # Proxy vers l'application EFC Backup
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Port $server_port;
        
        # WebSocket support pour les mises à jour en temps réel
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Logs spécifiques
    access_log /var/log/nginx/efc-backup-access.log;
    error_log /var/log/nginx/efc-backup-error.log;
}
`;
    }

    /**
     * Obtenir le statut SSL actuel
     */
    async getSSLStatus() {
        try {
            const status = {
                certificateExists: false,
                certificateValid: false,
                nginxConfigured: false,
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

            // Vérifier la configuration Nginx
            try {
                await fs.access(this.nginxConfigPath);
                status.nginxConfigured = true;
            } catch (error) {
                // Configuration Nginx n'existe pas
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
            logger.error('Erreur lors de la vérification du statut SSL:', error);
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
            
            // Recharger Nginx
            await this.runCommand('systemctl', ['reload', 'nginx']);

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
const sslManager = new SSLManager();

module.exports = {
    sslManager,
    SSLManager
};