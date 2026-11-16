import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import {
  BluetoothDeviceInfo,
  BluetoothGadgetState,
  calculateHeartRateZone
} from '../types/bluetooth';
import { bluetoothFitness } from '../services/bluetoothFitness';
import { estimateActiveKcalPerMinute } from '../wearables/energy';
import { resolveMaxHeartRate } from '../wearables/heartRateZones';
import { readUserMaxHr, writeUserMaxHr } from '../wearables/maxHrStore';
import { UserProfile } from '../types';

interface BluetoothGadgetContextType extends BluetoothGadgetState {
  isGadgetModalOpen: boolean;
  setIsGadgetModalOpen: (open: boolean) => void;
  connectRealDevice: () => Promise<void>;
  connectSimulatedDevice: (name?: string) => void;
  disconnect: () => void;
  setExertion: (bpm: number) => void;
  /** Save (or clear with null) the user's own maximum heart rate. Returns the stored value. */
  setUserMaxHeartRate: (bpm: number | null) => number | null;
  userMaxHeartRate: number | null;
}

const BluetoothGadgetContext = createContext<BluetoothGadgetContextType | null>(null);

export const BluetoothGadgetProvider: React.FC<{
  children: ReactNode;
  profile: UserProfile;
}> = ({ children, profile }) => {
  const [isSupported, setIsSupported] = useState<boolean>(false);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isSimulated, setIsSimulated] = useState<boolean>(false);
  const [device, setDevice] = useState<BluetoothDeviceInfo | null>(null);
  const [liveHeartRate, setLiveHeartRate] = useState<number | null>(null);
  const [heartRateHistory, setHeartRateHistory] = useState<{ time: number; bpm: number }[]>([]);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [activeCaloriesBurned, setActiveCaloriesBurned] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [isGadgetModalOpen, setIsGadgetModalOpen] = useState<boolean>(false);

  const [userMaxHeartRate, setUserMaxHeartRateState] = useState<number | null>(() => readUserMaxHr());
  // No fallback age: with neither a plausible age nor a user value there is no maximum and no zone.
  const maxHeartRate = resolveMaxHeartRate({ age: profile.age, userMaxHr: userMaxHeartRate });
  const maxHrBpm = maxHeartRate?.bpm ?? null;

  useEffect(() => {
    setIsSupported(bluetoothFitness.isSupported());
  }, []);

  useEffect(() => {
    bluetoothFitness.setMaxHeartRate(maxHrBpm);
  }, [maxHrBpm]);

  const setUserMaxHeartRate = useCallback((bpm: number | null) => {
    const stored = writeUserMaxHr(bpm);
    setUserMaxHeartRateState(stored);
    return stored;
  }, []);

  // Subscribe to service events
  useEffect(() => {
    const unsubHR = bluetoothFitness.onHeartRate((data) => {
      setLiveHeartRate(data.bpm);
      setHeartRateHistory((prev) => {
        const next = [...prev, { time: data.timestamp, bpm: data.bpm }];
        return next.slice(-60); // keep last 60 seconds
      });

      // Approximate active energy: an ESTIMATE, produced only from real age, weight and sex (see wearables/energy.ts).
      const calPerMin = estimateActiveKcalPerMinute({ bpm: data.bpm, age: profile.age, weightKg: profile.currentWeightKg, sex: profile.sex });
      if (calPerMin !== null) {
        setActiveCaloriesBurned((prev) => Number((prev + calPerMin / 60).toFixed(1)));
      }
    });

    const unsubBat = bluetoothFitness.onBattery((level) => {
      setBatteryLevel(level);
    });

    const unsubDisc = bluetoothFitness.onDisconnect(() => {
      setIsConnected(false);
      setIsSimulated(false);
      setDevice(null);
      setLiveHeartRate(null);
    });

    const unsubErr = bluetoothFitness.onError((errMsg) => {
      setError(errMsg);
      setIsConnecting(false);
    });

    return () => {
      unsubHR();
      unsubBat();
      unsubDisc();
      unsubErr();
    };
  }, [profile.age, profile.currentWeightKg, profile.sex]);

  const connectRealDevice = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const dev = await bluetoothFitness.requestAndConnectDevice();
      setDevice(dev);
      setIsConnected(true);
      setIsSimulated(false);
      setBatteryLevel(dev.batteryLevel ?? null);
    } catch (err: any) {
      setError(err?.message || 'Bluetooth connection failed');
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const connectSimulatedDevice = useCallback((name?: string) => {
    setError(null);
    const dev = bluetoothFitness.startSimulation(name);
    setDevice(dev);
    setIsConnected(true);
    setIsSimulated(true);
    setBatteryLevel(null);
  }, []);

  const disconnect = useCallback(() => {
    bluetoothFitness.disconnect();
    setIsConnected(false);
    setIsSimulated(false);
    setDevice(null);
    setLiveHeartRate(null);
  }, []);

  const setExertion = useCallback((bpm: number) => {
    bluetoothFitness.adjustSimulatedExertion(bpm);
  }, []);

  const currentZone = liveHeartRate ? calculateHeartRateZone(liveHeartRate, maxHrBpm) : null;

  return (
    <BluetoothGadgetContext.Provider
      value={{
        isSupported,
        isConnecting,
        isConnected,
        isSimulated,
        device,
        liveHeartRate,
        heartRateHistory,
        currentZone,
        maxHeartRate,
        userMaxHeartRate,
        setUserMaxHeartRate,
        batteryLevel,
        activeCaloriesBurned,
        error,
        isGadgetModalOpen,
        setIsGadgetModalOpen,
        connectRealDevice,
        connectSimulatedDevice,
        disconnect,
        setExertion
      }}
    >
      {children}
    </BluetoothGadgetContext.Provider>
  );
};

export function useBluetoothGadget() {
  const context = useContext(BluetoothGadgetContext);
  if (!context) {
    throw new Error('useBluetoothGadget must be used within a BluetoothGadgetProvider');
  }
  return context;
}
