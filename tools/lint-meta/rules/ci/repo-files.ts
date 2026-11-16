/*
 * YAML line helpers for the workflow rules that read `ctx.workflowFiles` line by line.
 */

/** A YAML line with its trailing comment removed (a `#` at the start or after whitespace). */
export function stripYamlComment(line: string): string {
  return line.replace(/(^|\s)#.*$/u, '');
}

/** A YAML scalar with surrounding quotes removed. */
export function unquote(value: string): string {
  return value.trim().replace(/^(['"])(.*)\1$/u, '$2');
}
