import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import {
  BluetoothDeviceInfo,
  BluetoothGadgetState,
  calculateHeartRateZone,
  HEART_RATE_ZONES
} from '../types/bluetooth';
import { bluetoothFitness } from '../services/bluetoothFitness';
import { UserProfile } from '../types';

interface BluetoothGadgetContextType extends BluetoothGadgetState {
  isGadgetModalOpen: boolean;
  setIsGadgetModalOpen: (open: boolean) => void;
  connectRealDevice: () => Promise<void>;
  connectSimulatedDevice: (name?: string) => void;
  disconnect: () => void;
  setExertion: (bpm: number) => void;
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

  const age = profile.age || 26;
  const weightKg = profile.currentWeightKg || 75;

  useEffect(() => {
    setIsSupported(bluetoothFitness.isSupported());
    bluetoothFitness.setUserAge(age);
  }, [age]);

  // Subscribe to service events
  useEffect(() => {
    const unsubHR = bluetoothFitness.onHeartRate((data) => {
      setLiveHeartRate(data.bpm);
      setHeartRateHistory((prev) => {
        const next = [...prev, { time: data.timestamp, bpm: data.bpm }];
        return next.slice(-60); // keep last 60 seconds
      });

      // Calculate approximate active calorie expenditure per second using Keytel formula:
      // Cal/min = (-55.0969 + (0.6309 x HR) + (0.1988 x Weight) + (0.2017 x Age)) / 4.184
      if (data.bpm > 90) {
        const calPerMin = Math.max(
          1,
          (-55.0969 + 0.6309 * data.bpm + 0.1988 * weightKg + 0.2017 * age) / 4.184
        );
        const calPerSec = calPerMin / 60;
        setActiveCaloriesBurned((prev) => Number((prev + calPerSec).toFixed(1)));
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
  }, [age, weightKg]);

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
    setBatteryLevel(dev.batteryLevel ?? 88);
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

  const currentZone = liveHeartRate
    ? calculateHeartRateZone(liveHeartRate, age)
    : HEART_RATE_ZONES[0];

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
