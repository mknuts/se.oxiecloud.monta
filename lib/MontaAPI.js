const Homey = require('homey');

let authData = {
            accessToken: null,
            refreshToken: null,
            expiresAt: null // Will be stored as a date object
    };

class MontaAPI {
    constructor(homey) {
        this.homey = homey;
        this.baseUrl = 'https://public-api.monta.com/api/v1';
        this.accessToken = null;
        
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
        console.log(`Authentication response: ${JSON.stringify(data)}`);

        if (!response.ok) {
            authData = { accessToken: null, refreshToken: null, expiresAt: null };
            throw new Error(`Auth failed: ${JSON.stringify(data)}`);
        }

        // Uppdated for Monta API response structure
        authData = {
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
            // Convert expiration date string to Date object
            expiresAt: new Date(data.accessTokenExpirationDate) 
        };

        console.log(`New acces token fetched, will expire: ${authData.expiresAt.toLocaleString()}`);
        return authData.accessToken;  
    }
  
    async getAuthToken() {
        
        
        if (!authData.accessToken) {
            let clientId = this.homey.app.clientId;
            let clientSecret = this.homey.app.clientSecret;
            console.log('No valid token will authenticate with clientId and clientSecret...');
            const url = this.baseUrl+'/auth/token';
            return await this.authenticate(url, { clientId, clientSecret });
        }
        // Check if token is about to expire in the next minute
        // We add a buffer of 60 seconds to avoid edge cases
        const now = new Date();
        const buffer = 60 * 1000; 

        if (now.getTime() + buffer >= authData.expiresAt.getTime()) {
            console.log('Token almost expired, will use refresh token...');
            const url = this.baseUrl+'/auth/refresh';
            return await this.authenticate(url, { refreshToken: authData.refreshToken });
        } else {
            //console.log('Token is valid.');
        }

        return authData.accessToken;
    }
    // Wrapper for Monta API
    async montaFetch(endpoint, method = "GET", body = null) {
        const token = await this.getAuthToken();
        
        // Prepare settings for fetch
        const options = {
            method: method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'accept': 'application/json',
                'Content-Type': 'application/json'
            }
        };
        //console.log(`Monta Fetch: ${method} ${endpoint}`);
        if (body) {

            options.body = JSON.stringify(body);
        }
        //console.log(this.baseUrl+`${endpoint} with options: ${JSON.stringify(options)}`);
        const response = await fetch(this.baseUrl+`${endpoint}`, options);


        if (response.status === 401) {
            // If we get an 401 (should not happen) clear token and try again 
            authData.accessToken = null;
            return this.montaFetch(endpoint);
        }

        return response.json();
  }
  
}

module.exports = MontaAPI;