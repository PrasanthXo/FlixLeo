import React from 'react';
import { SourceType } from '../../types/stream';

interface SourceFilterBarProps {
  selectedSource: SourceType | 'all';
  onSelectSource: (source: SourceType | 'all') => void;
  counts: Record<string, number>;
}

export const SourceFilterBar: React.FC<SourceFilterBarProps> = ({
  selectedSource,
  onSelectSource,
  counts
}) => {
  const filters: Array<{ id: SourceType | 'all'; label: string; highlight?: string }> = [
    { id: 'all', label: 'All Sources' },
    { id: 'streamhub', label: '4K Ultra (2160p)' },
    { id: 'vault', label: 'Cloud Vault Direct' },
    { id: 'remux', label: 'Cinema Remux' },
    { id: 'fastedge', label: 'FastStream Edge' },
  ];

  return (
    <div className="flex items-center gap-1.5 p-1 bg-slate-900/80 border border-slate-800/80 rounded-xl overflow-x-auto no-scrollbar max-w-full">
      {filters.map((filter) => {
        const isActive = selectedSource === filter.id;
        const count = counts[filter.id] ?? 0;

        return (
          <button
            key={filter.id}
            onClick={() => onSelectSource(filter.id)}
            className={`px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-all flex items-center gap-1.5 ${
              isActive
                ? 'bg-amber-500 text-black shadow-sm font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <span>{filter.label}</span>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                isActive ? 'bg-black/20 text-black' : 'bg-slate-800 text-slate-500'
              }`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
};