import dayjs from 'dayjs';
import 'dayjs/locale/tr';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);
dayjs.extend(customParseFormat);
dayjs.locale('tr');

export { dayjs };

export function money(n: number | string | null | undefined, opts: { sign?: boolean } = {}) {
  const v = Number(n ?? 0);
  const abs = Math.abs(v);
  const [int, dec] = abs.toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const s = `${grouped},${dec} ₺`;
  if (opts.sign) return (v < 0 ? '-' : '+') + s;
  return v < 0 ? '-' + s : s;
}

export function odd(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  return v.toFixed(2);
}

export function time(d: string) {
  return dayjs(d).format('HH:mm');
}

export function dateShort(d: string) {
  return dayjs(d).format('D MMM');
}

export function dateTime(d: string) {
  return dayjs(d).format('D MMM HH:mm');
}

/** "x dakika önce"; sunucu saati cihazdan ileri olsa bile asla "sonra" demez. */
export function ago(d: string | Date) {
  const t = dayjs(d);
  const diff = dayjs().diff(t, 'second');
  if (diff < 45) return 'az önce';
  return t.fromNow();
}

export function dayLabel(d: dayjs.Dayjs) {
  const today = dayjs().startOf('day');
  const diff = d.startOf('day').diff(today, 'day');
  if (diff === 0) return 'Bugün';
  if (diff === 1) return 'Yarın';
  if (diff === -1) return 'Dün';
  return capitalize(d.format('dddd'));
}

function capitalize(s: string) {
  return s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1);
}
