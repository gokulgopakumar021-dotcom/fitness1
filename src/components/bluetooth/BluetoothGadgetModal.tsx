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
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-[#0b0f14] border border-zinc-800 rounded-2xl max-w-xl w-full p-5 sm:p-6 shadow-2xl relative my-auto space-y-5">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <Bluetooth className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-extrabold text-zinc-100 flex items-center gap-2">
                <span>Fitness Gadgets &amp; Bluetooth Hub</span>
                {isConnected && (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                )}
              </h2>
              <p className="text-xs text-zinc-400">
                Pair real BLE chest straps, smart bands, and fitness monitors
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsGadgetModalOpen(false)}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-start gap-2.5 text-xs text-rose-300">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        {/* CONNECTED STATE */}
        {isConnected && device ? (
          <div className="space-y-4">
            {/* Live Gadget Card */}
            <div className="p-4 bg-zinc-900/80 border border-sky-500/30 rounded-xl space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Watch className="w-4 h-4 text-sky-400" />
                  <span className="font-bold text-zinc-100 text-sm">{device.name}</span>
                  {isSimulated && (
                    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold">
                      Simulated BLE
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
                  {batteryLevel !== null && (
                    <span className="flex items-center gap-1 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800 text-zinc-300">
                      <Battery className="w-3.5 h-3.5 text-emerald-400" />
                      {batteryLevel}%
                    </span>
                  )}
                  <button
                    onClick={disconnect}
                    className="flex items-center gap-1 px-2.5 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-lg font-bold text-xs transition-colors"
                  >
                    <PowerOff className="w-3 h-3" />
                    <span>Disconnect</span>
                  </button>
                </div>
              </div>

              {/* Heart Rate Display */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
                <div className="p-3 bg-zinc-950/70 border border-zinc-800 rounded-lg">
                  <div className="text-[10px] font-mono text-zinc-400 uppercase flex items-center gap-1">
                    <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500 animate-pulse" />
                    <span>Heart Rate</span>
                  </div>
                  <div className="text-2xl font-extrabold font-mono text-zinc-100 mt-1 flex items-baseline gap-1">
                    <span>{liveHeartRate ?? '--'}</span>
                    <span className="text-xs text-zinc-500 font-normal">BPM</span>
                  </div>
                </div>

                <div className="p-3 bg-zinc-950/70 border border-zinc-800 rounded-lg">
                  <div className="text-[10px] font-mono text-zinc-400 uppercase flex items-center gap-1">
                    <Activity className="w-3.5 h-3.5 text-lime-400" />
                    <span>Training Zone</span>
                  </div>
                  <div className="text-sm font-bold font-mono text-lime-400 mt-1 truncate">
                    Zone {currentZone.zone}
                  </div>
                  <div className="text-[10px] text-zinc-400 truncate">
                    {currentZone.name.split(':')[1] || currentZone.name}
                  </div>
                </div>

                <div className="p-3 bg-zinc-950/70 border border-zinc-800 rounded-lg col-span-2 sm:col-span-1">
                  <div className="text-[10px] font-mono text-zinc-400 uppercase flex items-center gap-1">
                    <Flame className="w-3.5 h-3.5 text-amber-400" />
                    <span>Active Calories</span>
                  </div>
                  <div className="text-2xl font-extrabold font-mono text-zinc-100 mt-1 flex items-baseline gap-1">
                    <span>{Math.round(activeCaloriesBurned)}</span>
                    <span className="text-xs text-zinc-500 font-normal">kcal</span>
                  </div>
                </div>
              </div>

              {/* Heart Rate Sparkline */}
              {heartRateHistory.length > 5 && (
                <div className="pt-2">
                  <div className="text-[10px] font-mono text-zinc-400 mb-1 flex items-center justify-between">
                    <span>Live 60s BPM Stream</span>
                    <span className="text-lime-400 font-bold">{liveHeartRate} BPM</span>
                  </div>
                  <div className="h-10 bg-zinc-950/80 rounded border border-zinc-800/80 flex items-end gap-0.5 p-1 overflow-hidden">
                    {heartRateHistory.map((item, idx) => {
                      const h = Math.max(10, Math.min(100, ((item.bpm - 60) / 120) * 100));
                      return (
                        <div
                          key={idx}
                          className="flex-1 bg-lime-400/80 hover:bg-lime-300 rounded-t-sm transition-all"
                          style={{ height: `${h}%` }}
                          title={`${item.bpm} BPM`}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Simulated Exertion Controls (If Simulated Mode) */}
              {isSimulated && (
                <div className="pt-2 border-t border-zinc-800/80 space-y-1.5">
                  <span className="text-[11px] font-mono text-zinc-400 uppercase font-semibold">
                    Simulate Workout Exertion:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: 'Rest (85 BPM)', bpm: 85 },
                      { label: 'Warm-up (110 BPM)', bpm: 110 },
                      { label: 'Working Set (145 BPM)', bpm: 145 },
                      { label: 'Heavy PR Set (172 BPM)', bpm: 172 }
                    ].map((btn) => (
                      <button
                        key={btn.bpm}
                        onClick={() => setExertion(btn.bpm)}
                        className="px-2.5 py-1 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded text-xs font-mono"
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
            <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
                  <Radio className="w-5 h-5 animate-pulse" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-bold text-zinc-100 text-sm">
                    Connect Real Bluetooth Fitness Monitor
                  </h3>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Uses the standard Bluetooth SIG Heart Rate Service (0x180D). Supports chest straps, smart bands, and fitness watches.
                  </p>
                </div>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
                <button
                  onClick={connectRealDevice}
                  disabled={isConnecting}
                  className="touch-press flex-1 py-3 px-4 bg-sky-500 hover:bg-sky-400 text-black font-extrabold text-xs rounded-xl shadow-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                >
                  <Bluetooth className={`w-4 h-4 ${isConnecting ? 'animate-spin' : ''}`} />
                  <span>{isConnecting ? 'Scanning Bluetooth Devices...' : 'Pair Physical Bluetooth Gadget'}</span>
                </button>

                <button
                  onClick={() => connectSimulatedDevice('Polar H10 Pro (BLE Sim)')}
                  className="touch-press py-3 px-4 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs rounded-xl border border-zinc-700 flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span>Launch Virtual BLE Simulator</span>
                </button>
              </div>

              {!isSupported && (
                <div className="mt-2 p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-[11px] text-amber-300 flex items-center gap-2">
                  <Info className="w-4 h-4 shrink-0 text-amber-400" />
                  <span>
                    Your current browser does not expose native Web Bluetooth (requires Chrome/Edge or Android). You can use the Virtual BLE Simulator above to experience live heart rate features!
                  </span>
                </div>
              )}
            </div>

            {/* Compatible Gadgets Breakdown */}
            <div className="space-y-2">
              <span className="text-[11px] font-mono text-zinc-400 uppercase font-semibold">
                Tested &amp; Compatible Gadgets:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="p-3 bg-zinc-900/40 border border-zinc-800 rounded-lg space-y-1">
                  <div className="font-bold text-zinc-200 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-lime-400" />
                    <span>Chest Strap Monitors</span>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Polar H10, H9, Garmin HRM-Pro, Wahoo TICKR, CooSpo H6
                  </p>
                </div>

                <div className="p-3 bg-zinc-900/40 border border-zinc-800 rounded-lg space-y-1">
                  <div className="font-bold text-zinc-200 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-lime-400" />
                    <span>Optical Bands &amp; Watches</span>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Scosche Rhythm+, Whoop 4.0, Apple Watch &amp; Galaxy Watch (via BLE HR broadcast)
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Heart Rate Zones Reference Table */}
        <div className="space-y-2 pt-2 border-t border-zinc-800">
          <span className="text-[11px] font-mono text-zinc-400 uppercase font-semibold">
            Target Heart Rate Zones:
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-xs font-mono">
            {HEART_RATE_ZONES.map((z) => (
              <div
                key={z.zone}
                className={`p-2 rounded-lg border text-center ${
                  liveHeartRate && currentZone.zone === z.zone
                    ? z.color + ' ring-1 ring-lime-400'
                    : 'bg-zinc-900/60 border-zinc-800 text-zinc-400'
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
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs rounded-xl transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
