'use strict';

const Homey = require('homey');
const MontaAPI = require('./lib/MontaAPI');

module.exports = class MontaApp extends Homey.App {

  async onInit() {
    this.log('Monta App is initializing...');

    // Create an instance of the MontaAPI class diretly in the App
    // We send this.homey so MontaAPI can use Homey's logging and settings
    this.api = new MontaAPI(this.homey);

    // Retrieve and set API credentials from Homey settings
    this.updateApiCredentials();

    // Listen for changes in username or password settings
    // If changed, update the MontaAPI instance with new credentials
    this.homey.settings.on('set', (key) => {
      if (key === 'username' || key === 'password') {
        this.log(`Setting '${key}' changed, updating API credentials...`);
        this.updateApiCredentials();
      }
    });

    this.log('Monta App has been initialized');
  }

  /**
   * Fetch credentials from Homey settings and update the MontaAPI instance.
   */
  updateApiCredentials() {
    const clientId = this.homey.settings.get('username');
    const clientSecret = this.homey.settings.get('password');

    if (clientId && clientSecret) {
      this.log('Updating API credentials...');
      // Set credentials in the MontaAPI instance
      this.api.setCredentials(clientId, clientSecret);
    } else {
      this.log('API Credentials not yet configured by user.');
    }
  }
};