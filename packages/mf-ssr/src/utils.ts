/**
 * JSON.stringify with HTML-safe escaping for embedding in <script> tags.
 *
 * `JSON.stringify` leaves `<`, `>`, `&`, U+2028, U+2029 unescaped — all of
 * which can break or subvert a <script> element in an HTML context:
 *  - `</script>` terminates the script block (even inside attribute values)
 *  - `<!--` can start an HTML comment in legacy browsers
 *  - U+2028 / U+2029 are valid JSON but illegal raw line-terminators in JS
 *
 * Replacing them with their Unicode escape equivalents is safe: the JSON
 * consumer (JSON.parse) treats `\u003c` identically to `<`.
 */
export function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
