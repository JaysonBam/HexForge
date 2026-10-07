import { Box } from 'lucide-react';

export const PrintLocationBadge = ({ label, className = '' }: { label?: string; className?: string }) => {
  const location = label?.trim();
  if (!location) return null;

  return (
    <span
      className={`forge-badge forge-badge-green h-[18px] min-w-0 gap-1 px-1.5 text-[10px] leading-none normal-case tracking-normal ${className}`}
      title={`Print location: ${location}`}
    >
      <Box size={12} className="shrink-0" aria-hidden="true" />
      <span className="sr-only">Print location: </span>
      <span className="truncate">{location}</span>
    </span>
  );
};
