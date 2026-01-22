'use strict';

const Homey = require('homey');
const MontaAPI = require('./lib/MontaAPI');


module.exports = class MontaApp extends Homey.App {
  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('Monta App has been initialized');
    this.api = new MontaAPI(this.homey);

   
    // Placeholder for clientId och clientSecret
    this.clientId = "";
    this.clientSecret = "";
    // Placeholder för latestChargeID, needed to stop an ongoing charge
    this.latestChargeID = null;

  }  
};
