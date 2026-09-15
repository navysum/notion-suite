import obsidianmd from "eslint-plugin-obsidianmd";

// The community directory runs its own review scan server-side. This config is
// the documented local proxy for it, so a submission is not the first time
// those rules get applied to this code.
export default [
	{ ignores: ["main.js", "node_modules/**", "tests/**", "*.mjs"] },
	...obsidianmd.configs.recommended,
	{
		// Several of the rules need type information to run at all.
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
];
