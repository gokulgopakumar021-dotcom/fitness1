import React from 'react';
import {
  Bluetooth,
  Heart,
  Battery,
  Zap,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Radio,
  Flame,
  Watch,
  Info,
  RefreshCw,
  PowerOff
} from 'lucide-react';
import { useBluetoothGadget } from '../../context/BluetoothGadgetContext';
import { HEART_RATE_ZONES } from '../../types/bluetooth';
import { Button, Modal } from '../ui';

export const BluetoothGadgetModal: React.FC = () => {
  const {
    isGadgetModalOpen,
    setIsGadgetModalOpen,
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
    connectRealDevice,
    connectSimulatedDevice,
    disconnect,
    setExertion
  } = useBluetoothGadget();

  return (
    <Modal
      open={isGadgetModalOpen}
      onClose={() => setIsGadgetModalOpen(false)}
      size="lg"
      title="Bluetooth & Sensor Hub"
      description={isConnected && device ? `Connected to ${device.name}` : 'Pair BLE chest straps, smart bands, and fitness telemetry'}
      closeLabel="Close Bluetooth Hub"
      footer={<Button variant="secondary" onClick={() => setIsGadgetModalOpen(false)}>Done</Button>}
    >
      <div className="space-y-5">
        {error && (
          <div className="p-3 bg-danger/10 border border-danger/30 rounded-xl flex items-start gap-2.5 text-xs text-danger">
            <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        {/* CONNECTED STATE */}
        {isConnected && device ? (
          <div className="space-y-4">
            {/* Live Gadget Card */}
            <div className="p-4 bg-white/[0.02] border border-line rounded-xl space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-line">
                <div className="flex items-center gap-2 text-xs">
                  <Watch className="w-4 h-4 text-info" />
                  <span className="font-bold text-white text-sm">{device.name}</span>
                  <span className="text-white/30">·</span>
                  <span className="font-mono text-white/50">
                    {isSimulated ? 'Simulated BLE' : 'Hardware BLE'}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs font-mono text-white/60">
                  {batteryLevel !== null && (
                    <span className="flex items-center gap-1.5 text-white/80">
                      <Battery className="w-3.5 h-3.5 text-accent" />
                      <span>{batteryLevel}%</span>
                    </span>
                  )}
                  <span className="text-white/30">·</span>
                  <button
                    onClick={disconnect}
                    className="flex items-center gap-1 px-2.5 py-1 text-danger hover:bg-danger/10 border border-danger/30 rounded-lg font-bold text-xs transition-colors"
                  >
                    <PowerOff className="w-3 h-3" />
                    <span>Disconnect</span>
                  </button>
                </div>
              </div>

              {/* Heart Rate Display */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
                <div className="p-3 bg-surface-2 border border-line rounded-xl">
                  <div className="text-[11px] font-mono tracking-wide text-white/50 flex items-center gap-1.5">
                    <Heart className="w-3.5 h-3.5 text-danger fill-danger animate-pulse" />
                    <span>Heart Rate</span>
                  </div>
                  <div className="text-2xl sm:text-3xl font-bold font-mono text-white mt-1 flex items-baseline gap-1.5">
                    <span>{liveHeartRate ?? '--'}</span>
                    <span className="text-xs text-white/40 font-normal">BPM</span>
                  </div>
                </div>

                <div className="p-3 bg-surface-2 border border-line rounded-xl">
                  <div className="text-[11px] font-mono tracking-wide text-white/50 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-accent" />
                    <span>Training Zone</span>
                  </div>
                  <div className="text-base sm:text-lg font-bold font-mono text-accent mt-1 truncate">
                    Zone {currentZone.zone}
                  </div>
                  <div className="text-[11px] text-white/50 truncate">
                    {currentZone.name.split(':')[1] || currentZone.name}
                  </div>
                </div>

                <div className="p-3 bg-surface-2 border border-line rounded-xl col-span-2 sm:col-span-1">
                  <div className="text-[11px] font-mono tracking-wide text-white/50 flex items-center gap-1.5">
                    <Flame className="w-3.5 h-3.5 text-warning" />
                    <span>Active Burn</span>
                  </div>
                  <div className="text-2xl sm:text-3xl font-bold font-mono text-white mt-1 flex items-baseline gap-1.5">
                    <span>{Math.round(activeCaloriesBurned)}</span>
                    <span className="text-xs text-white/40 font-normal">kcal</span>
                  </div>
                </div>
              </div>

              {/* Heart Rate Sparkline */}
              {heartRateHistory.length > 5 && (
                <div className="pt-2">
                  <div className="text-[11px] font-mono text-white/50 mb-1.5 flex items-center justify-between">
                    <span>Live 60s BPM Stream</span>
                    <span className="text-accent font-bold">{liveHeartRate} BPM</span>
                  </div>
                  <div className="h-10 bg-surface rounded-lg border border-line flex items-end gap-0.5 p-1 overflow-hidden">
                    {heartRateHistory.map((item, idx) => {
                      const h = Math.max(12, Math.min(100, ((item.bpm - 60) / 120) * 100));
                      return (
                        <div
                          key={idx}
                          className="flex-1 bg-accent/80 hover:bg-accent rounded-t-sm transition-all"
                          style={{ height: `${h}%` }}
                          title={`${item.bpm} BPM`}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Simulated Exertion Controls */}
              {isSimulated && (
                <div className="pt-3 border-t border-line space-y-2">
                  <span className="text-[11px] font-mono text-white/50 tracking-wide font-semibold">
                    Simulate Workout Exertion:
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {[
                      { label: 'Rest (85)', bpm: 85 },
                      { label: 'Warm-up (110)', bpm: 110 },
                      { label: 'Working (145)', bpm: 145 },
                      { label: 'Heavy PR (172)', bpm: 172 }
                    ].map((btn) => (
                      <button
                        key={btn.bpm}
                        onClick={() => setExertion(btn.bpm)}
                        className="py-1.5 px-2 bg-white/[0.04] hover:bg-white/[0.08] border border-line text-white/80 hover:text-white rounded-lg text-xs font-mono transition-colors text-center"
                      >
                        {btn.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* DISCONNECTED / PAIRING FLOW */
          <div className="space-y-4">
            <div className="p-4 bg-white/[0.02] border border-line rounded-xl space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-info/10 border border-info/30 flex items-center justify-center text-info shrink-0">
                  <Radio className="w-5 h-5 animate-pulse" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-bold text-white text-sm">
                    Connect Real Bluetooth Fitness Monitor
                  </h3>
                  <p className="text-xs text-white/50 leading-relaxed">
                    Uses the standard Bluetooth SIG Heart Rate Service (0x180D). Supports chest straps, smart bands, and fitness watches.
                  </p>
                </div>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
                <button
                  onClick={connectRealDevice}
                  disabled={isConnecting}
                  className="touch-press flex-1 min-h-[44px] py-2.5 px-4 bg-accent hover:bg-accent-hover text-accent-ink font-bold text-xs tracking-wide rounded-xl shadow-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                >
                  <Bluetooth className={`w-4 h-4 ${isConnecting ? 'animate-spin' : ''}`} />
                  <span>{isConnecting ? 'Scanning Bluetooth Devices...' : 'Pair Physical Bluetooth Gadget'}</span>
                </button>

                <button
                  onClick={() => connectSimulatedDevice('Polar H10 Pro (BLE Sim)')}
                  className="touch-press min-h-[44px] py-2.5 px-4 bg-white/[0.04] hover:bg-white/[0.08] text-white font-bold text-xs rounded-xl border border-line flex items-center justify-center gap-2 transition-all"
                >
                  <Zap className="w-4 h-4 text-warning" />
                  <span>Launch Virtual Simulator</span>
                </button>
              </div>

              {!isSupported && (
                <div className="mt-2 p-2.5 bg-warning/10 border border-warning/20 rounded-lg text-[11px] text-warning flex items-center gap-2">
                  <Info className="w-4 h-4 shrink-0 text-warning" />
                  <span>
                    Your current browser does not expose native Web Bluetooth (requires Chrome/Edge or Android). You can use the Virtual BLE Simulator above to experience live heart rate features!
                  </span>
                </div>
              )}
            </div>

            {/* Compatible Gadgets Breakdown */}
            <div className="space-y-2">
              <span className="text-[11px] font-mono text-white/50 tracking-wide font-semibold">
                Tested &amp; Compatible Gadgets:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="p-3 bg-white/[0.02] border border-line rounded-xl space-y-1">
                  <div className="font-bold text-white flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-accent" />
                    <span>Chest Strap Monitors</span>
                  </div>
                  <p className="text-[11px] text-white/50">
                    Polar H10, H9, Garmin HRM-Pro, Wahoo TICKR, CooSpo H6
                  </p>
                </div>

                <div className="p-3 bg-white/[0.02] border border-line rounded-xl space-y-1">
                  <div className="font-bold text-white flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-accent" />
                    <span>Optical Bands &amp; Watches</span>
                  </div>
                  <p className="text-[11px] text-white/50">
                    Scosche Rhythm+, Whoop 4.0, Apple Watch &amp; Galaxy Watch (via BLE HR broadcast)
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Heart Rate Zones Reference Table */}
        <div className="space-y-2 pt-3 border-t border-line">
          <span className="text-[11px] font-mono text-white/50 tracking-wide font-semibold">
            Target Heart Rate Zones:
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-xs font-mono">
            {HEART_RATE_ZONES.map((z) => (
              <div
                key={z.zone}
                className={`p-2 rounded-lg border text-center transition-colors ${
                  liveHeartRate && currentZone.zone === z.zone
                    ? 'border-accent bg-accent/10 text-accent font-bold'
                    : 'bg-white/[0.02] border-line text-white/50'
                }`}
              >
                <div className="font-extrabold text-[11px]">Z{z.zone}</div>
                <div className="text-[11px] truncate">{z.minPct}-{z.maxPct}%</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
};
