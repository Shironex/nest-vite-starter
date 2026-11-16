import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// The overlay dock appends its own node to document.body outside React, so a
// leaked panel from one test would be visible to the next.
afterEach(() => {
  cleanup();
});
