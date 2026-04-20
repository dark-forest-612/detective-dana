#!/usr/bin/env node
// Renders firestore.rules from firestore.rules.template, substituting
// {{NOTES_COLLECTION}} / {{APP_SETTINGS_COLLECTION}} with the values
// from .env (or process.env if set). Run manually via
// `npm run rules:build`, or automatically via the firebase.json
// predeploy hook.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = resolve(ROOT, 'firestore.rules.template');
const OUT = resolve(ROOT, 'firestore.rules');

const DEFAULTS = {
	PUBLIC_FIREBASE_NOTES_COLLECTION: 'notes',
	PUBLIC_FIREBASE_APP_SETTINGS_COLLECTION: 'appSettings'
};

// Collection names must be non-empty, ≤1500 bytes, no '/', and not
// match the reserved `__.*__` pattern. Keep the check tight so a typo
// in .env fails loudly instead of producing broken rules.
const VALID_NAME = /^(?!__.*__$)[^/]{1,1500}$/;

function parseDotEnv(path) {
	if (!existsSync(path)) return {};
	const out = {};
	const text = readFileSync(path, 'utf8');
	for (const rawLine of text.split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const eq = line.indexOf('=');
		if (eq === -1) continue;
		const key = line.slice(0, eq).trim();
		let value = line.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		out[key] = value;
	}
	return out;
}

// Precedence matches Vite's loader: .env.local > .env (we don't split
// on mode here because Firestore rules don't have a dev/prod distinction
// at rule-generation time — deploy what you configure).
const envFromFiles = {
	...parseDotEnv(resolve(ROOT, '.env')),
	...parseDotEnv(resolve(ROOT, '.env.local'))
};

function resolveVar(name) {
	const value = process.env[name] ?? envFromFiles[name] ?? DEFAULTS[name];
	if (!VALID_NAME.test(value)) {
		throw new Error(
			`Invalid value for ${name}: ${JSON.stringify(value)}. ` +
				'Must be a non-empty string without "/" and not match /^__.*__$/.'
		);
	}
	return value;
}

const notes = resolveVar('PUBLIC_FIREBASE_NOTES_COLLECTION');
const settings = resolveVar('PUBLIC_FIREBASE_APP_SETTINGS_COLLECTION');

const template = readFileSync(TEMPLATE, 'utf8');
const rendered = template
	.replaceAll('{{NOTES_COLLECTION}}', notes)
	.replaceAll('{{APP_SETTINGS_COLLECTION}}', settings);

writeFileSync(OUT, rendered);
console.log(
	`Wrote ${OUT}\n  notes       -> ${notes}\n  appSettings -> ${settings}`
);
