import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import {
  ActionIcon,
  Alert,
  AppShell,
  AppShellHeader,
  AppShellMain,
  AppShellNavbar,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Modal,
  NumberInput,
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Tooltip
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconAnchor,
  IconArrowsExchange,
  IconBoxMultiple,
  IconCheck,
  IconCircleCheck,
  IconClockHour4,
  IconCube,
  IconFileDescription,
  IconFileImport,
  IconHistory,
  IconLayoutBoardSplit,
  IconLock,
  IconLockOpen,
  IconMap2,
  IconPlayerPlay,
  IconPrinter,
  IconRefresh,
  IconRulerMeasure,
  IconRoute,
  IconShip,
  IconUserCheck,
  IconUsers,
  IconX
} from '@tabler/icons-react';
import * as THREE from 'three';
import { useGetVoyageQuery, useImportDeclarationMutation, DG_CAPACITY_PER_HOLD, UN_TABLE, type Cargo, type CargoType, type SegRelation } from './api';
import {
  acceptComment,
  acceptLimit,
  acknowledgeConflict,
  addComment,
  calculateStability,
  cancelQueue,
  clearImportNotice,
  detectConflicts,
  lockPlan,
  moveCargo,
  rejectComment,
  releaseClaim,
  selectCargo,
  setViewMode,
  simulateConcurrentEdit,
  store,
  supplementCategory,
  updateDeclaration,
  updateLashing,
  type RootState
} from './store';

const nav = [
  { path: '/', label: '航次总览', icon: <IconShip size={17} /> },
  { path: '/stowage', label: '配载与货位', icon: <IconLayoutBoardSplit size={17} /> },
  { path: '/dg', label: '隔离校核', icon: <IconAlertTriangle size={17} /> },
  { path: '/compare', label: '方案对比', icon: <IconHistory size={17} /> },
  { path: '/print', label: '配载图与清单', icon: <IconPrinter size={17} /> }
];

function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><small>{eyebrow}</small><h1>{title}</h1><p>{description}</p></div><Group gap="xs">{actions}</Group></div>;
}

function ThreeHold({ compact = false }: { compact?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cargo = useSelector((root: RootState) => root.stowage.cargo);
  const activeId = useSelector((root: RootState) => root.stowage.activeCargoId);
  const dispatch = useDispatch();
  const [rotation, setRotation] = useState({ theta: .65, phi: 1.05 });
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#dce7e3');
    scene.fog = new THREE.Fog('#dce7e3', 38, 88);
    const camera = new THREE.PerspectiveCamera(36, 1, .1, 200);
    scene.add(new THREE.HemisphereLight('#ffffff', '#4b625b', 2.4));
    const light = new THREE.DirectionalLight('#fff5dd', 3.3);
    light.position.set(22, 38, 20);
    light.castShadow = true;
    scene.add(light);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(90, 60), new THREE.MeshStandardMaterial({ color: '#4c7c86', roughness: .72 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = -.15;
    scene.add(water);
    const hullMat = new THREE.MeshStandardMaterial({ color: '#214c46', roughness: .55, metalness: .18 });
    const deckMat = new THREE.MeshStandardMaterial({ color: '#8b928d', roughness: .9 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(56, 5.5, 18), hullMat);
    hull.position.y = 2.2;
    hull.castShadow = true;
    scene.add(hull);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(56, .45, 18), deckMat);
    deck.position.y = 5.15;
    deck.receiveShadow = true;
    scene.add(deck);
    for (let x = -24; x <= 24; x += 4) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(.08, .06, 18), new THREE.MeshBasicMaterial({ color: '#b8c8c3' }));
      line.position.set(x, 5.4, 0);
      scene.add(line);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(8, 7, 14), new THREE.MeshStandardMaterial({ color: '#e6e5df' }));
    bridge.position.set(21, 8.7, 0);
    scene.add(bridge);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 4, 16), new THREE.MeshStandardMaterial({ color: '#c26843' }));
    stack.position.set(18, 14.2, 0);
    scene.add(stack);
    const boxes: THREE.Mesh[] = [];
    cargo.filter((item) => item.type === '集装箱').forEach((item) => {
      const geometry = item.dimension.startsWith('20') ? new THREE.BoxGeometry(2.35, 2.3, 2.3) : new THREE.BoxGeometry(4.5, 2.3, 2.3);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: item.color, roughness: .68 }));
      mesh.position.set((item.bay - 20) * 2.2, item.deck === '主甲板' ? 6.7 + item.tier * 2.45 : 2.1 + item.tier * 2.45, (item.row - 4) * 2.5);
      mesh.castShadow = true;
      mesh.userData.id = item.id;
      boxes.push(mesh);
      scene.add(mesh);
    });
    const heavy = cargo.find((item) => item.type === '重大件');
    if (heavy) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(9.5, 2.4, 3), new THREE.MeshStandardMaterial({ color: heavy.color }));
      mesh.position.set((heavy.bay - 20) * 2.2, 6.7, 1.2);
      mesh.userData.id = heavy.id;
      boxes.push(mesh);
      scene.add(mesh);
      const center = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, 8.5, 12), new THREE.MeshStandardMaterial({ color: '#e9b54d' }));
      center.position.set((heavy.bay - 20) * 2.2, 7.95, 1.2);
      center.rotation.z = Math.PI / 2;
      scene.add(center);
    }
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let theta = .65;
    let phi = 1.05;
    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    const onDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging) return;
      theta += (event.clientX - lastX) * .007;
      phi = Math.max(.5, Math.min(1.55, phi + (event.clientY - lastY) * .005));
      lastX = event.clientX;
      lastY = event.clientY;
      setRotation({ theta, phi });
    };
    const onUp = (event: PointerEvent) => {
      dragging = false;
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(boxes)[0];
      if (hit?.object.userData.id) dispatch(selectCargo(String(hit.object.userData.id)));
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    let frame = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      const radius = compact ? 68 : 61;
      camera.position.set(Math.sin(theta) * Math.sin(phi) * radius, Math.cos(phi) * radius + 15, Math.cos(theta) * Math.sin(phi) * radius);
      camera.lookAt(0, 7, 0);
      boxes.forEach((box) => { box.material = box.material as THREE.MeshStandardMaterial; (box.material as THREE.MeshStandardMaterial).emissive = box.userData.id === activeId ? new THREE.Color('#1a5c4b') : new THREE.Color('#000000'); });
      renderer.render(scene, camera);
    };
    render();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      renderer.dispose();
    };
  }, [activeId, cargo, compact, dispatch]);
  return <div ref={containerRef} className="three-hold"><canvas ref={canvasRef} /><div className="three-legend"><span><i style={{ background: '#2b7c75' }} />集装箱</span><span><i style={{ background: '#b64f49' }} />重大件</span><span><i style={{ background: '#e9b54d' }} />吊点</span></div><div className="three-hint">拖动旋转 · 点击货箱选择</div><div className="orientation">艏 <span>→</span> 艉</div></div>;
}

function SectionView() {
  const cargo = useSelector((root: RootState) => root.stowage.cargo);
  const dispatch = useDispatch();
  return <div className="section-view"><div className="section-labels"><span>第 3 层</span><span>第 2 层</span><span>第 1 层</span><span>舱底</span></div><div className="section-grid">{Array.from({ length: 9 * 4 }).map((_, index) => { const tier = 4 - Math.floor(index / 9); const row = index % 9; const item = cargo.find((cargoItem) => cargoItem.tier === tier && cargoItem.row === row); return <button key={index} className={item ? 'occupied' : ''} style={item ? { background: item.color } : undefined} onClick={() => item && dispatch(selectCargo(item.id))} title={item ? `${item.id} · ${item.weight}t` : `空货位 R${row} T${tier}`}>{item?.bill.slice(-3)}</button>; })}</div><div className="section-axis">舱内横向剖面 · 鼠标悬停查看重量</div></div>;
}

function Overview() {
  const state = useSelector((root: RootState) => root.stowage);
  const { data } = useGetVoyageQuery();
  const dispatch = useDispatch();
  const stability = calculateStability(state.cargo);
  const conflicts = detectConflicts(state.cargo, state.declarations, state.queue, state.conclusions);
  const active = state.cargo.find((item) => item.id === state.activeCargoId) ?? state.cargo[0];
  return <div className="page">
    <PageHeading eyebrow={`${data?.id ?? 'V-2609-17'} / 航次审阅`} title="多用途船舶配载校核" description={`${data?.vessel ?? '海岳轮'} · ${data?.route ?? '上海 → 釜山 → 温哥华'} · 计划离港 ${data?.departure ?? '10-02 14:00'}`} actions={<><Button variant="default" leftSection={<IconRefresh size={16} />} onClick={() => dispatch(setViewMode(state.viewMode === '3d' ? 'section' : '3d'))}>{state.viewMode === '3d' ? '二维剖面' : '三维视角'}</Button><Button color="teal" leftSection={<IconLock size={16} />} disabled={conflicts.length > 0 || state.locked} onClick={() => dispatch(lockPlan())}>{state.locked ? '方案已锁定' : '锁定配载版本'}</Button></>} />
    {conflicts.length > 0 && <div className="warning-banner"><IconAlertTriangle size={18} /><strong>{conflicts.length} 项配载冲突待处理</strong><span>{conflicts.map((item) => item.title).join('、')}</span></div>}
    <SimpleGrid cols={{ base: 2, lg: 4 }} spacing="sm" mb="md">{[
      ['总货重', `${stability.total.toFixed(1)} t`, '设计上限 3560 t', 'ok'],
      ['稳性裕度', `${stability.stability.toFixed(1)}%`, stability.stability > 70 ? '符合航次要求' : '低于控制线', stability.stability > 70 ? 'ok' : 'bad'],
      ['纵倾状态', stability.trim, `Lcg ${stability.longitudinal.toFixed(2)} m`, 'ok'],
      ['主甲板载荷', `${stability.deckLoad.toFixed(1)} t`, '局部强度已校核', 'ok']
    ].map((item) => <Card key={item[0]} padding="md" className="metric-card"><Text size="xs" c="dimmed">{item[0]}</Text><Text fw={800} fz={23} mt={3}>{item[1]}</Text><Text size="xs" c={item[3] === 'bad' ? 'red' : 'teal'}>{item[2]}</Text></Card>)}</SimpleGrid>
    <div className="overview-grid">
      <Card padding={0} className="scene-card"><div className="panel-title"><div><strong>{state.viewMode === '3d' ? '三维货位与航次分布' : '舱内横向剖面'}</strong><Text size="xs" c="dimmed">货箱颜色对应目的港与货类</Text></div><Badge color="teal" variant="light">方案 V{state.planRevision}</Badge></div>{state.viewMode === '3d' ? <ThreeHold /> : <SectionView />}</Card>
      <Stack gap="sm">
        <Card padding="md"><div className="panel-title"><div><strong>当前货位</strong><Text size="xs" c="dimmed">{active.id}</Text></div><Badge color={active.hazmat !== '无' ? 'orange' : 'gray'}>{active.hazmat === '无' ? '普通货' : '危险品'}</Badge></div><Stack gap={6} mt="sm"><Text fw={700}>{active.bill} · {active.type}</Text><Text size="xs" c="dimmed">{active.dimension}</Text><SimpleGrid cols={2} spacing="xs"><div className="mini-stat"><span>重量</span><strong>{active.weight} t</strong></div><div className="mini-stat"><span>卸货港</span><strong>{active.port}</strong></div><div className="mini-stat"><span>货位</span><strong>Bay {active.bay} / Row {active.row} / Tier {active.tier}</strong></div><div className="mini-stat"><span>绑扎</span><strong>{active.lashing}</strong></div></SimpleGrid></Stack></Card>
        <Card padding="md"><div className="panel-title"><div><strong>重量分布</strong><Text size="xs" c="dimmed">按横向货位统计</Text></div><IconRulerMeasure size={18} /></div><div className="weight-bars">{[2, 4, 6, 8, 10, 12, 14].map((bay) => { const weight = state.cargo.filter((item) => item.bay === bay).reduce((sum, item) => sum + item.weight, 0); return <div key={bay}><span>{weight.toFixed(0)}t</span><i style={{ height: `${Math.max(8, weight / 1.2)}px` }} /><small>B{bay}</small></div>; })}</div></Card>
        <Card padding="md"><div className="panel-title"><div><strong>角色限制条件</strong><Text size="xs" c="dimmed">{state.comments.filter((item) => item.status === '待确认').length} 项待确认</Text></div><IconUsers size={18} /></div>{state.comments.slice(0, 3).map((comment) => <div className="limit-row" key={comment.id}><div><Text size="xs" fw={700}>{comment.author} · {comment.role}</Text><Text size="xs" c="dimmed">{comment.content}</Text></div><Badge size="xs" color={comment.status === '待确认' ? 'orange' : 'teal'}>{comment.status}</Badge></div>)}</Card>
      </Stack>
    </div>
  </div>;
}

function Stowage() {
  const state = useSelector((root: RootState) => root.stowage);
  const dispatch = useDispatch();
  const active = state.cargo.find((item) => item.id === state.activeCargoId) ?? state.cargo[0];
  const conflicts = detectConflicts(state.cargo, state.declarations, state.queue, state.conclusions);
  const stability = calculateStability(state.cargo);
  const [bay, setBay] = useState(active.bay);
  const [row, setRow] = useState(active.row);
  const [tier, setTier] = useState(active.tier);
  const [dragId, setDragId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  useEffect(() => { setBay(active.bay); setRow(active.row); setTier(active.tier); }, [active.bay, active.row, active.tier]);
  const slots = useMemo(() => Array.from({ length: 28 }).map((_, index) => ({ id: `slot-${index}`, bay: 4 + Math.floor(index / 4), row: index % 4, tier: 0, label: `B${4 + Math.floor(index / 4)} R${index % 4}` })), []);
  return <div className="page">
    <PageHeading eyebrow={`配载工作区 / 方案 V${state.planRevision}`} title="货位安排与冲突校核" description="拖动货箱排序，或输入目标货位精确调整；系统即时重算重量分布。" actions={<Badge size="lg" color={conflicts.length ? 'orange' : 'teal'} leftSection={<IconCheck size={14} />}>{conflicts.length ? `${conflicts.length} 项冲突` : '校验通过'}</Badge>} />
    {state.importNotice && <Alert color={state.importNotice.kind === 'failed' ? 'red' : state.importNotice.kind === 'draft' ? 'orange' : state.importNotice.kind === 'ok' ? 'teal' : 'blue'} variant="light" icon={<IconAlertTriangle size={16} />} withCloseButton onClose={() => dispatch(clearImportNotice())} mb="md">{state.importNotice.message}</Alert>}
    <div className="stowage-grid">
      <Card padding={0} className="cargo-list-panel"><div className="panel-title"><div><strong>货物清单</strong><Text size="xs" c="dimmed">{state.cargo.length} 票 · 可拖拽</Text></div><TextInput size="xs" placeholder="搜索提单号" /></div><ScrollArea h={600}><div className="cargo-list">{state.cargo.map((item) => <button draggable onDragStart={() => setDragId(item.id)} key={item.id} className={state.activeCargoId === item.id ? 'active' : ''} onClick={() => dispatch(selectCargo(item.id))}><i style={{ background: item.color }} /><div><strong>{item.bill}</strong><span>{item.type} · {item.weight}t · {item.port}</span></div><Group gap={4} wrap="nowrap">{item.claimedBy && <Badge size="xs" color="red" variant="light">占用</Badge>}<Badge size="xs" color={item.hazmat === '无' ? 'gray' : 'orange'}>{item.hazmat === '无' ? `B${item.bay}` : 'DG'}</Badge></Group></button>)}</div></ScrollArea></Card>
      <Card padding={0} className="deck-panel"><div className="panel-title"><div><strong>主甲板货位图</strong><Text size="xs" c="dimmed">将货物拖入槽位，或点击槽位选择</Text></div><Group gap="xs"><Badge color="teal">稳性 {stability.stability.toFixed(1)}%</Badge><Badge color="gray">{stability.trim}</Badge></Group></div><div className="deck-layout"><div className="bridge-shape">驾驶台</div><div className="slot-grid">{slots.map((slot) => { const occupied = state.cargo.find((item) => item.deck === '主甲板' && item.bay === slot.bay && item.row === slot.row); return <button key={slot.id} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragId) dispatch(moveCargo({ id: dragId, bay: slot.bay, row: slot.row, tier: occupied?.tier ?? 1 })); setDragId(null); }} className={occupied ? 'occupied' : ''} style={occupied ? { background: occupied.color } : undefined} onClick={() => { if (occupied) { dispatch(selectCargo(occupied.id)); setRow(slot.row); setBay(slot.bay); } }}><small>{slot.label}</small>{occupied && <strong>{occupied.bill.slice(-3)}<span>{occupied.weight}t</span></strong>}</button>; })}</div><div className="deck-axis">左舷 ← 横向 Row → 右舷</div></div></Card>
      <Stack gap="sm">
        <Card padding="md"><div className="panel-title"><div><strong>精确调整</strong><Text size="xs" c="dimmed">{active.id}</Text></div><IconCube size={18} /></div><Stack gap="sm" mt="md"><NumberInput label="Bay 纵向货位" min={1} max={20} value={bay} onChange={(value) => setBay(Number(value))} /><NumberInput label="Row 横向货位" min={0} max={8} value={row} onChange={(value) => setRow(Number(value))} /><NumberInput label="Tier 堆码层" min={0} max={4} value={tier} onChange={(value) => setTier(Number(value))} /><Button color="teal" onClick={() => dispatch(moveCargo({ id: active.id, bay, row, tier }))}>应用货位调整</Button>{active.hazmat !== '无' && (() => { const d = state.declarations.find((x) => x.id === active.declarationId); return d?.status === '缺类别' ? <Alert color="orange" variant="light" icon={<IconAlertTriangle size={14} />}>旧稿缺危险品类别，补齐后才能重排。<Select size="xs" mt={6} data={['1', '2.1', '3', '4.1', '5.1', '6.1', '7', '8', '9'].map((c) => ({ value: c, label: `${c} 类` }))} placeholder="选择类别补齐" onChange={(v) => v && dispatch(supplementCategory({ cargoId: active.id, category: v }))} /></Alert> : null; })()}<Divider /><Select label="绑扎状态" data={['已绑扎', '待绑扎', '需复核']} value={active.lashing} onChange={(value) => value && dispatch(updateLashing({ id: active.id, lashing: value as Cargo['lashing'] }))} /><Divider /><Group justify="space-between"><Text size="xs" c="dimmed">货位占用者</Text>{active.claimedBy ? <Badge size="xs" color="orange">{active.claimedBy}</Badge> : <Badge size="xs" color="gray">空闲</Badge>}</Group><Button size="xs" variant="default" leftSection={<IconArrowsExchange size={14} />} onClick={() => dispatch(simulateConcurrentEdit(active.id))}>模拟值班员·乙同时修改</Button></Stack></Card>
        <Card padding="md" className={conflicts.length ? 'conflict-card' : ''}><div className="panel-title"><div><strong>实时冲突</strong><Text size="xs" c="dimmed">重心、稳性、隔离与堆码</Text></div><IconAlertTriangle size={18} /></div>{conflicts.map((item) => <button className="conflict-row" key={item.id} onClick={() => dispatch(selectCargo(item.cargoId))}><Badge size="xs" color={item.level === 'high' ? 'red' : 'orange'}>{item.level === 'high' ? '阻断' : '预警'}</Badge><div><strong>{item.title}</strong><span>{item.detail}</span></div></button>)}{!conflicts.length && <Text size="sm" c="teal" mt="md">当前方案未发现冲突。</Text>}</Card>
        <Card padding="md"><div className="panel-title"><div><strong>排队与并发冲突</strong><Text size="xs" c="dimmed">危险品位排队 · 先到者占用后到者留冲突</Text></div><Group gap={4}><Badge size="xs" color="orange">{state.queue.length} 排队</Badge><Badge size="xs" color="red">{state.concurrency.filter((c) => c.status === '待处理').length} 冲突</Badge></Group></div><Stack gap="xs" mt="xs">{state.queue.map((q) => { const qc = state.cargo.find((c) => c.id === q.cargoId); return <div key={q.id} className="conflict-row" style={{ borderTop: '1px solid #f0dfc5' }}><Badge size="xs" color="orange">排队</Badge><div><strong>{qc?.bill} · {q.hold}</strong><span>占用者：{q.occupantIds.map((oid) => state.cargo.find((c) => c.id === oid)?.bill ?? oid).join('、')}</span></div></div>; })}{state.concurrency.map((cc) => <div key={cc.id} className="conflict-row" style={{ borderTop: '1px solid #f0dfc5' }}><Badge size="xs" color={cc.status === '待处理' ? 'red' : 'gray'}>{cc.status === '待处理' ? '冲突' : '已处理'}</Badge><div><strong>{cc.firstOfficer} 先到 / {cc.secondOfficer} 后到</strong><span>{state.cargo.find((c) => c.id === cc.cargoId)?.bill} · 目标 B{cc.position.bay}/R{cc.position.row}/T{cc.position.tier}</span></div>{cc.status === '待处理' && <Button size="xs" variant="default" onClick={() => dispatch(acknowledgeConflict(cc.id))}>知悉</Button>}</div>)}{!state.queue.length && !state.concurrency.length && <Text size="sm" c="teal" mt="xs">无排队与并发冲突。</Text>}</Stack></Card>
      </Stack>
    </div>
    <Card padding="md" mt="md"><div className="panel-title"><div><strong>角色条件与审批</strong><Text size="xs" c="dimmed">船长、码头和货主代表可对方案提出限制</Text></div><IconUsers size={18} /></div><div className="comments-grid">{state.comments.map((item) => <div className="comment-card" key={item.id}><Group justify="space-between"><Badge size="xs">{item.role}</Badge><Text size="xs" c="dimmed">{item.author}</Text></Group><Text size="sm" mt="xs">{item.content}</Text><Group gap="xs" mt="sm"><Button size="compact-xs" color="teal" disabled={item.status !== '待确认'} onClick={() => dispatch(acceptComment(item.id))}>接受</Button><Button size="compact-xs" variant="default" disabled={item.status !== '待确认'} onClick={() => dispatch(rejectComment(item.id))}>退回</Button></Group></div>)}</div><Group mt="md" align="flex-start"><Textarea flex={1} minRows={2} placeholder="输入新的限制条件或调整意见" value={comment} onChange={(event) => setComment(event.currentTarget.value)} /><Button color="teal" onClick={() => { if (comment.trim()) { dispatch(addComment({ cargoId: active.id, author: '本次负责人', role: '船长', content: comment })); setComment(''); } }}>提交条件</Button></Group></Card>
  </div>;
}

function DgPage() {
  const state = useSelector((root: RootState) => root.stowage);
  const dispatch = useDispatch();
  const [importDecl, { isLoading: importing }] = useImportDeclarationMutation();
  const [importCargoId, setImportCargoId] = useState(state.activeCargoId);
  const [importUn, setImportUn] = useState('UN 1203');

  const cargo = state.cargo;
  const declarations = state.declarations;
  const conclusions = state.conclusions;
  const dgCargo = cargo.filter((c) => c.declarationId);
  const segIssues = dgCargo.flatMap((c) => conclusions[c.id]?.segregation.issues ?? []);
  const maxLevel = dgCargo.reduce((m, c) => Math.max(m, conclusions[c.id]?.segregation.level ?? 0), 0);
  const queueCount = state.queue.length;
  const active = cargo.find((c) => c.id === state.activeCargoId) ?? cargo[0];

  const holds = Array.from(new Set(cargo.map((c) => c.hold)));
  const holdRows = holds.map((hold) => {
    const items = cargo.filter((c) => c.declarationId && c.hold === hold);
    return { hold, items };
  });

  const notice = state.importNotice;
  const noticeColor = notice?.kind === 'failed' ? 'red' : notice?.kind === 'draft' ? 'orange' : notice?.kind === 'ok' ? 'teal' : 'blue';

  const categoryOptions = ['1', '2.1', '3', '4.1', '5.1', '6.1', '7', '8', '9'].map((c) => ({ value: c, label: `${c} 类` }));
  const unOptions = Object.keys(UN_TABLE).map((u) => ({ value: u, label: `${u} · ${UN_TABLE[u].name}` }));
  const cargoOptions = cargo.map((c) => ({ value: c.id, label: `${c.bill} · ${c.id}（${c.hold}）` }));

  const applyUn = (cargoId: string, un: string) => {
    const entry = UN_TABLE[un];
    if (!entry) return;
    dispatch(updateDeclaration({ cargoId, unNumber: un, category: entry.category, name: entry.name, segregationLevel: entry.segregation }));
  };

  return (
    <div className="page">
      <PageHeading
        eyebrow="DG SEGREGATION / 隔离校核"
        title="危险品申报 · 货物 · 货位 隔离校核"
        description="按 UN 号取类别与隔离等级，比对同舱、相邻层与上下层货位；任一申报或货位一变，受影响箱子隔离结论即失效重算。"
        actions={<Badge size="lg" color={segIssues.length ? 'red' : 'teal'} leftSection={<IconCircleCheck size={14} />}>{segIssues.length ? `${segIssues.length} 项隔离不足` : '隔离已清'}</Badge>}
      />
      {notice && (
        <Alert color={noticeColor} variant="light" icon={<IconAlertTriangle size={16} />} withCloseButton onClose={() => dispatch(clearImportNotice())} mb="md">
          {notice.message}
        </Alert>
      )}
      <SimpleGrid cols={{ base: 2, lg: 4 }} spacing="sm" mb="md">
        {[
          ['危险品箱', `${dgCargo.length} 票`, '已接申报与货位', 'ok'],
          ['最高隔离等级', `${maxLevel} 级`, maxLevel >= 2 ? '须分舱 / 隔舱' : '同舱可装', maxLevel >= 2 ? 'bad' : 'ok'],
          ['待处理隔离冲突', `${segIssues.length} 项`, segIssues.length ? '未清前不得锁定 / 打印' : '隔离已清', segIssues.length ? 'bad' : 'ok'],
          ['危险品位排队', `${queueCount} 票`, queueCount ? '容量不足，先排队' : '无需等位', queueCount ? 'bad' : 'ok']
        ].map((item) => <Card key={item[0]} padding="md" className="metric-card"><Text size="xs" c="dimmed">{item[0]}</Text><Text fw={800} fz={23} mt={3}>{item[1]}</Text><Text size="xs" c={item[3] === 'bad' ? 'red' : 'teal'}>{item[2]}</Text></Card>)}
      </SimpleGrid>

      <div className="dg-grid">
        <Stack gap="sm">
          <Card padding={0}>
            <div className="panel-title"><div><strong>危险品申报与隔离等级</strong><Text size="xs" c="dimmed">按 UN 号取类别与隔离等级；改 UN 即触发受影响箱子重算</Text></div></div>
            <ScrollArea>
              <Table verticalSpacing="xs" className="dg-table">
                <Table.Thead><Table.Tr><Table.Th>货物 / 货位</Table.Th><Table.Th>UN 号</Table.Th><Table.Th>类别</Table.Th><Table.Th>隔离等级</Table.Th><Table.Th>来源</Table.Th><Table.Th>状态</Table.Th><Table.Th>操作</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>
                  {dgCargo.map((c) => {
                    const decl = declarations.find((d) => d.id === c.declarationId);
                    if (!decl) return null;
                    const conc = conclusions[c.id];
                    return (
                      <Table.Tr key={c.id}>
                        <Table.Td><Text fw={700} size="xs">{c.bill}</Text><Text size="xs" c="dimmed">{c.id} · {c.hold} · B{c.bay}/R{c.row}/T{c.tier}</Text></Table.Td>
                        <Table.Td><Text size="xs">{decl.unNumber}</Text></Table.Td>
                        <Table.Td>{decl.status === '缺类别' ? <Badge color="orange" size="xs">待补齐</Badge> : <Badge size="xs" variant="light">{decl.category} 类</Badge>}</Table.Td>
                        <Table.Td><Badge size="xs" color={decl.segregationLevel >= 2 ? 'red' : 'teal'} variant="light">{decl.segregationLevel} 级</Badge></Table.Td>
                        <Table.Td><Text size="xs" c="dimmed">{decl.source}</Text></Table.Td>
                        <Table.Td><Badge size="xs" color={decl.status === '完整' ? 'teal' : 'orange'}>{decl.status}</Badge></Table.Td>
                        <Table.Td>
                          {decl.status === '缺类别' ? (
                            <Group gap={4}>
                              <Select size="xs" data={categoryOptions} placeholder="补类别" style={{ width: 92 }} onChange={(v) => v && dispatch(supplementCategory({ cargoId: c.id, category: v }))} />
                            </Group>
                          ) : (
                            <Select size="xs" data={unOptions} value={decl.unNumber} style={{ width: 178 }} onChange={(v) => v && applyUn(c.id, v)} />
                          )}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Card>

          <Card padding="0">
            <div className="panel-title"><div><strong>隔离校核结论</strong><Text size="xs" c="dimmed">同舱 / 相邻层 / 上下层；受影响箱子重算，无关箱子沿用原结论</Text></div></div>
            <div className="dg-conc-list">
              {dgCargo.map((c) => {
                const conc = conclusions[c.id];
                const decl = declarations.find((d) => d.id === c.declarationId);
                const relCount: Record<SegRelation, number> = { 同舱: 0, 相邻层: 0, 上下层: 0, 远舱: 0 };
                conc?.segregation.issues.forEach((i) => { relCount[i.relation] += 1; });
                const cacheLabel = conc && conc.recomputeCount > 0 ? `已重算 ${conc.recomputeCount} 次` : '沿用初始结论';
                return (
                  <div key={c.id} className="dg-conc">
                    <div className="dg-conc-head">
                      <Group gap={6}><Text fw={700} size="xs">{c.bill}</Text><Badge size="xs" color="orange">{decl?.unNumber}</Badge><Badge size="xs" variant="light">{decl?.category} 类</Badge></Group>
                      <Group gap={6}><Badge size="xs" color={conc?.segregation.ok ? 'teal' : 'red'}>{conc?.segregation.ok ? '隔离通过' : `${conc?.segregation.issues.length} 项不足`}</Badge><Badge size="xs" variant="outline" color="gray">{cacheLabel}</Badge></Group>
                    </div>
                    <Group gap={6} mt={6}>
                      {(['同舱', '相邻层', '上下层'] as const).map((rel) => (
                        <Badge key={rel} size="xs" color={relCount[rel] ? 'red' : 'gray'} variant={relCount[rel] ? 'filled' : 'light'}>{rel} {relCount[rel]}</Badge>
                      ))}
                      <Badge size="xs" color={conc?.stacking.ok ? 'gray' : 'orange'} variant="light">堆码 {conc?.stacking.ok ? '正常' : `${conc?.stacking.issues.length}`}</Badge>
                      <Badge size="xs" color={conc?.stability.ok ? 'gray' : 'orange'} variant="light">稳性 {conc?.stability.ok ? '正常' : `${conc?.stability.issues.length}`}</Badge>
                      <Text size="xs" c="dimmed" ml="auto">校核于 {conc?.computedAt}</Text>
                    </Group>
                    {conc && !conc.segregation.ok && (
                      <Stack gap={4} mt={6}>{conc.segregation.issues.map((i) => <Text key={i.id} size="xs" c="red">{i.text}</Text>)}</Stack>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </Stack>

        <Stack gap="sm">
          <Card padding="md">
            <div className="panel-title" style={{ padding: 0, border: 0, marginBottom: 8 }}><div><strong>码头申报导入</strong><Text size="xs" c="dimmed">按 UN 号导入类别与隔离等级</Text></div><IconFileImport size={18} /></div>
            <Stack gap="xs">
              <Select size="xs" label="导入到货物" data={cargoOptions} value={importCargoId} onChange={(v) => v && setImportCargoId(v)} />
              <TextInput size="xs" label="UN 号" value={importUn} onChange={(e) => setImportUn(e.currentTarget.value)} />
              <Button size="xs" color="teal" loading={importing} onClick={() => importDecl({ cargoId: importCargoId, unNumber: importUn })}>导入申报</Button>
              <Divider label="模拟场景" labelPosition="center" />
              <Group gap={6}>
                <Button size="xs" variant="default" onClick={() => importDecl({ cargoId: importCargoId, unNumber: 'UN 0000' })}>导入失败重试</Button>
                <Button size="xs" variant="default" onClick={() => importDecl({ cargoId: importCargoId, unNumber: 'UN 9999' })}>旧稿缺类别</Button>
              </Group>
              <Text size="xs" c="dimmed">导入失败保留原货位与旧申报，可重试；旧稿缺危险品类别时补齐后才能重排。</Text>
            </Stack>
          </Card>

          <Card padding="md">
            <div className="panel-title" style={{ padding: 0, border: 0, marginBottom: 8 }}><div><strong>危险品位容量与排队</strong><Text size="xs" c="dimmed">容量 {DG_CAPACITY_PER_HOLD} 票 / 舱，不足先排队并写明占用者</Text></div><IconClockHour4 size={18} /></div>
            <Stack gap="xs">
              {holdRows.map((row) => (
                <div key={row.hold} className="dg-hold-row">
                  <Group justify="space-between"><Text size="xs" fw={700}>{row.hold}</Text><Badge size="xs" color={row.items.length >= DG_CAPACITY_PER_HOLD ? 'red' : 'teal'} variant="light">{row.items.length}/{DG_CAPACITY_PER_HOLD}</Badge></Group>
                  <Text size="xs" c="dimmed">{row.items.length ? row.items.map((c) => c.bill).join('、') : '暂无危险品箱'}</Text>
                </div>
              ))}
              {state.queue.map((q) => {
                const qc = cargo.find((c) => c.id === q.cargoId);
                return (
                  <div key={q.id} className="dg-queue">
                    <Group justify="space-between"><Badge size="xs" color="orange">排队中</Badge><Text size="xs" c="dimmed">{q.requestedAt}</Text></Group>
                    <Text size="xs" fw={700}>{qc?.bill} · {q.reason}</Text>
                    <Text size="xs" c="dimmed">占用者：{q.occupantIds.map((oid) => cargo.find((c) => c.id === oid)?.bill ?? oid).join('、')}</Text>
                    <Button size="xs" variant="default" onClick={() => dispatch(cancelQueue(q.id))}>取消排队</Button>
                  </div>
                );
              })}
              {!state.queue.length && <Text size="xs" c="teal">各舱危险品位均有空位。</Text>}
            </Stack>
          </Card>

          <Card padding="md">
            <div className="panel-title" style={{ padding: 0, border: 0, marginBottom: 8 }}><div><strong>两名值班员并发修改</strong><Text size="xs" c="dimmed">先到者占用，后到者留冲突</Text></div><IconArrowsExchange size={18} /></div>
            <Stack gap="xs">
              <Group justify="space-between"><Text size="xs" c="dimmed">当前值班员</Text><Badge size="xs" variant="light">{state.currentOfficer}</Badge></Group>
              <Group justify="space-between"><Text size="xs" c="dimmed">{active.bill} 占用者</Text>{active.claimedBy ? <Badge size="xs" color="orange">{active.claimedBy}</Badge> : <Badge size="xs" color="gray">空闲</Badge>}</Group>
              <Button size="xs" variant="default" leftSection={<IconUserCheck size={14} />} onClick={() => dispatch(simulateConcurrentEdit(active.id))}>模拟值班员·乙同时修改此货位</Button>
              {active.claimedBy && active.claimedBy === state.currentOfficer && (
                <Button size="xs" variant="subtle" onClick={() => dispatch(releaseClaim(active.id))}>释放占用</Button>
              )}
              <Divider label="并发冲突记录" labelPosition="center" />
              {state.concurrency.map((cc) => (
                <div key={cc.id} className="dg-cc">
                  <Group justify="space-between"><Badge size="xs" color={cc.status === '待处理' ? 'red' : 'gray'}>{cc.status}</Badge><Text size="xs" c="dimmed">{cc.at}</Text></Group>
                  <Text size="xs"><Text span fw={700}>{cc.firstOfficer}</Text> 先到占用 {cargo.find((c) => c.id === cc.cargoId)?.bill}，<Text span fw={700}>{cc.secondOfficer}</Text> 后到留冲突（目标 B{cc.position.bay}/R{cc.position.row}/T{cc.position.tier}）。</Text>
                  {cc.status === '待处理' && <Button size="xs" variant="default" onClick={() => dispatch(acknowledgeConflict(cc.id))}>知悉</Button>}
                </div>
              ))}
              {!state.concurrency.length && <Text size="xs" c="teal">暂无并发冲突。</Text>}
            </Stack>
          </Card>
        </Stack>
      </div>
    </div>
  );
}

function Compare() {
  const state = useSelector((root: RootState) => root.stowage);
  const stability = calculateStability(state.cargo);
  const changed = state.cargo.filter((item) => item.id === 'BL-88247' || item.id === 'BL-88219' || item.id === 'BL-88240');
  const [acceptOpen, setAcceptOpen] = useState(false);
  const dispatch = useDispatch();
  return <div className="page">
    <PageHeading eyebrow="PLAN BASELINE / V4 → V5" title="配载方案对比" description="按货位、重量分布和受限条件比较两个版本，并逐项决定是否接受。" actions={<Button color="teal" leftSection={<IconCheck size={16} />} onClick={() => setAcceptOpen(true)}>形成审阅结论</Button>} />
    <div className="compare-summary"><div><span>当前版本</span><strong>V{state.planRevision}</strong><small>总重 {stability.total.toFixed(1)}t</small></div><span className="compare-arrow">→</span><div><span>被比较版本</span><strong>V4</strong><small>总重 {(stability.total + 5.2).toFixed(1)}t</small></div><Badge color="teal" variant="light">3 处货位变化</Badge></div>
    <div className="compare-grid"><Card padding={0}><div className="panel-title"><div><strong>V4 基线</strong><Text size="xs" c="dimmed">批准于 09-28 16:20</Text></div></div><div className="mini-deck old-deck">{Array.from({ length: 28 }).map((_, index) => <div key={index} className={index === 6 || index === 11 || index === 17 ? 'changed' : ''}>{index === 6 ? '219' : index === 11 ? '240' : index === 17 ? '247' : ''}</div>)}</div></Card><Card padding={0}><div className="panel-title"><div><strong>V5 候选</strong><Text size="xs" c="dimmed">当前编辑 · {state.draftSavedAt}</Text></div></div><div className="mini-deck new-deck">{Array.from({ length: 28 }).map((_, index) => <div key={index} className={index === 6 || index === 11 || index === 17 ? 'changed' : ''}>{index === 6 ? '219' : index === 11 ? '240' : index === 17 ? '247' : ''}</div>)}</div></Card></div>
    <Card padding="md" mt="md"><div className="panel-title"><div><strong>参数差异</strong><Text size="xs" c="dimmed">系统通过检查的差异可直接接受</Text></div><Badge>{changed.length} 项</Badge></div><Table verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th>货物</Table.Th><Table.Th>字段</Table.Th><Table.Th>V4</Table.Th><Table.Th>V5</Table.Th><Table.Th>说明</Table.Th><Table.Th>决定</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{[
      ['BL-88247', '货位', 'Bay 14 / Row 1', 'Bay 15 / Row 0', '扩大重大件绑扎操作空间'],
      ['BL-88219', '绑扎', '待绑扎', '需复核', '危险品隔离边界调整'],
      ['BL-88240', 'Tier', 'Tier 1', 'Tier 2', '降低舱内底层局部载荷']
    ].map((row) => <Table.Tr key={row[0]}><Table.Td>{row[0]}</Table.Td><Table.Td>{row[1]}</Table.Td><Table.Td><Text c="red" td="line-through">{row[2]}</Text></Table.Td><Table.Td><Text c="teal" fw={700}>{row[3]}</Text></Table.Td><Table.Td><Text size="xs">{row[4]}</Text></Table.Td><Table.Td><Checkbox label="接受" defaultChecked /></Table.Td></Table.Tr>)}</Table.Tbody></Table></Card>
    <Modal opened={acceptOpen} onClose={() => setAcceptOpen(false)} title="形成配载审阅结论" centered><Stack><Text size="sm" c="dimmed">接受后生成新的只读版本并保留船长、码头和货主意见。锁定前仍可退回修改。</Text>{['重大件绑扎后由甲板部复核', '危险品隔离线在配载图中明确标注', '釜山卸货顺序不得改变'].map((limit) => <Checkbox key={limit} label={limit} checked={state.acceptedLimits.includes(limit)} onChange={() => dispatch(acceptLimit(limit))} />)}<Button color="teal" disabled={state.acceptedLimits.length < 3} onClick={() => { dispatch(lockPlan()); setAcceptOpen(false); }}>接受并锁定 V{state.planRevision + 1}</Button></Stack></Modal>
  </div>;
}

function PrintPlan() {
  const { data } = useGetVoyageQuery();
  const state = useSelector((root: RootState) => root.stowage);
  const stability = calculateStability(state.cargo);
  const dispatch = useDispatch();
  const conflicts = detectConflicts(state.cargo, state.declarations, state.queue, state.conclusions);
  const dgIssues = Object.values(state.conclusions).filter((c) => !c.segregation.ok).reduce((n, c) => n + c.segregation.issues.length, 0);
  const canPrint = conflicts.length === 0 && dgIssues === 0;
  return <div className="page print-page">
    <PageHeading eyebrow="STOWAGE PLAN / PRINT" title="配载图与卸货清单" description="面向船长、码头和理货人员打印，包含重量分布和危险品标记。" actions={<><Button variant="default" leftSection={<IconPlayerPlay size={16} />} onClick={() => dispatch(setViewMode(state.viewMode === '3d' ? 'section' : '3d'))}>预览剖面</Button><Button color="teal" leftSection={<IconPrinter size={16} />} disabled={!canPrint} onClick={() => canPrint && window.print()}>打印配载包</Button></>} />
    {!canPrint && <Alert color="red" variant="light" icon={<IconLockOpen size={16} />} mb="md">危险品隔离尚未清干净（{dgIssues} 项隔离不足{conflicts.length ? `，${conflicts.length} 项冲突` : ''}），锁定并消除隔离前不得打印配载包。</Alert>}
    <Card padding="xl" className="print-sheet">
      <div className="print-header"><div><Text size="xs" c="dimmed">VESSEL STOWAGE PLAN</Text><h1>{data?.vessel ?? '海岳轮'} · {data?.id ?? 'V-2609-17'}</h1><p>{data?.route}</p></div><div className="print-stamp">方案 V{state.planRevision}<br />{canPrint ? '已校核' : '隔离未清'}</div></div>
      <div className="print-kpis"><div><span>总货重</span><strong>{stability.total.toFixed(1)} t</strong></div><div><span>稳性裕度</span><strong>{stability.stability.toFixed(1)}%</strong></div><div><span>纵倾</span><strong>{stability.trim}</strong></div><div><span>主甲板载荷</span><strong>{stability.deckLoad.toFixed(1)} t</strong></div></div>
      <h3>主甲板配载图</h3>
      <div className="print-deck">{Array.from({ length: 28 }).map((_, index) => { const row = index % 4; const bay = 4 + Math.floor(index / 4); const item = state.cargo.find((cargo) => cargo.deck === '主甲板' && cargo.bay === bay && cargo.row === row); return <div key={index} className={item ? 'filled' : ''} style={item ? { borderTopColor: item.color } : undefined}><span>{item ? item.bill.slice(-3) : ''}</span><small>{item ? `${item.weight}t` : `B${bay}/R${row}`}</small>{item?.hazmat !== '无' && item && <b>DG</b>}</div>; })}</div>
      <h3>卸货顺序与绑扎清单</h3>
      <Table striped><Table.Thead><Table.Tr><Table.Th>顺序</Table.Th><Table.Th>提单号</Table.Th><Table.Th>货位</Table.Th><Table.Th>货类</Table.Th><Table.Th>重量</Table.Th><Table.Th>卸货港</Table.Th><Table.Th>危险品 / 绑扎</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{[...state.cargo].sort((a, b) => (a.port === '釜山' ? -1 : 1) - (b.port === '釜山' ? -1 : 1)).map((item, index) => <Table.Tr key={item.id}><Table.Td>{index + 1}</Table.Td><Table.Td fw={700}>{item.bill}</Table.Td><Table.Td>B{item.bay}/R{item.row}/T{item.tier}</Table.Td><Table.Td>{item.type}</Table.Td><Table.Td>{item.weight} t</Table.Td><Table.Td>{item.port}</Table.Td><Table.Td><Badge size="xs" color={item.hazmat !== '无' ? 'orange' : 'gray'}>{item.hazmat}</Badge> <Text span size="xs">{item.lashing}</Text></Table.Td></Table.Tr>)}</Table.Tbody></Table>
      <div className="print-signatures"><div>配载负责人：____________</div><div>船长确认：____________</div><div>码头代表：____________</div><div>日期：2026-09-29</div></div>
    </Card>
  </div>;
}

function Shell({ children }: { children: ReactNode }) {
  const state = useSelector((root: RootState) => root.stowage);
  const stability = calculateStability(state.cargo);
  return <AppShell header={{ height: 62 }} navbar={{ width: 224, breakpoint: 'sm' }} padding={0}>
    <AppShellHeader className="app-header"><Group h="100%" px="md" justify="space-between"><Group gap="sm"><ThemeIcon color="teal" variant="light"><IconShip size={19} /></ThemeIcon><div className="brand-copy"><strong>船舶配载校核台</strong><span>Stowage & Voyage Review</span></div></Group><Group gap="sm" visibleFrom="sm"><Badge variant="light" color="teal">海岳轮</Badge><Text size="xs" c="dimmed">V-2609-17 · 方案 V{state.planRevision}</Text><Badge color={state.locked ? 'teal' : 'orange'}>{state.locked ? '已锁定' : '审阅中'}</Badge></Group><ActionIcon variant="subtle" color="gray"><IconAnchor size={18} /></ActionIcon></Group></AppShellHeader>
    <AppShellNavbar p="xs" className="app-nav"><div className="voyage-card"><Text size="xs" c="dimmed">当前航次</Text><Text fw={800}>上海 → 温哥华</Text><Text size="xs" c="dimmed">经停釜山 · 10-02 离港</Text><Progress value={stability.stability} color={stability.stability > 70 ? 'teal' : 'orange'} size="sm" mt="sm" /><Text size="xs" mt={4}>稳性裕度 {stability.stability.toFixed(1)}%</Text></div>{nav.map((item) => <NavLink end={item.path === '/'} key={item.path} to={item.path}>{item.icon}<span>{item.label}</span></NavLink>)}<div className="nav-foot"><IconRoute size={16} /><Text size="xs">基线：方案 V4<br />草稿：{state.draftSavedAt} 自动保存</Text></div></AppShellNavbar>
    <AppShellMain>{children}</AppShellMain>
  </AppShell>;
}

export default function App() {
  return <BrowserRouter><Shell><Routes><Route path="/" element={<Overview />} /><Route path="/stowage" element={<Stowage />} /><Route path="/dg" element={<DgPage />} /><Route path="/compare" element={<Compare />} /><Route path="/print" element={<PrintPlan />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes></Shell></BrowserRouter>;
}
