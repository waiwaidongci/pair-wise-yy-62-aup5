import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { stowageApi, type Cargo, type TerminalImport } from './api';
import { DG_ZONE, LEVEL_LABELS, UN_TABLE, checkStack, inDgZone, minScoreFor, parseUn, relationOf, requiredLevel } from './dg';

export type StowageComment = {
  id: string;
  cargoId: string;
  author: string;
  role: '船长' | '码头' | '货主';
  content: string;
  status: '待确认' | '已接受' | '已退回';
};

export type DgDeclaration = {
  id: string;
  cargoId: string;
  un: string;
  dgClass: string;
  status: '有效' | '待补齐';
  source: '手工录入' | '码头导入' | '旧稿迁移';
  updatedAt: string;
};

export type SegregationConflict = { withId: string; relation: string; required: string };
export type SegregationVerdict = {
  status: '通过' | '冲突' | '排队中' | '待补齐';
  conflicts: SegregationConflict[];
  computedAt: string;
};

type SlotClaim = { officer: string; cargoId: string; at: string };
type SlotConflict = { id: string; slotKey: string; holder: string; holderCargo: string; challenger: string; challengerCargo: string; at: string };

type State = {
  cargo: Cargo[];
  activeCargoId: string;
  planRevision: number;
  comments: StowageComment[];
  acceptedLimits: string[];
  locked: boolean;
  viewMode: '3d' | 'section';
  draftSavedAt: string;
  declarations: DgDeclaration[];
  segregation: Record<string, { signature: string; verdict: SegregationVerdict }>;
  stacking: Record<string, { signature: string; issues: string[]; computedAt: string }>;
  stabilityConclusion: { signature: string; computedAt: string; stability: number; trim: string; total: number };
  dgOccupants: string[];
  dgQueue: { cargoId: string; occupiers: string[]; reason: string; at: string }[];
  slotClaims: Record<string, SlotClaim>;
  slotConflicts: SlotConflict[];
  currentOfficer: string;
  importLog: { at: string; status: '成功' | '失败'; message: string }[];
  audit: string[];
  lastRejection: string | null;
  lastRecompute: { at: string; reason: string; recomputed: number; reused: number } | null;
  version: number;
};

const STATE_VERSION = 2;
export const OFFICERS = ['值班员·陈', '值班员·林'];

const initialCargo: Cargo[] = [
  { id: 'BL-88214', bill: 'SEA-88214', type: '集装箱', bay: 12, row: 4, tier: 2, deck: '主甲板', weight: 24.6, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: '无', lashing: '已绑扎', color: '#2b7c75' },
  { id: 'BL-88219', bill: 'SEA-88219', type: '集装箱', bay: 13, row: 4, tier: 2, deck: '主甲板', weight: 28.1, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: 'UN 1263', lashing: '需复核', color: '#c77835' },
  { id: 'BL-88231', bill: 'SEA-88231', type: '集装箱', bay: 10, row: 6, tier: 1, deck: '主甲板', weight: 18.2, dimension: '20 × 8 × 8.6 ft', port: '釜山', hazmat: '无', lashing: '已绑扎', color: '#366d94' },
  { id: 'BL-88236', bill: 'SEA-88236', type: '集装箱', bay: 14, row: 4, tier: 2, deck: '主甲板', weight: 21.8, dimension: '20 × 8 × 8.6 ft', port: '温哥华', hazmat: 'UN 2014', lashing: '已绑扎', color: '#8a5a2b' },
  { id: 'BL-88240', bill: 'SEA-88240', type: '集装箱', bay: 8, row: 2, tier: 2, deck: '货舱', weight: 31.4, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: '无', lashing: '待绑扎', color: '#6d528d' },
  { id: 'BL-88247', bill: 'SEA-88247', type: '重大件', bay: 15, row: 0, tier: 1, deck: '主甲板', weight: 112.5, dimension: '18.4 × 4.2 × 4.8 m', port: '温哥华', hazmat: '无', lashing: '需复核', color: '#b64f49' },
  { id: 'BL-88254', bill: 'SEA-88254', type: '散货', bay: 5, row: 0, tier: 0, deck: '货舱', weight: 286.0, dimension: '散装 / 420 m³', port: '釜山', hazmat: '无', lashing: '已绑扎', color: '#9a7836' }
];

const seedDeclarations: DgDeclaration[] = [
  { id: 'DG-BL-88219', cargoId: 'BL-88219', un: '1263', dgClass: '3', status: '有效', source: '手工录入', updatedAt: '09-29 10:12' },
  { id: 'DG-BL-88236', cargoId: 'BL-88236', un: '2014', dgClass: '5.1', status: '有效', source: '码头导入', updatedAt: '09-29 11:40' }
];

const timeNow = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
const slotKey = (deck: string, bay: number, row: number, tier: number) => `${deck} B${bay}/R${row}/T${tier}`;

/**
 * 隔离 / 堆码 / 稳性联动校核。
 * 隔离与堆码按签名失效：签名不变的箱子沿用原结论，变化的才重算；
 * restowAll（申报变更、导入、补齐）时堆码与稳性结论一并退回重算。
 */
function runChecks(state: State, reason: string, restowAll = false) {
  const at = timeNow();
  // 危险品货位容量：先占先得，容量不够先排队并写明占用者
  const dgIds = new Set(state.declarations.filter((d) => d.status === '有效').map((d) => d.cargoId));
  const dgCargo = state.cargo.filter((c) => dgIds.has(c.id));
  const inZone = dgCargo.filter(inDgZone);
  const kept = state.dgOccupants.filter((id) => inZone.some((c) => c.id === id));
  const newcomers = inZone.filter((c) => !kept.includes(c.id)).map((c) => c.id);
  state.dgOccupants = [...kept, ...newcomers].slice(0, DG_ZONE.capacity);
  const queued = inZone.filter((c) => !state.dgOccupants.includes(c.id));
  state.dgQueue = queued.map((c) => ({ cargoId: c.id, occupiers: [...state.dgOccupants], reason: `危险品货位容量不足（${state.dgOccupants.length}/${DG_ZONE.capacity} 被占用）`, at }));
  // 隔离校核：按 UN 号类别取隔离等级，比对同舱、相邻层与上下层货位
  let recomputed = 0;
  let reused = 0;
  const active = dgCargo.filter((c) => !queued.some((q) => q.id === c.id));
  queued.forEach((c) => { state.segregation[c.id] = { signature: '', verdict: { status: '排队中', conflicts: [], computedAt: at } }; });
  state.declarations.filter((d) => d.status === '待补齐').forEach((d) => { state.segregation[d.cargoId] = { signature: '', verdict: { status: '待补齐', conflicts: [], computedAt: at } }; });
  active.forEach((cargo) => {
    const decl = state.declarations.find((d) => d.cargoId === cargo.id)!;
    const others = active.filter((o) => o.id !== cargo.id).map((o) => {
      const od = state.declarations.find((d) => d.cargoId === o.id)!;
      return [o.id, od.un, od.dgClass, o.deck, o.bay, o.row, o.tier];
    });
    const signature = JSON.stringify({ un: decl.un, cls: decl.dgClass, slot: [cargo.deck, cargo.bay, cargo.row, cargo.tier], others });
    const cached = state.segregation[cargo.id];
    if (cached && cached.signature === signature) { reused += 1; return; }
    const conflicts: SegregationConflict[] = [];
    active.forEach((other) => {
      if (other.id === cargo.id) return;
      const od = state.declarations.find((d) => d.cargoId === other.id)!;
      const level = requiredLevel(decl.dgClass, od.dgClass);
      if (level === 0) return;
      const relation = relationOf(cargo, other);
      if (relation.score < minScoreFor(level)) conflicts.push({ withId: other.id, relation: relation.label, required: LEVEL_LABELS[level] });
    });
    state.segregation[cargo.id] = { signature, verdict: { status: conflicts.length ? '冲突' : '通过', conflicts, computedAt: at } };
    recomputed += 1;
  });
  Object.keys(state.segregation).forEach((id) => { if (!state.declarations.some((d) => d.cargoId === id)) delete state.segregation[id]; });
  // 堆码结论：按签名失效重算
  let stackRecomputed = 0;
  state.cargo.forEach((cargo) => {
    const neighbors = state.cargo.filter((o) => o.id !== cargo.id && o.deck === cargo.deck && o.bay === cargo.bay && o.row === cargo.row && Math.abs(o.tier - cargo.tier) === 1).map((o) => [o.id, o.weight, o.tier]);
    const signature = JSON.stringify([cargo.type, cargo.weight, cargo.deck, cargo.bay, cargo.row, cargo.tier, neighbors]);
    const cached = state.stacking[cargo.id];
    if (!restowAll && cached && cached.signature === signature) return;
    state.stacking[cargo.id] = { signature, issues: checkStack(cargo, state.cargo), computedAt: at };
    stackRecomputed += 1;
  });
  // 稳性结论：货位或重量签名变化、或申报变更时退回重算
  const stabSignature = JSON.stringify(state.cargo.map((c) => [c.id, c.bay, c.row, c.tier, c.deck, c.weight]));
  let stabRecomputed = false;
  if (restowAll || state.stabilityConclusion.signature !== stabSignature) {
    const result = calculateStability(state.cargo);
    state.stabilityConclusion = { signature: stabSignature, computedAt: at, stability: result.stability, trim: result.trim, total: result.total };
    stabRecomputed = true;
  }
  state.lastRecompute = { at, reason, recomputed, reused };
  const parts = [`隔离重算 ${recomputed} 箱`];
  if (reused > 0) parts.push(`沿用 ${reused} 箱`);
  if (stackRecomputed > 0) parts.push(`堆码重算 ${stackRecomputed} 箱`);
  if (stabRecomputed) parts.push('稳性退回重算');
  state.audit.unshift(`[${at}] ${reason}：${parts.join(' · ')}`);
  state.audit = state.audit.slice(0, 30);
}

function baseState(): State {
  const state: State = {
    cargo: initialCargo,
    activeCargoId: 'BL-88247',
    planRevision: 5,
    comments: [
      { id: 'CM-21', cargoId: 'BL-88219', author: '港方配载', role: '码头', content: '危险品箱与船员生活区保持隔离，请在最终图中标注危险品隔离线。', status: '待确认' },
      { id: 'CM-22', cargoId: 'BL-88247', author: '周船长', role: '船长', content: '重大件横向支撑需增加两组绑扎点，检查甲板局部强度。', status: '待确认' },
      { id: 'CM-23', cargoId: 'BL-88254', author: '货主代表', role: '货主', content: '釜山港卸货前不得覆盖散货舱口，已接受当前安排。', status: '已接受' }
    ],
    acceptedLimits: [],
    locked: false,
    viewMode: '3d',
    draftSavedAt: '09:52',
    declarations: seedDeclarations.map((d) => ({ ...d })),
    segregation: {},
    stacking: {},
    stabilityConclusion: { signature: '', computedAt: '—', stability: 0, trim: '—', total: 0 },
    dgOccupants: [],
    dgQueue: [],
    slotClaims: {},
    slotConflicts: [],
    currentOfficer: OFFICERS[0],
    importLog: [],
    audit: [],
    lastRejection: null,
    lastRecompute: null,
    version: STATE_VERSION
  };
  runChecks(state, '方案装载');
  return state;
}

/** 旧稿升级：v1 草稿没有危险品申报，按 hazmat 字段迁移；缺类别的标记待补齐 */
function migrate(saved: Record<string, unknown> | null): State | null {
  if (!saved) return null;
  if ((saved as { version?: number }).version === STATE_VERSION) return saved as unknown as State;
  const legacyCargo = Array.isArray(saved.cargo) ? (saved.cargo as Cargo[]) : [];
  const declarations: DgDeclaration[] = legacyCargo.filter((c) => c.hazmat && c.hazmat !== '无').map((c) => {
    const un = parseUn(c.hazmat);
    const known = un ? UN_TABLE[un] : undefined;
    return { id: `DG-${c.id}`, cargoId: c.id, un, dgClass: known?.dgClass ?? '', status: known ? '有效' : '待补齐', source: '旧稿迁移', updatedAt: (saved.draftSavedAt as string) ?? '—' };
  });
  const state = {
    ...baseState(),
    ...saved,
    declarations,
    segregation: {},
    stacking: {},
    stabilityConclusion: { signature: '', computedAt: '—', stability: 0, trim: '—', total: 0 },
    dgOccupants: [],
    dgQueue: [],
    slotClaims: {},
    slotConflicts: [],
    currentOfficer: OFFICERS[0],
    importLog: [],
    audit: [],
    lastRejection: null,
    lastRecompute: null,
    version: STATE_VERSION
  } as State;
  runChecks(state, '旧稿升级');
  if (declarations.some((d) => d.status === '待补齐')) state.audit.unshift('旧稿缺危险品类别：已标记待补齐，升级补齐后才能重排');
  return state;
}

const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('yy62-stowage-plan') : null;
const saved = raw ? JSON.parse(raw) : null;
const initialState: State = migrate(saved) ?? baseState();

const slice = createSlice({
  name: 'stowage',
  initialState,
  reducers: {
    selectCargo(state, action: PayloadAction<string>) { state.activeCargoId = action.payload; },
    moveCargo(state, action: PayloadAction<{ id: string; bay: number; row: number; tier: number }>) {
      const cargo = state.cargo.find((item) => item.id === action.payload.id);
      if (!cargo) return;
      if (state.locked) { state.lastRejection = '方案已锁定，不能调整货位'; return; }
      if (state.declarations.some((d) => d.status === '待补齐')) {
        state.lastRejection = '有危险品申报缺类别（待补齐），升级补齐后才能重排';
        state.audit.unshift(`[${timeNow()}] 重排被阻止：申报待补齐`);
        return;
      }
      const key = slotKey(cargo.deck, action.payload.bay, action.payload.row, action.payload.tier);
      const claim = state.slotClaims[key];
      if (claim && claim.officer !== state.currentOfficer && claim.cargoId !== cargo.id) {
        state.slotConflicts.unshift({ id: `SC-${Date.now()}`, slotKey: key, holder: claim.officer, holderCargo: claim.cargoId, challenger: state.currentOfficer, challengerCargo: cargo.id, at: timeNow() });
        state.lastRejection = `货位 ${key} 已由 ${claim.officer} 占用，本次修改未生效`;
        state.audit.unshift(`[${timeNow()}] ${state.currentOfficer} 修改 ${key} 被拒：${claim.officer} 先占用`);
        return;
      }
      Object.keys(state.slotClaims).forEach((k) => { if (state.slotClaims[k].cargoId === cargo.id) delete state.slotClaims[k]; });
      Object.assign(cargo, { bay: action.payload.bay, row: action.payload.row, tier: action.payload.tier });
      state.slotClaims[key] = { officer: state.currentOfficer, cargoId: cargo.id, at: timeNow() };
      state.planRevision += 1;
      state.draftSavedAt = timeNow();
      runChecks(state, `${cargo.id} 货位调整`);
    },
    updateLashing(state, action: PayloadAction<{ id: string; lashing: Cargo['lashing'] }>) {
      const cargo = state.cargo.find((item) => item.id === action.payload.id);
      if (cargo) cargo.lashing = action.payload.lashing;
    },
    updateDeclarationUn(state, action: PayloadAction<{ cargoId: string; un: string }>) {
      const decl = state.declarations.find((d) => d.cargoId === action.payload.cargoId);
      const cargo = state.cargo.find((c) => c.id === action.payload.cargoId);
      if (!decl || !cargo || state.locked) return;
      const known = UN_TABLE[action.payload.un];
      decl.un = action.payload.un;
      decl.dgClass = known?.dgClass ?? '';
      decl.status = known ? '有效' : '待补齐';
      decl.source = '手工录入';
      decl.updatedAt = timeNow();
      cargo.hazmat = `UN ${action.payload.un}`;
      runChecks(state, `${cargo.id} 申报 UN 号变更`, true);
    },
    upgradeDeclaration(state, action: PayloadAction<{ cargoId: string; dgClass: string }>) {
      const decl = state.declarations.find((d) => d.cargoId === action.payload.cargoId);
      if (!decl) return;
      decl.dgClass = action.payload.dgClass;
      decl.status = '有效';
      decl.updatedAt = timeNow();
      runChecks(state, `${decl.cargoId} 申报类别补齐`, true);
    },
    applyImportedDeclarations(state, action: PayloadAction<TerminalImport>) {
      const at = timeNow();
      action.payload.declarations.forEach((row) => {
        const cargo = state.cargo.find((c) => c.bill === row.bill);
        if (!cargo) return;
        const known = UN_TABLE[row.un];
        const next = { un: row.un, dgClass: known?.dgClass ?? '', status: (known ? '有效' : '待补齐') as DgDeclaration['status'], source: '码头导入' as const, updatedAt: at };
        const existing = state.declarations.find((d) => d.cargoId === cargo.id);
        if (existing) Object.assign(existing, next);
        else state.declarations.push({ id: `DG-${cargo.id}`, cargoId: cargo.id, ...next });
        cargo.hazmat = `UN ${row.un}`;
      });
      state.importLog.unshift({ at, status: '成功', message: `码头申报导入 ${action.payload.declarations.length} 条（${action.payload.receivedAt}）` });
      runChecks(state, '码头申报导入', true);
    },
    recordImportFailure(state, action: PayloadAction<string>) {
      const at = timeNow();
      state.importLog.unshift({ at, status: '失败', message: action.payload });
      state.audit.unshift(`[${at}] 码头申报导入失败：${action.payload}；已保留原货位和旧申报，可重试`);
    },
    setOfficer(state, action: PayloadAction<string>) { state.currentOfficer = action.payload; },
    clearRejection(state) { state.lastRejection = null; },
    addComment(state, action: PayloadAction<{ cargoId: string; author: string; role: StowageComment['role']; content: string }>) {
      state.comments.unshift({ ...action.payload, id: `CM-${Date.now()}`, status: '待确认' });
    },
    acceptComment(state, action: PayloadAction<string>) {
      const comment = state.comments.find((item) => item.id === action.payload);
      if (comment) comment.status = '已接受';
    },
    rejectComment(state, action: PayloadAction<string>) {
      const comment = state.comments.find((item) => item.id === action.payload);
      if (comment) comment.status = '已退回';
    },
    acceptLimit(state, action: PayloadAction<string>) {
      if (!state.acceptedLimits.includes(action.payload)) state.acceptedLimits.push(action.payload);
    },
    setViewMode(state, action: PayloadAction<'3d' | 'section'>) { state.viewMode = action.payload; },
    lockPlan(state) {
      if (detectConflicts(state.cargo).length > 0 || !segregationClear(state)) {
        state.lastRejection = '危险品隔离未清干净或存在配载冲突，不能锁定';
        state.audit.unshift(`[${timeNow()}] 锁定被阻止：隔离未清或冲突未处理`);
        return;
      }
      state.locked = true;
      state.planRevision += 1;
      state.audit.unshift(`[${timeNow()}] 方案 V${state.planRevision} 已锁定`);
    }
  }
});

export const {
  selectCargo, moveCargo, updateLashing, updateDeclarationUn, upgradeDeclaration,
  applyImportedDeclarations, recordImportFailure, setOfficer, clearRejection,
  addComment, acceptComment, rejectComment, acceptLimit, setViewMode, lockPlan
} = slice.actions;

export const store = configureStore({
  reducer: { stowage: slice.reducer, [stowageApi.reducerPath]: stowageApi.reducer },
  middleware: (getDefault) => getDefault().concat(stowageApi.middleware)
});

store.subscribe(() => {
  if (typeof localStorage !== 'undefined') localStorage.setItem('yy62-stowage-plan', JSON.stringify(store.getState().stowage));
});

export type RootState = ReturnType<typeof store.getState>;

/** 隔离是否清干净：无冲突、无排队、无待补齐，全部结论为通过 */
export function segregationClear(state: State): boolean {
  return state.dgQueue.length === 0
    && !state.declarations.some((d) => d.status === '待补齐')
    && Object.values(state.segregation).every((entry) => entry.verdict.status === '通过');
}

export function calculateStability(cargo: Cargo[]) {
  const total = cargo.reduce((sum, item) => sum + item.weight, 0);
  const longitudinal = cargo.reduce((sum, item) => sum + item.weight * item.bay, 0) / Math.max(total, 1);
  const vertical = cargo.reduce((sum, item) => sum + item.weight * (item.tier + 1), 0) / Math.max(total, 1);
  const deckLoad = cargo.filter((item) => item.deck === '主甲板').reduce((sum, item) => sum + item.weight, 0);
  const stability = Math.max(0, 92 - Math.abs(longitudinal - 10.8) * 2.2 - Math.max(0, vertical - 1.75) * 8);
  return {
    total,
    longitudinal,
    vertical,
    deckLoad,
    stability,
    trim: (longitudinal - 10.8) < -0.4 ? '艉倾' : (longitudinal - 10.8) > 0.4 ? '艏倾' : '正平'
  };
}

export function detectConflicts(cargo: Cargo[]) {
  const issues: { id: string; cargoId: string; level: 'high' | 'medium'; title: string; detail: string }[] = [];
  const slots = new Map<string, Cargo>();
  cargo.forEach((item) => {
    const key = `${item.deck}-${item.bay}-${item.row}-${item.tier}`;
    const existing = slots.get(key);
    if (existing) issues.push({ id: `${item.id}-overlap`, cargoId: item.id, level: 'high', title: '货位重叠', detail: `${item.id} 与 ${existing.id} 占用相同二维货位。` });
    slots.set(key, item);
    if (item.hazmat !== '无' && item.deck === '主甲板' && item.row <= 1) issues.push({ id: `${item.id}-hazmat`, cargoId: item.id, level: 'high', title: '危险品隔离不足', detail: `${item.id} 与船体边界距离小于方案要求。` });
    if (item.weight > 100 && item.lashing !== '已绑扎') issues.push({ id: `${item.id}-lashing`, cargoId: item.id, level: 'medium', title: '重大件绑扎未完成', detail: `${item.id} 重量 ${item.weight}t，绑扎状态为“${item.lashing}”。` });
    if (item.type === '集装箱' && item.weight > 30 && item.tier >= 3) issues.push({ id: `${item.id}-stack`, cargoId: item.id, level: 'medium', title: '上层堆重超限', detail: `${item.id} 不应放在第 ${item.tier} 层。` });
  });
  return issues;
}
