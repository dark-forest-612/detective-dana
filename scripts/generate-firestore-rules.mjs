#!/usr/bin/env node
// Renders firestore.rules from firestore.rules.template.
//
// Each `// BEGIN_BLOCK:<NAME> ... // END_BLOCK:<NAME>` section in the
// template is duplicated once per collection name, with the `{{X}}`
// placeholder filled in. That lets several projects share one database
// by listing every project's collection name in a single deploy.
//
// Collection name sources (first match wins, per role):
//   1. FIREBASE_RULES_<ROLE>_COLLECTIONS — comma-separated list.
//   2. PUBLIC_FIREBASE_<ROLE>_COLLECTION — singular, same var the
//      client reads. Used when the list var is unset.
//   3. A hard-coded default.
//
// Run manually with `npm run rules:build` or automatically via the
// firebase.json predeploy hook.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = resolve(ROOT, 'firestore.rules.template');
const OUT = resolve(ROOT, 'firestore.rules');

const ROLES = [
	{
		role: 'NOTES',
		block: 'NOTES',
		placeholder: '{{NOTES_COLLECTION}}',
		defaultName: 'notes'
	},
	{
		role: 'APP_SETTINGS',
		block: 'APP_SETTINGS',
		placeholder: '{{APP_SETTINGS_COLLECTION}}',
		defaultName: 'appSettings'
	}
];

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

// Precedence matches Vite's loader: .env.local > .env. (We don't split
// on mode — Firestore rules have no dev/prod distinction at
// generation time; deploy what you configure.)
const envFromFiles = {
	...parseDotEnv(resolve(ROOT, '.env')),
	...parseDotEnv(resolve(ROOT, '.env.local'))
};

function lookup(key) {
	return process.env[key] ?? envFromFiles[key];
}

function resolveCollections({ role, defaultName }) {
	const listKey = `FIREBASE_RULES_${role}_COLLECTIONS`;
	const singleKey = `PUBLIC_FIREBASE_${role}_COLLECTION`;

	const listRaw = lookup(listKey);
	let names;
	if (listRaw !== undefined) {
		// Accept ASCII comma, fullwidth comma (U+FF0C) and semicolons as
		// separators. IME-typed commas are a frequent foot-gun: they look
		// identical to ASCII commas in most terminals but String.split(',')
		// treats the value as a single name, producing a rules file like
		// `match /a,b/{id}` that the Firestore compiler rejects.
		names = listRaw
			.split(/[,，;；]/)
			.map((s) => s.trim())
			.filter(Boolean);
		if (names.length === 0) {
			throw new Error(`${listKey} is set but contains no collection names.`);
		}
	} else {
		names = [lookup(singleKey) ?? defaultName];
	}

	// Dedupe — identical match blocks would be redundant and some
	// versions of the Firestore rules compiler reject them.
	const unique = [...new Set(names)];

	for (const name of unique) {
		if (!VALID_NAME.test(name)) {
			throw new Error(
				`Invalid collection name ${JSON.stringify(name)} for ${role}. ` +
					'Must be a non-empty string without "/" and not match /^__.*__$/.'
			);
		}
	}
	return unique;
}

function expandBlock(source, blockName, placeholder, names) {
	const begin = `// BEGIN_BLOCK:${blockName}\n`;
	const end = `// END_BLOCK:${blockName}\n`;
	const startIdx = source.indexOf(begin);
	if (startIdx === -1) {
		throw new Error(`Template is missing ${begin.trim()}`);
	}
	const endIdx = source.indexOf(end, startIdx);
	if (endIdx === -1) {
		throw new Error(`Template is missing ${end.trim()} after ${begin.trim()}`);
	}
	const body = source.slice(startIdx + begin.length, endIdx);
	const copies = names.map((n) => body.replaceAll(placeholder, n));
	return (
		source.slice(0, startIdx) +
		copies.join('\n') +
		source.slice(endIdx + end.length)
	);
}

let rendered = readFileSync(TEMPLATE, 'utf8');
const summary = [];
for (const spec of ROLES) {
	const names = resolveCollections(spec);
	rendered = expandBlock(rendered, spec.block, spec.placeholder, names);
	// Print the count so a silent "one name with a comma inside" failure
	// stands out — (1 name) when the user expected (2 names) is the
	// signal to check for fullwidth/IME punctuation in the env value.
	const count = `${names.length} name${names.length === 1 ? '' : 's'}`;
	summary.push(`  ${spec.role.padEnd(12)} (${count}) -> ${names.join(', ')}`);
}

writeFileSync(OUT, rendered);
console.log(`Wrote ${OUT}\n${summary.join('\n')}`);
