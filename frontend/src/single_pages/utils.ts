/**
 * Byte-identical port of twister.html's hashOf — the hash is sent as
 * `filename` to the tts endpoint, where it becomes part of the GCS
 * object name, so the same text must keep producing the same hash.
 */
export function hashOf(text: string): string {
  return (
    'hash' +
    text.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0)
  );
}
