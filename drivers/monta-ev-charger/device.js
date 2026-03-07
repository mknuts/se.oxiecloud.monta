'use strict';

const Homey = require('homey');

module.exports = class MontaDevice extends Homey.Device {

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.setCapabilityListeners();
    await this.setCapabilityValue('evcharger_charging', false);
    
    this.monetaryUnit = null; 
    this.lastMeterReading = null;
    this.lastReadingTime = null;
    this.powerHistory = []; 
    this.historyLength = 8; 
    this.latestChargeID = null;

    // Register Condition cards
    this.homey.flow.getConditionCard('charger_state_is')
      .registerRunListener(async (args) => {
        const currentStatus = this.getCapabilityValue('charger_state');
        this.log(`[Condition] Checking if ${currentStatus} is ${args.status}`);
        return currentStatus === args.status;
      });

    this.homey.flow.getConditionCard('charging_state_is')
      .registerRunListener(async (args) => {
        const currentState = this.getCapabilityValue('charging_state');
        this.log(`[Condition] Checking if ${currentState} is ${args.state}`);
        return currentState === args.state;
      });

    this.homey.flow.getConditionCard('is_cable_connected')
      .registerRunListener(async (args, state) => {
        const isConnected = this.getCapabilityValue('connected');
        this.log(`Condition check: Is cable connected? ${isConnected}`);
        return isConnected === true; 
      });

    // Register Trigger cards
    this.homey.flow.getDeviceTriggerCard('charger_state_is')
      .registerRunListener(async (args, state) => {
        this.log(`[RunListener] Flow Card selection: ${args.status}`);
        this.log(`[RunListener] Actual device state: ${state.status}`);
        return (args.status === state.status);
      }
    );

    this.homey.flow.getDeviceTriggerCard('charging_state_is')
      .registerRunListener(async (args, state) => {
        this.log(`[RunListener] Flow Card selection: ${args.state}`);
        this.log(`[RunListener] Actual device state: ${state.state}`);
        return (args.state === state.state);
      }
    );

    this.startTimer();
    this.log('Monta EV Charger device initialized');
  }
  
  async onAdded() {
    this.log('A Monta connected Charger has been added');
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    if (changedKeys.includes('poll_interval')) {
      this.log(`Polling interval changed from ${oldSettings.poll_interval} to ${newSettings.poll_interval}`);
      this.startTimer();
    }
    this.log('Monta Charger settings were changed');
  }

  async onRenamed(name) {
    this.log('Monta EV Charger was renamed');
  }

  async onDeleted() {
    this.stopTimer();
    this.log('Monta Charger with id ' + this.getData().id +' has been deleted');
  }
  
  // Trigger for cable connected/disconnected flow card
  async updateCableStatus(isConnected) {
    const oldValue = this.getCapabilityValue('connected');  

    if (oldValue !== isConnected) {
      await this.setCapabilityValue('connected', isConnected);
      const triggerId = isConnected ? 'cable_connected' : 'cable_disconnected';
      
      // CLEANED: Removed { device: this } from state
      this.homey.flow.getDeviceTriggerCard(triggerId)
          .trigger(this, {}, {}) 
          .then(() => this.log(`Triggered flow: ${triggerId}`))
          .catch(this.error);
    }
  }

  async updateChargingState(newStateId) {
    const oldValue = this.getCapabilityValue('charging_state');
    if (oldValue === newStateId) return;

    try {
      const cap = this.homey.manifest.capabilities['charging_state'];
      const val = cap.values.find(v => v.id === newStateId);
      const lang = this.homey.i18n.getLanguage();
      const displayTitle = val.title[lang] || val.title['en'] || newStateId;

      await this.setCapabilityValue('charging_state', newStateId);

      // Trigger "Changed"
      const triggerChanged = this.homey.flow.getDeviceTriggerCard('charging_state_changed');
      if (triggerChanged) {
        // CLEANED: Removed { device: this } from state
        await triggerChanged.trigger(this, { state: displayTitle }, {});
      }

      // Trigger "Is"
      const triggerIs = this.homey.flow.getDeviceTriggerCard('charging_state_is');
      if (triggerIs) {
        // CLEANED: Removed { device: this } from state, keeping 'state' for runListener
        await triggerIs.trigger(this, {}, { state: newStateId });
      }

    } catch (err) {
      this.error('Error updateChargingState:', err);
    }
  }

  async updateChargerState(newStateId) {
    const oldValue = this.getCapabilityValue('charger_state');
    if (oldValue === newStateId) return;

    try {
      const cap = this.homey.manifest.capabilities['charger_state'];
      const val = cap.values.find(v => v.id === newStateId);
      const lang = this.homey.i18n.getLanguage();
      const displayTitle = val.title[lang] || val.title['en'] || newStateId;

      await this.setCapabilityValue('charger_state', newStateId);
      
      const triggerChanged = this.homey.flow.getDeviceTriggerCard('charger_state_changed');
      if (triggerChanged) {
        // CLEANED: Removed { device: this } from state
        await triggerChanged.trigger(this, { state: displayTitle }, {});
      }

      const triggerIs = this.homey.flow.getDeviceTriggerCard('charger_state_is');
      if (triggerIs) {
        // CLEANED: Removed { device: this } from state, keeping 'status' for runListener
        await triggerIs.trigger(this, {}, { status: newStateId });
      }

    } catch (err) {
      this.error('Error updateChargerState:', err);
    }
  }

  async fetchMontaData() {
    try {
        const MontaID = this.getData().id;
        const points = await this.homey.app.api.montaFetch('/charge-points/' + MontaID);
        if (!points) {
            this.error('No data received from API (chargepoint)');
            return;
        }

        await this.setAvailable().catch(this.error);

        const charges = await this.homey.app.api.montaFetch('/charges?chargePointId='+MontaID+'&page=0&perPage=1');
        if (!charges || !charges.data || charges.data.length === 0) {
            this.error('No data received from API (charges)');
            return;
        }

        const currencyFromAPI = charges.data[0].currency.identifier;
        if (this.monetaryUnit !== currencyFromAPI) {
            this.monetaryUnit = currencyFromAPI;
            await this.setCapabilityOptions('measure_monetary', { "units": this.monetaryUnit.toUpperCase(), "title": { "en": "Charge cost", "sv": "Laddkostnad" } });
            this.log('Updated monetary unit to:', this.monetaryUnit.toUpperCase());
        }

        const currentMeter = points.lastMeterReadingKwh; 
        const currentTime = Date.now(); 
        const isCharging = charges.data[0].state === 'charging';

        if (this.getCapabilityValue('meter_power') !== points.lastMeterReadingKwh) {
          await this.setCapabilityValue('meter_power', points.lastMeterReadingKwh);
        }
        
        if (this.lastMeterReading !== null && this.lastReadingTime !== null) {
            const deltaKwh = currentMeter - this.lastMeterReading;
            if (deltaKwh < 0) {
                this.lastMeterReading = currentMeter;
                return;
            }
            const deltaTimeHours = (currentTime - this.lastReadingTime) / (1000 * 60 * 60);

            if (!isCharging) {
                this.powerHistory = []; 
                this.lastMeterReading = currentMeter;
                if(this.getCapabilityValue('measure_power') !== 0) {
                  await this.setCapabilityValue('measure_power', 0);
                }
            }
            else if (deltaKwh > 0 ) {
                const rawPowerKw = deltaKwh / deltaTimeHours;
                let rawPowerW = Math.round(rawPowerKw * 1000);
                rawPowerW = Math.min(rawPowerW, 12000); 
                this.powerHistory.push(rawPowerW);
                if (this.powerHistory.length > this.historyLength) {
                    this.powerHistory.shift(); 
                }
                const sum = this.powerHistory.reduce((a, b) => a + b, 0);
                const avgPowerW = Math.round(sum / this.powerHistory.length);
                if(this.getCapabilityValue('measure_power') !== avgPowerW) {
                  await this.setCapabilityValue('measure_power', avgPowerW);
                }
                this.lastMeterReading = currentMeter;
                this.lastReadingTime = currentTime;
            }
        } else {
            this.lastMeterReading = currentMeter;
            this.lastReadingTime = currentTime;
        }

        this.updateCableStatus(points.cablePluggedIn); 
        
        if(this.getCapabilityValue('measure_monetary') !== charges.data[0].cost) {
          this.setCapabilityValue('measure_monetary', charges.data[0].cost);
        }
        if(this.getCapabilityValue('meter_lastkwh') !== charges.data[0].consumedKwh) { 
          this.setCapabilityValue('meter_lastkwh', charges.data[0].consumedKwh );
        }

        this.updateChargingState(charges.data[0].state); 
        this.updateChargerState(points.state); 

        if (points.state === 'busy-charging') {
          if(this.getCapabilityValue('evcharger_charging') !== true) {
            this.setCapabilityValue('evcharger_charging', true);
          }
        } else {
          if(this.getCapabilityValue('evcharger_charging') !== false) {
            this.setCapabilityValue('evcharger_charging', false);
          }
        };
        return points;

    } catch (error) {
        console.error('Critical Error during data fetch:', error.message);
        if (error.message.includes('401') || error.message.includes('Unauthorized')) {
            const msg = this.homey.__('error.unauthorized')
            await this.setUnavailable(msg).catch(this.error);
        } else if (error.message.includes('fetch') || error.message.includes('network')) {
            const msg = this.homey.__('error.api_connection_failed');
            await this.setUnavailable(msg).catch(this.error);
        }
        await this.setCapabilityValue('measure_power', 0).catch(() => {});
    }
  }

  async timerCallback() {
    try {
        await this.fetchMontaData();
    } catch (error) {
        this.error('Timer error:', error.message);
    } finally {
        const pollIntervalSeconds = this.getSetting('poll_interval') || 30;
        const pollFrequencyMs = pollIntervalSeconds * 1000;
        this.pollTimer = this.homey.setTimeout(() => this.timerCallback(), pollFrequencyMs);
    }
  }

  startTimer() {
    this.stopTimer(); 
    this.timerCallback();
  }

  stopTimer() {
    if (this.pollTimer) {
        this.homey.clearTimeout(this.pollTimer);
        this.pollTimer = null;
    }
  }

  setCapabilityListeners() {
    this.registerCapabilityListener("evcharger_charging", async (value) => {
      return await this.onCapability_EVCHARGER_CHARGING(value);
    });
  }

  async onCapability_EVCHARGER_CHARGING(value) {
    const MontaID = this.getData().id;
    const isDocked = this.getCapabilityValue('connected');

    if (value === true && !isDocked) {
        throw new Error(this.homey.__('error.no_cable'));
    }
    
    const isAvailable = this.getCapabilityValue('charger_state');
    if (value === true && isAvailable !== 'available') {
        throw new Error(this.homey.__('error.charger_not_available'));
    }

    try {
        if (value) {
          try {
              const startCharge = await this.homey.app.api.montaFetch('/charges', 'POST', { chargePointId: MontaID });
              await this.setStoreValue('latestChargeID', startCharge.externalId);
          } catch (error) {
              this.log('Error start charge: ' + error.message);
          }
        } else {
          try {
            const chargeID = this.getStoreValue('latestChargeID');
            if (!chargeID) {
                this.error('No Charge ID found in store.');
                return;
            }
            await this.homey.app.api.montaFetch(`/charges/${chargeID}/stop`, 'POST' );
            await this.setStoreValue('latestChargeID', null);
          } catch (error) {
              this.log('Error stop charge: ' + error.message);
          }
        }
    } catch (error) {
        this.log('Error evcharger_charging: ' + error.message);
        throw error;
    }
  } 
};