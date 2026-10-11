import { describe, expect, test } from 'bun:test';
import {
  buildTwimlSipDialResponse,
  fitTwilioHeaderBudget,
  TWILIO_SIP_HEADER_BUDGET,
} from '../src/cxml';
import { formatDayLabel, formatSlotRanges, getUpcomingDates } from '../src/providers/booking';

function slots(date: string, from: string, to: string, step = 30): string[] {
  const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const out: string[] = [];
  for (let m = toMinutes(from); m <= toMinutes(to); m += step) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    out.push(`${date}T${hh}:${mm}:00+01:00`);
  }
  return out;
}

/** Length of the SIP header parameters exactly as sent to Twilio */
async function sentHeaderLength(context: Record<string, string>): Promise<number> {
  const xml = await buildTwimlSipDialResponse('sip:agent@example.test', context).text();
  const sip = xml.match(/<Sip>([^<]*)<\/Sip>/)?.[1] ?? '';
  return sip.replace(/&amp;/g, '&').split('?')[1]?.length ?? 0;
}

describe('getUpcomingDates', () => {
  test('starts today in the organisation timezone and includes weekends', () => {
    // 23:30 UTC Saturday 10 Oct is already Sunday 11 Oct in Madrid
    const dates = getUpcomingDates(7, 'Europe/Madrid', new Date('2026-10-10T23:30:00Z'));
    expect(dates).toEqual([
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
    ]);
  });
});

describe('formatDayLabel', () => {
  test('labels 2026 dates with their real weekday', () => {
    expect(formatDayLabel('2026-10-13')).toBe('Tue 13 Oct');
    expect(formatDayLabel('2026-10-14')).toBe('Wed 14 Oct');
    expect(formatDayLabel('2026-10-15')).toBe('Thu 15 Oct');
  });
});

describe('formatSlotRanges', () => {
  test('collapses contiguous slots into a range with the interval', () => {
    expect(formatSlotRanges(slots('2026-10-12', '06:00', '21:30'))).toBe('06:00-21:30 every 30m');
  });

  test('keeps gaps as separate ranges and single slots', () => {
    const day = [
      ...slots('2026-10-12', '10:00', '11:00'),
      '2026-10-12T14:00:00+01:00',
      ...slots('2026-10-12', '16:00', '16:30'),
    ];
    expect(formatSlotRanges(day)).toBe('10:00-11:00, 14:00, 16:00-16:30 every 30m');
  });

  test('marks a day with no slots', () => {
    expect(formatSlotRanges([])).toBe('none');
  });
});

describe('fitTwilioHeaderBudget', () => {
  const base = {
    callerName: 'John',
    callerPhone: '+447729417490',
    currentDate: 'Sunday, October 11, 2026',
    currentTime: '11:51 AM',
    fromNumber: '+447729417490',
    toNumber: '+442046528151',
  };
  const week = getUpcomingDates(7, 'Europe/London', new Date('2026-10-11T10:00:00Z'))
    .map((d) => `${formatDayLabel(d)}: ${formatSlotRanges(slots(d, '06:00', '21:30'))}`)
    .join(' | ');

  test('a full week of availability fits without trimming', async () => {
    const context = { ...base, callerHistory: 'new caller', availability: week };
    expect(fitTwilioHeaderBudget(context)).toEqual(context);
    expect(await sentHeaderLength(context)).toBeLessThan(TWILIO_SIP_HEADER_BUDGET);
  });

  test('trims furthest availability days first, then bookings, to stay under budget', async () => {
    const history = Array.from(
      { length: 5 },
      (_, i) => `Private Tour - Mon, Oct ${12 + i}, 10:00 AM [uid:63i7d9jBeuGnwKm1wPND1${i}]`,
    ).join('; ');
    const fragmented = getUpcomingDates(7, 'Europe/London', new Date('2026-10-11T10:00:00Z'))
      .map((d) => `${formatDayLabel(d)}: 06:00, 07:30, 09:00, 10:30, 12:00, 13:30, 15:00, 16:30 every 30m`)
      .join(' | ');
    const context = { ...base, callerHistory: history, availability: fragmented };

    const fitted = fitTwilioHeaderBudget(context);
    expect(await sentHeaderLength(context)).toBeLessThan(TWILIO_SIP_HEADER_BUDGET);
    expect(fitted.availability.length).toBeLessThan(context.availability.length);
    expect(fitted.availability.startsWith('Sun 11 Oct')).toBe(true);
    expect(context.availability.startsWith(fitted.availability)).toBe(true);
  });
});
