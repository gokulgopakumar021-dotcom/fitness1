import React, { useId } from 'react';
import { SegmentedControl, cn } from '../ui';
import {
  LOAD_STATUS_LABELS,
  getRegionLabel,
  viewsForRegion,
  MUSCLE_REGIONS,
  type BodyView,
  type LoadStatus,
  type MuscleMapSummary,
  type MuscleRegionId,
} from '../../utils/muscleMap';
import { MIRROR_TRANSFORM, PARTS_BY_VIEW, SILHOUETTE, VIEWBOX } from './muscleMapGeometry';
import { LEGEND_ORDER, STATUS_VISUALS } from './muscleMapStyles';

export interface MuscleMapProps {
  summary: MuscleMapSummary;
  view: BodyView;
  onViewChange: (view: BodyView) => void;
  selectedRegion: MuscleRegionId | null;
  onSelectRegion: (region: MuscleRegionId) => void;
}

const VIEW_LABELS: Record<BodyView, string> = { front: 'Front', back: 'Back' };

/** Accessible name of a region: its label plus its training-load category, in text. */
export const regionAccessibleName = (region: MuscleRegionId, status: LoadStatus): string =>
  `${getRegionLabel(region)}, ${LOAD_STATUS_LABELS[status]}`;

/** Small legend / list swatch drawn with the same visual treatment as the figure. */
const StatusSwatch: React.FC<{ status: LoadStatus; hatchId: string }> = ({ status, hatchId }) => {
  const v = STATUS_VISUALS[status];
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill={v.color} fillOpacity={v.fillOpacity} />
      {v.hatch && <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill={`url(#${hatchId})`} />}
      <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="none" stroke={v.stroke} strokeWidth={v.strokeWidth} strokeDasharray={v.dash} />
    </svg>
  );
};

export const MuscleMap: React.FC<MuscleMapProps> = ({ summary, view, onViewChange, selectedRegion, onSelectRegion }) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const hatchId = `muscle-hatch-${uid}`;

  const select = (id: MuscleRegionId) => onSelectRegion(id);
  const onRegionKeyDown = (id: MuscleRegionId) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      select(id);
    }
  };

  const regionsOnView = new Set(PARTS_BY_VIEW[view].map((p) => p.region));
  const selectedHidden = selectedRegion !== null && !regionsOnView.has(selectedRegion);
  const otherView: BodyView = view === 'front' ? 'back' : 'front';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <SegmentedControl<BodyView>
          ariaLabel="Body view"
          value={view}
          onChange={onViewChange}
          options={(['front', 'back'] as const).map((v) => ({ value: v, label: VIEW_LABELS[v] }))}
        />
      </div>

      <div className="rounded-xl border border-line bg-surface-2 px-3 py-4">
        <svg
          viewBox={VIEWBOX}
          className="mx-auto block h-auto w-full max-w-[11rem] select-none"
          role="group"
          aria-label={`${VIEW_LABELS[view]} body view. Select a muscle region.`}
        >
          <defs>
            <pattern id={hatchId} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="4" stroke="var(--text-muted)" strokeWidth="1" strokeOpacity="0.55" />
            </pattern>
          </defs>

          <g aria-hidden="true" fill="var(--bg-surface-3)" stroke="var(--border-card-hover)" strokeWidth="1">
            {SILHOUETTE.map((s, i) => (
              <React.Fragment key={i}>
                <path d={s.d} />
                {s.mirror && <path d={s.d} transform={MIRROR_TRANSFORM} />}
              </React.Fragment>
            ))}
          </g>

          {[...regionsOnView].map((id) => {
            const status = summary.regions[id].status;
            const base = STATUS_VISUALS[status];
            const selected = selectedRegion === id;
            const name = regionAccessibleName(id, status);
            const parts = PARTS_BY_VIEW[view].filter((p) => p.region === id);
            const stroke = selected ? 'var(--text-primary)' : base.stroke;
            const strokeWidth = selected ? 2.75 : base.strokeWidth;
            const dash = selected ? undefined : base.dash;
            return (
              <g
                key={id}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={name}
                data-region={id}
                data-status={status}
                data-selected={selected ? 'true' : 'false'}
                onClick={() => select(id)}
                onKeyDown={onRegionKeyDown(id)}
                className="cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:[&_path]:stroke-[var(--text-primary)]"
              >
                <title>{name}</title>
                {parts.map((p) => {
                  const render = (transform?: string) => (
                    <React.Fragment key={`${p.key}${transform ? '-m' : ''}`}>
                      <path
                        d={p.d}
                        transform={transform}
                        data-part={p.key}
                        fill={base.color}
                        fillOpacity={base.fillOpacity}
                        stroke={stroke}
                        strokeWidth={strokeWidth}
                        strokeDasharray={dash}
                        strokeLinejoin="round"
                        className="motion-reduce:transition-none transition-colors"
                      />
                      {base.hatch && <path d={p.d} transform={transform} fill={`url(#${hatchId})`} pointerEvents="none" />}
                    </React.Fragment>
                  );
                  return p.mirror ? (
                    <React.Fragment key={p.key}>
                      {render()}
                      {render(MIRROR_TRANSFORM)}
                    </React.Fragment>
                  ) : (
                    render()
                  );
                })}
              </g>
            );
          })}
        </svg>

        {selectedHidden && selectedRegion && (
          <p className="mt-3 text-center text-xs text-zinc-400">
            {getRegionLabel(selectedRegion)} is on the {viewsForRegion(selectedRegion)[0]} view.{' '}
            <button
              type="button"
              onClick={() => onViewChange(otherView)}
              className="font-semibold text-accent underline underline-offset-2"
            >
              Show {otherView} view
            </button>
          </p>
        )}
      </div>

      <div role="group" aria-label="Muscle regions" className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        {MUSCLE_REGIONS.map((r) => {
          const status = summary.regions[r.id].status;
          const selected = selectedRegion === r.id;
          const hiddenHere = !regionsOnView.has(r.id);
          return (
            <button
              key={r.id}
              type="button"
              aria-pressed={selected}
              onClick={() => select(r.id)}
              data-region-button={r.id}
              className={cn(
                'flex min-h-11 items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors motion-reduce:transition-none',
                selected ? 'border-accent bg-accent/10' : 'border-line bg-surface hover:border-line-strong'
              )}
            >
              <StatusSwatch status={status} hatchId={hatchId} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-white">{r.label}</span>
                <span className="block text-[11px] text-zinc-400">
                  {LOAD_STATUS_LABELS[status]}
                  {hiddenHere && ` · ${viewsForRegion(r.id)[0]} view`}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div aria-label="Legend" role="group" className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-zinc-400">
        {LEGEND_ORDER.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <StatusSwatch status={s} hatchId={hatchId} />
            {LOAD_STATUS_LABELS[s]}
          </span>
        ))}
      </div>
    </div>
  );
};
