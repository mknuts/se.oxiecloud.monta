'use strict';

const Homey = require('homey');

module.exports = class MontaDevice extends Homey.Device {

  



  
  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
   
   
    /*     
    // Just some code needed once, when capabilities was added and removed
    // Removing and adding the device will actually fix this automaticly 

        if (!this.hasCapability('charger_state')) {
        this.log('Adding missing capability...');
        await this.addCapability('charger_state').catch(this.error);
    }
    
    if (this.hasCapability('charging_mode')) {
        this.log('Removing deprecated capability charging_mode...');
        await this.removeCapability('charging_mode').catch(this.error);
    }

    */
    
    this.setCapabilityListeners();
    await this.setCapabilityValue('evcharger_charging', false);
    
    this.monetaryUnit = null; // To be fetched from API
    this.lastMeterReading = null;
    this.lastReadingTime = null;
    this.powerHistory = []; // Keep history of power measurements
    this.historyLength = 8; // How many entries to keep (8 x 30s = 4 minutes), adjust as needed
    this.latestChargeID = null;
    


    // Register Condition card
    this.homey.flow.getConditionCard('charger_state_is')
      .registerRunListener(async (args) => {
        const currentStatus = this.getCapabilityValue('charger_state');
        this.log(`[Condition] Checking if ${currentStatus} is ${args.status}`);
        return currentStatus === args.status;
      });

    
    
    // Register Condition card
    this.homey.flow.getConditionCard('charging_state_is')
      .registerRunListener(async (args) => {
        // args.device is the device that the card runs on
        // args.state is the selected drop-down value
        
        const currentState = this.getCapabilityValue('charging_state');
        this.log(`[Condition] Checking if ${currentState} is ${args.state}`);
        return currentState === args.state; // Returns true or false
      });

    // Register Condition card
    this.homey.flow.getConditionCard('is_cable_connected')
      .registerRunListener(async (args, state) => {
            
        //Fetch current capability status
        const isConnected = this.getCapabilityValue('connected');

        this.log(`Condition check: Is cable connected? ${isConnected}`);

        //Return true or false
          return isConnected === true; 
      });

    this.homey.flow.getDeviceTriggerCard('charger_state_is')
      .registerRunListener(async (args, state) => {
        // args.state from dropdownen in Flow-kortet
        // state.status from triggerContext 
        
        //this.log(`[RunListener] Args:`, args);
        //this.log(`[RunListener] State:`, state);


        this.log(`[RunListener] Flow Card selection: ${args.status}`);
        this.log(`[RunListener] Actual device state: ${state.status}`);
        
        const isMatch = (args.status === state.status);
        this.log(`[RunListener] Is match: ${isMatch}`);
        
        return isMatch; // If true, then the flow will be executed
      }
    );

    this.homey.flow.getDeviceTriggerCard('charging_state_is')
      .registerRunListener(async (args, state) => {
        // args.state from dropdownen in Flow-kortet
        // state.status from triggerContext 
        
        //this.log(`[RunListener] Args:`, args);
        //this.log(`[RunListener] State:`, state);


        this.log(`[RunListener] Flow Card selection: ${args.state}`);
        this.log(`[RunListener] Actual device state: ${state.state}`);
        
        const isMatch = (args.state === state.state);
        this.log(`[RunListener] Is match: ${isMatch}`);
        
        return isMatch; // If true, then the flow will be executed
      }
    );


    this.startTimer();

    this.log('Monta EV Charger device initialized ');

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
    if (changedKeys.includes('poll_interval')) {
      this.log(`Polling interval changed from ${oldSettings.poll_interval} to ${newSettings.poll_interval}`);
      // Restart the polling timer with the new value
      // Assuming you have a method called startPolling()
      this.startTimer();
  }
    this.log('Monta Charger settings where changed');
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name) {
    this.log('Monta EV Charger was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.stopTimer();
    this.log('Monta Charger with id ' + this.getData().id +' has been deleted');
  }
  
  // Trigger for cable connected/disconnected flow card
  async updateCableStatus(isConnected) {
      // Fetch old value to see if it has changed
      const oldValue = this.getCapabilityValue('connected');  

      // If changed then trigger flow
      if (oldValue !== isConnected) {
          // Update capability (for UI/app)
          await this.setCapabilityValue('connected', isConnected);
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
    const oldValue = this.getCapabilityValue('charging_state');
    if (oldValue === newStateId) {
      return;
    }
    try {
      // 1. Find token title
      const cap = this.homey.manifest.capabilities['charging_state'];
      const val = cap.values.find(v => v.id === newStateId);
      const lang = this.homey.i18n.getLanguage();
      const displayTitle = val.title[lang] || val.title['en'] || newStateId;

      // 2. Update UI
      await this.setCapabilityValue('charging_state', newStateId);

      // 3. Trigger "Changed"
      const triggerChanged = this.homey.flow.getDeviceTriggerCard('charging_state_changed');
      if (triggerChanged) {
        // We send 'this' as device-argument (thats what the filter will look for)
        await triggerChanged.trigger(this, { state: displayTitle }, { device: this });
      }

      // 4. Trigger "Is"
      const triggerIs = this.homey.flow.getDeviceTriggerCard('charging_state_is');
      if (triggerIs) {
        await triggerIs.trigger(this, {}, { device: this, state: newStateId });
      }

    } catch (err) {
      this.error('Error:', err);
    }
  }

  async updateChargerState(newStateId) {
    const oldValue = this.getCapabilityValue('charger_state');
    if (oldValue === newStateId) {
      return;
    }
    try {
      
      const cap = this.homey.manifest.capabilities['charger_state'];
      const val = cap.values.find(v => v.id === newStateId);
      const lang = this.homey.i18n.getLanguage();
      const displayTitle = val.title[lang] || val.title['en'] || newStateId;

      
      await this.setCapabilityValue('charger_state', newStateId);

      
      const triggerChanged = this.homey.flow.getDeviceTriggerCard('charger_state_changed');
      if (triggerChanged) {
        
        await triggerChanged.trigger(this, { state: displayTitle }, { device: this });
      }

      const triggerIs = this.homey.flow.getDeviceTriggerCard('charger_state_is');
      if (triggerIs) {
        await triggerIs.trigger(this, {}, { device: this, status: newStateId });
      }

    } catch (err) {
      this.error('Error:', err);
    }
  }



  async fetchMontaData() {
    try {
        const MontaID = this.getData().id;
        //this.log(`Fetch data for monta charger with ID: ${MontaID}`);
        const points = await this.homey.app.api.montaFetch('/charge-points/' + MontaID);
        if (!points) {
                this.error('No data received from API (chargepoint)');
            return;
        }

        // --- Set device as available on successful fetch ---
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
        if (this.getCapabilityValue('meter_power') !== points.lastMeterReadingKwh) {
          await this.setCapabilityValue('meter_power', points.lastMeterReadingKwh);
        }
        
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
                if(this.getCapabilityValue('measure_power') !== 0) {
                  await this.setCapabilityValue('measure_power', 0);
                  this.log('Charging not active , setting power to 0W');
                }
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
                if(this.getCapabilityValue('measure_power') !== avgPowerW) {
                  await this.setCapabilityValue('measure_power', avgPowerW);
                }
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
        
        this.log('KWh meter:', points.lastMeterReadingKwh, 'Cabel connected:', points.cablePluggedIn, 'Status:', points.state);
        this.log('Status previous (or current) charge:', charges.data[0].state, 'ID:', charges.data[0].externalId);

        this.updateCableStatus(points.cablePluggedIn); //Capability will be updated in this function
        
        if(this.getCapabilityValue('measure_monetary') !== charges.data[0].cost) {
          this.setCapabilityValue('measure_monetary', charges.data[0].cost);
        }
        if(this.getCapabilityValue('meter_lastkwh') !== charges.data[0].consumedKwh) { 
          this.setCapabilityValue('meter_lastkwh', charges.data[0].consumedKwh );
        }

        this.updateChargingState(charges.data[0].state); //Capability update in function
        
        this.updateChargerState(points.state); //Capability update in function

        if (points.state === 'busy-charging') {
          //this.log('Set evcharger_charging to TRUE');
          if(this.getCapabilityValue('evcharger_charging') !== true) {
            this.setCapabilityValue('evcharger_charging', true);
          }
        } else {
          //this.log('Set evcharger_charging to FALSE');
          if(this.getCapabilityValue('evcharger_charging') !== false) {
            this.setCapabilityValue('evcharger_charging', false);
          }
        };
        return points;

    } catch (error) {
        console.error('Critical Error during data fetch:', error.message);

        // --- Set device as unavailable on certain errors ---
        if (error.message.includes('401') || error.message.includes('Unauthorized')) {
            // This sets the device as unavailable with a custom message
            const msg = this.homey.__('error.unauthorized')
            await this.setUnavailable(msg).catch(this.error);
        } else if (error.message.includes('fetch') || error.message.includes('network')) {
            const msg = this.homey.__('error.api_connection_failed');
            await this.setUnavailable(msg).catch(this.error);
        }
        // --------------------------------------------------


        // On error, set power to 0
        // so that Homey does not show stale data
        await this.setCapabilityValue('measure_power', 0).catch(() => {});
    }
    
  }

 /**
 * Main polling logic.
 * This function fetches data and schedules the next execution.
 */
  async timerCallback() {
    try {
        // Log the fetch attempt
        this.log('Fetching Monta data...');
        await this.fetchMontaData();
    } catch (error) {
        this.error('Timer error:', error.message);
    } finally {
        // Retrieve the user-defined poll interval (in seconds) from settings.
        // Fallback to 30 seconds if setting is missing.
        const pollIntervalSeconds = this.getSetting('poll_interval') || 30;
        
        // Convert to milliseconds for setTimeout
        const pollFrequencyMs = pollIntervalSeconds * 1000;

        // Schedule the next run. 
        // We use setTimeout to ensure we wait the full interval AFTER the previous fetch is finished.
        this.pollTimer = this.homey.setTimeout(() => this.timerCallback(), pollFrequencyMs);
    }
  }

  /**
  * Starts the polling process.
  * Clears any existing timer first to prevent duplicate polling chains.
  */
  startTimer() {
    this.log('Starting polling timer...');
    this.stopTimer(); // Always clear existing timers before starting a new one
    this.timerCallback();
  }

  /**
 * Stops the polling process.
 * Should be called in onUninit() or when restarting the timer.
 */
  stopTimer() {
    if (this.pollTimer) {
        this.log('Stopping polling timer...');
        this.homey.clearTimeout(this.pollTimer);
        this.pollTimer = null;
    }
  }



  setCapabilityListeners() {
    this.registerCapabilityListener("evcharger_charging", async (value) => {
      return await this.onCapability_EVCHARGER_CHARGING(value);
    });
    this.log('Registered capability listener for evcharger_charging');
  }

  async onCapability_EVCHARGER_CHARGING(value) {
    this.log('Capability evcharger_charging changed to: ' + value);
    const MontaID = this.getData().id;

    // ---  (GUARD) ---
    // We need to check if the cable is connected before starting charging
    const isDocked = this.getCapabilityValue('connected');

    if (value === true && !isDocked) {
        // If user tries to start (true) but cable is not connected (!isDocked)
        this.log('Aborting: No cable connected.');
        
        // This error message is shown to the user in the Homey app
        throw new Error(this.homey.__('error.no_cable'));
    }
    // ---  (GUARD) ---
    // We need to check if the charger is avaliable before starting charging
    const isAvailable = this.getCapabilityValue('charger_state');
    this.log('Charger availability status:', isAvailable);
    if (value === true && isAvailable !== 'available') {
        // If user tries to start (true) but charger is not available
        this.log('Aborting: Charger not available.');
        
        // This error message will be shown to APP users
        throw new Error(this.homey.__('error.charger_not_available'));
    }
    // ------------------------------


    try {
        // Code to start/stop charging via Monta API
        
        if (value) {
            this.log('Start charging via Monta API...');
            // Call Monta API to start charging
          try {
              const startCharge = await this.homey.app.api.montaFetch('/charges', 'POST', { chargePointId: MontaID });
              this.latestChargeID = startCharge.externalId; // Used to stop charging later, Monta needs externalId for this
              await this.setStoreValue('latestChargeID', startCharge.externalId);
              this.log('Charging started:', startCharge, 'Charge ID', this.latestChargeID);
          } catch (error) {
              this.log('Error when charging was started: ' + error.message);
          }
        } else {
            this.log('Stop charging via Monta API...');
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
              this.log('Error when trying to stop charging: ' + error.message);
          }
        }
    } catch (error) {
        this.log('Error when chaging evcharger_charging: ' + error.message);
        throw error;
    }
  } 

};
