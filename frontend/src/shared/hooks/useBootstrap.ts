import { useMemo } from 'react';
import { readBootstrap } from '../bootstrap';
import type { BootstrapPayload } from '../bootstrap';

export type { BootstrapPayload };

/** Reads the `#spa-bootstrap` json_script payload once. */
export function useBootstrap(): BootstrapPayload {
  return useMemo(() => readBootstrap(), []);
}

export default useBootstrap;
