import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import {
  stowageApi,
  DG_CAPACITY_PER_HOLD,
  UN_TABLE,
  holdOf,
  requiredSegregation,
  segRelation,
  type Cargo,
  type CargoType,
  type DgDeclaration,
  type SegRelation
} from './api';

export type StowageComment = {
  id: string;
  cargoId: string;
  author: string;
  role: '船长' | '码头' | '货主';
  content: string;
  status: '待确认' | '已接受' | '已退回';
};

export type SegIssue = {
  id: string;
  withId: string;
  withUn: string;
  level: number;
  relation: SegRelation;
  text: string;
};

/** 每票货物一份结论缓存：隔离 / 堆码 / 稳性。受影响才重算，无关箱子沿用。 */
export type Conclusion = {
  status: 'valid' | 'stale';
  segregation: { ok: boolean; level: number; issues: SegIssue[] };
  stacking: { ok: boolean; issues: string[] };
  stability: { ok: boolean; issues: string[] };
  dependsOn: string[];
  computedAt: string;
  recomputeCount: number;
};

export type QueueEntry = {
  id: string;
  cargoId: string;
  hold: string;
  occupantIds: string[];
  reason: string;
  requestedAt: string;
  status: '排队中';
};

export type ConcurrencyConflict = {
  id: string;
  cargoId: string;
  firstOfficer: string;
  secondOfficer: string;
  position: { bay: number; row: number; tier: number };
  at: string;
  status: '待处理' | '已处理';
};

export type ImportNotice = { kind: 'failed' | 'draft' | 'ok' | 'info'; message: string; at: string } | null;

type State = {
  cargo: Cargo[];
  declarations: DgDeclaration[];
  activeCargoId: string;
  planRevision: number;
  comments: StowageComment[];
  acceptedLimits: string[];
  locked: boolean;
  viewMode: '3d' | 'section';
  draftSavedAt: string;
  conclusions: Record<string, Conclusion>;
  queue: QueueEntry[];
  concurrency: ConcurrencyConflict[];
  importNotice: ImportNotice;
  currentOfficer: string;
};

const initialCargo: Cargo[] = [
  { id: 'BL-88214', bill: 'SEA-88214', type: '集装箱', bay: 12, row: 4, tier: 2, deck: '主甲板', weight: 24.6, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: '无', lashing: '已绑扎', color: '#2b7c75', hold: '主甲板', declarationId: null, posVersion: 1, claimedBy: null },
  { id: 'BL-88219', bill: 'SEA-88219', type: '集装箱', bay: 13, row: 4, tier: 2, deck: '主甲板', weight: 28.1, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: 'UN 1263', lashing: '需复核', color: '#c77835', hold: '主甲板', declarationId: 'DG-219', posVersion: 1, claimedBy: null },
  { id: 'BL-88227', bill: 'SEA-88227', type: '集装箱', bay: 6, row: 2, tier: 1, deck: '主甲板', weight: 22.4, dimension: '20 × 8 × 8.6 ft', port: '温哥华', hazmat: 'UN 1805', lashing: '已绑扎', color: '#b06a8f', hold: '主甲板', declarationId: 'DG-227', posVersion: 1, claimedBy: null },
  { id: 'BL-88231', bill: 'SEA-88231', type: '集装箱', bay: 10, row: 6, tier: 1, deck: '主甲板', weight: 18.2, dimension: '20 × 8 × 8.6 ft', port: '釜山', hazmat: '无', lashing: '已绑扎', color: '#366d94', hold: '主甲板', declarationId: null, posVersion: 1, claimedBy: null },
  { id: 'BL-88236', bill: 'SEA-88236', type: '集装箱', bay: 7, row: 1, tier: 1, deck: '货舱', weight: 26.8, dimension: '20 × 8 × 8.6 ft', port: '釜山', hazmat: 'UN 1479', lashing: '已绑扎', color: '#c08a3e', hold: '1号货舱', declarationId: 'DG-236', posVersion: 1, claimedBy: null },
  { id: 'BL-88240', bill: 'SEA-88240', type: '集装箱', bay: 8, row: 2, tier: 2, deck: '货舱', weight: 31.4, dimension: '40 × 8 × 8.6 ft', port: '温哥华', hazmat: '无', lashing: '待绑扎', color: '#6d528d', hold: '1号货舱', declarationId: null, posVersion: 1, claimedBy: null },
  { id: 'BL-88247', bill: 'SEA-88247', type: '重大件', bay: 15, row: 0, tier: 1, deck: '主甲板', weight: 112.5, dimension: '18.4 × 4.2 × 4.8 m', port: '温哥华', hazmat: '无', lashing: '需复核', color: '#b64f49', hold: '主甲板', declarationId: null, posVersion: 1, claimedBy: null },
  { id: 'BL-88254', bill: 'SEA-88254', type: '散货', bay: 5, row: 0, tier: 0, deck: '货舱', weight: 286.0, dimension: '散装 / 420 m³', port: '釜山', hazmat: '无', lashing: '已绑扎', color: '#9a7836', hold: '1号货舱', declarationId: null, posVersion: 1, claimedBy: null }
];

const initialDeclarations: DgDeclaration[] = [
  { id: 'DG-219', unNumber: 'UN 1263', category: '3', name: '油漆类易燃液体', segregationLevel: 2, status: '完整', source: '码头申报' },
  { id: 'DG-227', unNumber: 'UN 1805', category: '8', name: '磷酸溶液', segregationLevel: 1, status: '完整', source: '码头申报' },
  { id: 'DG-236', unNumber: 'UN 1479', category: '5.1', name: '氧化性固体', segregationLevel: 2, status: '完整', source: '码头申报' }
];

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** 按 UN 号取类别与隔离等级，生成隔离校核结论。 */
function buildSegIssues(item: Cargo, allCargo: Cargo[], declarations: DgDeclaration[]): SegIssue[] {
  const decl = declarations.find((d) => d.id === item.declarationId);
  if (!decl || !decl.category) return [];
  const issues: SegIssue[] = [];
  for (const other of allCargo) {
    if (other.id === item.id) continue;
    const otherDecl = declarations.find((d) => d.id === other.declarationId);
    if (!otherDecl || !otherDecl.category) continue;
    // 同类别可混装；爆炸品除外
    const level = decl.category === otherDecl.category ? (decl.category === '1' ? 3 : 0) : segLevelBetween(decl.category, otherDecl.category);
    if (level === 0) continue;
    const relation = segRelation(item, other);
    if (relation === '上下层') {
      issues.push({
        id: `${item.id}-${other.id}-上下层`,
        withId: other.id,
        withUn: otherDecl.unNumber,
        level,
        relation,
        text: `${item.bill}（${decl.unNumber} 类${decl.category}）与 ${other.bill}（${otherDecl.unNumber} 类${otherDecl.category}）上下层堆装，须隔离 ${level} 级，不得置于同一 Bay 同一 Row 的上下层货位。`
      });
    } else if (relation === '相邻层' && level >= 2) {
      issues.push({
        id: `${item.id}-${other.id}-相邻层`,
        withId: other.id,
        withUn: otherDecl.unNumber,
        level,
        relation,
        text: `${item.bill}（${decl.unNumber} 类${decl.category}）与 ${other.bill}（${otherDecl.unNumber} 类${otherDecl.category}）相邻层且同舱，隔离不足 ${level} 级，须分舱或拉开层位。`
      });
    } else if (relation === '同舱' && level >= 2) {
      issues.push({
        id: `${item.id}-${other.id}-同舱`,
        withId: other.id,
        withUn: otherDecl.unNumber,
        level,
        relation,
        text: `${item.bill}（${decl.unNumber} 类${decl.category}）与 ${other.bill}（${otherDecl.unNumber} 类${otherDecl.category}）同舱装载，隔离不足 ${level} 级，须分舱配载。`
      });
    }
  }
  return issues;
}

function segLevelBetween(catA: string, catB: string): number {
  // 与 api.ts 的矩阵保持一致，这里直接复用 requiredSegregation
  return requiredSegregation(catA, catB);
}

function buildConclusion(item: Cargo, allCargo: Cargo[], declarations: DgDeclaration[], prev: Conclusion | undefined, initial: boolean): Conclusion {
  const segIssues = buildSegIssues(item, allCargo, declarations);
  const stackIssues: string[] = [];
  const stabilityIssues: string[] = [];
  const stackMates = allCargo.filter((c) => c.bay === item.bay && c.row === item.row);
  const below = stackMates.filter((c) => c.tier < item.tier).sort((a, b) => b.tier - a.tier)[0];
  if (item.tier > 0 && !below) stackIssues.push(`第 ${item.tier} 层悬空，下方无支撑货箱。`);
  if (item.type === '集装箱' && item.weight > 30 && item.tier >= 3) stackIssues.push(`上层堆重超限：${item.weight}t 置于第 ${item.tier} 层。`);
  const stackWeight = stackMates.filter((c) => c.tier <= item.tier).reduce((sum, c) => sum + c.weight, 0);
  if (stackWeight > 90) stabilityIssues.push(`本列堆码重量 ${stackWeight.toFixed(1)}t 超过甲板局部载荷限值。`);
  const deps = [
    item.id,
    ...allCargo
      .filter((c) => c.id !== item.id && (segRelation(item, c) !== '远舱' || (c.bay === item.bay && c.row === item.row)))
      .map((c) => c.id)
  ];
  return {
    status: 'valid',
    segregation: { ok: segIssues.length === 0, level: segIssues.reduce((m, i) => Math.max(m, i.level), 0), issues: segIssues },
    stacking: { ok: stackIssues.length === 0, issues: stackIssues },
    stability: { ok: stabilityIssues.length === 0, issues: stabilityIssues },
    dependsOn: deps,
    computedAt: nowTime(),
    recomputeCount: initial ? 0 : (prev?.recomputeCount ?? 0) + 1
  };
}

function buildAllConclusions(cargo: Cargo[], declarations: DgDeclaration[]): Record<string, Conclusion> {
  const out: Record<string, Conclusion> = {};
  for (const item of cargo) out[item.id] = buildConclusion(item, cargo, declarations, undefined, true);
  return out;
}

/** 受影响集合：改动箱 + 旧位置邻居 + 新位置邻居（按隔离空间关系判定）。 */
function affectedIds(changedId: string, prevCargo: Cargo[], nextCargo: Cargo[]): Set<string> {
  const set = new Set<string>();
  set.add(changedId);
  const oldX = prevCargo.find((c) => c.id === changedId);
  const newX = nextCargo.find((c) => c.id === changedId);
  for (const y of nextCargo) {
    if (y.id === changedId) continue;
    const ro = oldX ? segRelation(oldX, y) : '远舱';
    const rn = newX ? segRelation(newX, y) : '远舱';
    if (ro !== '远舱' || rn !== '远舱') set.add(y.id);
  }
  return set;
}

function neighborIdsOf(cargoId: string, cargo: Cargo[]): string[] {
  const item = cargo.find((c) => c.id === cargoId);
  const ids = [cargoId];
  for (const y of cargo) {
    if (y.id === cargoId) continue;
    const rel = item ? segRelation(item, y) : '远舱';
    const sameStack = !!item && y.bay === item.bay && y.row === item.row;
    if (rel !== '远舱' || sameStack) ids.push(y.id);
  }
  return ids;
}

function recomputeIds(state: State, ids: Iterable<string>) {
  for (const id of ids) {
    const item = state.cargo.find((c) => c.id === id);
    if (!item) continue;
    state.conclusions[id] = buildConclusion(item, state.cargo, state.declarations, state.conclusions[id], false);
  }
}

const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('yy62-stowage-plan-v2') : null;
const saved = raw ? JSON.parse(raw) : null;
const initialState: State = saved ?? {
  cargo: initialCargo,
  declarations: initialDeclarations,
  activeCargoId: 'BL-88219',
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
  conclusions: buildAllConclusions(initialCargo, initialDeclarations),
  queue: [],
  concurrency: [],
  importNotice: null,
  currentOfficer: '值班员·甲'
};

const slice = createSlice({
  name: 'stowage',
  initialState,
  reducers: {
    selectCargo(state, action: PayloadAction<string>) {
      const prev = state.cargo.find((item) => item.id === state.activeCargoId);
      if (prev && prev.claimedBy === state.currentOfficer) prev.claimedBy = null;
      state.activeCargoId = action.payload;
    },
    moveCargo(state, action: PayloadAction<{ id: string; bay: number; row: number; tier: number; officer?: string }>) {
      const by = action.payload.officer ?? state.currentOfficer;
      const cargo = state.cargo.find((item) => item.id === action.payload.id);
      if (!cargo) return;
      const decl = state.declarations.find((d) => d.id === cargo.declarationId);
      // 旧稿缺危险品类别：升级补齐前不得重排。
      if (decl && decl.status === '缺类别') {
        state.importNotice = { kind: 'draft', message: `${cargo.bill} 的旧稿缺少危险品类别，升级补齐前不得重排。`, at: nowTime() };
        return;
      }
      // 并发：两名值班员改同一货位，先到者占用，后到者留冲突。
      if (cargo.claimedBy && cargo.claimedBy !== by) {
        state.concurrency.unshift({
          id: `CC-${Date.now()}`,
          cargoId: cargo.id,
          firstOfficer: cargo.claimedBy,
          secondOfficer: by,
          position: { bay: action.payload.bay, row: action.payload.row, tier: action.payload.tier },
          at: nowTime(),
          status: '待处理'
        });
        state.importNotice = { kind: 'failed', message: `${by} 的修改晚于 ${cargo.claimedBy}，同一货位先到者占用、后到者已留冲突。`, at: nowTime() };
        return;
      }
      const prevCargo = state.cargo.map((item) => ({ ...item }));
      const targetHold = holdOf(cargo.deck, action.payload.bay);
      // 危险品货位容量不足：先排队并写明占用者。
      if (cargo.declarationId) {
        const dgInHold = state.cargo.filter((item) => item.declarationId && item.id !== cargo.id && holdOf(item.deck, item.bay) === targetHold);
        if (dgInHold.length >= DG_CAPACITY_PER_HOLD) {
          const occupantIds = dgInHold.map((item) => item.id);
          if (!state.queue.some((q) => q.cargoId === cargo.id && q.hold === targetHold && q.status === '排队中')) {
            state.queue.unshift({
              id: `Q-${Date.now()}`,
              cargoId: cargo.id,
              hold: targetHold,
              occupantIds,
              reason: `${targetHold} 危险品位已满（容量 ${DG_CAPACITY_PER_HOLD}）`,
              requestedAt: nowTime(),
              status: '排队中'
            });
          }
          state.importNotice = {
            kind: 'info',
            message: `${cargo.bill} 排入 ${targetHold} 危险品位等候，占用者：${occupantIds.map((oid) => state.cargo.find((c) => c.id === oid)?.bill ?? oid).join('、')}。`,
            at: nowTime()
          };
          return;
        }
      }
      cargo.bay = action.payload.bay;
      cargo.row = action.payload.row;
      cargo.tier = action.payload.tier;
      cargo.hold = targetHold;
      cargo.posVersion += 1;
      cargo.claimedBy = by;
      const affected = new Set<string>([...neighborIdsOf(cargo.id, prevCargo), ...neighborIdsOf(cargo.id, state.cargo)]);
      recomputeIds(state, affected);
      state.planRevision += 1;
      state.draftSavedAt = nowTime();
    },
    updateDeclaration(state, action: PayloadAction<{ cargoId: string; unNumber: string; category: string; name: string; segregationLevel: number }>) {
      const { cargoId, unNumber, category, name, segregationLevel } = action.payload;
      let decl = state.declarations.find((d) => d.unNumber === unNumber || d.id === `DG-${cargoId.slice(-3)}`);
      if (!decl) {
        decl = { id: `DG-${cargoId.slice(-3)}`, unNumber, category, name, segregationLevel, status: category ? '完整' : '缺类别', source: '码头申报' };
        state.declarations.push(decl);
      } else {
        decl.unNumber = unNumber;
        decl.category = category;
        decl.name = name;
        decl.segregationLevel = segregationLevel;
        decl.status = category ? '完整' : '缺类别';
      }
      const cargo = state.cargo.find((item) => item.id === cargoId);
      if (cargo) {
        cargo.declarationId = decl.id;
        cargo.hazmat = unNumber;
      }
      recomputeIds(state, neighborIdsOf(cargoId, state.cargo));
      state.planRevision += 1;
    },
    supplementCategory(state, action: PayloadAction<{ cargoId: string; category: string }>) {
      const cargo = state.cargo.find((item) => item.id === action.payload.cargoId);
      if (cargo?.declarationId) {
        const decl = state.declarations.find((d) => d.id === cargo.declarationId);
        if (decl) {
          decl.category = action.payload.category;
          decl.status = '完整';
          decl.segregationLevel = UN_TABLE[decl.unNumber]?.segregation ?? decl.segregationLevel;
        }
      }
      recomputeIds(state, neighborIdsOf(action.payload.cargoId, state.cargo));
      state.importNotice = { kind: 'ok', message: `${cargo?.bill ?? action.payload.cargoId} 已补齐危险品类别 ${action.payload.category}，隔离结论已重算。`, at: nowTime() };
    },
    releaseClaim(state, action: PayloadAction<string>) {
      const cargo = state.cargo.find((item) => item.id === action.payload);
      if (cargo) cargo.claimedBy = null;
    },
    simulateConcurrentEdit(state, action: PayloadAction<string>) {
      const cargo = state.cargo.find((item) => item.id === action.payload);
      if (!cargo) return;
      const first = cargo.claimedBy ?? state.currentOfficer;
      if (!cargo.claimedBy) cargo.claimedBy = first;
      state.concurrency.unshift({
        id: `CC-${Date.now()}`,
        cargoId: cargo.id,
        firstOfficer: first,
        secondOfficer: '值班员·乙',
        position: { bay: cargo.bay, row: cargo.row, tier: cargo.tier },
        at: nowTime(),
        status: '待处理'
      });
      state.importNotice = { kind: 'failed', message: `值班员·乙 对 ${cargo.bill} 的修改晚于 ${first}，同一货位先到者占用、后到者留冲突。`, at: nowTime() };
    },
    acknowledgeConflict(state, action: PayloadAction<string>) {
      const item = state.concurrency.find((c) => c.id === action.payload);
      if (item) item.status = '已处理';
    },
    cancelQueue(state, action: PayloadAction<string>) {
      state.queue = state.queue.filter((q) => q.id !== action.payload);
    },
    clearImportNotice(state) {
      state.importNotice = null;
    },
    setOfficer(state, action: PayloadAction<string>) {
      state.currentOfficer = action.payload;
    },
    updateLashing(state, action: PayloadAction<{ id: string; lashing: Cargo['lashing'] }>) {
      const cargo = state.cargo.find((item) => item.id === action.payload.id);
      if (cargo) cargo.lashing = action.payload.lashing;
    },
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
      const hasDgIssue = Object.values(state.conclusions).some((c) => c.segregation.issues.length > 0);
      if (hasDgIssue) {
        state.importNotice = { kind: 'failed', message: '危险品隔离尚未清干净（存在同舱 / 相邻层 / 上下层隔离不足），锁定前必须消除。', at: nowTime() };
        return;
      }
      state.locked = true;
      state.planRevision += 1;
    }
  },
  extraReducers: (builder) => {
    builder
      .addMatcher(stowageApi.endpoints.importDeclaration.matchPending, (state) => {
        state.importNotice = { kind: 'info', message: '正在向码头申报系统导入危险品申报…', at: nowTime() };
      })
      .addMatcher(stowageApi.endpoints.importDeclaration.matchFulfilled, (state, action) => {
        const res = action.payload;
        if (res.status === 'failed') {
          // 导入失败：保留原货位与旧申报，仅提示，可重试。
          state.importNotice = { kind: 'failed', message: `${res.message}。已保留原货位与旧申报，可重试。`, at: nowTime() };
          return;
        }
        const idx = state.declarations.findIndex((d) => d.id === res.declaration.id || d.unNumber === res.declaration.unNumber);
        if (idx >= 0) state.declarations[idx] = res.declaration;
        else state.declarations.push(res.declaration);
        const cargo = state.cargo.find((c) => c.id === res.cargoId);
        if (cargo) {
          cargo.declarationId = res.declaration.id;
          cargo.hazmat = res.declaration.unNumber;
        }
        if (res.status === 'draft') {
          state.importNotice = { kind: 'draft', message: '导入的旧稿缺少危险品类别，升级补齐前不得重排。请先选择类别补齐。', at: nowTime() };
        } else {
          state.importNotice = { kind: 'ok', message: `码头申报已导入：${res.declaration.unNumber} · ${res.declaration.name}（类别 ${res.declaration.category}），隔离等级 ${res.declaration.segregationLevel}。`, at: nowTime() };
        }
        recomputeIds(state, neighborIdsOf(res.cargoId, state.cargo));
        state.planRevision += 1;
      })
      .addMatcher(stowageApi.endpoints.importDeclaration.matchRejected, (state) => {
        state.importNotice = { kind: 'failed', message: '码头申报导入失败，已保留原货位与旧申报，可重试。', at: nowTime() };
      });
  }
});

export const {
  selectCargo,
  moveCargo,
  updateDeclaration,
  supplementCategory,
  releaseClaim,
  simulateConcurrentEdit,
  acknowledgeConflict,
  cancelQueue,
  clearImportNotice,
  setOfficer,
  updateLashing,
  addComment,
  acceptComment,
  rejectComment,
  acceptLimit,
  setViewMode,
  lockPlan
} = slice.actions;

export const store = configureStore({
  reducer: { stowage: slice.reducer, [stowageApi.reducerPath]: stowageApi.reducer },
  middleware: (getDefault) => getDefault().concat(stowageApi.middleware)
});

store.subscribe(() => {
  if (typeof localStorage !== 'undefined') localStorage.setItem('yy62-stowage-plan-v2', JSON.stringify(store.getState().stowage));
});

export type RootState = ReturnType<typeof store.getState>;

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

export function detectConflicts(cargo: Cargo[], declarations?: DgDeclaration[], queue?: QueueEntry[], conclusions?: Record<string, Conclusion>) {
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
  // 危险品隔离校核结论（同舱 / 相邻层 / 上下层）。
  if (conclusions) {
    for (const item of cargo) {
      const conc = conclusions[item.id];
      if (conc && !conc.segregation.ok) {
        for (const si of conc.segregation.issues) {
          issues.push({ id: si.id, cargoId: item.id, level: 'high', title: `隔离不足·${si.relation}`, detail: si.text });
        }
      }
    }
  }
  // 容量不足排队。
  if (queue) {
    for (const q of queue) {
      const item = cargo.find((c) => c.id === q.cargoId);
      issues.push({
        id: q.id,
        cargoId: q.cargoId,
        level: 'medium',
        title: '危险品位排队中',
        detail: `${item?.bill ?? q.cargoId} 等待 ${q.hold} 空位，占用者：${q.occupantIds.map((oid) => cargo.find((c) => c.id === oid)?.bill ?? oid).join('、')}。`
      });
    }
  }
  return issues;
}
