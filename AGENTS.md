# Project conventions

Speak Russian with the user. Keep the UI, code comments and README in English.
Keep JavaScript, TypeScript, CSS and HTML formatting conventions in this file; do
not include them in README.md. Keep this extension simple and do not introduce a
backend, database or unrelated features.

## JavaScript and TypeScript documentation

Apply these rules to every maintained `.js` and `.ts` file, including existing tests:

1. Start the file with a comprehensive comment explaining its purpose, responsibilities,
   important behavior and boundaries with other modules.
2. Describe every function before its definition, including arrow functions, callbacks,
   event handlers and methods. Explain its purpose and relevant side effects or constraints.
3. Leave one blank line after each function. For an inline callback, keep its separating
   comma with the function, then leave a blank line before the next argument or closing call.
4. Leave one blank line before each comment block, except at the very beginning of a file.
   Do not leave multiple consecutive blank lines. Treat multiline comments and consecutive
   continuation lines as a single comment block.
5. Group related functions and handlers by responsibility. Introduce each group with:
   `// ----------------------------------------------------------------- Group description`
6. Leave one blank line before each `if`, unless the immediately preceding statement is
   a `const`, `let` or `var` declaration. Keep `else if` together as a branch; do not
   insert a blank line before `else` or `else if`.
7. Leave one blank line after each complete `if`/`else` construct. Consecutive `if`
   statements share one separating blank line, never two. If an `else` follows, leave
   no blank line between branches; add the blank line only after the complete chain.

## CSS and HTML formatting

Always keep CSS and HTML in readable, pretty-printed form. Use consistent two-space
indentation. Put each CSS declaration on its own line and separate rules with one blank
line. Indent nested HTML elements and split long attribute lists across lines. Preserve
meaningful text whitespace, preformatted content, styles and behavior when formatting.

Preserve execution order when grouping initialization or event registration. Keep comments
accurate when changing behavior. For documentation-only refactors, verify that executable
code is unchanged as well as checking syntax. Do not add or expand unit tests unless asked;
use syntax checks and focused verification appropriate to the change.
