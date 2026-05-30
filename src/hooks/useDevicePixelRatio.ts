'use client';

import { useEffect, useState } from 'react';

function getRatio(): number {
  if (typeof window === 'undefined') return 1;
  return window.devicePixelRatio;
}

export function useDevicePixelRatio(): number {
  const [ratio, setRatio] = useState(() => getRatio());

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const update = () => {
      const ratio = getRatio();
      console.debug(`Setting pixel ratio: ${ratio}`);
      setRatio(ratio);
    };
    update();

    const media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);

    media.addEventListener('change', update);
    return () => {
      media.removeEventListener('change', update);
    };
  }, []);

  return ratio;
}
