/*
 * Spine 快速摆位与调试 · 应用层
 *
 * 分层（docs/review/2026-11-01-spine/contract-task1.md A1）：
 *   - 纯数学（解析/采样/矩阵/IK/几何/蒙皮/命中）在 spine-core.js；
 *   - 本文件只碰 DOM / canvas / 状态 / 交互 / 撤销 / 原 JSON 补丁导出。
 *
 * 渲染（A4）：姿势来自 core.evalPose（含 IK 求值），几何来自 core.buildGeometry；
 *   region 走整四边形 affine 快路，mesh / 加权 mesh 逐三角 clip + setTransform + drawImage。
 *   Y 翻转只在 view 层做一次，DPR 只乘在 setTransform 上。
 */
"use strict";
(function () {
  /* ==========================================================================
   * 0. 小工具
   * ====================================================================== */
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const icon = typeof window.spineIcon === "function" ? window.spineIcon : () => "";
  const iconEl = (name, cls) => {
    const wrap = document.createElement("span");
    wrap.innerHTML = icon(name);
    const svg = wrap.firstChild;
    if (svg && cls) svg.classList.add(cls);
    return svg || wrap;
  };
  const round = (v, d) => {
    const p = Math.pow(10, d == null ? 2 : d);
    return Math.round(v * p) / p;
  };
  const fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d == null ? 1 : d) : "—");
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const IS_MAC = /mac/i.test(
    (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ""
  );
  const MOD_LABEL = IS_MAC ? "⌘" : "Ctrl";
  const isTypingTarget = (t) => {
    if (!t || !t.tagName) return false;
    const tag = t.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    return !!t.isContentEditable;
  };

  const core = window.SpineCore || null;
  const coreInfo = { ready: false, reason: core ? "未载入模型" : "spine-core.js 未加载" };

  /* ==========================================================================
   * 1. 状态
   * ====================================================================== */
  const state = {
    raw: null,
    model: null,
    atlas: null,
    pageImages: [],
    label: "",
    source: "",

    boneList: [],
    bones: Object.create(null),
    slots: [],
    constraints: [],
    ikIssues: Object.create(null),

    zoom: 1,
    panX: 0,
    panY: 0,
    tool: "move",

    sel: -1,
    hover: -1,
    hidden: new Set(),
    locked: new Set(),
    search: "",

    dirty: false,
    undo: [],
    initial: null,

    anim: "",
    animDur: 0,
    t: 0,
    playing: false,
    speed: 1,
    loop: true,
    lastTs: 0,

    show: { texture: true, bones: false, mesh: false, weights: false },
    weightMode: "bone",
    texAlpha: 100,
    texAlphaAuto: true,
    snap: false,

    diagnostics: [],
    issueDetails: [],
    unsupportedCount: 0,
    frame: null,
    drag: null,
    spaceDown: false,
    helpOpen: false,
  };

  const cv = $("cv");
  const ctx = cv.getContext("2d");

  /* ==========================================================================
   * 2. 载入
   * ====================================================================== */
  class LoadError extends Error {
    constructor(message, detail) {
      super(message);
      this.detail = detail || "";
    }
  }

  function loadImage(src, label) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new LoadError("图片加载失败：" + (label || src)));
      im.src = src;
    });
  }

  function issueText(issues, n) {
    const list = (issues || []).slice(0, n || 3);
    return list.map((i) => (i.path || "") + " " + (i.message || i.code)).join("；");
  }

  function parseBundle(raw, atlasText) {
    if (!core) throw new LoadError("spine-core.js 未加载，无法解析");
    if (!raw || typeof raw !== "object") throw new LoadError("JSON 内容不是对象");
    const version = raw.skeleton && raw.skeleton.spine;
    if (version && !/^[34]\./.test(String(version))) {
      throw new LoadError("不支持的 skeleton.spine=" + version + "（本编辑器覆盖 3.8 / 4.x 的 region+mesh 子集）");
    }
    const atlasRes = core.parseAtlas(atlasText || "");
    if (!atlasRes || atlasRes.ok !== true) {
      throw new LoadError("图集解析失败", issueText(atlasRes && atlasRes.issues));
    }
    const modelRes = core.parseModel(raw, atlasRes.value, { skin: "default" });
    if (!modelRes || modelRes.ok !== true) {
      throw new LoadError("骨架解析失败", issueText(modelRes && modelRes.issues));
    }
    return { atlas: atlasRes.value, atlasIssues: atlasRes.issues || [], model: modelRes.value };
  }

  function applyLoaded(input) {
    const parsed = parseBundle(input.raw, input.atlasText);
    const model = parsed.model;

    state.raw = typeof structuredClone === "function" ? structuredClone(input.raw) : JSON.parse(JSON.stringify(input.raw));
    state.model = model;
    state.atlas = parsed.atlas;
    state.pageImages = input.pageImages || [];
    state.label = input.label || "";
    state.source = input.source || "";

    state.boneList = model.bones.map((b, i) => ({
      name: b.name,
      parentName: b.parentIndex >= 0 && model.bones[b.parentIndex] ? model.bones[b.parentIndex].name : null,
      x: b.x,
      y: b.y,
      rotation: b.rotation,
      scaleX: b.scaleX,
      scaleY: b.scaleY,
      index: i,
    }));
    state.bones = Object.create(null);
    for (const b of state.boneList) state.bones[b.name] = b;

    state.slots = model.slots.map((sl, i) => ({
      name: sl.name,
      index: i,
      boneIndex: sl.boneIndex,
      boneName: model.bones[sl.boneIndex] ? model.bones[sl.boneIndex].name : "",
      attachment: sl.setupAttachment,
    }));
    state.constraints = model.constraints || [];
    state.ikIssues = Object.create(null);

    state.sel = -1;
    state.hover = -1;
    state.hidden = new Set();
    state.locked = new Set();
    state.search = "";
    state.undo = [];
    state.dirty = false;
    state.anim = "";
    state.animDur = 0;
    state.t = 0;
    state.playing = false;
    state.initial = snapshot();
    coreInfo.ready = true;
    coreInfo.reason = "SpineCore";
    clearNotices();
    state.diagnostics = collectDiagnostics(parsed.atlasIssues, model);
    if (state.unsupportedCount > 0) {
      notice("warn", "部分预览：" + state.unsupportedCount + " 项未求值", [{ label: "查看详情", onClick: () => openDebug() }]);
    }
    for (const d of state.diagnostics.filter((x) => x.severity === "error")) notice("error", d.text);
    if (!state.pageImages.length) notice("warn", "没有载入到图集图片：几何可编辑，但贴图不显示。");

    syncAnimSelect();
    syncExprInputs();
    framePose();
    syncAll();
    fitView("all");
    setStatus("已载入 " + state.slots.length + " 部件 / " + state.boneList.length + " 骨骼 · " + state.label);
    render();
    return true;
  }

  async function loadFiles(fileList) {
    const files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    const jsonFiles = files.filter((f) => /\.json$/i.test(f.name));
    const atlasFiles = files.filter((f) => /\.atlas$/i.test(f.name));
    const imgFiles = files.filter((f) => /\.(png|webp|jpe?g)$/i.test(f.name));
    const retry = () => $("files").click();
    if (!jsonFiles.length) return reportLoadError(new LoadError("缺少 .json 骨骼文件"), "重新选择", retry);
    if (!atlasFiles.length) return reportLoadError(new LoadError("缺少 .atlas 图集描述文件"), "重新选择", retry);
    if (!imgFiles.length) return reportLoadError(new LoadError("缺少图集图片（.png / .webp）"), "重新选择", retry);
    const urls = [];
    try {
      const atlasText = await atlasFiles[0].text();
      const raw = JSON.parse(await jsonFiles[0].text());
      const parsed = parseBundle(raw, atlasText);
      const pageImages = [];
      for (let i = 0; i < parsed.atlas.pages.length; i++) {
        const page = parsed.atlas.pages[i];
        const file = imgFiles.find((f) => f.name === page.name) || (i === 0 ? imgFiles[0] : null);
        if (!file) throw new LoadError("缺少图集页图片：" + page.name);
        const url = URL.createObjectURL(file);
        urls.push(url);
        pageImages.push(await loadImage(url, file.name));
      }
      applyLoaded({
        raw: raw,
        atlasText: atlasText,
        pageImages: pageImages,
        label: jsonFiles[0].name + " + " + atlasFiles[0].name + " + " + imgFiles.map((f) => f.name).join(" + "),
        source: "file",
      });
    } catch (e) {
      reportLoadError(e, "重新选择", retry);
    } finally {
      for (const u of urls) setTimeout(() => URL.revokeObjectURL(u), 1000);
    }
  }

  async function loadExample() {
    const base = "../../assets/characters/deepseek/spine";
    setStatus("载入示例中…");
    try {
      const res = await Promise.all([
        fetch(base + "/model.json", { cache: "no-cache" }),
        fetch(base + "/model.atlas", { cache: "no-cache" }),
      ]);
      const jsonRes = res[0];
      const atlasRes = res[1];
      if (!jsonRes.ok) throw new LoadError("model.json HTTP " + jsonRes.status);
      if (!atlasRes.ok) throw new LoadError("model.atlas HTTP " + atlasRes.status);
      const raw = await jsonRes.json();
      const atlasText = await atlasRes.text();
      const parsed = parseBundle(raw, atlasText);
      const pageImages = [];
      for (const page of parsed.atlas.pages) pageImages.push(await loadImage(base + "/" + page.name, page.name));
      applyLoaded({ raw: raw, atlasText: atlasText, pageImages: pageImages, label: "示例 · deepseek", source: "example" });
    } catch (e) {
      reportLoadError(
        new LoadError("载入示例失败：" + e.message + "（本页需通过 http 打开，见 serve.py）", e.detail),
        "重试",
        loadExample
      );
    }
  }

  async function loadRig(param) {
    const rig = String(param || "").trim();
    if (!rig) return false;
    if (/^[a-z]+:/i.test(rig) || rig.startsWith("//") || rig.includes("..")) {
      reportLoadError(new LoadError("?rig= 只接受同源相对路径（不能带协议或 ..）"));
      return false;
    }
    const wanted = rig.replace(/\.json$/i, "") + ".json";
    // 先按页面相对路径找，再按站点根（工具在 /tools/spine-part-editor/ 下，root = ../../）
    // 站点根相对优先（文档里的 ?rig=references/... 就是这种写法，避免先打一次 404）
    const rootRel = new URL("../../", location.href).pathname;
    const candidates = [rootRel + wanted, wanted];
    setStatus("载入 rig：" + wanted);
    try {
      let jsonPath = null;
      let raw = null;
      let lastStatus = 0;
      for (const cand of candidates) {
        const res = await fetch(cand, { cache: "no-cache" });
        if (res.ok) {
          jsonPath = cand;
          raw = await res.json();
          break;
        }
        lastStatus = res.status;
      }
      if (!jsonPath) {
        throw new LoadError(
          "读不到 " + wanted + "（HTTP " + (lastStatus || "?") + "）",
          "已试：" + candidates.join(" / ")
        );
      }
      const base = jsonPath.replace(/[^/]*$/, "");
      const atlasPath = jsonPath.replace(/\.json$/i, ".atlas");
      const atlasRes = await fetch(atlasPath, { cache: "no-cache" });
      if (!atlasRes.ok) {
        throw new LoadError("缺少图集：" + atlasPath + "（HTTP " + atlasRes.status + "）", "同目录需要同名 .atlas 与图集图片");
      }
      const atlasText = await atlasRes.text();
      const parsed = parseBundle(raw, atlasText);
      const pageImages = [];
      for (const page of parsed.atlas.pages) {
        const url = base + page.name;
        try {
          pageImages.push(await loadImage(url, url));
        } catch (e) {
          throw new LoadError("缺少图集图片：" + url, e.message);
        }
      }
      applyLoaded({ raw: raw, atlasText: atlasText, pageImages: pageImages, label: "rig · " + jsonPath.split("/").pop(), source: "rig" });
      return true;
    } catch (e) {
      reportLoadError(
        new LoadError(String(e.message || e), e.detail || "同目录需要 <同名>.atlas + 图集图片（page 名要与 atlas 一致）")
      );
      return false;
    }
  }

  async function loadFixture(id) {
    const cases = fixtureCases();
    const fx = cases && cases[id];
    if (!fx) return reportLoadError(new LoadError("找不到样张：" + id));
    setStatus("载入样张：" + (fx.label || id));
    try {
      const pages = textureSpecs(fx.textureSpec);
      applyLoaded({
        raw: fx.json,
        atlasText: fx.atlasText,
        pageImages: pages.map((p) => textureSpecToCanvas(p)),
        label: "样张 · " + (fx.label || id),
        source: "fixture",
      });
      if (pages.length > 1) notice("warn", "样张图集有 " + pages.length + " 页，已全部载入");
    } catch (e) {
      reportLoadError(e);
    }
  }

  function fixtureCases() {
    const f = window.SpineFixtures;
    if (!f) return null;
    return f.cases || f;
  }
  function textureSpecs(spec) {
    const list = Array.isArray(spec) ? spec : [spec];
    return list.filter(Boolean).map((p, i) => Object.assign({ name: p.name || "page" + i + ".png", width: 64, height: 64 }, p));
  }
  function textureSpecToCanvas(spec) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(spec.width || 64));
    c.height = Math.max(1, Math.round(spec.height || 64));
    const g = c.getContext("2d");
    g.fillStyle = "#000";
    g.fillRect(0, 0, c.width, c.height);
    for (const cell of spec.cells || []) {
      const r = cell.rect || [0, 0, c.width, c.height];
      g.fillStyle = cell.color || "#888";
      g.fillRect(r[0], r[1], r[2], r[3]);
      if (cell.label) {
        g.fillStyle = "rgba(0,0,0,.75)";
        g.font = "10px ui-monospace,monospace";
        g.fillText(cell.label, r[0] + 2, r[1] + 12);
      }
    }
    return c;
  }

  function reportLoadError(err, actionLabel, actionFn) {
    const message = (err && err.message) || String(err);
    const detail = err && err.detail ? "（" + err.detail + "）" : "";
    setStatus("载入失败：" + message, "error");
    notice("error", "载入失败：" + message + detail, actionLabel && actionFn ? [{ label: actionLabel, onClick: actionFn }] : []);
    try {
      console.info("[spine-editor] 载入失败：", message, detail);
    } catch (_) {
      /* 忽略 */
    }
    return false;
  }

  /* ==========================================================================
   * 3. 诊断（「部分预览 N 项」= 未求值的对象数，明细另存）
   * ====================================================================== */
  function collectDiagnostics(atlasIssues, model) {
    const out = [];
    const issues = [];
    for (const i of atlasIssues || []) issues.push(i);
    for (const i of model.issues || []) issues.push(i);

    // 「部分预览 N 项」= 未求值的**对象**数（约束 / 附件 / 骨 / 特性去重计）
    const objects = new Set();
    const cap = model.capabilities || {};
    const u = cap.unsupported || {};
    const addN = (n, tag) => {
      for (let i = 1; i <= n; i++) objects.add(tag + " #" + i);
    };
    if (u.transformConstraints) addN(u.transformConstraints, "transform 约束");
    if (u.pathConstraints) addN(u.pathConstraints, "path 约束");
    if (u.physicsConstraints) addN(u.physicsConstraints, "physics 约束");
    if (u.sequences) addN(u.sequences, "sequence 附件");
    if (u.deform) objects.add("deform 形变动画");
    if (u.slotColor) objects.add("slot 颜色动画");
    if (u.drawOrder) objects.add("drawOrder 动画");
    for (const i of issues) {
      const code = String(i.code || "");
      const path = String(i.path || "");
      if (code === "bone.inherit.unsupported") objects.add("inherit " + path);
      else if (code === "attachment.unsupportedType") objects.add("attachment " + path);
      else if (/^ik\./.test(path) && /^ik\.(unsupported|targetMissing|zeroLength|singularParent|bone\.noParent)/.test(code)) {
        const name = path.slice(3);
        if (name) {
          state.ikIssues[name] = i.message || code;
          objects.add("ik " + name);
        }
      }
    }
    if (u.attachments && typeof u.attachments === "object") {
      // issue 里已经逐个报过的附件不再按类型重复计数
      const mentioned = issues
        .filter((i) => i.code === "attachment.unsupportedType")
        .map((i) => String(i.message || ""));
      for (const k of Object.keys(u.attachments)) {
        if (mentioned.some((m) => m.indexOf(k) >= 0)) continue;
        objects.add("attachment " + k);
      }
    }
    state.unsupportedCount = objects.size;

    // 分组摘要（面板/提示只列组，明细在「未求值 / 诊断明细」里逐条给 code + 路径）
    const groups = new Map();
    for (const o of objects) {
      let key = o.replace(/ #\d+$/, "");
      if (key.indexOf("inherit ") === 0) key = "inherit≠Normal 骨";
      else if (key.indexOf("attachment ") === 0) key = "不支持的附件";
      else if (key.indexOf("ik ") === 0) key = "IK 约束";
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    for (const entry of groups) {
      out.push({ severity: "warning", text: "部分预览：" + entry[0] + (entry[1] > 1 ? " ×" + entry[1] : "") + " 未求值" });
    }
    for (const i of issues) {
      if (i.severity === "error") out.push({ severity: "error", text: "错误 " + (i.path || "") + " " + (i.message || i.code) });
    }
    state.issueDetails = issues.map((i) => ({ severity: i.severity, code: i.code, path: i.path, message: i.message }));
    return out;
  }

  /* ==========================================================================
   * 4. 姿态 / 几何
   * ====================================================================== */
  const FIELDS = ["x", "y", "rotation", "scaleX", "scaleY"];
  let lastPose = null;

  function editsMap() {
    const map = new Map();
    for (const b of state.boneList) {
      const setup = state.model.bones[b.index];
      if (!setup) continue;
      const patch = {};
      let any = false;
      for (const f of FIELDS) {
        const isScale = f === "scaleX" || f === "scaleY";
        const v = b[f] == null ? (isScale ? 1 : 0) : b[f];
        const s = setup[f] == null ? (isScale ? 1 : 0) : setup[f];
        if (Math.abs(v - s) > 1e-9) {
          patch[f] = v;
          any = true;
        }
      }
      if (any) map.set(b.name, patch);
    }
    return map;
  }

  function evalCurrentPose() {
    const edits = editsMap();
    const opts = { animation: state.anim || null, time: state.t, skin: "default" };
    if (edits.size) opts.edits = { bones: edits };
    return core.evalPose(state.model, opts);
  }

  function attachmentAt(pose, slotIndex) {
    return (pose && pose.attachments && pose.attachments[slotIndex]) || null;
  }

  function framePose() {
    if (!state.model) {
      state.frame = null;
      return null;
    }
    const pose = evalCurrentPose();
    lastPose = pose;
    const geo = core.buildGeometry(state.model, pose, { hidden: state.hidden });
    state.frame = { pose: pose, geo: geo };
    return state.frame;
  }

  /* ==========================================================================
   * 5. 视图
   * ====================================================================== */
  const viewW = () => cv.clientWidth;
  const viewH = () => cv.clientHeight;
  const viewParams = () => ({ z: state.zoom, tx: viewW() / 2 + state.panX, ty: viewH() / 2 - state.panY });
  function proj(wx, wy) {
    const v = viewParams();
    return { x: wx * v.z + v.tx, y: -wy * v.z + v.ty };
  }
  function unproj(sx, sy) {
    const v = viewParams();
    return { x: (sx - v.tx) / v.z, y: -(sy - v.ty) / v.z };
  }
  function projXY(worldXY) {
    const v = viewParams();
    const out = new Float64Array(worldXY.length);
    for (let i = 0; i < worldXY.length; i += 2) {
      out[i] = worldXY[i] * v.z + v.tx;
      out[i + 1] = -worldXY[i + 1] * v.z + v.ty;
    }
    return out;
  }
  function syncZoom() {
    $("zoomLabel").textContent = state.model ? Math.round(state.zoom * 100) + "%" : "—";
  }
  function fitView(mode) {
    if (!state.model) return;
    const frame = state.frame || framePose();
    let items = frame.geo;
    if (mode === "sel" && state.sel >= 0) {
      const one = items.filter((it) => it.slotIndex === state.sel);
      if (one.length) items = one;
    }
    const b = core.boundsOf(items);
    if (!b) return;
    const pad = 24;
    const availW = Math.max(40, viewW() - pad * 2);
    const availH = Math.max(40, viewH() - pad * 2);
    const z = clamp(Math.min(availW / Math.max(1e-6, b.maxX - b.minX), availH / Math.max(1e-6, b.maxY - b.minY)), 0.02, 12);
    state.zoom = z;
    state.panX = -((b.minX + b.maxX) / 2) * z;
    state.panY = -((b.minY + b.maxY) / 2) * z;
    syncZoom();
    render();
  }
  function zoomBy(factor, ax, ay) {
    if (!state.model) return;
    const sx = ax == null ? viewW() / 2 : ax;
    const sy = ay == null ? viewH() / 2 : ay;
    const before = unproj(sx, sy);
    state.zoom = clamp(state.zoom * factor, 0.02, 12);
    state.panX = sx - viewW() / 2 - before.x * state.zoom;
    state.panY = viewH() / 2 - sy - before.y * state.zoom;
    syncZoom();
    render();
  }

  /* ==========================================================================
   * 6. 渲染
   * ====================================================================== */
  const overlayActive = () => state.show.bones || state.show.mesh || state.show.weights;
  const anyLayerOn = () => state.show.texture || overlayActive();
  const effectiveTextureAlpha = () => (state.show.texture ? clamp(state.texAlpha / 100, 0, 1) : 0);

  function syncCanvasSize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(viewW() * dpr));
    const h = Math.max(1, Math.round(viewH() * dpr));
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    return dpr;
  }

  let scratch = null;
  function scratchContext() {
    if (!scratch) scratch = document.createElement("canvas");
    if (scratch.width !== cv.width || scratch.height !== cv.height) {
      scratch.width = cv.width;
      scratch.height = cv.height;
    }
    const g = scratch.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, scratch.width, scratch.height);
    g.imageSmoothingEnabled = ctx.imageSmoothingEnabled;
    return g;
  }

  function applyAtlasSmoothing() {
    const page = state.atlas && state.atlas.pages && state.atlas.pages[0];
    const f = page && page.filter;
    let nearest = false;
    if (f && typeof f === "object") nearest = f.mag === "Nearest";
    else if (typeof f === "string") nearest = /nearest/i.test(f);
    ctx.imageSmoothingEnabled = !nearest;
  }

  function render() {
    const dpr = syncCanvasSize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewW(), viewH());
    if (!state.model) {
      state.frame = null;
      syncStageOverlays();
      return;
    }
    const frame = framePose();
    drawTextures(frame, dpr);
    if (state.show.mesh) drawMeshOverlay(frame);
    if (state.show.weights) drawWeightOverlay(frame, dpr);
    if (state.show.bones) drawBoneOverlay(frame);
    if (anyLayerOn()) {
      drawSelection(frame);
      drawDragGhost(frame);
    }
    syncStageOverlays();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---- 6.1 贴图：region 四边形快路 + mesh 逐三角 ---- */
  function paintTriangle(g, src, dst, a, b, c, page, dpr, clipQuad) {
    const m = core.affineFromTriangles(
      [src[a], src[a + 1], src[b], src[b + 1], src[c], src[c + 1]],
      [dst[a], dst[a + 1], dst[b], dst[b + 1], dst[c], dst[c + 1]]
    );
    if (!m) return false;
    g.save();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.beginPath();
    if (clipQuad) {
      g.moveTo(clipQuad[0], clipQuad[1]);
      g.lineTo(clipQuad[2], clipQuad[3]);
      g.lineTo(clipQuad[4], clipQuad[5]);
      g.lineTo(clipQuad[6], clipQuad[7]);
    } else {
      g.moveTo(dst[a], dst[a + 1]);
      g.lineTo(dst[b], dst[b + 1]);
      g.lineTo(dst[c], dst[c + 1]);
    }
    g.closePath();
    g.clip();
    g.setTransform(dpr * m.a, dpr * m.b, dpr * m.c, dpr * m.d, dpr * m.tx, dpr * m.ty);
    g.drawImage(page, 0, 0);
    g.restore();
    return true;
  }

  function paintItem(g, item, screen, page, dpr) {
    const tris = item.triangles;
    const src = item.sourceXY;
    if (!tris || tris.length < 3) return;
    const isQuad = item.worldXY.length === 8 && tris.length === 6;
    if (isQuad) {
      paintTriangle(g, src, screen, tris[0] * 2, tris[1] * 2, tris[2] * 2, page, dpr, [
        screen[0], screen[1], screen[2], screen[3], screen[4], screen[5], screen[6], screen[7],
      ]);
      return;
    }
    for (let t = 0; t + 2 < tris.length; t += 3) {
      paintTriangle(g, src, screen, tris[t] * 2, tris[t + 1] * 2, tris[t + 2] * 2, page, dpr, null);
    }
  }

  function drawTextures(frame, dpr) {
    const alpha = effectiveTextureAlpha();
    if (alpha <= 0 || !state.pageImages.length) return;
    applyAtlasSmoothing();
    const useScratch = alpha < 0.999;
    for (const item of frame.geo) {
      const page = state.pageImages[item.pageIndex] || state.pageImages[0];
      if (!page) continue;
      const screen = projXY(item.worldXY);
      if (!useScratch) {
        paintItem(ctx, item, screen, page, dpr);
        continue;
      }
      const g = scratchContext();
      paintItem(g, item, screen, page, dpr);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = alpha;
      ctx.drawImage(scratch, 0, 0);
      ctx.restore();
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
  }

  /* ---- 6.2 网格层 ---- */
  function drawMeshOverlay(frame) {
    ctx.save();
    for (const item of frame.geo) {
      const att = attachmentAt(frame.pose, item.slotIndex);
      if (!att) continue;
      const screen = projXY(item.worldXY);
      const tris = item.triangles;
      const isRegion = att.type === "region";
      const sel = item.slotIndex === state.sel;
      ctx.strokeStyle = sel ? "rgba(120,190,255,.95)" : "rgba(90,169,255,.45)";
      ctx.lineWidth = sel ? 1.2 : 0.8;
      ctx.beginPath();
      for (let t = 0; t + 2 < tris.length; t += 3) {
        const a = tris[t] * 2;
        const b = tris[t + 1] * 2;
        const c = tris[t + 2] * 2;
        ctx.moveTo(screen[a], screen[a + 1]);
        ctx.lineTo(screen[b], screen[b + 1]);
        ctx.lineTo(screen[c], screen[c + 1]);
        ctx.closePath();
      }
      ctx.stroke();
      const hull = att.hullCount || 0;
      if (!isRegion && hull > 2) {
        ctx.strokeStyle = sel ? "#a8d8ff" : "rgba(90,169,255,.85)";
        ctx.lineWidth = sel ? 1.8 : 1.1;
        ctx.beginPath();
        for (let k = 0; k < hull; k++) {
          const p = k * 2;
          if (k === 0) ctx.moveTo(screen[p], screen[p + 1]);
          else ctx.lineTo(screen[p], screen[p + 1]);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = sel ? "#ffffff" : "#5aa9ff";
        const r = sel ? 2.4 : 1.6;
        for (let i = 0; i < screen.length; i += 2) {
          ctx.beginPath();
          ctx.arc(screen[i], screen[i + 1], r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
    drawUVInset(frame);
  }

  /* ---- 6.3 权重层 ---- */
  const bonePalette = new Map();
  const patchCache = new Map();
  function boneColorOf(boneIndex) {
    if (bonePalette.has(boneIndex)) return bonePalette.get(boneIndex);
    const name = (state.model.bones[boneIndex] && state.model.bones[boneIndex].name) || String(boneIndex);
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    const c = hslToRgb(h / 360, 0.78, 0.58);
    bonePalette.set(boneIndex, c);
    return c;
  }
  function hslToRgb(h, s, l) {
    const f = (n) => {
      const k = (n + h * 12) % 12;
      const a = s * Math.min(l, 1 - l);
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4)];
  }
  function heatColor(t) {
    const c = clamp(t, 0, 1);
    if (c < 0.5) {
      const k = c / 0.5;
      return [0.15 + 0.1 * k, 0.45 + 0.45 * k, 0.95 - 0.75 * k];
    }
    const k = (c - 0.5) / 0.5;
    return [0.25 + 0.75 * k, 0.9 - 0.6 * k, 0.2 - 0.2 * k];
  }
  const colorKey = (c) => (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);
  function patchCanvas(c0, c1, c2) {
    const key = colorKey(c0) + ":" + colorKey(c1) + ":" + colorKey(c2);
    const hit = patchCache.get(key);
    if (hit) return hit;
    const S = 64;
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S;
    const g = c.getContext("2d");
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const idx = (y * S + x) * 4;
        const w1 = x / S;
        const w2 = y / S;
        const w0 = 1 - w1 - w2;
        if (w0 < 0) {
          img.data[idx + 3] = 0;
          continue;
        }
        img.data[idx] = Math.round(255 * (w0 * c0[0] + w1 * c1[0] + w2 * c2[0]));
        img.data[idx + 1] = Math.round(255 * (w0 * c0[1] + w1 * c1[1] + w2 * c2[1]));
        img.data[idx + 2] = Math.round(255 * (w0 * c0[2] + w1 * c1[2] + w2 * c2[2]));
        img.data[idx + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    patchCache.set(key, c);
    return c;
  }
  function drawWeightOverlay(frame, dpr) {
    const heatMode = state.weightMode === "heat";
    const selectedBone = state.sel >= 0 ? state.slots[state.sel].boneIndex : null;
    const pal = new Map();
    for (let i = 0; i < state.model.bones.length; i++) pal.set(i, boneColorOf(i));
    ctx.save();
    ctx.globalAlpha = 0.92;
    for (const item of frame.geo) {
      const att = attachmentAt(frame.pose, item.slotIndex);
      if (!att) continue;
      const screen = projXY(item.worldXY);
      let res = null;
      try {
        res = core.weightColors(att, state.slots[item.slotIndex].boneIndex, pal, heatMode ? selectedBone : null);
      } catch (_) {
        res = null;
      }
      let colors = res ? res.rgb : null;
      if (heatMode && res && res.heat && selectedBone !== null) {
        const rgb = new Float32Array(res.heat.length * 3);
        for (let v = 0; v < res.heat.length; v++) {
          const c = heatColor(res.heat[v]);
          rgb[v * 3] = c[0];
          rgb[v * 3 + 1] = c[1];
          rgb[v * 3 + 2] = c[2];
        }
        colors = rgb;
      }
      if (!colors) {
        const c = boneColorOf(state.slots[item.slotIndex].boneIndex);
        ctx.fillStyle = "rgb(" + Math.round(c[0] * 255) + "," + Math.round(c[1] * 255) + "," + Math.round(c[2] * 255) + ")";
        ctx.beginPath();
        for (let i = 0; i < screen.length; i += 2) {
          if (i === 0) ctx.moveTo(screen[i], screen[i + 1]);
          else ctx.lineTo(screen[i], screen[i + 1]);
        }
        ctx.closePath();
        ctx.fill();
        continue;
      }
      const tris = item.triangles;
      for (let t = 0; t + 2 < tris.length; t += 3) {
        const i0 = tris[t];
        const i1 = tris[t + 1];
        const i2 = tris[t + 2];
        const c0 = [colors[i0 * 3], colors[i0 * 3 + 1], colors[i0 * 3 + 2]];
        const c1 = [colors[i1 * 3], colors[i1 * 3 + 1], colors[i1 * 3 + 2]];
        const c2 = [colors[i2 * 3], colors[i2 * 3 + 1], colors[i2 * 3 + 2]];
        const S = 64;
        const patch = patchCanvas(c0, c1, c2);
        const a = i0 * 2;
        const b = i1 * 2;
        const c = i2 * 2;
        const m = core.affineFromTriangles([0, 0, S, 0, 0, S], [screen[a], screen[a + 1], screen[b], screen[b + 1], screen[c], screen[c + 1]]);
        if (!m) continue;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.beginPath();
        ctx.moveTo(screen[a], screen[a + 1]);
        ctx.lineTo(screen[b], screen[b + 1]);
        ctx.lineTo(screen[c], screen[c + 1]);
        ctx.closePath();
        ctx.clip();
        ctx.setTransform(dpr * m.a, dpr * m.b, dpr * m.c, dpr * m.d, dpr * m.tx, dpr * m.ty);
        ctx.drawImage(patch, 0, 0);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* ---- 6.4 骨骼层 ---- */
  function ikState() {
    const map = new Map();
    for (const c of state.constraints) {
      map.set(c.name, { constraint: c, restricted: !!state.ikIssues[c.name], reason: state.ikIssues[c.name] || "" });
    }
    return map;
  }
  function drawBoneOverlay(frame) {
    const ik = ikState();
    const inIK = new Set();
    const targets = new Set();
    for (const c of state.constraints) {
      for (const bi of c.bones) inIK.add(bi);
      targets.add(c.target);
    }
    ctx.save();
    for (let i = 0; i < state.model.bones.length; i++) {
      const b = state.model.bones[i];
      const w = frame.pose.world[i];
      if (!w) continue;
      const p = proj(w.tx, w.ty);
      if (b.parentIndex >= 0 && frame.pose.world[b.parentIndex]) {
        const pw = frame.pose.world[b.parentIndex];
        const pp = proj(pw.tx, pw.ty);
        ctx.beginPath();
        ctx.moveTo(pp.x, pp.y);
        ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = inIK.has(i) ? "#f0b429" : "#5aa9ff";
        ctx.lineWidth = inIK.has(i) ? 2.2 : 1.6;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, inIK.has(i) ? 3.8 : 2.6, 0, Math.PI * 2);
      ctx.fillStyle = targets.has(i) ? "#f57785" : inIK.has(i) ? "#f0b429" : "#5aa9ff";
      ctx.fill();
      ctx.strokeStyle = "#0b0e14";
      ctx.lineWidth = 1;
      ctx.stroke();
      if (targets.has(i)) {
        ctx.strokeStyle = "#f57785";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(p.x - 9, p.y);
        ctx.lineTo(p.x + 9, p.y);
        ctx.moveTo(p.x, p.y - 9);
        ctx.lineTo(p.x, p.y + 9);
        ctx.stroke();
      }
      if (state.zoom > 0.22) {
        ctx.font = "10px ui-monospace,SFMono-Regular,Menlo,monospace";
        ctx.fillStyle = inIK.has(i) ? "#f6d38a" : "#c9d4e6";
        ctx.fillText(b.name, p.x + 6, p.y - 5);
      }
    }
    if (state.zoom > 0.18) {
      ctx.font = "10px ui-monospace,SFMono-Regular,Menlo,monospace";
      for (const item of ik) {
        const info = item[1];
        const tw = frame.pose.world[info.constraint.target];
        if (!tw) continue;
        const p = proj(tw.tx, tw.ty);
        ctx.fillStyle = info.restricted ? "#f57785" : "#f0b429";
        ctx.fillText(info.restricted ? item[0] + " · 受限/未求值" : item[0], p.x + 11, p.y - 8);
      }
    }
    ctx.restore();
  }

  /* ---- 6.5 UV 预览 ---- */
  function drawUVInset(frame) {
    const page = state.pageImages[0];
    if (!page) return;
    const size = 150;
    const pad = 12;
    const x = viewW() - size - pad;
    const y = viewH() - size - pad;
    ctx.save();
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = "#12151d";
    ctx.strokeStyle = "#2c3444";
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, size, size);
    ctx.strokeRect(x, y, size, size);
    const s = Math.min(size / page.width, size / page.height);
    const ox = x + (size - page.width * s) / 2;
    const oy = y + (size - page.height * s) / 2;
    ctx.globalAlpha = 0.62;
    ctx.imageSmoothingEnabled = false;
    try {
      ctx.drawImage(page, ox, oy, page.width * s, page.height * s);
    } catch (_) {
      /* 忽略 */
    }
    const item = state.sel >= 0 && frame ? frame.geo.find((it) => it.slotIndex === state.sel) : null;
    if (item && item.sourceXY && item.sourceXY.length >= 2) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < item.sourceXY.length; i += 2) {
        const sx = item.sourceXY[i];
        const sy = item.sourceXY[i + 1];
        minX = Math.min(minX, sx);
        maxX = Math.max(maxX, sx);
        minY = Math.min(minY, sy);
        maxY = Math.max(maxY, sy);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#f0b429";
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + minX * s, oy + minY * s, Math.max(1, (maxX - minX) * s), Math.max(1, (maxY - minY) * s));
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#8b98ad";
    ctx.font = "10px ui-monospace,monospace";
    ctx.fillText("atlas · UV", x + 6, y + 13);
    ctx.restore();
  }

  /* ---- 6.6 选中 / 拖动反馈 ---- */
  function traceHull(screen, hull) {
    ctx.beginPath();
    const n = Math.max(3, Math.min(hull || 4, screen.length / 2));
    for (let k = 0; k < n; k++) {
      const p = k * 2;
      if (k === 0) ctx.moveTo(screen[p], screen[p + 1]);
      else ctx.lineTo(screen[p], screen[p + 1]);
    }
    ctx.closePath();
  }
  function drawSelection(frame) {
    const selItem = state.sel >= 0 ? frame.geo.find((it) => it.slotIndex === state.sel) : null;
    const hovItem = state.hover >= 0 && state.hover !== state.sel ? frame.geo.find((it) => it.slotIndex === state.hover) : null;
    ctx.save();
    if (hovItem) {
      const att = attachmentAt(frame.pose, hovItem.slotIndex);
      traceHull(projXY(hovItem.worldXY), att ? att.hullCount : 4);
      ctx.strokeStyle = "rgba(230,235,245,.7)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (selItem) {
      const att = attachmentAt(frame.pose, selItem.slotIndex);
      const screen = projXY(selItem.worldXY);
      traceHull(screen, att ? att.hullCount : 4);
      ctx.strokeStyle = "#5aa9ff";
      ctx.lineWidth = 2;
      ctx.stroke();
      const w = frame.pose.world[state.slots[selItem.slotIndex].boneIndex];
      if (w) {
        const p = proj(w.tx, w.ty);
        ctx.strokeStyle = "#f0b429";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p.x - 7, p.y);
        ctx.lineTo(p.x + 7, p.y);
        ctx.moveTo(p.x, p.y - 7);
        ctx.lineTo(p.x, p.y + 7);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
        ctx.fillStyle = "#f0b429";
        ctx.fill();
      }
    }
    ctx.restore();
  }
  function drawDragGhost(frame) {
    const d = state.drag;
    if (!d || d.mode !== "move" || !d.startWorldXY) return;
    const start = projXY(d.startWorldXY);
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = "rgba(240,180,41,.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < start.length; i += 2) {
      if (i === 0) ctx.moveTo(start[i], start[i + 1]);
      else ctx.lineTo(start[i], start[i + 1]);
    }
    ctx.closePath();
    ctx.stroke();
    const item = frame.geo.find((it) => it.slotIndex === d.slotIndex);
    if (item) {
      const a = proj(d.startPivot.x, d.startPivot.y);
      const cur = projXY(item.worldXY);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(cur[0], cur[1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ==========================================================================
   * 7. 拾取
   * ====================================================================== */
  function hitSlot(worldPoint) {
    const frame = state.frame;
    if (!frame) return -1;
    const hit = core.hitTest(frame.geo, worldPoint, { epsilon: 1e-8 });
    return hit ? hit.slotIndex : -1;
  }
  function dragBlockReason(slotIndex) {
    const slot = state.slots[slotIndex];
    if (!slot) return "没有选中部件";
    if (state.locked.has(slot.name)) return "该部件已锁定：点检查器里的锁图标解锁后可拖动";
    if (state.anim) return "预览动画中：先点「绑定姿态」回到绑定姿态再摆位";
    const att = state.frame ? attachmentAt(state.frame.pose, slotIndex) : null;
    if (att && att.weighted) return "加权网格由多根骨骼共同控制，位置只读（可改旋转/缩放看变形）";
    for (const c of state.constraints) {
      if (c.bones.indexOf(slot.boneIndex) >= 0) return "该骨受 IK 约束（" + c.name + "）：请移动 IK target 骨";
    }
    return "";
  }

  /* ==========================================================================
   * 8. 提示 / 状态
   * ====================================================================== */
  const notices = [];
  function notice(kind, text, actions) {
    const key = kind + "|" + text;
    if (notices.some((n) => n.key === key)) return;
    notices.push({ key: key, kind: kind, text: text, actions: actions || [] });
    syncNotices();
  }
  function clearNotices() {
    notices.length = 0;
    syncNotices();
  }
  function syncNotices() {
    const box = $("notices");
    box.textContent = "";
    for (const n of notices) {
      const row = el("div", "notice " + n.kind);
      row.setAttribute("role", n.kind === "error" ? "alert" : "status");
      row.appendChild(iconEl(n.kind === "error" ? "alert" : n.kind === "warn" ? "alert" : "info"));
      row.appendChild(el("span", "msg", n.text));
      if (n.actions.length) {
        const act = el("div", "notice-actions");
        for (const a of n.actions) {
          const b = el("button", "btn btn-sm", a.label);
          b.type = "button";
          b.addEventListener("click", a.onClick);
          act.appendChild(b);
        }
        row.appendChild(act);
      }
      const close = el("button", "btn btn-icon btn-sm", "×");
      close.type = "button";
      close.title = "关闭提示";
      close.addEventListener("click", () => {
        const i = notices.indexOf(n);
        if (i >= 0) notices.splice(i, 1);
        syncNotices();
      });
      row.appendChild(close);
      box.appendChild(row);
    }
  }
  function setStatus(msg, kind) {
    const node = $("statusMsg");
    node.textContent = msg;
    node.className = "msg" + (kind ? " " + kind : "");
  }
  function syncStageOverlays() {
    const loaded = !!state.model;
    $("emptyState").hidden = loaded;
    $("hiddenAllState").hidden = !(loaded && state.hidden.size >= state.slots.length);
    $("noLayerState").hidden = !(loaded && !anyLayerOn());
  }

  /* ==========================================================================
   * 9. 编辑 / 撤销
   * ====================================================================== */
  function snapshot() {
    return JSON.stringify({
      b: state.boneList.map((b) => [
        b.name,
        b.x || 0,
        b.y || 0,
        b.rotation || 0,
        b.scaleX == null ? 1 : b.scaleX,
        b.scaleY == null ? 1 : b.scaleY,
      ]),
      o: state.slots.map((s) => s.name),
    });
  }
  function applySnapshot(str) {
    const snap = JSON.parse(str);
    for (const entry of snap.b) {
      const b = state.bones[entry[0]];
      if (!b) continue;
      b.x = entry[1];
      b.y = entry[2];
      b.rotation = entry[3];
      b.scaleX = entry[4];
      b.scaleY = entry[5];
    }
    const byName = Object.create(null);
    for (const s of state.slots) byName[s.name] = s;
    const next = [];
    for (const n of snap.o) if (byName[n]) next.push(byName[n]);
    if (next.length === snap.o.length) state.slots = next;
    if (state.sel >= state.slots.length) state.sel = state.slots.length - 1;
  }
  function pushUndo(snap) {
    state.undo.push(snap);
    if (state.undo.length > 120) state.undo.shift();
    syncToolbar();
  }
  function commit(before) {
    const now = snapshot();
    if (now === before) return false;
    pushUndo(before);
    state.dirty = now !== state.initial;
    syncFooter();
    return true;
  }
  function undo() {
    if (!state.undo.length) return setStatus("没有可撤销的操作");
    applySnapshot(state.undo.pop());
    state.dirty = snapshot() !== state.initial;
    syncAll();
    render();
    setStatus("已撤销一步");
  }
  function resetAll() {
    if (!state.initial) return;
    if (snapshot() === state.initial && !state.hidden.size && !state.locked.size) return setStatus("已经是载入时的状态");
    pushUndo(snapshot());
    applySnapshot(state.initial);
    state.hidden = new Set();
    state.locked = new Set();
    state.dirty = false;
    state.sel = -1;
    if (state.anim) {
      state.anim = "";
      state.animDur = 0;
      state.t = 0;
      state.playing = false;
      syncPlayButton();
      updateTimeLabel();
    }
    syncAll();
    render();
    setStatus("已重置到载入时的状态");
  }
  function nudgeBone(axis, delta) {
    if (state.sel < 0) return;
    const reason = dragBlockReason(state.sel);
    if (reason) return setStatus(reason, "warn");
    const slot = state.slots[state.sel];
    const b = state.bones[slot.boneName];
    if (!b) return;
    const before = snapshot();
    b[axis] = (b[axis] || 0) + delta;
    if (commit(before)) {
      render();
      syncInspector();
    }
  }
  function moveLayer(action) {
    if (state.sel < 0) return;
    if (drawOrderLocked()) return setStatus("该动画含 drawOrder，本期禁用层级调整", "warn");
    const arr = state.slots;
    const pos = state.sel;
    let target = pos;
    if (action === "up") target = Math.min(arr.length - 1, pos + 1);
    if (action === "down") target = Math.max(0, pos - 1);
    if (action === "top") target = arr.length - 1;
    if (action === "bottom") target = 0;
    if (target === pos) return;
    const before = snapshot();
    const moved = arr.splice(pos, 1)[0];
    arr.splice(target, 0, moved);
    state.sel = target;
    commit(before);
    syncAll();
    render();
  }
  function drawOrderLocked() {
    const u = state.model && state.model.capabilities && state.model.capabilities.unsupported;
    return !!(u && u.drawOrder);
  }
  function toggleHidden(slotIndex) {
    if (slotIndex < 0) return;
    const name = state.slots[slotIndex].name;
    if (state.hidden.has(name)) state.hidden.delete(name);
    else state.hidden.add(name);
    syncList();
    syncInspector();
    syncStageOverlays();
    render();
  }
  function toggleLocked(slotIndex) {
    if (slotIndex < 0) return;
    const name = state.slots[slotIndex].name;
    if (state.locked.has(name)) state.locked.delete(name);
    else state.locked.add(name);
    syncList();
    syncInspector();
    updateCursor();
    render();
  }
  function restoreSlot(slotIndex) {
    if (slotIndex < 0) return;
    const slot = state.slots[slotIndex];
    const initial = JSON.parse(state.initial);
    const entry = initial.b.find((e) => e[0] === slot.boneName);
    if (!entry) return;
    const b = state.bones[slot.boneName];
    const before = snapshot();
    b.x = entry[1];
    b.y = entry[2];
    b.rotation = entry[3];
    b.scaleX = entry[4];
    b.scaleY = entry[5];
    if (commit(before)) {
      syncAll();
      render();
      setStatus("已恢复 " + slot.name + " 的变换");
    } else setStatus("该部件已经在载入时的状态");
  }

  /* ==========================================================================
   * 10. 动画
   * ====================================================================== */
  function animDuration(name) {
    const anim = state.model && state.model.animations.get(name);
    if (!anim) return 0;
    let d = 0;
    const scan = (map) => {
      if (!map || typeof map.forEach !== "function") return;
      map.forEach((tracks) => {
        const list = Object.keys(tracks || {});
        for (const k of list) {
          const track = tracks[k];
          const keys = track && track.keys;
          if (keys && keys.length) d = Math.max(d, keys[keys.length - 1].time);
        }
      });
    };
    scan(anim.bones);
    scan(anim.slots);
    return d;
  }
  function syncAnimSelect() {
    const sel = $("animSel");
    const names = state.model ? Array.from(state.model.animations.keys()) : [];
    sel.textContent = "";
    const none = el("option", null, "（无 · 绑定姿态）");
    none.value = "";
    sel.appendChild(none);
    for (const n of names) {
      const o = el("option", null, n);
      o.value = n;
      sel.appendChild(o);
    }
    sel.value = state.anim;
    const has = names.length > 0;
    sel.disabled = !has;
    $("btnPlay").disabled = !has;
    $("btnSetup").disabled = !has;
    $("btnStop").disabled = !state.anim;
    $("speedSel").disabled = !has;
    $("scrub").disabled = !state.anim || state.animDur <= 0;
  }
  function setAnim(name) {
    state.anim = name || "";
    state.animDur = animDuration(state.anim);
    state.t = 0;
    state.playing = false;
    syncPlayButton();
    syncAnimSelect();
    updateTimeLabel();
    syncInspector();
    render();
    if (state.anim) setStatus("预览动画「" + state.anim + "」：摆位已暂停，点「绑定姿态」返回");
  }
  function syncPlayButton() {
    const btn = $("btnPlay");
    btn.innerHTML = icon(state.playing ? "pause" : "play");
    btn.appendChild(el("span", null, state.playing ? "暂停" : "播放"));
    btn.appendChild(el("kbd", null, "P"));
    btn.classList.toggle("on", state.playing);
    btn.setAttribute("aria-pressed", state.playing ? "true" : "false");
  }
  function togglePlay() {
    if (!state.anim) return setStatus("先选一个动画，或直接拖动部件摆位", "warn");
    state.playing = !state.playing;
    syncPlayButton();
    if (state.playing) {
      if (state.t >= state.animDur) state.t = 0;
      state.lastTs = 0;
      requestAnimationFrame(tick);
      setStatus("预览中 · 返回绑定姿态后才能摆位", "warn");
    } else setStatus("已暂停");
  }
  function tick(ts) {
    if (!state.playing) return;
    if (!state.lastTs) state.lastTs = ts;
    const dt = Math.min(0.1, (ts - state.lastTs) / 1000) * state.speed;
    state.lastTs = ts;
    state.t += dt;
    if (state.t >= state.animDur) {
      if (state.loop && state.animDur > 0) state.t %= state.animDur;
      else {
        state.t = state.animDur;
        state.playing = false;
        syncPlayButton();
      }
    }
    updateTimeLabel();
    render();
    if (state.playing) requestAnimationFrame(tick);
  }
  function updateTimeLabel() {
    $("timeLabel").textContent = state.t.toFixed(2) + " / " + state.animDur.toFixed(2) + " s";
    if (state.animDur > 0) $("scrub").value = Math.round((1000 * state.t) / state.animDur);
  }

  /* ==========================================================================
   * 11. UI 同步
   * ====================================================================== */
  function syncAll() {
    syncToolbar();
    syncList();
    syncInspector();
    syncLayers();
    syncDebug();
    syncFooter();
    syncStageOverlays();
    updateCursor();
  }
  function syncToolbar() {
    const loaded = !!state.model;
    $("btnUndo").disabled = !loaded || state.undo.length === 0;
    $("btnReset").disabled = !loaded;
    $("btnSave").disabled = !loaded;
    $("btnFit").disabled = !loaded;
    $("btnZoomIn").disabled = !loaded;
    $("btnZoomOut").disabled = !loaded;
    $("btnToolMove").setAttribute("aria-pressed", state.tool === "move" ? "true" : "false");
    $("btnToolPan").setAttribute("aria-pressed", state.tool === "pan" ? "true" : "false");
    $("btnToolMove").classList.toggle("on", state.tool === "move");
    $("btnToolPan").classList.toggle("on", state.tool === "pan");
    syncZoom();
    syncAnimSelect();
  }
  function syncList() {
    const box = $("list");
    box.textContent = "";
    $("slotCount").textContent = String(state.slots.length);
    $("listEmpty").hidden = state.slots.length > 0;
    const q = state.search.trim().toLowerCase();
    const frame = state.frame;
    let shown = 0;
    for (let i = state.slots.length - 1; i >= 0; i--) {
      const slot = state.slots[i];
      const att = frame ? attachmentAt(frame.pose, i) : null;
      const attName = (att && (att.path || slot.attachment)) || slot.attachment || slot.name;
      const hay = (slot.name + " " + attName + " " + slot.boneName).toLowerCase();
      if (q && hay.indexOf(q) < 0) continue;
      shown++;
      const row = el("div", "slot-row");
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", i === state.sel ? "true" : "false");
      row.tabIndex = 0;
      row.dataset.index = String(i);
      if (state.hidden.has(slot.name)) row.classList.add("is-hidden");
      row.appendChild(el("span", "slot-idx", String(i)));
      row.appendChild(el("span", "slot-name", attName));
      if (String(slot.boneName).toLowerCase() !== String(attName).toLowerCase()) {
        row.appendChild(el("span", "slot-bone", slot.boneName));
      }
      if (state.locked.has(slot.name)) {
        const lk = el("span", "slot-lock");
        lk.title = "已锁定";
        lk.appendChild(iconEl("lock"));
        row.appendChild(lk);
      }
      const eye = el("button", "slot-eye");
      eye.type = "button";
      eye.innerHTML = icon(state.hidden.has(slot.name) ? "eye-off" : "eye");
      eye.title = state.hidden.has(slot.name) ? "显示该部件" : "隐藏该部件";
      eye.setAttribute("aria-label", eye.title + "：" + slot.name);
      eye.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleHidden(i);
      });
      row.appendChild(eye);
      row.addEventListener("click", () => selectSlot(i));
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectSlot(i);
        }
      });
      box.appendChild(row);
    }
    const sc = $("searchCount");
    if (q) {
      sc.hidden = false;
      sc.textContent = shown + "/" + state.slots.length;
    } else sc.hidden = true;
  }
  function selectSlot(i) {
    state.sel = i;
    state.hover = -1;
    syncList();
    syncInspector();
    render();
    if (i >= 0) {
      const row = $("list").querySelector('.slot-row[data-index="' + i + '"]');
      if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
    }
  }
  function syncInspector() {
    const slot = state.sel >= 0 ? state.slots[state.sel] : null;
    const frame = state.frame;
    const att = slot && frame ? attachmentAt(frame.pose, slot.index) : null;
    $("selBadge").textContent = slot ? String(state.sel) : "—";
    $("selEmpty").hidden = !!slot;
    $("selBody").hidden = !slot;
    if (!slot) {
      $("selEmpty").textContent = state.model
        ? "点击画布或列表选择部件。选中后这里显示绑定骨、局部坐标与层级操作。"
        : "还没有载入角色。点「载入文件」或「示例」开始。";
      return;
    }
    const bone = state.bones[slot.boneName] || {};
    $("selName").textContent = (att && (att.path || slot.attachment)) || slot.name;
    $("selSlot").textContent = "slot:" + slot.name;
    $("selBone").textContent = slot.boneName;
    $("selType").textContent = !att
      ? "（无附件）"
      : att.type === "region"
        ? "矩形附件"
        : (att.weighted ? "加权网格" : "刚性网格") + " · " + att.vertexCount + " 顶点 / " + (att.triangles ? att.triangles.length / 3 : 0) + " 三角";
    const reason = dragBlockReason(state.sel);
    $("selEditable").textContent = reason ? "受限" : "可拖动 / 方向键";
    $("selReason").hidden = !reason;
    $("selReason").textContent = reason || "";
    $("posX").disabled = !!reason;
    $("posY").disabled = !!reason;
    $("posX").value = round(bone.x || 0, 2);
    $("posY").value = round(bone.y || 0, 2);
    const transformLocked = !!state.anim || state.locked.has(slot.name);
    $("rotX").disabled = transformLocked;
    $("rotX").value = round(bone.rotation || 0, 1);
    $("rotRange").disabled = transformLocked;
    $("rotRange").value = clamp(bone.rotation || 0, -180, 180);
    $("scaleX").disabled = transformLocked;
    $("scaleX").value = round(bone.scaleX == null ? 1 : bone.scaleX, 2);
    $("scaleY").disabled = transformLocked;
    $("scaleY").value = round(bone.scaleY == null ? 1 : bone.scaleY, 2);
    const hidden = state.hidden.has(slot.name);
    const vis = $("btnSelVisible");
    vis.innerHTML = icon(hidden ? "eye-off" : "eye");
    vis.setAttribute("aria-pressed", hidden ? "true" : "false");
    vis.title = hidden ? "显示该部件（H）" : "隐藏该部件（H）";
    const locked = state.locked.has(slot.name);
    const lk = $("btnSelLock");
    lk.innerHTML = icon(locked ? "lock" : "unlock");
    lk.setAttribute("aria-pressed", locked ? "true" : "false");
    lk.title = locked ? "解锁该部件" : "锁定该部件（只影响查看器）";
    const zLocked = drawOrderLocked();
    $("btnLayerUp").disabled = zLocked || state.sel >= state.slots.length - 1;
    $("btnLayerDown").disabled = zLocked || state.sel <= 0;
    $("btnLayerTop").disabled = zLocked;
    $("btnLayerBottom").disabled = zLocked;
    $("btnRestoreSlot").disabled = !state.initial;
    const infl = $("influences");
    if (att && att.weighted && att.influences) {
      const bonesUsed = new Map();
      for (const list of att.influences) for (const inf of list) bonesUsed.set(inf.boneIndex, (bonesUsed.get(inf.boneIndex) || 0) + inf.weight);
      const ul = $("influenceList");
      ul.textContent = "";
      const entries = Array.from(bonesUsed.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
      for (const entry of entries) {
        const bi = entry[0];
        const name = (state.model.bones[bi] && state.model.bones[bi].name) || "#" + bi;
        const li = el("li");
        const left = el("span");
        const sw = el("span", "swatch");
        const c = boneColorOf(bi);
        sw.style.background = "rgb(" + Math.round(c[0] * 255) + "," + Math.round(c[1] * 255) + "," + Math.round(c[2] * 255) + ")";
        left.appendChild(sw);
        left.appendChild(document.createTextNode(name));
        li.appendChild(left);
        li.appendChild(el("span", null, round(entry[1], 1) + " Σw"));
        ul.appendChild(li);
      }
      infl.hidden = false;
    } else infl.hidden = true;
  }
  function syncLayers() {
    $$(".layers input[data-layer]").forEach((cb) => {
      cb.checked = !!state.show[cb.dataset.layer];
    });
    $("snapChk").checked = state.snap;
    $("snapState").textContent = state.snap ? "1 单位" : "关闭";
    $("texAlpha").value = state.texAlpha;
    $("texAlphaV").textContent = Math.round(state.texAlpha) + "%";
    $("weightMode").value = state.weightMode;
  }
  function syncDebug() {
    const loaded = !!state.model;
    $("boneLegend").textContent = "";
    if (loaded) {
      const legend = $("boneLegend");
      const fk = el("span");
      fk.innerHTML = '<i class="swatch" style="background:#5aa9ff"></i>骨骼 ' + state.boneList.length;
      const ikn = el("span");
      ikn.innerHTML = '<i class="swatch" style="background:#f0b429"></i>IK ' + state.constraints.length;
      const tg = el("span");
      tg.innerHTML = '<i class="swatch" style="background:#f57785"></i>target ' + new Set(state.constraints.map((c) => c.target)).size;
      legend.appendChild(fk);
      legend.appendChild(ikn);
      legend.appendChild(tg);
      const restricted = Array.from(ikState().values()).filter((x) => x.restricted);
      $("boneNote").textContent = state.constraints.length
        ? "IK 约束 " + state.constraints.length + " 个（" + state.constraints.map((c) => c.name).join("、") + "）。" +
          (restricted.length
            ? "受限/未求值 " + restricted.length + " 个：" + restricted.map((x) => x.constraint.name + "（" + x.reason + "）").join("；")
            : "全部已求值（mix>0 时生效）。") +
          " 蓝线 FK、琥珀 IK、红色十字为 IK target。"
        : "骨骼 " + state.boneList.length + " 根，没有 ik 约束（skeleton.ik 为空），所以全部是 FK 链。";
    } else $("boneNote").textContent = "载入后显示骨骼数与约束状态。";

    const frame = state.frame;
    const meshes = [];
    if (loaded && frame) {
      for (const item of frame.geo) {
        const att = attachmentAt(frame.pose, item.slotIndex);
        if (att && att.type !== "region") meshes.push({ item: item, att: att });
      }
    }
    if (!loaded) $("meshNote").textContent = "载入后显示网格与 UV 状态。";
    else if (!meshes.length) {
      $("meshNote").textContent = "全部是矩形附件（无网格顶点）：网格层只画 2 个三角面 + 轮廓，不画示意细分。";
    } else {
      const selMesh = meshes.filter((m) => m.item.slotIndex === state.sel)[0];
      $("meshNote").textContent =
        "网格附件 " + meshes.length + " 个：" +
        meshes
          .slice(0, 6)
          .map((m) => m.item.attachmentId.split("/").pop() + "(" + m.att.vertexCount + " 顶点/" + m.att.triangles.length / 3 + " 三角" + (m.att.weighted ? "·加权" : "") + ")")
          .join("、") +
        (meshes.length > 6 ? "…" : "") +
        (selMesh ? "；选中件 hull=" + selMesh.att.hullCount : "") +
        "。右下角是图集 UV 预览（黄框为选中件）。";
    }

    $("legend").textContent = "";
    if (loaded && frame) {
      const legend = $("legend");
      const used = new Map();
      let anyWeighted = false;
      for (const item of frame.geo) {
        const att = attachmentAt(frame.pose, item.slotIndex);
        if (!att) continue;
        if (att.weighted) anyWeighted = true;
        let res = null;
        try {
          res = core.weightColors(att, state.slots[item.slotIndex].boneIndex, new Map(), null);
        } catch (_) {
          res = null;
        }
        const list = (res && res.legend) || [];
        for (const e of list) if (!used.has(e.boneIndex)) used.set(e.boneIndex, e);
      }
      const entries = Array.from(used.entries()).slice(0, 12);
      for (const entry of entries) {
        const bi = entry[0];
        const e = entry[1];
        const s = el("span");
        const c = e.color || boneColorOf(bi);
        s.innerHTML = '<i class="swatch" style="background:rgb(' + Math.round((c[0] || 0) * 255) + "," + Math.round((c[1] || 0) * 255) + "," + Math.round((c[2] || 0) * 255) + ')"></i>';
        s.appendChild(document.createTextNode((e.name || "#" + bi) + (e.vertexCount ? " ×" + e.vertexCount : "")));
        legend.appendChild(s);
      }
      $("weightsNote").textContent = anyWeighted
        ? "按顶点权重混合着色（每面重心插值色片）：面内可见渐变；可切「选中骨热力」看单骨权重 0..1。"
        : "刚性绑定：每个部件 100% 属于其绑定骨（颜色只表示归属，没有渐变）。";
    } else $("weightsNote").textContent = "载入后显示权重归属说明。";

    $("exprAvail").textContent = !loaded
      ? "载入后检测表情槽位。"
      : "spine 没有独立的「表情」参数类型：本工具不伪造眨眼/口型。要换表情请用动画里的 attachment(swap) 轨道（本期不编辑时间线）。";
    const exprIds = ["exBlink", "exMouth", "exBrow"];
    for (const id of exprIds) $(id).disabled = true;
    $$("#debug .presets button").forEach((b) => (b.disabled = true));

    const issues = state.issueDetails || [];
    $("diagBadge").hidden = state.unsupportedCount === 0 && issues.length === 0;
    $("diagBadge").textContent = String(issues.length);
    const box = $("issueList");
    box.textContent = "";
    for (const i of issues.slice(0, 60)) {
      const li = el("li", "issue-" + (i.severity || "warning"));
      li.textContent = (i.severity === "error" ? "错误" : "警告") + " [" + (i.code || "") + "] " + (i.path || "") + " — " + (i.message || "");
      box.appendChild(li);
    }
    $("issueWrap").hidden = issues.length === 0;
  }
  function syncFooter() {
    $("footDirty").textContent = state.dirty ? "有未保存改动" : "无未保存改动";
    $("footDirty").className = state.dirty ? "dirty-on" : "";
    const diag = $("footDiag");
    diag.hidden = state.unsupportedCount === 0;
    diag.textContent = "未求值 " + state.unsupportedCount;
    $("rendererInfo").textContent = !state.model ? "渲染：—" : coreInfo.ready ? "渲染：SpineCore" : "渲染：—";
    $("rendererInfo").title = coreInfo.reason || "";
  }
  function updateCursor() {
    let cursor = "default";
    if (state.drag && state.drag.mode === "pan") cursor = "grabbing";
    else if (state.spaceDown || state.tool === "pan") cursor = "grab";
    else if (state.hover >= 0) cursor = dragBlockReason(state.hover) ? "not-allowed" : "move";
    cv.style.cursor = cursor;
  }
  function setTool(tool) {
    state.tool = tool;
    syncToolbar();
    updateCursor();
    setStatus(tool === "pan" ? "平移工具：拖动移动视图（V 回到移动工具）" : "移动工具：拖动部件改变摆位");
  }
  function setDebugOpen(open) {
    $("debug").classList.toggle("open", !!open);
    $("debugBody").hidden = !open;
    $("debugToggle").setAttribute("aria-expanded", open ? "true" : "false");
  }
  function openDebug() {
    setDebugOpen(true);
    $("debug").scrollIntoView({ block: "nearest" });
  }

  /* ==========================================================================
   * 12. 画布交互
   * ====================================================================== */
  function stagePoint(e) {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function beginPan(e) {
    const p = stagePoint(e);
    state.drag = { mode: "pan", startX: p.x, startY: p.y, panX: state.panX, panY: state.panY };
    cv.setPointerCapture(e.pointerId);
    updateCursor();
  }
  function onPointerDown(e) {
    if (e.button === 1) {
      e.preventDefault();
      return beginPan(e);
    }
    if (e.button !== 0) return;
    if (state.spaceDown || state.tool === "pan") {
      e.preventDefault();
      return beginPan(e);
    }
    if (!state.model) return;
    if (!anyLayerOn()) return setStatus("未显示任何内容：先恢复一个显示层再拾取", "warn");
    const p = stagePoint(e);
    const world = unproj(p.x, p.y);
    const frame = state.frame || framePose();
    const hit = core.hitTest(frame.geo, world, { epsilon: 1e-8 });
    if (!hit) return selectSlot(-1);
    selectSlot(hit.slotIndex);
    const reason = dragBlockReason(hit.slotIndex);
    if (reason) return setStatus(reason, "warn");
    const slot = state.slots[hit.slotIndex];
    const bone = state.bones[slot.boneName];
    const item = frame.geo.filter((it) => it.slotIndex === hit.slotIndex)[0];
    const bw = frame.pose.world[slot.boneIndex];
    const parentIndex = state.model.bones[slot.boneIndex].parentIndex;
    state.drag = {
      mode: "move",
      slotIndex: hit.slotIndex,
      boneName: slot.boneName,
      startWorld: world,
      startBone: { x: bone.x || 0, y: bone.y || 0 },
      startPivot: { x: bw.tx, y: bw.ty },
      startWorldXY: item ? Array.from(item.worldXY) : null,
      parentWorld: parentIndex >= 0 ? frame.pose.world[parentIndex] : null,
      baseline: snapshot(),
      moved: false,
      pointerId: e.pointerId,
    };
    cv.setPointerCapture(e.pointerId);
    updateCursor();
    render();
  }
  function onPointerMove(e) {
    const d = state.drag;
    if (d) {
      const p = stagePoint(e);
      if (d.mode === "pan") {
        state.panX = d.panX + (p.x - d.startX);
        state.panY = d.panY + (p.y - d.startY);
        render();
        return;
      }
      const world = unproj(p.x, p.y);
      const wdx = world.x - d.startWorld.x;
      const wdy = world.y - d.startWorld.y;
      let ldx = wdx;
      let ldy = wdy;
      if (d.parentWorld) {
        const m = d.parentWorld;
        const det = m.a * m.d - m.b * m.c;
        if (Math.abs(det) < 1e-12) return;
        ldx = (m.d * wdx - m.c * wdy) / det;
        ldy = (-m.b * wdx + m.a * wdy) / det;
      }
      const bone = state.bones[d.boneName];
      let nx = d.startBone.x + ldx;
      let ny = d.startBone.y + ldy;
      if (state.snap) {
        nx = Math.round(nx);
        ny = Math.round(ny);
      }
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
      if (nx !== d.startBone.x || ny !== d.startBone.y) d.moved = true;
      bone.x = nx;
      bone.y = ny;
      if (d.moved) {
        state.dirty = snapshot() !== state.initial;
        syncFooter();
        syncInspector();
      }
      updateDragBadge(e, nx - d.startBone.x, ny - d.startBone.y);
      render();
      return;
    }
    if (!state.model || !anyLayerOn()) {
      if (state.hover !== -1) {
        state.hover = -1;
        updateCursor();
        render();
      }
      return;
    }
    const p = stagePoint(e);
    const world = unproj(p.x, p.y);
    const frame = state.frame || framePose();
    const hit = core.hitTest(frame.geo, world, { epsilon: 1e-8 });
    const idx = hit ? hit.slotIndex : -1;
    if (idx !== state.hover) {
      state.hover = idx;
      updateCursor();
      render();
    }
  }
  function onPointerUp(e) {
    const d = state.drag;
    if (!d) return;
    try {
      cv.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* 忽略 */
    }
    if (d.mode === "move" && d.moved) {
      pushUndo(d.baseline);
      state.dirty = snapshot() !== state.initial;
      setStatus("已移动 " + (state.slots[d.slotIndex] ? state.slots[d.slotIndex].name : "") + " · 可 Ctrl+Z 撤销");
      syncFooter();
      syncInspector();
      syncList();
    }
    state.drag = null;
    $("dragBadge").hidden = true;
    updateCursor();
    render();
  }
  function cancelDrag() {
    const d = state.drag;
    if (!d) return false;
    if (d.mode === "move" && d.moved) {
      applySnapshot(d.baseline);
      state.dirty = snapshot() !== state.initial;
    }
    state.drag = null;
    $("dragBadge").hidden = true;
    updateCursor();
    syncAll();
    render();
    setStatus("已取消本次拖动");
    return true;
  }
  function updateDragBadge(e, dx, dy) {
    const badge = $("dragBadge");
    const r = cv.getBoundingClientRect();
    badge.hidden = false;
    badge.style.left = clamp(e.clientX - r.left + 14, 4, r.width - 180) + "px";
    badge.style.top = clamp(e.clientY - r.top + 14, 4, r.height - 44) + "px";
    badge.textContent =
      "ΔX " + (dx >= 0 ? "+" : "−") + fmt(Math.abs(dx), 1) + "  ΔY " + (dy >= 0 ? "+" : "−") + fmt(Math.abs(dy), 1);
  }
  function onWheel(e) {
    if (!state.model) return;
    e.preventDefault();
    const p = stagePoint(e);
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, p.x, p.y);
  }
  function onKeyDown(e) {
    if (isTypingTarget(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    const lower = key.length === 1 ? key.toLowerCase() : key;
    if (key === "Escape") {
      if (state.helpOpen) return closeHelp();
      if (state.drag) {
        e.preventDefault();
        return cancelDrag();
      }
      if (state.sel >= 0) return selectSlot(-1);
      return;
    }
    if (key === "?" || (e.shiftKey && key === "/")) {
      e.preventDefault();
      return toggleHelp();
    }
    if (mod && lower === "z") {
      e.preventDefault();
      return undo();
    }
    if (key === " ") {
      e.preventDefault();
      if (!e.repeat) {
        state.spaceDown = true;
        updateCursor();
      }
      return;
    }
    if (mod || e.altKey) return;
    if (lower === "v") return setTool("move");
    if (lower === "p") {
      e.preventDefault();
      return togglePlay();
    }
    if (lower === "f") {
      e.preventDefault();
      return fitView(e.shiftKey ? "sel" : "all");
    }
    if (lower === "h") {
      e.preventDefault();
      if (state.sel >= 0) toggleHidden(state.sel);
      return;
    }
    if (key === "[") {
      e.preventDefault();
      return moveLayer("down");
    }
    if (key === "]") {
      e.preventDefault();
      return moveLayer("up");
    }
    if (key === "+" || key === "=") {
      e.preventDefault();
      return zoomBy(1.25);
    }
    if (key === "-" || key === "_") {
      e.preventDefault();
      return zoomBy(1 / 1.25);
    }
    if (key.indexOf("Arrow") === 0) {
      if (state.sel < 0) return;
      const step = e.shiftKey ? 10 : 1;
      const map = { ArrowLeft: ["x", -step], ArrowRight: ["x", step], ArrowUp: ["y", step], ArrowDown: ["y", -step] };
      const d = map[key];
      if (!d) return;
      e.preventDefault();
      nudgeBone(d[0], d[1]);
    }
  }
  function onKeyUp(e) {
    if (e.code === "Space" || e.key === " ") {
      state.spaceDown = false;
      updateCursor();
    }
  }

  /* ==========================================================================
   * 13. 帮助浮层
   * ====================================================================== */
  let helpReturnFocus = null;
  function toggleHelp() {
    if (state.helpOpen) closeHelp();
    else openHelp();
  }
  function openHelp() {
    helpReturnFocus = document.activeElement;
    state.helpOpen = true;
    $("helpOverlay").hidden = false;
    $("helpClose").focus();
  }
  function closeHelp() {
    state.helpOpen = false;
    $("helpOverlay").hidden = true;
    if (helpReturnFocus && helpReturnFocus.focus) {
      try {
        helpReturnFocus.focus();
      } catch (_) {
        /* 忽略 */
      }
    }
  }

  /* ==========================================================================
   * 14. 导出（只在原 JSON 上打补丁）
   * ====================================================================== */
  function exportJson() {
    if (!state.raw) return;
    const raw = typeof structuredClone === "function" ? structuredClone(state.raw) : JSON.parse(JSON.stringify(state.raw));
    const changed = [];
    raw.bones = (raw.bones || []).map((rb, i) => {
      const cur = state.boneList[i];
      if (!cur) return rb;
      const out = Object.assign({}, rb);
      for (const f of FIELDS) {
        const dflt = f === "scaleX" || f === "scaleY" ? 1 : 0;
        const before = rb[f] == null ? dflt : rb[f];
        const now = cur[f] == null ? dflt : cur[f];
        if (Math.abs(now - before) > 1e-9) {
          out[f] = round(now, 6);
          changed.push(cur.name + "." + f);
        }
      }
      return out;
    });
    const byName = Object.create(null);
    for (const s of raw.slots || []) byName[s.name] = s;
    raw.slots = state.slots.map((s) =>
      Object.assign({}, byName[s.name] || { name: s.name, bone: s.boneName, attachment: s.attachment })
    );
    const blob = new Blob([JSON.stringify(raw, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = (state.label || "model").replace(/[^\w.-]+/g, "_").slice(0, 40) + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    state.dirty = false;
    syncFooter();
    setStatus("已导出 JSON（补丁 " + changed.length + " 个字段）· 运行时 JSON，不能还原 .spine 工程");
    notice("info", changed.length ? "已导出：" + changed.slice(0, 6).join("、") + (changed.length > 6 ? "…" : "") : "已导出：未改动任何骨骼字段");
    window.__lastExport = raw;
    return raw;
  }

  /* ==========================================================================
   * 15. 示例菜单
   * ====================================================================== */
  function menuItem(opts) {
    const b = el("button", "menu-item");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.appendChild(iconEl(opts.icon || "sample"));
    const text = el("span");
    text.appendChild(el("span", null, opts.label));
    if (opts.note) text.appendChild(el("span", "menu-note", opts.note));
    b.appendChild(text);
    if (opts.disabled) {
      b.disabled = true;
      b.title = opts.note || "不可用";
    } else {
      b.addEventListener("click", () => {
        closeExampleMenu();
        opts.onClick();
      });
    }
    return b;
  }
  function buildExampleMenu() {
    const menu = $("exampleMenu");
    menu.textContent = "";
    menu.appendChild(el("div", "menu-title", "真实角色"));
    menu.appendChild(
      menuItem({
        label: "deepseek 女仆",
        note: "assets/characters/deepseek/spine · 11 部件 / 12 骨骼",
        icon: "sample",
        onClick: loadExample,
      })
    );
    menu.appendChild(el("div", "menu-sep"));
    menu.appendChild(el("div", "menu-title", "测试样张（fixtures）"));
    const cases = fixtureCases();
    if (cases) {
      const ids = Object.keys(cases).filter((id) => cases[id] && cases[id].example === true);
      const list = ids.length ? ids : Object.keys(cases);
      const groupIcon = { basic: "mesh", atlas: "texture", ik: "target", fk: "bone", diagnostics: "alert", degenerate: "alert" };
      for (const id of list) {
        const fx = cases[id];
        menu.appendChild(
          menuItem({
            label: fx.label || id,
            note: "fixtures/" + id + (fx.group ? " · " + fx.group : ""),
            icon: groupIcon[fx.group] || "mesh",
            onClick: () => loadFixture(id),
          })
        );
      }
      if (list.length < Object.keys(cases).length) {
        menu.appendChild(
          menuItem({
            label: "其余 " + (Object.keys(cases).length - list.length) + " 个样张",
            note: "含退化/不支持特性用例：在 selftest.html 里跑断言",
            icon: "info",
            disabled: true,
          })
        );
      }
    } else {
      menu.appendChild(menuItem({ label: "fixtures 未就绪", note: "需要 fixtures/cases.js", icon: "mesh", disabled: true }));
    }
    menu.appendChild(el("div", "menu-sep"));
    const rig = new URLSearchParams(location.search).get("rig");
    menu.appendChild(
      menuItem({
        label: "开发用：?rig=<相对路径>",
        note: rig ? "当前：" + rig : "地址栏追加 ?rig=references/spine-rigs/… 可载入真实 rig",
        icon: "target",
        disabled: true,
      })
    );
  }
  function openExampleMenu() {
    $("exampleMenu").hidden = false;
    $("btnExamples").setAttribute("aria-expanded", "true");
    const first = $("exampleMenu").querySelector(".menu-item:not(:disabled)");
    if (first) first.focus();
  }
  function closeExampleMenu() {
    $("exampleMenu").hidden = true;
    $("btnExamples").setAttribute("aria-expanded", "false");
  }

  /* ==========================================================================
   * 16. 绑定 / 启动
   * ====================================================================== */
  function applyInspectorNumber(axis) {
    if (state.sel < 0) return;
    const reason = dragBlockReason(state.sel);
    if (reason) return setStatus(reason, "warn");
    const slot = state.slots[state.sel];
    const v = parseFloat($(axis === "x" ? "posX" : "posY").value);
    if (!Number.isFinite(v)) return syncInspector();
    const b = state.bones[slot.boneName];
    const before = snapshot();
    b[axis] = v;
    if (commit(before)) {
      syncAll();
      render();
    } else syncInspector();
  }
  function applyBoneField(field, rawValue) {
    if (state.sel < 0) return;
    const slot = state.slots[state.sel];
    if (state.anim || state.locked.has(slot.name)) return;
    const v = Number(rawValue);
    if (!Number.isFinite(v)) return syncInspector();
    const b = state.bones[slot.boneName];
    const before = snapshot();
    b[field] = field === "scaleX" || field === "scaleY" ? (v > 0 ? v : 0.01) : v;
    if (commit(before)) {
      syncInspector();
      syncDebug();
      render();
    }
  }
  function bindUI() {
    $("btnLoad").addEventListener("click", () => $("files").click());
    $("btnEmptyLoad").addEventListener("click", () => $("files").click());
    $("files").addEventListener("change", (e) => {
      loadFiles(e.target.files);
      e.target.value = "";
    });
    $("btnEmptyExample").addEventListener("click", loadExample);
    $("btnExamples").addEventListener("click", (e) => {
      e.stopPropagation();
      if ($("exampleMenu").hidden) openExampleMenu();
      else closeExampleMenu();
    });
    document.addEventListener("click", (e) => {
      if (!$("exampleMenu").hidden && !e.target.closest(".menu-wrap")) closeExampleMenu();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("exampleMenu").hidden) closeExampleMenu();
    });
    $("btnToolMove").addEventListener("click", () => setTool("move"));
    $("btnToolPan").addEventListener("click", () => setTool("pan"));
    $("btnUndo").addEventListener("click", undo);
    $("btnReset").addEventListener("click", resetAll);
    $("btnSave").addEventListener("click", exportJson);
    $("btnFit").addEventListener("click", () => fitView("all"));
    $("btnZoomIn").addEventListener("click", () => zoomBy(1.25));
    $("btnZoomOut").addEventListener("click", () => zoomBy(1 / 1.25));
    $("btnHelp").addEventListener("click", toggleHelp);
    $("helpClose").addEventListener("click", closeHelp);
    $("helpOverlay").addEventListener("click", (e) => {
      if (e.target === $("helpOverlay")) closeHelp();
    });
    $("btnPanel").addEventListener("click", () => {
      const open = document.body.classList.toggle("drawer-open");
      $("btnPanel").setAttribute("aria-pressed", open ? "true" : "false");
    });
    const backdrop = $("backdrop");
    if (backdrop) {
      backdrop.addEventListener("click", () => {
        document.body.classList.remove("drawer-open");
        $("btnPanel").setAttribute("aria-pressed", "false");
      });
    }
    $("btnRestoreAll").addEventListener("click", () => {
      state.hidden.clear();
      syncList();
      syncInspector();
      syncStageOverlays();
      render();
    });
    $("btnRestoreTexture").addEventListener("click", () => {
      state.show.texture = true;
      syncLayers();
      syncStageOverlays();
      render();
      setStatus("已恢复贴图层");
    });
    $$(".layers input[data-layer]").forEach((cb) => {
      cb.addEventListener("change", () => {
        state.show[cb.dataset.layer] = cb.checked;
        autoTextureAlpha();
        syncStageOverlays();
        syncDebug();
        render();
        if (!anyLayerOn()) setStatus("四个显示层都关了：画布暂不响应拾取，列表与检查器仍可用", "warn");
      });
    });
    $("snapChk").addEventListener("change", (e) => {
      state.snap = e.target.checked;
      syncLayers();
      setStatus(state.snap ? "吸附已开启：拖动取整到 1 个单位" : "吸附已关闭");
    });
    $("texAlpha").addEventListener("input", (e) => {
      state.texAlpha = Number(e.target.value);
      state.texAlphaAuto = false;
      $("texAlphaV").textContent = Math.round(state.texAlpha) + "%";
      render();
    });
    $("weightMode").addEventListener("change", (e) => {
      state.weightMode = e.target.value;
      render();
      syncDebug();
    });
    $("btnSelVisible").addEventListener("click", () => toggleHidden(state.sel));
    $("btnSelLock").addEventListener("click", () => toggleLocked(state.sel));
    $("btnLayerUp").addEventListener("click", () => moveLayer("up"));
    $("btnLayerDown").addEventListener("click", () => moveLayer("down"));
    $("btnLayerTop").addEventListener("click", () => moveLayer("top"));
    $("btnLayerBottom").addEventListener("click", () => moveLayer("bottom"));
    $("btnRestoreSlot").addEventListener("click", () => restoreSlot(state.sel));
    $("posX").addEventListener("change", () => applyInspectorNumber("x"));
    $("posY").addEventListener("change", () => applyInspectorNumber("y"));
    $("rotX").addEventListener("change", (e) => applyBoneField("rotation", e.target.value));
    $("rotRange").addEventListener("input", (e) => applyBoneField("rotation", e.target.value));
    $("scaleX").addEventListener("change", (e) => applyBoneField("scaleX", e.target.value));
    $("scaleY").addEventListener("change", (e) => applyBoneField("scaleY", e.target.value));
    $("slotSearch").addEventListener("input", (e) => {
      state.search = e.target.value;
      syncList();
    });
    $("footDiag").addEventListener("click", openDebug);
    $("debugToggle").addEventListener("click", () => setDebugOpen(!$("debug").classList.contains("open")));
    $("animSel").addEventListener("change", (e) => setAnim(e.target.value));
    $("btnPlay").addEventListener("click", togglePlay);
    $("btnSetup").addEventListener("click", () => {
      if (!state.anim) return;
      setAnim("");
      setStatus("已回到绑定姿态，可以拖动摆位");
    });
    $("btnStop").addEventListener("click", () => {
      state.playing = false;
      state.t = 0;
      syncPlayButton();
      updateTimeLabel();
      render();
    });
    $("loopChk").addEventListener("change", (e) => (state.loop = e.target.checked));
    $("speedSel").addEventListener("change", (e) => (state.speed = parseFloat(e.target.value)));
    $("scrub").addEventListener("input", (e) => {
      if (!state.animDur) return;
      state.playing = false;
      syncPlayButton();
      state.t = (state.animDur * Number(e.target.value)) / 1000;
      updateTimeLabel();
      render();
    });
    cv.addEventListener("pointerdown", onPointerDown);
    cv.addEventListener("pointermove", onPointerMove);
    cv.addEventListener("pointerup", onPointerUp);
    cv.addEventListener("pointercancel", onPointerUp);
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    const stage = $("stage");
    stage.addEventListener("dragenter", (e) => {
      e.preventDefault();
      stage.classList.add("drop-target");
    });
    stage.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });
    stage.addEventListener("dragleave", (e) => {
      if (e.target === stage) stage.classList.remove("drop-target");
    });
    stage.addEventListener("drop", (e) => {
      e.preventDefault();
      stage.classList.remove("drop-target");
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) loadFiles(files);
    });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", () => {
      state.spaceDown = false;
      updateCursor();
    });
    if (typeof ResizeObserver === "function") new ResizeObserver(() => render()).observe(stage);
  }
  function autoTextureAlpha() {
    if (!state.texAlphaAuto) return;
    state.texAlpha = overlayActive() ? 35 : 100;
    $("texAlpha").value = state.texAlpha;
    $("texAlphaV").textContent = Math.round(state.texAlpha) + "%";
  }
  function syncExprInputs() {
    const pairs = [["exBlink", "exBlinkV", "0.00"], ["exMouth", "exMouthV", "0"], ["exBrow", "exBrowV", "0"]];
    for (const p of pairs) {
      const inp = $(p[0]);
      const out = $(p[1]);
      if (inp) inp.value = 0;
      if (out) out.textContent = p[2];
    }
  }
  function init() {
    bindUI();
    if ($("kbdUndo")) $("kbdUndo").textContent = MOD_LABEL + "+Z";
    if ($("helpModKey")) $("helpModKey").textContent = MOD_LABEL;
    buildExampleMenu();
    syncAll();
    syncExprInputs();
    updateTimeLabel();
    syncFooter();
    setStatus("未载入：选择 JSON + atlas + 所有图集图片，或从「示例」开始");
    render();
    const rig = new URLSearchParams(location.search).get("rig");
    if (rig) loadRig(rig);
    window.__spineEditor = {
      state: state,
      core: coreInfo,
      frame: () => state.frame,
      renderer: () => (coreInfo.ready ? "core" : "none"),
      hitTest: (x, y) => hitSlot({ x: x, y: y }),
      render: render,
      fitView: fitView,
      loadRig: loadRig,
      exportJson: exportJson,
    };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
