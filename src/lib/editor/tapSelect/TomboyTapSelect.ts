// TipTap wrapper around the read-mode tap-select plugin.
//
// See tapSelectPlugin.ts for the state machine. This extension exists only
// to register the plugin under TipTap's extension system and to expose a
// clearTapSelection command for consumers (e.g. when the note becomes
// editable or the user navigates to a different note).

import { Extension } from '@tiptap/core';
import { createTapSelectPlugin, tapSelectPluginKey } from './tapSelectPlugin.js';

export interface TomboyTapSelectOptions {
	onSelectionChange?: (text: string | null) => void;
}

declare module '@tiptap/core' {
	interface Commands<ReturnType> {
		tomboyTapSelect: {
			clearTapSelection: () => ReturnType;
		};
	}
}

export const TomboyTapSelect = Extension.create<TomboyTapSelectOptions>({
	name: 'tomboyTapSelect',

	addOptions() {
		return { onSelectionChange: undefined };
	},

	addProseMirrorPlugins() {
		return [createTapSelectPlugin(this.options)];
	},

	addCommands() {
		return {
			clearTapSelection:
				() =>
				({ tr, dispatch }) => {
					if (dispatch) dispatch(tr.setMeta(tapSelectPluginKey, { type: 'clear' }));
					return true;
				},
		};
	},
});
