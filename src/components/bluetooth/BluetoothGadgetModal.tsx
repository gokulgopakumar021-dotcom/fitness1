import React from 'react';
import {
  Bluetooth,
  Heart,
  Battery,
  Zap,
  Activity,
  CheckCircle2,
  AlertTriangle,
  X,
  Radio,
  Flame,
  Watch,
  Info,
  RefreshCw,
  PowerOff
} from 'lucide-react';
import { useBluetoothGadget } from '../../context/BluetoothGadgetContext';
import { HEART_RATE_ZONES } from '../../types/bluetooth';

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

  if (!isGadgetModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-[#090c12] border border-white/[0.14] rounded-2xl max-w-xl w-full p-5 sm:p-6 shadow-2xl relative my-auto space-y-5">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#00E5FF]/10 border border-[#00E5FF]/30 flex items-center justify-center text-[#00E5FF]">
              <Bluetooth className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black tracking-tight text-white font-nrc">
                  BLUETOOTH &amp; SENSOR HUB
                </h2>
                {isConnected && (
                  <span className="inline-block w-2 h-2 rounded-full bg-[#CEFF00] animate-pulse" />
                )}
              </div>
              <p className="text-xs text-white/50">
                Pair BLE chest straps, smart bands, and fitness telemetry
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsGadgetModalOpen(false)}
            aria-label="Close Bluetooth Hub"
            className="w-9 h-9 flex items-center justify-center text-white/50 hover:text-white hover:bg-white/[0.06] rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-[#FF3B30]/10 border border-[#FF3B30]/30 rounded-xl flex items-start gap-2.5 text-xs text-rose-300">
            <AlertTriangle className="w-4 h-4 text-[#FF3B30] shrink-0 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        {/* CONNECTED STATE */}
        {isConnected && device ? (
          <div className="space-y-4">
            {/* Live Gadget Card */}
            <div className="p-4 bg-white/[0.02] border border-white/[0.10] rounded-xl space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/[0.06]">
                <div className="flex items-center gap-2 text-xs">
                  <Watch className="w-4 h-4 text-[#00E5FF]" />
                  <span className="font-bold text-white text-sm">{device.name}</span>
                  <span className="text-white/30">·</span>
                  <span className="font-mono text-white/50">
                    {isSimulated ? 'Simulated BLE' : 'Hardware BLE'}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs font-mono text-white/60">
                  {batteryLevel !== null && (
                    <span className="flex items-center gap-1.5 text-white/80">
                      <Battery className="w-3.5 h-3.5 text-[#CEFF00]" />
                      <span>{batteryLevel}%</span>
                    </span>
                  )}
                  <span className="text-white/30">·</span>
                  <button
                    onClick={disconnect}
                    className="flex items-center gap-1 px-2.5 py-1 text-[#FF3B30] hover:bg-[#FF3B30]/10 border border-[#FF3B30]/30 rounded-lg font-bold text-xs transition-colors"
                  >
                    <PowerOff className="w-3 h-3" />
                    <span>Disconnect</span>
                  </button>
                </div>
              </div>

              {/* Heart Rate Display */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
                <div className="p-3 bg-[#0c1017] border border-white/[0.08] rounded-xl">
                  <div className="text-[10px] font-mono tracking-wider text-white/50 uppercase flex items-center gap-1.5">
                    <Heart className="w-3.5 h-3.5 text-[#FF3B30] fill-[#FF3B30] animate-pulse" />
                    <span>Heart Rate</span>
                  </div>
                  <div className="text-2xl sm:text-3xl font-black font-mono text-white mt-1 flex items-baseline gap-1.5">
                    <span>{liveHeartRate ?? '--'}</span>
                    <span className="text-xs text-white/40 font-normal">BPM</span>
                  </div>
                </div>

                <div className="p-3 bg-[#0c1017] border border-white/[0.08] rounded-xl">
                  <div className="text-[10px] font-mono tracking-wider text-white/50 uppercase flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-[#CEFF00]" />
                    <span>Training Zone</span>
                  </div>
                  <div className="text-base sm:text-lg font-bold font-mono text-[#CEFF00] mt-1 truncate">
                    Zone {currentZone.zone}
                  </div>
                  <div className="text-[11px] text-white/50 truncate">
                    {currentZone.name.split(':')[1] || currentZone.name}
                  </div>
                </div>

                <div className="p-3 bg-[#0c1017] border border-white/[0.08] rounded-xl col-span-2 sm:col-span-1">
                  <div className="text-[10px] font-mono tracking-wider text-white/50 uppercase flex items-center gap-1.5">
                    <Flame className="w-3.5 h-3.5 text-[#FBBF24]" />
                    <span>Active Burn</span>
                  </div>
                  <div className="text-2xl sm:text-3xl font-black font-mono text-white mt-1 flex items-baseline gap-1.5">
                    <span>{Math.round(activeCaloriesBurned)}</span>
                    <span className="text-xs text-white/40 font-normal">kcal</span>
                  </div>
                </div>
              </div>

              {/* Heart Rate Sparkline */}
              {heartRateHistory.length > 5 && (
                <div className="pt-2">
                  <div className="text-[10px] font-mono text-white/50 mb-1.5 flex items-center justify-between">
                    <span>Live 60s BPM Stream</span>
                    <span className="text-[#CEFF00] font-bold">{liveHeartRate} BPM</span>
                  </div>
                  <div className="h-10 bg-[#06080d] rounded-lg border border-white/[0.06] flex items-end gap-0.5 p-1 overflow-hidden">
                    {heartRateHistory.map((item, idx) => {
                      const h = Math.max(12, Math.min(100, ((item.bpm - 60) / 120) * 100));
                      return (
                        <div
                          key={idx}
                          className="flex-1 bg-[#CEFF00]/80 hover:bg-[#CEFF00] rounded-t-sm transition-all"
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
                <div className="pt-3 border-t border-white/[0.06] space-y-2">
                  <span className="text-[10px] font-mono text-white/50 uppercase tracking-wider font-semibold">
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
                        className="py-1.5 px-2 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.10] text-white/80 hover:text-white rounded-lg text-xs font-mono transition-colors text-center"
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
            <div className="p-4 bg-white/[0.02] border border-white/[0.10] rounded-xl space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#00E5FF]/10 border border-[#00E5FF]/30 flex items-center justify-center text-[#00E5FF] shrink-0">
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
                  className="touch-press flex-1 min-h-[44px] py-2.5 px-4 bg-[#CEFF00] hover:bg-[#b8e600] text-black font-black text-xs uppercase tracking-wider rounded-xl shadow-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                >
                  <Bluetooth className={`w-4 h-4 ${isConnecting ? 'animate-spin' : ''}`} />
                  <span>{isConnecting ? 'Scanning Bluetooth Devices...' : 'Pair Physical Bluetooth Gadget'}</span>
                </button>

                <button
                  onClick={() => connectSimulatedDevice('Polar H10 Pro (BLE Sim)')}
                  className="touch-press min-h-[44px] py-2.5 px-4 bg-white/[0.04] hover:bg-white/[0.08] text-white font-bold text-xs rounded-xl border border-white/[0.12] flex items-center justify-center gap-2 transition-all"
                >
                  <Zap className="w-4 h-4 text-[#FBBF24]" />
                  <span>Launch Virtual Simulator</span>
                </button>
              </div>

              {!isSupported && (
                <div className="mt-2 p-2.5 bg-[#FBBF24]/10 border border-[#FBBF24]/20 rounded-lg text-[11px] text-[#FBBF24] flex items-center gap-2">
                  <Info className="w-4 h-4 shrink-0 text-[#FBBF24]" />
                  <span>
                    Your current browser does not expose native Web Bluetooth (requires Chrome/Edge or Android). You can use the Virtual BLE Simulator above to experience live heart rate features!
                  </span>
                </div>
              )}
            </div>

            {/* Compatible Gadgets Breakdown */}
            <div className="space-y-2">
              <span className="text-[10px] font-mono text-white/50 uppercase tracking-wider font-semibold">
                Tested &amp; Compatible Gadgets:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="p-3 bg-white/[0.02] border border-white/[0.08] rounded-xl space-y-1">
                  <div className="font-bold text-white flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#CEFF00]" />
                    <span>Chest Strap Monitors</span>
                  </div>
                  <p className="text-[11px] text-white/50">
                    Polar H10, H9, Garmin HRM-Pro, Wahoo TICKR, CooSpo H6
                  </p>
                </div>

                <div className="p-3 bg-white/[0.02] border border-white/[0.08] rounded-xl space-y-1">
                  <div className="font-bold text-white flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#CEFF00]" />
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
        <div className="space-y-2 pt-3 border-t border-white/[0.08]">
          <span className="text-[10px] font-mono text-white/50 uppercase tracking-wider font-semibold">
            Target Heart Rate Zones:
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-xs font-mono">
            {HEART_RATE_ZONES.map((z) => (
              <div
                key={z.zone}
                className={`p-2 rounded-lg border text-center transition-colors ${
                  liveHeartRate && currentZone.zone === z.zone
                    ? 'border-[#CEFF00] bg-[#CEFF00]/10 text-[#CEFF00] font-bold'
                    : 'bg-white/[0.02] border-white/[0.08] text-white/50'
                }`}
              >
                <div className="font-extrabold text-[11px]">Z{z.zone}</div>
                <div className="text-[10px] truncate">{z.minPct}-{z.maxPct}%</div>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            onClick={() => setIsGadgetModalOpen(false)}
            className="min-h-[44px] px-5 py-2 bg-white/[0.06] hover:bg-white/[0.12] text-white font-bold text-xs rounded-xl border border-white/[0.10] transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
