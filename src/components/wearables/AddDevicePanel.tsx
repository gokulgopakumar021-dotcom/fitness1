import React from 'react';
import { Bluetooth, Cloud, Link2, Upload } from 'lucide-react';
import { Badge, Button, Card } from '../ui';
import type { WearableCapabilities } from '../../wearables/capabilities';

interface Props { capabilities: WearableCapabilities; connecting: boolean; connected: boolean; onConnect: () => void }

/**
 * Only routes that really exist get a working button. The others say what is missing instead of pretending.
 */
export const AddDevicePanel: React.FC<Props> = ({ capabilities, connecting, connected, onConnect }) => (
  <Card aria-labelledby="add-device-title">
    <h2 id="add-device-title" className="text-base font-semibold text-white">Add a device</h2>
    <p className="text-sm text-zinc-400 mb-3">Iron Log does not claim to work with every watch. A watch’s own app working does not mean Iron Log can read it.</p>
    <ul className="space-y-3">
      <li className="rounded-card border border-line p-3">
        <div className="flex items-start gap-3">
          <Bluetooth className="w-5 h-5 text-info mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white flex items-center gap-2 flex-wrap">Direct Bluetooth <Badge tone={capabilities.directBluetooth ? 'info' : 'neutral'}>{capabilities.directBluetooth ? 'Available in this browser' : 'Unavailable here'}</Badge></p>
            <p className="text-xs text-zinc-400 mt-1">{capabilities.message}</p>
            <ul className="text-xs text-zinc-400 mt-2 list-disc pl-4 space-y-0.5">
              <li>Works only with devices that broadcast the standard Bluetooth Heart Rate service (many chest straps; some watches have a “broadcast heart rate” mode).</li>
              <li>Only heart rate (and battery, if the device reports it) is read. Readings arrive only while this page is open.</li>
              <li>Android Chrome or Edge can support this. iPhone browsers generally cannot, and adding Iron Log to the Home Screen does not change that.</li>
              <li>No specific device has been verified yet.</li>
            </ul>
            {capabilities.directBluetooth && <Button className="mt-3" size="sm" onClick={onConnect} loading={connecting} disabled={connected}>{connected ? 'A device is connected' : 'Choose a heart-rate device'}</Button>}
          </div>
        </div>
      </li>
      {([
        [Cloud, 'Official manufacturer cloud API', 'Not configured. No provider is connected. This needs the manufacturer’s official developer access and a secure server-side sign-in flow, neither of which exists yet.'],
        [Link2, 'Third-party aggregator', 'Not implemented. It needs separate approval from the Iron Log owner before any service is used.'],
        [Upload, 'Manual data import', 'Not implemented yet.']
      ] as const).map(([Icon, title, text]) => (
        <li key={title} className="rounded-card border border-line p-3 opacity-80">
          <div className="flex items-start gap-3">
            <Icon className="w-5 h-5 text-zinc-500 mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium text-white flex items-center gap-2 flex-wrap">{title} <Badge>Not available</Badge></p>
              <p className="text-xs text-zinc-400 mt-1">{text}</p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  </Card>
);
