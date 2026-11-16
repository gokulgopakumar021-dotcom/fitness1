import { BluetoothDeviceInfo, HeartRateData, calculateHeartRateZone } from '../types/bluetooth';
import { logClientError } from '../lib/clientLog';
import { parseHeartRateMeasurement, parseBatteryLevel } from '../wearables/heartRate';
import { detectWearableCapabilities, readCapabilityEnv } from '../wearables/capabilities';

type HeartRateCallback = (data: HeartRateData) => void;
type BatteryCallback = (level: number) => void;
type DisconnectCallback = () => void;
type ErrorCallback = (error: string) => void;

class BluetoothFitnessService {
  private device: any = null;
  private server: any = null;
  private hrCharacteristic: any = null;
  private batteryCharacteristic: any = null;

  private hrListeners: Set<HeartRateCallback> = new Set();
  private batteryListeners: Set<BatteryCallback> = new Set();
  private disconnectListeners: Set<DisconnectCallback> = new Set();
  private errorListeners: Set<ErrorCallback> = new Set();

  private isSimulating: boolean = false;
  private simulationInterval: any = null;
  private simulatedBpm: number = 118;
  /** Maximum heart rate for zones; null = unknown, so no zone is attached to readings. */
  private maxHr: number | null = null;

  public isSupported(): boolean {
    return detectWearableCapabilities(readCapabilityEnv()).directBluetooth;
  }

  public setMaxHeartRate(maxHr: number | null) {
    this.maxHr = typeof maxHr === 'number' && maxHr > 0 ? maxHr : null;
  }

  public onHeartRate(cb: HeartRateCallback) {
    this.hrListeners.add(cb);
    return () => this.hrListeners.delete(cb);
  }

  public onBattery(cb: BatteryCallback) {
    this.batteryListeners.add(cb);
    return () => this.batteryListeners.delete(cb);
  }

  public onDisconnect(cb: DisconnectCallback) {
    this.disconnectListeners.add(cb);
    return () => this.disconnectListeners.delete(cb);
  }

  public onError(cb: ErrorCallback) {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  private notifyError(err: string) {
    this.errorListeners.forEach((cb) => cb(err));
  }

  /**
   * Connect to physical Bluetooth Fitness Gadget (Heart Rate Monitor / Smart Band)
   */
  public async requestAndConnectDevice(): Promise<BluetoothDeviceInfo> {
    if (!this.isSupported()) {
      throw new Error(detectWearableCapabilities(readCapabilityEnv()).message);
    }

    try {
      this.disconnect(); // Clean up prior connection

      // Request device with standard Heart Rate Service and optional Battery service
      const navBluetooth = (navigator as any).bluetooth;
      const device = await navBluetooth.requestDevice({
        filters: [
          { services: ['heart_rate'] }
        ],
        optionalServices: ['battery_service', 'device_information']
      });

      this.device = device;
      device.addEventListener('gattserverdisconnected', () => {
        this.handleDisconnect();
      });

      const server = await device.gatt.connect();
      this.server = server;

      // 1. Setup Heart Rate Service. A device without it cannot feed live heart rate; say so instead of "connecting".
      let hrChar: any;
      try {
        const hrService = await server.getPrimaryService('heart_rate');
        hrChar = await hrService.getCharacteristic('heart_rate_measurement');
      } catch (e: any) {
        if (e?.name === 'NotFoundError') {
          try { device.gatt?.disconnect(); } catch { /* already gone */ }
          throw new Error('This device does not expose the standard Bluetooth Heart Rate service, so Iron Log cannot read heart rate from it directly.');
        }
        throw e;
      }
      this.hrCharacteristic = hrChar;

      await hrChar.startNotifications();
      hrChar.addEventListener('characteristicvaluechanged', (event: any) => {
        this.handleHeartRateValueChanged(event.target.value);
      });

      // 2. Setup Battery Service (optional). Only a value actually read from the device is ever reported.
      let batteryLevel: number | undefined;
      try {
        const batteryService = await server.getPrimaryService('battery_service');
        const batteryChar = await batteryService.getCharacteristic('battery_level');
        this.batteryCharacteristic = batteryChar;
        const val = await batteryChar.readValue();
        const level = parseBatteryLevel(val);
        if (level !== null) {
          batteryLevel = level;
          this.batteryListeners.forEach((cb) => cb(level));
        }

        await batteryChar.startNotifications();
        batteryChar.addEventListener('characteristicvaluechanged', (ev: any) => {
          const l = parseBatteryLevel(ev.target.value);
          if (l !== null) this.batteryListeners.forEach((cb) => cb(l));
        });
      } catch {
        // Battery service optional
      }

      return {
        id: device.id,
        name: device.name || 'Bluetooth Heart Rate Gadget',
        deviceType: 'heart_rate_monitor',
        connected: true,
        isSimulated: false,
        ...(batteryLevel !== undefined ? { batteryLevel } : {})
      };
    } catch (error: any) {
      logClientError('bluetooth connection failed', error);
      // A failed attempt must not leave a half-connected device behind.
      try { this.device?.gatt?.disconnect?.(); } catch { /* already gone */ }
      this.device = null;
      this.server = null;
      this.hrCharacteristic = null;
      this.batteryCharacteristic = null;
      const msg = error?.name === 'NotFoundError'
        ? 'Bluetooth pairing cancelled or no compatible device found.'
        : error?.name === 'SecurityError'
          ? 'Bluetooth permission was blocked for this page.'
          : error?.name === 'NetworkError'
            ? 'Could not connect to the device. Make sure it is nearby, awake and not connected to another app.'
            : error?.message || 'Failed to connect to Bluetooth gadget.';
      this.notifyError(msg);
      throw new Error(msg);
    }
  }

  /**
   * Parse standard BLE Heart Rate Measurement Characteristic (0x2A37)
   */
  private handleHeartRateValueChanged(value: DataView) {
    const parsed = parseHeartRateMeasurement(value);
    if (!parsed.ok) return; // malformed or "no reading": stays missing, never becomes 0
    const { bpm, contactDetected, energyExpendedJoules, rrIntervalsMs } = parsed.value;
    const zoneInfo = calculateHeartRateZone(bpm, this.maxHr);
    const hrData: HeartRateData = {
      bpm,
      contactDetected,
      energyExpendedJoules,
      rrIntervalsMs,
      timestamp: Date.now(),
      zone: zoneInfo?.zone,
      zoneName: zoneInfo?.name
    };
    this.hrListeners.forEach((cb) => cb(hrData));
  }

  /**
   * High-fidelity Simulated Gadget (Polar H10 Pro BLE Simulator)
   */
  public startSimulation(gadgetName: string = 'Polar H10 Pro (BLE Sim)'): BluetoothDeviceInfo {
    this.disconnect();
    this.isSimulating = true;
    this.simulatedBpm = 115;

    // Simulate fluctuating heart rate with realistic exertion curves
    this.simulationInterval = setInterval(() => {
      // Gentle jitter: +/- 1 to 3 bpm with natural physiological drift
      const delta = (Math.random() - 0.48) * 4;
      this.simulatedBpm = Math.min(178, Math.max(72, Math.round(this.simulatedBpm + delta)));

      const zoneInfo = calculateHeartRateZone(this.simulatedBpm, this.maxHr);

      const hrData: HeartRateData = {
        bpm: this.simulatedBpm,
        contactDetected: true,
        rrIntervalsMs: [Math.round(60000 / this.simulatedBpm)],
        timestamp: Date.now(),
        zone: zoneInfo?.zone,
        zoneName: zoneInfo?.name
      };

      this.hrListeners.forEach((cb) => cb(hrData));
    }, 1000);

    return {
      id: 'sim-ble-polar-h10',
      name: gadgetName,
      deviceType: 'heart_rate_monitor',
      connected: true,
      isSimulated: true,
      lastHeartRate: this.simulatedBpm
    };
  }

  /**
   * Set simulated exertion level (e.g. during heavy sets, rest, or warm-up)
   */
  public adjustSimulatedExertion(targetBpm: number) {
    if (this.isSimulating) {
      this.simulatedBpm = Math.min(185, Math.max(65, targetBpm));
    }
  }

  public disconnect() {
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.simulationInterval = null;
    }
    this.isSimulating = false;

    if (this.device && this.device.gatt && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    }
    this.handleDisconnect();
  }

  private handleDisconnect() {
    this.device = null;
    this.server = null;
    this.hrCharacteristic = null;
    this.batteryCharacteristic = null;
    this.disconnectListeners.forEach((cb) => cb());
  }

  public isConnected(): boolean {
    return this.isSimulating || (this.device && this.device.gatt && this.device.gatt.connected);
  }
}

export const bluetoothFitness = new BluetoothFitnessService();
