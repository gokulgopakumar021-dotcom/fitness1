import React from 'react';
import { Info } from 'lucide-react';
import { AI_NOTICES, type AiNoticeKind } from '../../legal/aiNotices';

/**
 * Compact, in-context AI / fitness notice. Muted, small, one paragraph, so it informs without dominating the screen and
 * does not change the surrounding layout. Wording lives in src/legal/aiNotices.ts.
 */
export const AiNotice: React.FC<{ kind: AiNoticeKind; className?: string }> = ({ kind, className = '' }) => {
  const n = AI_NOTICES[kind];
  return (
    <p
      role="note"
      aria-label={n.label}
      data-ai-notice={kind}
      className={`flex items-start gap-1.5 text-label leading-snug text-zinc-500 ${className}`}
    >
      <Info className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden />
      <span>{n.text}</span>
    </p>
  );
};
