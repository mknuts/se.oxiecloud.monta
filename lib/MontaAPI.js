'use strict';

class MontaAPI {
    constructor(homey) {
        this.homey = homey;
        this.baseUrl = 'https://public-api.monta.com/api/v1';
        
        // auth-data 
        this.accessToken = null;
        this.refreshToken = null;
        this.expiresAt = null;
        
        // Credentials from app settings
        this.clientId = null;
        this.clientSecret = null;
    }

    /**
     * Uppdate credentials and reset current session.
     * Called from från app.js when settings changes
     */
    setCredentials(clientId, clientSecret) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.accessToken = null;
        this.refreshToken = null;
        this.expiresAt = null;
        console.log('MontaAPI: Credentials updated and tokens cleared.');
    }

    async authenticate(url, bodyContent) {
        const payload = {
            method: 'POST',
            headers: { 
                'accept': 'application/json',
                'content-type': 'application/json' 
            },
            body: JSON.stringify(bodyContent)
        };

        const response = await fetch(url, payload);
        const data = await response.json();

        if (!response.ok) {
            this.accessToken = null;
            throw new Error(`Auth failed: ${JSON.stringify(data)}`);
        }

        // Save data on class instance (this)
        this.accessToken = data.accessToken;
        this.refreshToken = data.refreshToken;
        this.expiresAt = new Date(data.accessTokenExpirationDate);

        console.log(`New access token fetched, expires: ${this.expiresAt.toLocaleString()}`);
        return this.accessToken;  
    }

    async getAuthToken() {
        // If we don't have a token do a full authentication
        if (!this.accessToken) {
            // Fetch credentials (if we don´t have them already)
            const clientId = this.clientId || this.homey.settings.get('username');
            const clientSecret = this.clientSecret || this.homey.settings.get('password');

            if (!clientId || !clientSecret) {
                throw new Error('Missing Monta API credentials. Please check App Settings.');
            }

            console.log('No valid token. Authenticating with Client ID...');
            return await this.authenticate(`${this.baseUrl}/auth/token`, { clientId, clientSecret });
        }

        // Check if token is about to expire (1 minute bufer).
        const now = new Date();
        const buffer = 60 * 1000; 

        if (now.getTime() + buffer >= this.expiresAt.getTime()) {
            console.log('Token almost expired, refreshing...');
            try {
                return await this.authenticate(`${this.baseUrl}/auth/refresh`, { refreshToken: this.refreshToken });
            } catch (e) {
                console.log('Refresh failed, retrying with full login...');
                this.accessToken = null;
                return this.getAuthToken();
            }
        }

        return this.accessToken;
    }

    async montaFetch(endpoint, method = "GET", body = null) {
        const token = await this.getAuthToken();
        
        const options = {
            method: method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'accept': 'application/json',
                'Content-Type': 'application/json'
            }
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(`${this.baseUrl}${endpoint}`, options);

        if (response.status === 401) {
            console.log('Got 401, clearing token and retrying...');
            this.accessToken = null;
            return this.montaFetch(endpoint, method, body);
        }

        // Handle empty answers(ex. 204 No Content)
        if (response.status === 204) return {};

        return response.json();
    }
}

module.exports = MontaAPI;