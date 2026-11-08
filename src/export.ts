import { STATIONS, formatTime, stationsForDirection, trainType } from './data';
import type { DiagramData, Train } from './types';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportYtd(data: DiagramData, filename = 'yokohama-diagram.ytd') {
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }), filename);
}

export function csvCell(field: unknown) {
  let value = String(field);
  if (/^[\u0009\u000d ]*[=+@-]/.test(value)) value = `'${value}`;
  return `"${value.replaceAll('"', '""')}"`;
}

export function exportCsv(trains: Train[]) {
  const header = ['列番', '種別・行先番号', '種別', '行先', '方向', ...STATIONS.flatMap((station) => [`${station.name} 到着`, `${station.name} 出発`, `${station.name} 停車`, `${station.name} 番線`])];
  const rows = trains.map((train) => [train.trainNumber, train.serviceCode, trainType(train.typeId).name, train.destination, train.direction, ...STATIONS.flatMap((station) => {
    const call = train.calls.find((item) => item.stationId === station.id);
    return [formatTime(call?.arrival ?? null), formatTime(call?.departure ?? null), call?.stop ? '停車' : '通過', call?.platform ?? ''];
  })]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  download(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }), 'yokohama-diagram.csv');
}

export async function exportPng(svg: SVGSVGElement) {
  const source = new XMLSerializer().serializeToString(svg);
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('ダイヤグラムを画像化できませんでした。'));
  });
  image.src = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
  await loaded;
  const canvas = document.createElement('canvas');
  canvas.width = svg.viewBox.baseVal.width;
  canvas.height = svg.viewBox.baseVal.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('PNG出力用Canvasを利用できません。');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  URL.revokeObjectURL(image.src);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('PNG出力に失敗しました。')), 'image/png'));
  download(blob, 'yokohama-diagram.png');
}

export async function exportStaffPng(trains: Train[]) {
  if (!trains.length) throw new Error('スタフを出力する列車がありません。');
  const ordered = [...trains].sort((a, b) => (a.operationOrder ?? earliest(a)) - (b.operationOrder ?? earliest(b)));
  const width = 794;
  const height = 100 + ordered.length * 230;
  const blocks = ordered.map((train, index) => {
    const top = 88 + index * 230;
    const heading = `<text x="24" y="${top}" font-size="18" font-weight="700">${escapeHtml(train.serviceCode)}　${escapeHtml(trainType(train.typeId).name)}　${escapeHtml(train.destination)}</text>`;
    const columns = `<text x="24" y="${top + 28}" font-size="12" font-weight="700">駅</text><text x="310" y="${top + 28}" font-size="12" font-weight="700">到着</text><text x="430" y="${top + 28}" font-size="12" font-weight="700">出発</text><text x="550" y="${top + 28}" font-size="12" font-weight="700">扱い</text><text x="650" y="${top + 28}" font-size="12" font-weight="700">番線</text>`;
    const rows = stationsForDirection(train.direction).map((station, rowIndex) => {
      const call = train.calls.find((item) => item.stationId === station.id);
      const y = top + 54 + rowIndex * 25;
      return `<line x1="20" y1="${y + 6}" x2="774" y2="${y + 6}" stroke="#d7dee8"/><text x="24" y="${y}" font-size="12">${station.name}</text><text x="310" y="${y}" font-size="12">${formatTime(call?.arrival ?? null)}</text><text x="430" y="${y}" font-size="12">${formatTime(call?.departure ?? null)}</text><text x="550" y="${y}" font-size="12">${call?.stop ? '停車' : '通過'}</text><text x="650" y="${y}" font-size="12">${escapeHtml(call?.platform ?? '')}</text>`;
    }).join('');
    return `<g>${heading}${columns}${rows}</g>`;
  }).join('');
  const operationNumber = ordered[0].trainNumber.trim() || '列番未設定';
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fff"/><text x="24" y="42" font-size="22" font-weight="700">横浜鉄道　運用スタフ　列番 ${escapeHtml(operationNumber)}</text>${blocks}</svg>`;
  const image = new Image();
  const imageUrl = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('スタフ画像を生成できませんでした。'));
      image.src = imageUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PNG出力用Canvasを利用できません。');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('スタフPNG出力に失敗しました。')), 'image/png'));
    download(blob, `staff-${operationNumber.replace(/[\\/:*?"<>|]/g, '_')}.png`);
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export function exportStaffPdf(trains: Train[]) {
  const byOperation = new Map<string, Train[]>();
  for (const train of trains) {
    const key = train.trainNumber.trim() || `未設定-${train.id}`;
    byOperation.set(key, [...(byOperation.get(key) ?? []), train]);
  }
  const sheets = [...byOperation].map(([, operation]) => {
    const number = operation[0]?.trainNumber.trim() || '列番未設定';
    const cards = [...operation].sort((a, b) => (a.operationOrder ?? earliest(a)) - (b.operationOrder ?? earliest(b))).map((train) => {
      const rows = stationsForDirection(train.direction).map((station) => {
        const call = train.calls.find((item) => item.stationId === station.id);
        return `<tr><td>${station.name}</td><td>${formatTime(call?.arrival ?? null)}</td><td>${formatTime(call?.departure ?? null)}</td><td>${call?.stop ? '停車' : '通過'}</td><td>${escapeHtml(call?.platform ?? '')}</td></tr>`;
      }).join('');
      return `<article><h3>${escapeHtml(train.serviceCode)}　${escapeHtml(trainType(train.typeId).name)}　${escapeHtml(train.destination)}</h3><table><thead><tr><th>駅</th><th>到着</th><th>出発</th><th>扱い</th><th>番線</th></tr></thead><tbody>${rows}</tbody></table></article>`;
    }).join('');
    return `<section class="sheet"><h1>横浜鉄道　運用スタフ</h1><h2>列番 ${escapeHtml(number)}</h2>${cards}</section>`;
  }).join('');
  const printWindow = window.open('', '_blank');
  if (!printWindow) throw new Error('印刷ウィンドウが開けません。ポップアップを許可してください。');
  printWindow.opener = null;
  printWindow.document.write('<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>横浜鉄道 運用スタフ</title><style>body{font-family:"Noto Sans JP","Yu Gothic",Meiryo,sans-serif;color:#172338}.sheet{width:180mm;min-height:260mm;margin:0 auto;padding:10mm;page-break-after:always}h1{font-size:18pt}h2{font-size:15pt;border-bottom:1px solid #333;padding-bottom:4mm}h3{font-size:12pt;margin:8mm 0 3mm}table{width:100%;border-collapse:collapse;font-size:10pt}th,td{border:1px solid #667085;padding:2mm;text-align:left}th{background:#eef2f6}@page{size:A4;margin:10mm}@media print{.sheet{margin:0;padding:0;min-height:0;page-break-after:always}}</style></head><body>' + sheets + '<script>window.onload=function(){window.print()};window.onafterprint=function(){window.close()};</script></body></html>');
  printWindow.document.close();
  return Promise.resolve();
}

function earliest(train: Train) {
  return Math.min(...train.calls.map((call) => call.departure ?? call.arrival ?? Number.MAX_SAFE_INTEGER));
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}
