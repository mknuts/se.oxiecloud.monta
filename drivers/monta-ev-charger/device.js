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
    // Hämtar inställningen för utjämning, standard 8
    this.historyLength = this.getSetting('history_length') || 8; 
    this.latestChargeID = null;

    // Register Condition cards
    this.homey.flow.getConditionCard('charger_state_is')
      .registerRunListener(async (args) => {
        const currentStatus = this.getCapabilityValue('charger_state');
        return currentStatus === args.status;
      });

    this.homey.flow.getConditionCard('charging_state_is')
      .registerRunListener(async (args) => {
        const currentState = this.getCapabilityValue('charging_state');
        return currentState === args.state;
      });

    this.homey.flow.getConditionCard('is_cable_connected')
      .registerRunListener(async (args, state) => {
        const isConnected = this.getCapabilityValue('connected');
        return isConnected === true; 
      });

    // Register Trigger cards
    this.homey.flow.getDeviceTriggerCard('charger_state_is')
      .registerRunListener(async (args, state) => {
        return (args.status === state.status);
      });

    this.homey.flow.getDeviceTriggerCard('charging_state_is')
      .registerRunListener(async (args, state) => {
        return (args.state === state.state);
      });

    this.startTimer();
    this.log('Monta EV Charger device initialized');
  }
  
  async onAdded() {
    this.log('A Monta connected Charger has been added');
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    if (changedKeys.includes('poll_interval')) {
      this.log(`Polling interval changed to ${newSettings.poll_interval}s`);
      this.startTimer();
    }
    if (changedKeys.includes('history_length')) {
      this.historyLength = newSettings.history_length;
      this.powerHistory = []; // Nollställ historiken vid ändring
      this.log(`History length updated to: ${this.historyLength}`);
    }
  }

  async onDeleted() {
    this.stopTimer();
    this.log('Monta Charger deleted');
  }
  
  async updateCableStatus(isConnected) {
    const oldValue = this.getCapabilityValue('connected');  
    if (oldValue !== isConnected) {
      await this.setCapabilityValue('connected', isConnected);
      const triggerId = isConnected ? 'cable_connected' : 'cable_disconnected';
      this.homey.flow.getDeviceTriggerCard(triggerId).trigger(this, {}, {}).catch(this.error);
    }
  }

  async updateChargingState(newStateId) {
    const oldValue = this.getCapabilityValue('charging_state');
    if (oldValue === newStateId) return;
    try {
      await this.setCapabilityValue('charging_state', newStateId);
      const triggerIs = this.homey.flow.getDeviceTriggerCard('charging_state_is');
      if (triggerIs) await triggerIs.trigger(this, {}, { state: newStateId });
    } catch (err) { this.error('Error updateChargingState:', err); }
  }

  async updateChargerState(newStateId) {
    const oldValue = this.getCapabilityValue('charger_state');
    if (oldValue === newStateId) return;
    try {
      await this.setCapabilityValue('charger_state', newStateId);
      const triggerIs = this.homey.flow.getDeviceTriggerCard('charger_state_is');
      if (triggerIs) await triggerIs.trigger(this, {}, { status: newStateId });
    } catch (err) { this.error('Error updateChargerState:', err); }
  }

async fetchMontaData() {
    try {
        const MontaID = this.getData().id;
        const points = await this.homey.app.api.montaFetch('/charge-points/' + MontaID);
        const charges = await this.homey.app.api.montaFetch('/charges?chargePointId='+MontaID+'&page=0&perPage=1');
        
        if (!points || !charges || !charges.data) return;
        await this.setAvailable().catch(this.error);

        const currentMeter = points.lastMeterReadingKwh; 
        const currentTime = Date.now(); 
        const isCharging = charges.data[0].state === 'charging';

        if (this.getCapabilityValue('meter_power') !== currentMeter) {
          await this.setCapabilityValue('meter_power', currentMeter);
        }
        
        // INITIALISERINGSKONTROLL: Om vi saknar värden, sätt dem och gå ur.
        if (this.lastMeterReading === null || this.lastReadingTime === null) {
            this.log("Initialiserar mätpunkter (första körningen)...");
            this.lastMeterReading = currentMeter;
            this.lastReadingTime = currentTime;
            return; // Vänta på nästa poll
        }

        const deltaKwh = Math.round((currentMeter - this.lastMeterReading) * 10) / 10;
        const deltaTimeMs = currentTime - this.lastReadingTime;
        const deltaTimeHours = deltaTimeMs / (1000 * 60 * 60);

        if (!isCharging) {
            this.powerHistory = []; 
            this.lastMeterReading = currentMeter;
            this.lastReadingTime = currentTime; 
            if(this.getCapabilityValue('measure_power') !== 0) {
              await this.setCapabilityValue('measure_power', 0);
            }
        }
        else if (deltaKwh > 0) {
            // SÄKERHETSSPÄRR FÖR UPPSTART:
            // Om detta är första gången mätaren rör sig sedan appen startade, 
            // kan vi inte lita på tiden (vi vet inte när inom förra intervallet den stod på förra värdet).
            // Vi kräver att deltaTimeMs är rimligt (t.ex. mer än 20 sekunder för 0.1kWh vid 11kW)
            // men framförallt kastar vi bort värdet om det är "första" hoppet för att kalibrera.
            
            const rawPowerKw = deltaKwh / deltaTimeHours;
            let rawPowerW = Math.round(rawPowerKw * 1000);
            
            // Om beräkningen ger mer än vad som är fysiskt möjligt (t.ex. 20kW på en 11kW bil)
            // pga kort deltaTime, ignorera detta specifika hopp och kalibrera om.
            if (rawPowerW > 15000) { 
                this.log(`Ignorerar spik på ${rawPowerW}W vid uppstart/omslag. Kalibrerar...`);
                this.lastMeterReading = currentMeter;
                this.lastReadingTime = currentTime;
                return;
            }

            rawPowerW = Math.min(rawPowerW, 12000); 

            this.powerHistory.push(rawPowerW);
            if (this.powerHistory.length > this.historyLength) this.powerHistory.shift(); 
            
            const avgPowerW = Math.round(this.powerHistory.reduce((a, b) => a + b, 0) / this.powerHistory.length);
            
            if(this.getCapabilityValue('measure_power') !== avgPowerW) {
              await this.setCapabilityValue('measure_power', avgPowerW);
            }

            this.lastMeterReading = currentMeter;
            this.lastReadingTime = currentTime;
        }
        // Om deltaKwh === 0, låt lastReadingTime vara kvar så att deltaTimeMs växer till nästa poll.

        // --- Resten av funktionen förblir oförändrad ---
        this.updateCableStatus(points.cablePluggedIn); 
        this.setCapabilityValue('measure_monetary', charges.data[0].cost);
        this.setCapabilityValue('meter_lastkwh', charges.data[0].consumedKwh);
        this.updateChargingState(charges.data[0].state); 
        this.updateChargerState(points.state); 
        await this.setCapabilityValue('evcharger_charging', points.state === 'busy-charging');

    } catch (error) {
        this.error('Fetch error:', error.message);
    }
  }

  async timerCallback() {
    try {
        await this.fetchMontaData();
    } finally {
        const pollInterval = this.getSetting('poll_interval') || 30;
        this.pollTimer = this.homey.setTimeout(() => this.timerCallback(), pollInterval * 1000);
    }
  }

  startTimer() {
    this.stopTimer(); 
    this.timerCallback();
  }

  stopTimer() {
    if (this.pollTimer) this.homey.clearTimeout(this.pollTimer);
  }

  setCapabilityListeners() {
    this.registerCapabilityListener("evcharger_charging", async (value) => {
      const MontaID = this.getData().id;
      if (value) {
          const startCharge = await this.homey.app.api.montaFetch('/charges', 'POST', { chargePointId: MontaID });
          await this.setStoreValue('latestChargeID', startCharge.externalId);
      } else {
          const chargeID = this.getStoreValue('latestChargeID');
          if (chargeID) await this.homey.app.api.montaFetch(`/charges/${chargeID}/stop`, 'POST');
      }
    });
  }
};