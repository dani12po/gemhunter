'use client';

import React from 'react';

export const TokenSkeleton: React.FC = () => {
  return (
    <div className="bg-[#0f0d1a] border border-[#30363d] rounded-2xl p-5 animate-pulse">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-12 h-12 bg-[#1a1625] rounded-xl" />
        <div className="flex-1">
          <div className="h-5 bg-[#1a1625] rounded w-24 mb-2" />
          <div className="h-3 bg-[#1a1625] rounded w-16" />
        </div>
        <div className="w-16 h-8 bg-[#1a1625] rounded-lg" />
      </div>
      
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="space-y-2">
          <div className="h-3 bg-[#1a1625] rounded w-12" />
          <div className="h-4 bg-[#1a1625] rounded w-20" />
        </div>
        <div className="space-y-2">
          <div className="h-3 bg-[#1a1625] rounded w-12" />
          <div className="h-4 bg-[#1a1625] rounded w-20" />
        </div>
      </div>

      <div className="h-10 bg-[#1a1625] rounded-xl w-full" />
    </div>
  );
};
