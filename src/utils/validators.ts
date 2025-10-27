export function normalizeTime12h(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  let s = String(input).trim();
  if (s === '') return '12:00 PM'; // pragmatic default
  s = s.toUpperCase().replace(/\s+/g, ' ');

  // "14:00" -> "02:00 PM"
  const m24 = s.match(/^(\d{1,2}):([0-5]\d)$/);
  if (m24) {
    let h = parseInt(m24[1], 10);
    const m = parseInt(m24[2], 10);
    const suffix = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`;
  }

  // "2 PM" -> "02:00 PM"
  const mHourAmPm = s.match(/^(\d{1,2})\s*(AM|PM)$/);
  if (mHourAmPm) {
    let h = parseInt(mHourAmPm[1], 10);
    const suffix = mHourAmPm[2];
    h = h % 12 || 12;
    return `${String(h).padStart(2, '0')}:00 ${suffix}`;
  }

  // "14:00 PM" / "00:30 AM" -> normalize safely
  const mWeird = s.match(/^(\d{1,2}):([0-5]\d)\s*(AM|PM)$/);
  if (mWeird) {
    let h = parseInt(mWeird[1], 10);
    const m = parseInt(mWeird[2], 10);
    const suffix = mWeird[3];
    if (h > 12) h = h % 12;
    if (h === 0) h = 12;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`;
  }

  return s; // let regex validator check exact format
}
