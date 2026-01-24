'use strict';

const Homey = require('homey');
const pollFrequency = 30000; // 30 seconds;

module.exports = class MontaDevice extends Homey.Device {

  



  
  /**
   * onInit is called when the device is initialized.
   */
    async onInit() {
        

    // Lägg till detta temporärt för att "laga" befintliga enheter
    if (!this.hasCapability('charger_state')) {
        this.log('Adding missing capability...');
        await this.addCapability('charger_state').catch(this.error);
    }
    if (this.hasCapability('charging_mode')) {
        this.log('Removing deprecated capability charging_mode...');
        await this.removeCapability('charging_mode').catch(this.error);

    }
    

    
    
    
    this.setCapabilityListeners();
    await this.setCapabilityValue('evcharger_charging', false);
    //await this.setCapabilityOptions('measure_monetary', { "units":"DKK" });
    //await this.setCapabilityValue('charging_state', 'charging');
    this.log('Monta EV Charger device initialized ');

    this.monetaryUnit = null; // To be fetched from API
    this.lastMeterReading = null;
    this.lastReadingTime = null;
    this.powerHistory = []; // Keep history of power measurements
    this.historyLength = 8; // How many entries to keep (8 x 30s = 4 minutes), adjust as needed
    this.latestChargeID = null;

    // Register Condition card
    this.homey.flow.getConditionCard('is_cable_connected')
        .registerRunListener(async (args, state) => {
            
            //Fetch current capability status
            const isConnected = this.getCapabilityValue('connected');

            this.log(`Condition check: Is cable connected? ${isConnected}`);

            //Return true or false
            return isConnected === true; 
        });


    this.startTimer();

// --- TEMPORARY SIMULATION CODE ---
// List of all your enum IDs
const mockStates = [
  'reserved', 'starting', 'charging', 
  'stopping', 'paused', 'scheduled', 
  'stopped', 'completed'
];

let stateIndex = 0;

// Change state every 10 seconds
this.homey.setInterval(async () => {
  const nextState = mockStates[stateIndex];
  this.log(`[Simulation] Cycling to: ${nextState}`);
  
  await this.updateChargingState(nextState);

  // Move to next state, or back to start
  stateIndex = (stateIndex + 1) % mockStates.length;
}, 10000); 
// ---------------------------------


    this.log('Monta EV charger has been initialized');
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('A Monta connected Charger has been added');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('My Monta Charger settings where changed');
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name) {
    this.log('My Monta EV Charger was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.stopTimer();
    this.log('Monta Charger with id ' + this.chargePointId +' has been deleted');
  }
  
    // Trigger for cable connected/disconnected flow card
    async updateCableStatus(isConnected) {
        // Fetch old value to see if it has changed
        const oldValue = this.getCapabilityValue('connected');
        
        // Update capability (for UI/app)
        await this.setCapabilityValue('connected', isConnected);

        // If changed then trigger flow
        if (oldValue !== isConnected) {
            const triggerId = isConnected ? 'cable_connected' : 'cable_disconnected';
            
            this.homey.flow.getDeviceTriggerCard(triggerId)
                .trigger(this, {}, { device: this })
                .then(() => this.log(`Triggered flow: ${triggerId}`))
                .catch(this.error);
        }
    }

/**
 * Updates the charging state and triggers flow cards dynamically.
 * @param {string} newStateId - The ID from your enum (e.g., 'charging', 'completed')
 */

async updateChargingState(newStateId) {
  try {
    // 1. Hitta titeln för token
    const cap = this.homey.manifest.capabilities['charging_state'];
    const val = cap.values.find(v => v.id === newStateId);
    const lang = this.homey.i18n.getLanguage();
    const displayTitle = val.title[lang] || val.title['en'] || newStateId;

    // 2. Uppdatera UI
    await this.setCapabilityValue('charging_state', newStateId);

    // 3. Trigga "Changed"
    const triggerChanged = this.homey.flow.getDeviceTriggerCard('charging_state_changed');
    if (triggerChanged) {
      // Vi skickar 'this' som device-argumentet (det filtret letar efter)
      await triggerChanged.trigger(this, { state: displayTitle }, { device: this });
    }

    // 4. Trigga "Is"
    const triggerIs = this.homey.flow.getDeviceTriggerCard('charging_state_is');
    if (triggerIs) {
      await triggerIs.trigger(this, {}, { device: this, state: newStateId });
    }

  } catch (err) {
    this.error('Error:', err);
  }
}

  async fetchMontaData() {
    try {
        const MontaID = this.getData().id;
        //console.log(`Fetch data for monta charger with ID: ${MontaID}`);
        const points = await this.homey.app.api.montaFetch('/charge-points/' + MontaID);
        if (!points) {
                this.error('No data received from API (chargepoint)');
            return;
        }

        // --- NEW: Set device as available on successful fetch ---
        await this.setAvailable().catch(this.error);
        // ---------------------------------------------------------------------

        const charges = await this.homey.app.api.montaFetch('/charges?chargePointId='+MontaID+'&page=0&perPage=1');
        if (!charges || !charges.data || charges.data.length === 0) {
            this.error('No data received from API (charges)');
            return;
        }
        // Check monetary unit from API if not already set
        const currencyFromAPI = charges.data[0].currency.identifier;
        if (this.monetaryUnit !== currencyFromAPI) {
            this.monetaryUnit = currencyFromAPI;
            await this.setCapabilityOptions('measure_monetary', { "units": this.monetaryUnit.toUpperCase(), "title": { "en": "Charge cost", "sv": "Laddkostnad" } });
            this.log('Updated monetary unit to:', this.monetaryUnit.toUpperCase());
        }
        //Calculate power (in Watts) based on meter readings (Monta do not provide any power data)
        const currentMeter = points.lastMeterReadingKwh; // kWh from API
        const currentTime = Date.now(); // Time in milliseconds
        const isCharging = charges.data[0].state === 'charging';
        
        await this.setCapabilityValue('meter_power', points.lastMeterReadingKwh);
        if (this.lastMeterReading !== null && this.lastReadingTime !== null) {
            // Calculate difference in kWh
            const deltaKwh = currentMeter - this.lastMeterReading;
                if (deltaKwh < 0) {
                    this.log('Warning: Meter value decreased. Skipping calculation to avoid power spike.');
                    this.lastMeterReading = currentMeter; // Restore last reading to current
                    return;
                }
            this.log(`Delta kWh: ${deltaKwh}, Current Meter: ${currentMeter}, Last Meter: ${this.lastMeterReading}`);
            // Calculate time difference in hours (change from ms to hours)
            const deltaTimeHours = (currentTime - this.lastReadingTime) / (1000 * 60 * 60);
            //  If car does not charge or deltaKwh is zero or negative, set power to 0
            if (!isCharging) {
                this.powerHistory = []; 
                this.lastMeterReading = currentMeter;
                await this.setCapabilityValue('measure_power', 0);
                this.log('Charging not active , setting power to 0W');
            }
            else if (deltaKwh > 0 ) {
                // Calculate power in kW
                const rawPowerKw = deltaKwh / deltaTimeHours;
                let rawPowerW = Math.round(rawPowerKw * 1000);
                rawPowerW = Math.min(rawPowerW, 12000); // Cap raw power to 12kW to avoid unrealistic values
                // Store power in history
                this.powerHistory.push(rawPowerW);
                if (this.powerHistory.length > this.historyLength) {
                    this.powerHistory.shift(); // Remove oldest entry
                }
                // Calculate smoothed power (average)
                const sum = this.powerHistory.reduce((a, b) => a + b, 0);
                const avgPowerW = Math.round(sum / this.powerHistory.length);
                this.log(`Power - Raw: ${rawPowerW}W, Avg: ${avgPowerW}W (History: ${this.powerHistory.length})`);
      
                await this.setCapabilityValue('measure_power', avgPowerW);
                this.lastMeterReading = currentMeter;
                this.lastReadingTime = currentTime;
            } else {

                this.log('No increase in meter reading...waiting for next update.');
            }
        } else {
            // First reading, just store values
            this.lastMeterReading = currentMeter;
            this.lastReadingTime = currentTime;
            
            this.log('First meter reading, storing values for next calculation.');
        }

        //End calculation of power
        
        console.log('KWh meter:', points.lastMeterReadingKwh, 'Cabel connected:', points.cablePluggedIn, 'Status:', points.state);
        console.log('Status previous (or current) charge:', charges.data[0].state, 'ID:', charges.data[0].externalId);
       

        this.updateCableStatus(points.cablePluggedIn);
        this.setCapabilityValue('measure_monetary', charges.data[0].cost);
        this.setCapabilityValue('meter_lastkwh', charges.data[0].consumedKwh );

        this.setCapabilityValue('ev_charging_state', charges.data[0].state);
        //this.setCapabilityValue('charging_state', charges.data[0].state);

        this.setCapabilityValue('evcharger_charging_state', points.state);
        this.setCapabilityValue('charger_state', points.state);
        if (points.state === 'busy-charging') {
          //console.log('Set evcharger_charging to TRUE');
          this.setCapabilityValue('evcharger_charging', true)
        } else {
          //console.log('Set evcharger_charging to FALSE');
          this.setCapabilityValue('evcharger_charging', false)
        };
        return points;

    } catch (error) {
        console.error('Critical Error during data fetch:', error.message);

        // --- NEW: Set device as unavailable on certain errors ---
        if (error.message.includes('401') || error.message.includes('Unauthorized')) {
            // This sets the device as unavailable with a custom message
            await this.setUnavailable("Ogiltiga API-uppgifter. Kontrollera App-inställningar.").catch(this.error);
        } else if (error.message.includes('fetch') || error.message.includes('network')) {
            await this.setUnavailable("Kunde inte nå Monta (Nätverksfel)").catch(this.error);
        }
        // --------------------------------------------------


        // On error, set power to 0
        // so that Homey does not show stale data
        await this.setCapabilityValue('measure_power', 0).catch(() => {});
    }
    
  }

  async timerCallback() {
      try {
          // Do the data fetch
          await this.fetchMontaData();
      } catch (error) {
          console.log('Timer error:', error.message);
      } finally {
          // Restart the timer regardless of success or failure
          // We will wait pollFrequency (defined in top of this file, should perhaps be a configuration item) before next run
          this.pollTimer = setTimeout(() => this.timerCallback(), pollFrequency);
      }
  }

    
  startTimer() {
      // Start first run immediately
      this.timerCallback();
  }

  stopTimer() {
      // Important to clear the timer when device is deleted
      if (this.pollTimer) {
          clearTimeout(this.pollTimer);
      }
  }

  setCapabilityListeners() {
    this.registerCapabilityListener("evcharger_charging", async (value) => {
      return await this.onCapability_EVCHARGER_CHARGING(value);
    });
    console.log('Registered capability listener for evcharger_charging');
  }

  async onCapability_EVCHARGER_CHARGING(value) {
    console.log('Capability evcharger_charging changed to: ' + value);
    const MontaID = this.getData().id;

    // ---  (GUARD) ---
    // We need to check if the cable is connected before starting charging
    const isDocked = this.getCapabilityValue('connected');

    if (value === true && !isDocked) {
        // If user tries to start (true) but cable is not connected (!isDocked)
        console.log('Aborting: No cable connected.');
        
        // This error message is shown to the user in the Homey app
        throw new Error(this.homey.__('error.no_cable'));
    }
    // ---  (GUARD) ---
    // We need to check if the charger is avaliable before starting charging
    const isAvailable = this.getCapabilityValue('evcharger_charging_state');
    console.log('Charger availability status:', isAvailable);
    if (value === true && isAvailable !== 'available') {
        // If user tries to start (true) but charger is not available
        console.log('Aborting: Charger not available.');
        
        // Detta felmeddelande visas för användaren i Homey-appen
        throw new Error(this.homey.__('charger_not_available'));
    }
    // ------------------------------


    try {
        // Code to start/stop charging via Monta API
        
        if (value) {
            console.log('Start charging via Monta API...');
            // Call Monta API to start charging
          try {
              const startCharge = await this.homey.app.api.montaFetch('/charges', 'POST', { chargePointId: MontaID });
              this.latestChargeID = startCharge.externalId; // Used to stop charging later, Monta needs externalId for this
              await this.setStoreValue('latestChargeID', startCharge.externalId);
              console.log('Charging started:', startCharge, 'Charge ID', this.latestChargeID);
          } catch (error) {
              console.log('Error when charging was started: ' + error.message);
          }
        } else {
            console.log('Stop charging via Monta API...');
            // Call Monta API to stop charging

          try {
            
            const chargeID = this.getStoreValue('latestChargeID');

            if (!chargeID) {
                this.error('Could not stop charging: No Charge ID found in store.');
            return;
    }

            const stopCharge = await this.homey.app.api.montaFetch(`/charges/${chargeID}/stop`, 'POST' );
            // Clear stored charge ID after stopping
            await this.setStoreValue('latestChargeID', null);
    
            this.log('Charging stopped and ID cleared from store');
          } catch (error) {
              console.log('Error when trying to stop charging: ' + error.message);
          }
        }
    } catch (error) {
        console.log('Error when chaging evcharger_charging: ' + error.message);
        throw error;
    }
  } 

};
