import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion(): boolean {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let active = true;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setEnabled);
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setEnabled(value);
    }).catch(() => {
      if (active) setEnabled(false);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return enabled;
}

