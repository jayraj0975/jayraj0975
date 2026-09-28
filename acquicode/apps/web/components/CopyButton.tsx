'use client';

import { useState } from 'react';

/** Copies the value of a text field (by id) to the clipboard. Without JavaScript the field itself remains selectable. */
export function CopyButton({ target, label = 'Copy' }: { target: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <button
      type="button"
      className="btn small"
      onClick={async () => {
        const el = document.getElementById(target) as HTMLInputElement | HTMLTextAreaElement | null;
        if (!el) return;
        try {
          await navigator.clipboard.writeText(el.value);
          setState('copied');
        } catch {
          el.select();
          setState('failed');
        }
        setTimeout(() => setState('idle'), 2500);
      }}
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Selected: press Ctrl+C' : label}
    </button>
  );
}
