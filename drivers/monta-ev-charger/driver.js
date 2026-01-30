'use strict';

const Homey = require('homey');
let authData = {
    accessToken: null,
    refreshToken: null,
    expiresAt: null // Will be stored as a date object
};

module.exports = class MontaDriver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('Monta EV Charger driver has been initialized');
  }

  async onPair(session) {
    // Get credentials from app settings
    const username = this.homey.settings.get('username');
    const password = this.homey.settings.get('password');

    // Check if username and password are set
    if (!username || !password) {
      // If not, throw an error to inform the user
      throw new Error(this.homey.__('error.missing_settings_pair'));
    }

    session.setHandler("list_devices", async () => {
      this.log(`Attempting to list devices using stored App Settings for: ${username}`);

      try {
        // We assume that app.js has already authenticated and stored tokens
        const points = await this.homey.app.api.montaFetch('/charge-points');
        
        if (!points || !points.data) {
          throw new Error(this.homey.__('error.no_data_received'));
        }

        // Map devices. Note that we dont save username/password here
        return points.data.map(point => {
          return {
            name: point.name || `Monta Charger (${point.id})`,
            data: {
              id: String(point.id),
            },
            settings: {
              // We only store the charger ID in device settings (ID comes from the API and is the uniqe ID for this charger in Montas database)
              charger_id: String(point.id),
              poll_interval: 30 
            },
          };
        });
      } catch (error) {
        this.error('Error during list_devices:', error.message);
        throw new Error(this.homey.__('error.api_connection_failed'));
      }
    });
  }
}