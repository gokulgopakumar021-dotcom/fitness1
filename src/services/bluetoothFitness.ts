import { BluetoothDeviceInfo, HeartRateData, calculateHeartRateZone } from '../types/bluetooth';

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
  private userAge: number = 25;

  public isSupported(): boolean {
    return typeof window !== 'undefined' && typeof (navigator as any).bluetooth !== 'undefined';
  }

  public setUserAge(age: number) {
    this.userAge = age > 0 ? age : 25;
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
      throw new Error(
        'Web Bluetooth is not supported on this browser or platform. Try Google Chrome, Edge, or use the Simulator mode.'
      );
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

      // 1. Setup Heart Rate Service
      const hrService = await server.getPrimaryService('heart_rate');
      const hrChar = await hrService.getCharacteristic('heart_rate_measurement');
      this.hrCharacteristic = hrChar;

      await hrChar.startNotifications();
      hrChar.addEventListener('characteristicvaluechanged', (event: any) => {
        this.handleHeartRateValueChanged(event.target.value);
      });

      // 2. Setup Battery Service (Optional)
      try {
        const batteryService = await server.getPrimaryService('battery_service');
        const batteryChar = await batteryService.getCharacteristic('battery_level');
        this.batteryCharacteristic = batteryChar;
        const val = await batteryChar.readValue();
        const level = val.getUint8(0);
        this.batteryListeners.forEach((cb) => cb(level));

        await batteryChar.startNotifications();
        batteryChar.addEventListener('characteristicvaluechanged', (ev: any) => {
          const l = ev.target.value.getUint8(0);
          this.batteryListeners.forEach((cb) => cb(l));
        });
      } catch {
        // Battery service optional
      }

      return {
        id: device.id,
        name: device.name || 'Bluetooth Heart Rate Gadget',
        deviceType: 'heart_rate_monitor',
        connected: true,
        batteryLevel: 95
      };
    } catch (error: any) {
      console.error('Bluetooth connection failed:', error);
      const msg = error?.name === 'NotFoundError'
        ? 'Bluetooth pairing cancelled or no gadget selected.'
        : error?.message || 'Failed to connect to Bluetooth gadget.';
      this.notifyError(msg);
      throw new Error(msg);
    }
  }

  /**
   * Parse standard BLE Heart Rate Measurement Characteristic (0x2A37)
   */
  private handleHeartRateValueChanged(value: DataView) {
    if (!value || value.byteLength === 0) return;

    const flags = value.getUint8(0);
    // Bit 0: Heart Rate Value Format (0 = UINT8, 1 = UINT16)
    const is16Bit = (flags & 0x01) !== 0;
    // Bit 1-2: Sensor Contact Status
    const contactDetected = (flags & 0x06) === 0x06;

    let offset = 1;
    let bpm: number;

    if (is16Bit) {
      bpm = value.getUint16(offset, /* littleEndian */ true);
      offset += 2;
    } else {
      bpm = value.getUint8(offset);
      offset += 1;
    }

    // Bit 3: Energy Expended Present
    let energyExpendedJoules: number | undefined;
    if ((flags & 0x08) !== 0) {
      energyExpendedJoules = value.getUint16(offset, true);
      offset += 2;
    }

    // Bit 4: RR-Intervals Present
    const rrIntervalsMs: number[] = [];
    if ((flags & 0x10) !== 0) {
      while (offset + 1 < value.byteLength) {
        // 1/1024 second resolution
        const raw = value.getUint16(offset, true);
        const ms = Math.round((raw / 1024) * 1000);
        rrIntervalsMs.push(ms);
        offset += 2;
      }
    }

    const zoneInfo = calculateHeartRateZone(bpm, this.userAge);

    const hrData: HeartRateData = {
      bpm,
      contactDetected,
      energyExpendedJoules,
      rrIntervalsMs,
      timestamp: Date.now(),
      zone: zoneInfo.zone,
      zoneName: zoneInfo.name
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

      const zoneInfo = calculateHeartRateZone(this.simulatedBpm, this.userAge);

      const hrData: HeartRateData = {
        bpm: this.simulatedBpm,
        contactDetected: true,
        rrIntervalsMs: [Math.round(60000 / this.simulatedBpm)],
        timestamp: Date.now(),
        zone: zoneInfo.zone,
        zoneName: zoneInfo.name
      };

      this.hrListeners.forEach((cb) => cb(hrData));
    }, 1000);

    // Initial battery update
    setTimeout(() => {
      this.batteryListeners.forEach((cb) => cb(88));
    }, 500);

    return {
      id: 'sim-ble-polar-h10',
      name: gadgetName,
      deviceType: 'heart_rate_monitor',
      connected: true,
      batteryLevel: 88,
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
