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
    // 1. Hämta inloggningsuppgifter från App Settings
    const username = this.homey.settings.get('username');
    const password = this.homey.settings.get('password');

    // 2. Kontrollera direkt om användaren har fyllt i sina uppgifter i app-inställningarna
    if (!username || !password) {
      // Om de saknas, visa ett tydligt felmeddelande i parningsfönstret
      throw new Error(this.homey.__('error.missing_settings_pair'));
    }

    session.setHandler("list_devices", async () => {
      this.log(`Attempting to list devices using stored App Settings for: ${username}`);

      try {
        // Vi antar att app.js redan har initierat API-klienten med dessa credentials
        const points = await this.homey.app.api.montaFetch('/charge-points');
        
        if (!points || !points.data) {
          throw new Error(this.homey.__('error.no_data_received'));
        }

        // 3. Mappa enheterna. Notera att vi INTE sparar username/password i settings här
        return points.data.map(point => {
          return {
            name: point.name || `Monta Charger (${point.id})`,
            data: {
              id: String(point.id),
            },
            settings: {
              // We only store the charger ID in device settings
              charger_id: String(point.id) 
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