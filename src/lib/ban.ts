import { dateTime } from '@/lib/format';

export interface BanFields {
  ban_permanent?: boolean;
  ban_until?: string | null;
}

export function banActive(p: BanFields | null | undefined): boolean {
  if (!p) return false;
  if (p.ban_permanent) return true;
  return !!p.ban_until && Date.parse(p.ban_until) > Date.now();
}

/** Girişte gösterilen metin. Süreli banda bitiş saati de eklenir. */
export function banMessage(p: BanFields | null | undefined): string {
  if (p && !p.ban_permanent && p.ban_until && Date.parse(p.ban_until) > Date.now()) {
    return `Hesabınız banlanmıştır. Ban ${dateTime(p.ban_until)} tarihine kadar sürer.`;
  }
  return 'Hesabınız banlanmıştır.';
}

export function banStatusLabel(p: BanFields | null | undefined): string | null {
  if (!p) return null;
  if (p.ban_permanent) return 'Kalıcı ban';
  if (p.ban_until && Date.parse(p.ban_until) > Date.now()) return `${dateTime(p.ban_until)} tarihine kadar`;
  if (p.ban_until) return 'Ban süresi doldu';
  return null;
}
