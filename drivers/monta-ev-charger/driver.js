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
    let username = "";
    let password = "";

    session.setHandler("login", async (data) => {

        username = data.username; //fetch from form input
        password = data.password;

    
      console.log(`User tries to login with ClientID: ${username} and ClientSecret: ${password}`);
      const clientId = username;
      const clientSecret = password;
      const credentialsAreValid = await this.homey.app.api.authenticate('https://public-api.monta.com/api/v1/auth/token', {
        clientId,
        clientSecret,
      });
      //console.log(`Login result: ${JSON.stringify(credentialsAreValid)}`);
      
      
      if (credentialsAreValid.accessToken !== null) {
        console.log('Inloggning lyckades');
        this.homey.app.clientId = username;
        this.homey.app.clientSecret = password;
        return credentialsAreValid;
      } else {
        console.log('Inloggning misslyckades');
        return false;
      } 
      
      // return true to continue adding the device if the login succeeded
      // return false to indicate to the user the login attempt failed
      // thrown errors will also be shown to the user
    
    });

    session.setHandler("list_devices", async () => {
      const points = await this.homey.app.api.montaFetch('/charge-points');
      //console.log(`Found chargers: ${JSON.stringify(points)}`);
 
 
      const myDevices = points.data.map(point => {
        return {
          id: String(point.id), // Homey wants a string here
          name: point.name
        };
      });

      const devices = myDevices.map((myDevice) => {
        return {
          name: myDevice.name,
          data: {
            id: myDevice.id,
          },
          settings: {
            // Store username & password in settings
            // so the user can change them later
            username,
            password,
          },
        };
      });

      return devices;

    });
  }
}