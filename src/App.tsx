import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createTrain, destinationNumber, formatTime, parseTime, STATIONS, stationsForDirection, trainType, serviceCode } from './data';
import { calculateYokohamaSchedule, checkConflicts, validateTrain } from './engine';
import { exportCsv, exportPng, exportStaffPdf, exportStaffPng, exportYtd } from './export';
import { previewWorkbook, type ImportPreview } from './importer';
import { loadLocal, parseYtd, saveLocal } from './storage';
import type { DiagramData, Train, TrainCall, ViewMode } from './types';

const emptyData: DiagramData = { format: 'YokohamaTrainDiagram', version: 1, railwayName: '横浜鉄道', lineName: '横浜鉄道線', trains: [] };
const initialView: ViewMode = '上下線';

export default function App() {
  const [data, setData] = useState<DiagramData>(emptyData);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>(initialView);
  const [zoom, setZoom] = useState(1);
  const [visibleTypeIds, setVisibleTypeIds] = useState(() => new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]));
  const [historySize, setHistorySize] = useState({ undo: 0, redo: 0 });
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<ReturnType<typeof checkConflicts> | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [dragPreview, setDragPreview] = useState<Train | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [modal, setModal] = useState<'edit' | 'check' | 'import' | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const workbookFileRef = useRef<File | null>(null);
  const previousDataRef = useRef(data);
  const currentDataRef = useRef(data);
  const undoStackRef = useRef<DiagramData[]>([]);
  const redoStackRef = useRef<DiagramData[]>([]);
  currentDataRef.current = data;
  const selected = (dragPreview?.id === selectedId ? dragPreview : null) ?? data.trains.find((train) => train.id === selectedId) ?? null;
  const selectedStations = selected ? stationsForDirection(selected.direction) : STATIONS;
  const visibleTrains = data.trains.map((train) => dragPreview?.id === train.id ? dragPreview : train).filter((train) => view === '上下線' || train.direction === view);
  const diagramEndMinutes = Math.max(1440, Math.ceil(Math.max(0, ...visibleTrains.flatMap((train) => train.calls.map((call) => call.arrival ?? call.departure ?? 0))) / 3600) * 60);

  const replaceTrain = useCallback((train: Train) => {
    setData((current) => ({ ...current, trains: current.trains.map((item) => item.id === train.id ? train : item) }));
    setIssues(null);
  }, []);

  useEffect(() => {
    let active = true;
    loadLocal().then((stored) => {
      if (active && stored) { previousDataRef.current = stored; setData(stored); }
    }).catch((reason: unknown) => {
      if (active) setError(`保存データを読み込めませんでした: ${errorText(reason)}`);
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (busy || previousDataRef.current === data) return;
    undoStackRef.current.push(previousDataRef.current);
    if (undoStackRef.current.length > 100) undoStackRef.current.shift();
    redoStackRef.current = [];
    previousDataRef.current = data;
    setHistorySize({ undo: undoStackRef.current.length, redo: 0 });
  }, [data, busy]);

  useEffect(() => {
    setIssues(null);
    setModal((current) => current === 'check' ? null : current);
  }, [data]);

  useEffect(() => {
    if (busy) return;
    const timer = window.setTimeout(() => {
      saveLocal(data).then(() => setSavedAt(new Date())).catch((reason: unknown) => setError(`自動保存に失敗しました: ${errorText(reason)}`));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [data, busy]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.matches('input,textarea,select')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); saveLocal(data).then(() => setSavedAt(new Date())).catch((reason: unknown) => setError(errorText(reason)));
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault(); redo();
      } else if (event.key === 'Delete' && selectedId) {
        setData((current) => ({ ...current, trains: current.trains.filter((train) => train.id !== selectedId) })); setSelectedId(null); setIssues(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data, selectedId]);

  const undo = () => {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current.push(currentDataRef.current);
    previousDataRef.current = previous;
    currentDataRef.current = previous;
    setData(previous);
    setHistorySize({ undo: undoStackRef.current.length, redo: redoStackRef.current.length });
    setIssues(null);
  };
  const redo = () => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(currentDataRef.current);
    previousDataRef.current = next;
    currentDataRef.current = next;
    setData(next);
    setHistorySize({ undo: undoStackRef.current.length, redo: redoStackRef.current.length });
    setIssues(null);
  };

  const addTrain = () => {
    if (data.trains.length >= 10000) { setError('列車数が上限（10,000本）に達しました。'); return; }
    const train = createTrain();
    setData((current) => ({ ...current, trains: [...current.trains, train] }));
    setSelectedId(train.id); setModal('edit'); setIssues(null);
  };
  const deleteSelected = () => {
    if (!selectedId) return;
    setData((current) => ({ ...current, trains: current.trains.filter((train) => train.id !== selectedId) }));
    setSelectedId(null); setModal(null); setIssues(null);
  };
  const onFile = async (file?: File) => {
    if (!file) return;
    setError('');
    try {
      if (/\.xlsx?$/i.test(file.name)) { workbookFileRef.current = file; setPreview(await previewWorkbook(file)); setModal('import'); return; }
      const imported = parseYtd(await file.text());
      setData(imported); setSelectedId(null); setIssues(null);
    } catch (reason) { setError(`読み込みに失敗しました: ${errorText(reason)}`); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };
  const commitImport = () => {
    if (!preview) return;
    setData((current) => ({ ...current, trains: [...current.trains, ...preview.trains] }));
    setModal(null); setPreview(null); setIssues(null);
  };
  const recalculateTrain = (train: Train) => {
    const originCall = train.calls.find((call) => call.stationId === train.originId);
    const startTime = originCall?.departure ?? originCall?.arrival;
    if (startTime === null || startTime === undefined) { setError('始発駅の時刻を先に入力してください。'); return; }
    try {
      const calls = calculateYokohamaSchedule({
        originId: train.originId,
        destinationId: train.destinationId,
        typeId: train.typeId,
        startTime,
        dwellSecondsByStation: Object.fromEntries(train.calls.filter((call) => call.arrival !== null && call.departure !== null).map((call) => [call.stationId, Math.max(0, (call.departure ?? 0) - (call.arrival ?? 0))])),
        platforms: Object.fromEntries(train.calls.map((call) => [call.stationId, call.platform])),
      });
      replaceTrain({ ...train, direction: train.originId > train.destinationId ? '下り' : '上り', serviceCode: serviceCode(train.typeId, destinationNumber(train.destinationId)), calls });
      setError('');
    } catch (reason) { setError(`時刻を計算できませんでした: ${errorText(reason)}`); }
  };
  const runCheck = () => { setIssues(checkConflicts(data.trains)); setCheckedAt(new Date()); setModal('check'); };
  const handleDrag = (event: React.PointerEvent<SVGElement>, train: Train, call?: TrainCall) => {
    event.preventDefault();
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const startX = event.clientX;
    const original = train;
    let updated = original;
    const move = (pointer: PointerEvent) => {
      const seconds = Math.round(((pointer.clientX - startX) / Math.max(1, bounds.width - 132)) * diagramEndMinutes) * 60;
      updated = call ? { ...original, calls: original.calls.map((item) => item.stationId === call.stationId ? { ...item, arrival: item.arrival === null ? null : Math.max(0, item.arrival + seconds), departure: item.departure === null ? null : Math.max(0, item.departure + seconds) } : item) } : { ...original, calls: original.calls.map((item) => ({ ...item, arrival: item.arrival === null ? null : Math.max(0, item.arrival + seconds), departure: item.departure === null ? null : Math.max(0, item.departure + seconds) })) };
      setDragPreview(updated);
    };
    const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', commit); window.removeEventListener('pointercancel', cancel); };
    const commit = () => { cleanup(); setDragPreview(null); const invalid = validateTrain(updated).some((issue) => issue.severity === '要確認'); if (invalid) setError('変更後の時刻に不整合があります。変更を取り消しました。'); else if (updated !== original) replaceTrain(updated); };
    const cancel = () => { cleanup(); setDragPreview(null); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', commit, { once: true });
    window.addEventListener('pointercancel', cancel, { once: true });
  };

  const operationGroups = useMemo(() => {
    const groups = new Map<string, Train[]>();
    for (const train of data.trains) {
      const key = train.trainNumber.trim() || `未設定-${train.id}`;
      groups.set(key, [...(groups.get(key) ?? []), train]);
    }
    return [...groups.entries()].map(([key, trains]) => ({ key, number: key.startsWith('未設定-') ? '列番未設定' : key, trains: trains.sort((a, b) => (a.operationOrder ?? earliest(a)) - (b.operationOrder ?? earliest(b))) }));
  }, [data.trains]);

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark">Y</div><div><h1>横浜鉄道 <span>DIAGRAM STUDIO</span></h1><p>ダイヤグラム・運用管理</p></div></div><div className="save-state"><span className={savedAt ? 'status-dot' : 'status-dot pending'} />{busy ? '読み込み中' : savedAt ? `自動保存 ${savedAt.toLocaleTimeString('ja-JP')}` : '変更を保存中'}</div></header>
    <nav className="toolbar" aria-label="ツールバー">
      <button onClick={() => fileRef.current?.click()}>開く</button><input ref={fileRef} hidden type="file" accept=".ytd,.json,.xlsx,.xls" onChange={(event) => void onFile(event.target.files?.[0])} />
      <button className="primary" onClick={addTrain}>＋ 列車追加</button><button disabled={!selected} onClick={deleteSelected}>削除</button><span className="separator" />
      <button onClick={() => setZoom((value) => Math.min(3, value * 1.25))}>拡大</button><button onClick={() => setZoom((value) => Math.max(.5, value / 1.25))}>縮小</button>
      <button disabled={!historySize.undo} onClick={undo}>Undo</button><button disabled={!historySize.redo} onClick={redo}>Redo</button>
      <button onClick={() => void saveLocal(data).then(() => { setSavedAt(new Date()); setError(''); }).catch((reason: unknown) => setError(errorText(reason)))}>保存</button>
      <button onClick={runCheck}>整合性チェック</button><span className="separator" /><button onClick={() => exportYtd(data)}>YTD出力</button><button onClick={() => exportCsv(data.trains)}>CSV出力</button><button onClick={() => void exportStaffPdf(data.trains).catch((reason: unknown) => setError(errorText(reason)))}>スタフPDF</button><button onClick={() => svgRef.current && void exportPng(svgRef.current).catch((reason: unknown) => setError(errorText(reason)))}>PNG</button>
    </nav>
    {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError('')} aria-label="閉じる">×</button></div>}
    <div className="workspace">
      <aside className="sidebar">
        <section className="side-section"><div className="section-heading"><h2>列車一覧</h2><span>{data.trains.length}本</span></div><div className="train-list">{data.trains.map((train) => <button key={train.id} className={`train-row ${selectedId === train.id ? 'selected' : ''}`} onClick={() => setSelectedId(train.id)} onDoubleClick={() => { setSelectedId(train.id); setModal('edit'); }}><span className="train-color" style={{ background: trainType(train.typeId).color }} /><span className="train-row-main"><b>{train.trainNumber || train.serviceCode}</b><small>{trainType(train.typeId).name} · {train.destination}</small></span><span className="direction-badge">{train.direction}</span></button>)}</div></section>
        <section className="side-section"><div className="section-heading"><h2>表示設定</h2></div><div className="view-switch">{(['上下線', '上り', '下り'] as ViewMode[]).map((mode) => <button key={mode} className={view === mode ? 'active' : ''} onClick={() => setView(mode)}>{mode}</button>)}</div><div className="type-legend">{Array.from({ length: 9 }, (_, index) => index + 1).map((id) => <label key={id}><input type="checkbox" checked={visibleTypeIds.has(id)} onChange={(event) => setVisibleTypeIds((current) => { const next = new Set(current); if (event.target.checked) next.add(id); else next.delete(id); return next; })} /><i style={{ background: trainType(id).color }} />{trainType(id).name}</label>)}</div></section>
        <section className="side-section operations"><div className="section-heading"><h2>運用一覧</h2><span>{operationGroups.length}運用</span></div>{operationGroups.map((group) => <div className="operation-card" key={group.key}><b>列番 {group.number}</b><span>{group.trains.map((train) => train.serviceCode).join(' → ')}</span><div className="operation-export"><button className="staff-button" onClick={() => void exportStaffPdf(group.trains).catch((reason: unknown) => setError(errorText(reason)))}>PDF</button><button className="staff-button" onClick={() => void exportStaffPng(group.trains).catch((reason: unknown) => setError(errorText(reason)))}>PNG</button></div></div>)}</section>
      </aside>
      <section className="diagram-panel">
        <div className="panel-heading"><div><h2>ダイヤグラム</h2><p>横軸：時刻　縦軸：駅　·　クリックで選択、ダブルクリックで編集、ドラッグで時刻変更</p></div><span className="zoom-label">{Math.round(zoom * 100)}%</span></div>
        <div className="diagram-scroll"><svg ref={svgRef} className="diagram" viewBox={`0 0 ${Math.round(diagramEndMinutes * zoom) + 132} 590`} role="img" aria-label="横浜鉄道ダイヤグラム">
          <rect width="100%" height="100%" fill="#fff" />
          {Array.from({ length: Math.floor(diagramEndMinutes / (zoom < .65 ? 180 : zoom < 1 ? 120 : zoom > 2 ? 30 : 60)) + 1 }, (_, index) => { const tickMinutes = zoom < .65 ? 180 : zoom < 1 ? 120 : zoom > 2 ? 30 : 60; const minutes = index * tickMinutes; const x = 132 + minutes * zoom; return <g key={index}><line x1={x} y1="36" x2={x} y2="570" stroke={minutes % 360 === 0 ? '#cbd5e1' : '#e8edf3'} strokeWidth={minutes % 360 === 0 ? 1.3 : 1} /><text x={x + 3} y="24" fontSize="11" fill="#64748b">{String(Math.floor(minutes / 60)).padStart(2, '0')}:{String(minutes % 60).padStart(2, '0')}</text></g>; })}
          {STATIONS.map((station) => { const y = stationY(station.id, view === '上り' ? '上り' : '下り'); return <g key={station.id}><line x1="132" y1={y} x2={Math.round(diagramEndMinutes * zoom) + 132} y2={y} stroke="#dbe2ea" /><text x="12" y={y + 4} fontSize="13" fontWeight="600" fill="#344256">{station.name}</text></g>; })}
          {visibleTrains.filter((train) => visibleTypeIds.has(train.typeId)).map((train) => { const points = train.calls.map((call) => { const time = call.departure ?? call.arrival; return time === null ? null : { x: 132 + time / 60 * zoom, y: stationY(call.stationId, train.direction), call }; }).filter((point): point is {x: number; y: number; call: TrainCall} => point !== null); if (points.length < 2) return null; const color = trainType(train.typeId).color; return <g key={train.id} className="train-line-group" onClick={() => setSelectedId(train.id)} onDoubleClick={() => { setSelectedId(train.id); setModal('edit'); }} onContextMenu={(event) => { event.preventDefault(); setSelectedId(train.id); setModal('edit'); }}><polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="transparent" strokeWidth="16" onPointerDown={(event) => handleDrag(event, train)} /><polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke={color} strokeWidth={selectedId === train.id || highlightedId === train.id ? 4 : 2} strokeDasharray={trainType(train.typeId).dash} className="train-stroke" />{points.map(({ x, y, call }) => call.stop && <circle key={call.stationId} cx={x} cy={y} r={selectedId === train.id ? 4 : 2.5} fill={color} onPointerDown={(event) => handleDrag(event, train, call)} />)}<text x={points[0].x + 4} y={points[0].y - 5} fontSize="10" fill={color}>{train.trainNumber || train.serviceCode}</text></g>; })}
        </svg></div>
        <div className="diagram-footnote">表示範囲 00:00–{formatTime(diagramEndMinutes * 60)}　·　目盛り間隔は拡大率に応じて調整</div>
      </section>
      <aside className="detail-panel">
        <div className="panel-heading"><div><h2>列車詳細</h2><p>{selected ? selected.serviceCode : '列車を選択してください'}</p></div>{selected && <button className="small-button" onClick={() => setModal('edit')}>編集</button>}</div>
        {selected ? <div className="detail-content"><div className="detail-summary"><strong>{selected.trainNumber || '列番未設定'}</strong><span>{trainType(selected.typeId).name} · {selected.direction}</span><small>{selected.destination}</small></div><div className="station-times">{selectedStations.map((station) => { const call = selected.calls.find((item) => item.stationId === station.id); if (!call) return null; return <div key={station.id} className="station-time-row"><div className="station-name"><i className={call.stop ? 'stop-dot' : 'pass-dot'} />{station.name}</div><div><small>着</small>{formatTime(call.arrival)}</div><div><small>発</small>{formatTime(call.departure)}</div></div>; })}</div></div> : <div className="empty-detail"><div className="empty-icon">↗</div><p>列車を追加するか、<br />ダイヤ上の列車を選択してください。</p><button className="primary" onClick={addTrain}>＋ 列車追加</button></div>}
      </aside>
    </div>
    {modal === 'edit' && selected && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}><div className="modal edit-modal"><div className="modal-heading"><div><h2>列車詳細編集</h2><p>{selected.serviceCode}</p></div><button onClick={() => setModal(null)}>×</button></div><div className="form-grid"><label>始発駅<select value={selected.originId} onChange={(event) => updateBasic(selected, 'originId', Number(event.target.value), replaceTrain)}>{STATIONS.map((station) => <option value={station.id} key={station.id}>{station.id} {station.name}</option>)}</select></label><label>終着駅<select value={selected.destinationId} onChange={(event) => { const id = Number(event.target.value); replaceTrain({ ...selected, destinationId: id, serviceCode: serviceCode(selected.typeId, destinationNumber(id)), destination: STATIONS.find((station) => station.id === id)?.name ?? '' }); }}>{STATIONS.map((station) => <option value={station.id} key={station.id}>{station.id} {station.name}</option>)}</select></label><label>種別<select value={selected.typeId} onChange={(event) => { const id = Number(event.target.value); replaceTrain({ ...selected, typeId: id, serviceCode: serviceCode(id, destinationNumber(selected.destinationId)) }); }}>{Array.from({ length: 9 }, (_, index) => index + 1).map((id) => <option value={id} key={id}>{id} {trainType(id).name}</option>)}</select></label><label>方向<select value={selected.direction} onChange={(event) => replaceTrain({ ...selected, direction: event.target.value as Train['direction'] })}><option>下り</option><option>上り</option></select></label><label>列番<input value={selected.trainNumber} onChange={(event) => replaceTrain({ ...selected, trainNumber: event.target.value })} placeholder="例：2001" /></label><label>列車名<input value={selected.name} onChange={(event) => replaceTrain({ ...selected, name: event.target.value })} /></label><label>行先<input value={selected.destination} onChange={(event) => replaceTrain({ ...selected, destination: event.target.value })} /></label><label>運用順<input type="number" value={selected.operationOrder ?? ''} onChange={(event) => replaceTrain({ ...selected, operationOrder: event.target.value ? Number(event.target.value) : null })} placeholder="自動" /></label></div><div className="table-wrap"><table><thead><tr><th>駅</th><th>着時刻</th><th>発時刻</th><th>扱い</th><th>番線</th></tr></thead><tbody>{selectedStations.map((station) => { const call = selected.calls.find((item) => item.stationId === station.id) ?? { stationId: station.id, arrival: null, departure: null, stop: true, platform: '' }; return <tr key={station.id}><th>{station.name}</th><td><TimeInput value={call.arrival} onChange={(value) => updateCall(selected, call.stationId, { arrival: value }, replaceTrain)} /></td><td><TimeInput value={call.departure} onChange={(value) => updateCall(selected, call.stationId, { departure: value }, replaceTrain)} /></td><td><select value={call.stop ? 'stop' : 'pass'} onChange={(event) => updateCall(selected, call.stationId, { stop: event.target.value === 'stop' }, replaceTrain)}><option value="stop">停車</option><option value="pass">通過</option></select></td><td><input className="platform-input" value={call.platform} onChange={(event) => updateCall(selected, call.stationId, { platform: event.target.value }, replaceTrain)} /></td></tr>; })}</tbody></table></div><div className="modal-actions"><button onClick={() => { const train = selected; if (train) recalculateTrain(train); }}>Excel規則で時刻計算</button><button className="danger-button" onClick={deleteSelected}>列車削除</button><button onClick={() => setModal(null)}>閉じる</button></div></div></div>}
    {modal === 'check' && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}><div className="modal"><div className="modal-heading"><div><h2>整合性チェック</h2><p>実行日時 {checkedAt?.toLocaleString('ja-JP') ?? '—'} · 安全性を保証するものではありません</p></div><button onClick={() => setModal(null)}>×</button></div>{issues?.length ? <div className="issue-list">{issues.map((issue) => <button className="issue-item" key={issue.id} onClick={() => { setSelectedId(issue.trainIds[0] ?? null); setHighlightedId(issue.trainIds[0] ?? null); setView('上下線'); setModal(null); }}><b>{issue.severity}</b><span>{issue.message}</span><small>{issue.trainIds.map((id) => data.trains.find((train) => train.id === id)?.trainNumber || data.trains.find((train) => train.id === id)?.serviceCode).join(' / ')}</small></button>)}</div> : <div className="no-issues">✓　問題は検出されませんでした</div>}<p className="safety-note">前後30秒は関連列車を検索する範囲であり、安全間隔ではありません。線路・閉そく情報がないため、運行上の安全性は判定できません。</p></div></div>}
    {modal === 'import' && preview && <div className="modal-backdrop"><div className="modal import-modal"><div className="modal-heading"><div><h2>Excel取り込みプレビュー</h2><p>{preview.trains.length}列車</p></div><button onClick={() => { setModal(null); setPreview(null); workbookFileRef.current = null; }}>×</button></div><label className="sheet-picker">対象シート<select value={preview.selectedSheet} onChange={(event) => { const file = workbookFileRef.current; if (file) void previewWorkbook(file, event.target.value).then(setPreview).catch((reason: unknown) => setError(`シートを読み込めません: ${errorText(reason)}`)); }}>{preview.sheetNames.map((name) => <option key={name}>{name}</option>)}</select></label><p>検出結果を確認してから現在のデータへ追加します。既存データは取り込み前に変更されません。</p>{preview.warnings.map((warning) => <div className="warning-line" key={warning}>{warning}</div>)}<div className="table-wrap"><table><thead><tr><th>列番</th><th>番号</th><th>種別</th><th>行先</th><th>方向</th></tr></thead><tbody>{preview.trains.map((train) => <tr key={train.id}><td>{train.trainNumber}</td><td>{train.serviceCode}</td><td>{trainType(train.typeId).name}</td><td>{train.destination}</td><td>{train.direction}</td></tr>)}</tbody></table></div><div className="modal-actions"><button onClick={() => { setModal(null); setPreview(null); workbookFileRef.current = null; }}>キャンセル</button><button className="primary" disabled={!preview.trains.length} onClick={commitImport}>取り込み確定</button></div></div></div>}
    <footer>横浜鉄道 ダイヤグラム作成システム <span>データはこのブラウザー内に保存されます</span></footer>
  </main>;
}

function TimeInput({ value, onChange }: { value: number | null; onChange: (value: number | null) => void }) {
  const [text, setText] = useState(formatTime(value));
  useEffect(() => setText(formatTime(value)), [value]);
  return <input className="time-input" value={text === '—' ? '' : text} placeholder="hh:mm:ss" onChange={(event) => { setText(event.target.value); if (!event.target.value) onChange(null); else { const parsed = parseTime(event.target.value); if (parsed !== null) onChange(parsed); } }} onBlur={() => { const parsed = parseTime(text); if (parsed !== null) setText(formatTime(parsed)); else if (text) setText(formatTime(value)); }} />;
}

function updateCall(train: Train, stationId: number, changes: Partial<TrainCall>, replace: (train: Train) => void) {
  const exists = train.calls.some((call) => call.stationId === stationId);
  const calls = exists ? train.calls.map((call) => call.stationId === stationId ? { ...call, ...changes } : call) : [...train.calls, { stationId, arrival: null, departure: null, stop: true, platform: '', ...changes }];
  replace({ ...train, calls });
}

function updateBasic<K extends 'originId'>(train: Train, key: K, value: Train[K], replace: (train: Train) => void) {
  replace({ ...train, [key]: value });
}
function earliest(train: Train) { return Math.min(...train.calls.map((call) => call.departure ?? call.arrival ?? Number.MAX_SAFE_INTEGER)); }
function stationY(stationId: number, direction: Train['direction']) { return 68 + (direction === '下り' ? stationId - 1 : STATIONS.length - stationId) * 96; }
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
