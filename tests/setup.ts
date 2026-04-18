import '@testing-library/jest-dom';
import { vi } from 'vitest';

// `$env/dynamic/public` is a SvelteKit virtual module. Vitest resolves it
// through the kit plugin, but stubbing it here guarantees Firebase config
// is absent in tests → repository/index.ts falls back to IDB instead of
// trying to initialise Firestore against a fake project.
vi.mock('$env/dynamic/public', () => ({
	env: {}
}));
