import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// vitest runs with globals disabled, so register RTL cleanup here.
afterEach(cleanup);
