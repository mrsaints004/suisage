'use client';

import { useState } from 'react';

export function Tooltip({ term, explanation }: { term: string; explanation: string }) {
  const [show, setShow] = useState(false);

  return (
    <span className="relative inline-block">
      <span
        className="underline decoration-dotted decoration-gray-500 cursor-help"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      >
        {term}
      </span>
      {show && (
        <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-200 whitespace-nowrap shadow-lg">
          {explanation}
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-gray-800" />
        </span>
      )}
    </span>
  );
}
