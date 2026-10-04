export type LeagueSchedule = {
  days: number[];
  hour_from: number;
  hour_to: number;
};

export const WEEKDAYS: { d: number; label: string }[] = [
  { d: 1, label: 'Pzt' },
  { d: 2, label: 'Sal' },
  { d: 3, label: 'Çar' },
  { d: 4, label: 'Per' },
  { d: 5, label: 'Cum' },
  { d: 6, label: 'Cmt' },
  { d: 7, label: 'Paz' },
];

export function formatSchedule(s: LeagueSchedule | null | undefined): string {
  if (!s?.days?.length) return 'Varsayılan ritim';
  const days = s.days
    .slice()
    .sort((a, b) => a - b)
    .map((d) => WEEKDAYS.find((x) => x.d === d)?.label ?? String(d))
    .join(', ');
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${days} · ${pad(s.hour_from)}:00–${pad(s.hour_to)}:00`;
}

export const SCHEDULE_PRESETS: { label: string; days: number[]; hour_from: number; hour_to: number }[] = [
  { label: 'Her gün', days: [1, 2, 3, 4, 5, 6, 7], hour_from: 0, hour_to: 23 },
  { label: 'Hafta içi', days: [1, 2, 3, 4, 5], hour_from: 19, hour_to: 22 },
  { label: 'Hafta sonu', days: [6, 7], hour_from: 16, hour_to: 22 },
  { label: 'Akşam', days: [1, 2, 3, 4, 5, 6, 7], hour_from: 18, hour_to: 23 },
];
