import React from 'react';
import { Lock } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { usePremiumAccess } from '../../context/EntitlementContext';

/** Lock icon + "Premium" label. Renders nothing while the account has an active trial or paid access, so free and entitled users see no change. */
export const PremiumMark: React.FC<{ className?: string }> = ({ className }) => {
  const { locked } = usePremiumAccess();
  if (!locked) return null;
  return (
    <Badge tone="warning" icon={<Lock className="w-3 h-3" aria-hidden />} className={className} title="Premium: start your trial or subscribe to unlock" data-premium-lock>
      Premium
    </Badge>
  );
};
