// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(import.meta.dirname, '../..', p), 'utf8');

describe('BT-04 source guards', () => {
  it('no hard-coded battery levels or fabricated fallbacks remain', () => {
    expect(read('src/services/bluetoothFitness.ts')).not.toMatch(/batteryLevel:\s*\d+/);
    expect(read('src/services/bluetoothFitness.ts')).not.toMatch(/batteryListeners\.forEach\(\(cb\) => cb\(\d+\)\)/);
    expect(read('src/context/BluetoothGadgetContext.tsx')).not.toMatch(/batteryLevel \?\? \d+/);
  });
  it('both AI trainer call sites go through the consent- and simulation-gated context builder', () => {
    for (const f of ['src/components/trainer/FloatingTrainerWidget.tsx', 'src/components/trainer/AiTrainerView.tsx']) {
      const s = read(f);
      expect(s).toContain('buildTrainerBluetoothContext(');
      expect(s).not.toMatch(/bluetooth:\s*\{\s*isConnected,\s*bpm:\s*liveHeartRate/);
    }
  });
  it('the modal does not claim tested/verified compatibility or name unverified devices as compatible', () => {
    const s = read('src/components/bluetooth/BluetoothGadgetModal.tsx');
    expect(s).not.toMatch(/Tested\s*&amp;\s*Compatible/);
    expect(s).not.toMatch(/Apple Watch &amp; Galaxy Watch|Whoop 4\.0/);
  });
  it('wearable code never references service-role keys or provider secrets in browser-reachable modules', () => {
    for (const f of ['src/wearables/types.ts', 'src/wearables/normalize.ts', 'src/wearables/consent.ts', 'src/wearables/trainerContext.ts'])
      expect(read(f)).not.toMatch(/service_role|SERVICE_ROLE|client_secret|refresh_token|VITE_[A-Z_]*SECRET/i);
  });
  it('LEGAL.isDraft is untouched by this stage', () => {
    expect(read('src/legal/legalConfig.ts')).toMatch(/isDraft:\s*true/);
  });
});
