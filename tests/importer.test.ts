import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import * as XLSX from '@e965/xlsx';
import { previewWorkbook } from '../src/importer';
import { csvCell } from '../src/export';

describe('Excel preview and CSV export', () => {
  it('previews a generic timetable workbook without changing current data', async () => {
    const workbook = XLSX.utils.book_new();
    const headers = ['列番', '種別', '行先', '東神奈川 着', '東神奈川 発', '大口 着', '大口 発', '横浜ゲートウェイ 着', '横浜ゲートウェイ 発', '菊名 着', '菊名 発', '新横浜 着', '新横浜 発', '小机 着', '小机 発'];
    const row = ['2001', 6, '小机', null, null, null, null, null, null, null, null, '23:59:50', '23:59:55', '24:00:10', '24:00:20'];
    const sheet = XLSX.utils.aoa_to_sheet([headers, row]);
    XLSX.utils.book_append_sheet(workbook, sheet, '運行表');
    const file = new File([XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })], 'sample.xlsx');
    const preview = await previewWorkbook(file);
    expect(preview.sheetNames).toEqual(['運行表']);
    expect(preview.trains).toHaveLength(1);
    expect(preview.trains[0].trainNumber).toBe('2001');
    expect(preview.trains[0].typeId).toBe(6);
    expect(preview.trains[0].originId).toBe(5);
    expect(preview.trains[0].destinationId).toBe(6);
    expect(preview.trains[0].serviceCode).toBe('A64');
    expect(preview.trains[0].calls.find((call) => call.stationId === 5)?.arrival).toBe(86390);
  });

  it('imports the workbook staff sheet and infers pass-through times and platforms', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([]);
    const values: Record<string, string | number> = {
      K1: '下り', B2: '各停', D2: '東神奈川', F2: 6, B4: 'A61', G4: '1201A',
      D7: '小机', F7: '＝', G7: 0.5, H7: 2,
      D9: '新横浜', F9: 0.501099537, G9: 0.5014467593, H9: 1,
      D11: '菊名', F11: 0.5014467593, G11: 0.5028935185,
      D13: '横浜ゲートウェイ', F13: 0.5039351852, G13: 0.5042824074, H13: 2,
      D15: '大口', F15: 0.5042824074, G15: 0.5056712963,
      D17: '東神奈川', F17: 0.5074074074, H17: 2,
    };
    for (const [address, value] of Object.entries(values)) sheet[address] = { v: value, t: typeof value === 'number' ? 'n' : 's' };
    sheet['!ref'] = 'B1:M24';
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['使い方']]), '使い方  How to use');
    XLSX.utils.book_append_sheet(workbook, sheet, '表からスタフ');
    const file = new File([XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })], 'Yoko_Dia.xlsx');
    const preview = await previewWorkbook(file);
    expect(preview.selectedSheet).toBe('表からスタフ');
    expect(preview.trains).toHaveLength(1);
    const train = preview.trains[0];
    expect([train.trainNumber, train.serviceCode, train.typeId, train.originId, train.destinationId, train.direction]).toEqual(['1201A', 'A61', 6, 6, 1, '下り']);
    expect(train.calls.find((call) => call.stationId === 5)).toMatchObject({ arrival: 43295, departure: 43325, stop: true, platform: '1' });
    expect(train.calls.find((call) => call.stationId === 4)).toMatchObject({ arrival: 43450, departure: 43450, stop: false });
    expect(train.calls.find((call) => call.stationId === 1)).toMatchObject({ arrival: 43840, departure: null, stop: true, platform: '2' });
  });

  it('imports only numbered trains from direction sheets and skips blank template columns', async () => {
    const workbook = XLSX.utils.book_new();
    const rows: unknown[][] = Array.from({ length: 25 }, () => []);
    const put = (address: string, value: string | number) => {
      const cell = XLSX.utils.decode_cell(address);
      rows[cell.r][cell.c] = value;
    };
    put('C1', 'A61'); put('B2', '列車番号'); put('C2', '1201A'); put('B3', '種別番号'); put('C3', 6); put('D3', 6);
    put('B4', '始発駅番号'); put('C4', 4); put('B5', '終着駅番号'); put('C5', 1);
    put('B8', '始発駅'); put('C8', '小机'); put('B9', '終着駅'); put('C9', '東神奈川'); put('B10', '始発駅発車時刻'); put('C10', 0.5); put('D10', 0.5);
    put('B11', '小机 発'); put('C11', 0.5); put('B12', '小机 番線'); put('C12', 2);
    put('B13', '新横浜 着'); put('C13', 0.501099537); put('B14', '新横浜 番線'); put('C14', 1);
    put('B15', '停車時間'); put('C15', 0.0003472222); put('B16', '新横浜 発'); put('C16', 0.5014467593);
    put('B17', '菊名 発'); put('C17', 0.5028935185); put('B18', '横浜ｹﾞｰﾄｳｪｲ 着'); put('C18', 0.5039351852);
    put('B19', '横浜ｹﾞｰﾄｳｪｲ 番線'); put('C19', 2); put('B21', '横浜ｹﾞｰﾄｳｪｲ 発'); put('C21', 0.5042824074);
    put('B22', '大口 発'); put('C22', 0.5056712963); put('B23', '東神奈川 着'); put('C23', 0.5074074074);
    put('B24', '東神奈川 番線'); put('C24', 2);
    const down = XLSX.utils.aoa_to_sheet(rows);
    down['!ref'] = 'A1:D25';
    XLSX.utils.book_append_sheet(workbook, down, '下り');
    const file = new File([XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })], 'direction.xlsx');
    const preview = await previewWorkbook(file);
    expect(preview.selectedSheet).toBe('下り');
    expect(preview.trains).toHaveLength(1);
    expect(preview.trains[0].trainNumber).toBe('1201A');
    expect(preview.trains[0].calls.find((call) => call.stationId === 4)).toMatchObject({ arrival: 43450, departure: 43450, stop: false });
    expect(preview.warnings.some((warning) => warning.includes('テンプレートとして除外'))).toBe(true);
  });

  it.skipIf(!process.env.YOKO_DIA_WORKBOOK)("matches the actual workbook staff data", async () => {
    const workbookBytes = await readFile(process.env.YOKO_DIA_WORKBOOK!);
    const file = new File([new Uint8Array(workbookBytes)], 'Yoko_Dia.xlsx');
    const preview = await previewWorkbook(file);
    expect(preview.selectedSheet).toBe('表からスタフ');
    expect(preview.trains).toHaveLength(1);
    expect(preview.trains[0]).toMatchObject({ trainNumber: '1201A', serviceCode: 'A61', typeId: 6, originId: 6, destinationId: 1, direction: '下り' });
    expect(preview.trains[0].calls.find((call) => call.stationId === 4)).toMatchObject({ arrival: 43450, departure: 43450, stop: false });
    expect(preview.trains[0].calls.find((call) => call.stationId === 1)?.arrival).toBe(43840);
    const down = await previewWorkbook(file, '下り');
    expect(down.trains).toHaveLength(0);
    expect(down.warnings.some((warning) => warning.includes('24列'))).toBe(true);
  });

  it('quotes CSV fields and prevents formula cells', () => {
    expect(csvCell('=1+1')).toBe('"\'=1+1"');
    expect(csvCell('safe,"text"')).toBe('"safe,""text"""');
  });
});
