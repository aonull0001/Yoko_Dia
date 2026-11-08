import { describe, expect, it } from 'vitest';
import { calculateIntermediateTimes, checkConflicts, validateTrain } from '../src/engine';
import { createTrain, parseTime, formatTime, serviceCode, stationsForDirection } from '../src/data';
import { parseYtd } from '../src/storage';

describe('diagram domain rules', () => {
  it('formats and parses seconds, including times beyond midnight', () => {
    expect(formatTime(86405)).toBe('24:00:05');
    expect(parseTime('25:10:30')).toBe(90630);
    expect(parseTime('24:60:00')).toBeNull();
  });
  it('keeps destination code separate from the train number', () => {
    expect(serviceCode(6, 4)).toBe('A64');
    const train = createTrain();
    train.trainNumber = '2001';
    expect(train.serviceCode).not.toBe(train.trainNumber);
  });
  it('calculates sequential times and validates invalid inputs', () => {
    const times = calculateIntermediateTimes([60, 90, 120, 60, 30], [0, 10, 10, 0, 5, 0], '下り');
    expect(times).toEqual([0, 60, 160, 290, 350, 385]);
    expect(() => calculateIntermediateTimes([-1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0], '下り')).toThrow();
  });
  it('detects reversed times and possible platform overlap without claiming safety', () => {
    const first = createTrain();
    first.calls[1].arrival = 22000;
    first.calls[1].departure = 21000;
    first.calls[0].platform = '1';
    const second = createTrain();
    second.calls[0].platform = '1';
    expect(validateTrain(first).some((issue) => issue.message.includes('到着が出発より後'))).toBe(true);
    expect(checkConflicts([first, second]).some((issue) => issue.severity === '競合の可能性あり')).toBe(true);
  });
  it('reverses station presentation for up trains', () => {
    expect(stationsForDirection('上り').map((station) => station.id)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(stationsForDirection('下り').map((station) => station.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('marks overlapping station stops for review when platform data is missing', () => {
    const first = createTrain();
    const second = createTrain();
    const result = checkConflicts([first, second]);
    expect(result.some((issue) => issue.severity === '要確認' && issue.message.includes('停車時刻が重複'))).toBe(true);
  });
  it('rejects malformed or unsupported YTD without replacing data', () => {
    expect(() => parseYtd('{')).toThrow();
    expect(() => parseYtd(JSON.stringify({ format: 'YokohamaTrainDiagram', version: 99, trains: [] }))).toThrow();
  });
});
