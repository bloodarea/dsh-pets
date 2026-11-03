/* =============================================================================
   立绘语义标注器 · 应用层
   - 原立绘 / 现有拆分件 / 标注工程载入
   - 多部件（语义层）编辑：矩形、多边形、画笔、橡皮、颜色魔法棒
   - 选区 -> 赋给当前件 / 从当前件减去 / 新建部件；合并、删除、调 z 序
   - 保存到 workspace（annotations.json + label + masks + cuts + preview）或导出 ZIP
   依赖：core.js（PartAnnotatorCore）
   ============================================================================= */
(function () {
  'use strict';

  var C = window.PartAnnotatorCore;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // ---------------------------------------------------------------- 状态
  var S = {
    caps: null,
    img: null,               // HTMLImageElement 原立绘
    imgW: 0, imgH: 0,
    basePixels: null,        // Uint8ClampedArray（洪水填充用）
    maps: { visible: null, hidden: null },
    channel: 'visible',
    mode: 'parts',            // parts = 语义部件标注；issues = 拆分问题标注
    parts: [],
    activeId: null,
    nextZ: 1,
    // [{id,type,severity,partId,beforePartId,note,masks:{region,before,after},createdAt}]
    // region / after 是“可累加的选区”（多个矩形/多边形/魔法棒叠加成一块或多块）；
    // before 不画选区，直接由 beforePartId 指向的拆分件的可见区生成。
    issues: [],
    activeIssueId: null,
    issueTarget: 'region',    // region | before | after
    showIssues: true,
    issueOverlayDirty: true,
    tool: 'rect',
    lastPaintTool: 'rect',    // 切到「改动前」（选择工具）前用的绘制工具，切回来时恢复
    zoom: 1, tx: 0, ty: 0,
    showMask: true, showOutline: true, showBase: true,
    brushSize: 18, tolerance: 28, autoAssign: true,
    selection: null,          // {type:'rect',x0,y0,x1,y1} | {type:'poly',points:[{x,y}]}
    hover: null,              // 指针图像坐标
    drag: null,
    undo: [], redo: [],
    dirty: false,
    sourcePath: '',
    projectDir: '',
    projectName: '',
    character: 'deepseek',
    view: 'front',
    overlayDirty: true,
    outlineDirty: true,
    visibilityDirty: true,
    visibilityCanvas: null,
    outlinePart: null,
    outlineCanvas: null,
    raf: 0
  };

  var cv, ctx, stage;
  var checker = null;
  var overlayCanvas = null, overlayCtx = null;
  var issueCanvas = null, issueCtx = null;
  var maskCanvas = null, maskCtx = null;
  var dpr = 1;

  // ---------------------------------------------------------------- 小工具
  function msg(text, hint) {
    $('#statusMsg').textContent = text;
    if (hint !== undefined) $('#statusHint').textContent = hint;
  }
  function setDirty(v) {
    S.dirty = v;
    document.title = (v ? '● ' : '') + '立绘语义标注器';
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function nowIso() { return new Date().toISOString(); }
  function partIndex(id) {
    for (var i = 0; i < S.parts.length; i++) if (S.parts[i].id === id) return i + 1;
    return 0;
  }
  function activePart() {
    var idx = partIndex(S.activeId);
    return idx ? S.parts[idx - 1] : null;
  }
  function channelMap(ch) { return S.maps[ch || S.channel]; }
  function scheduleRender() {
    if (S.raf) return;
    S.raf = requestAnimationFrame(function () { S.raf = 0; render(); });
  }
  function hexToRgba(hex, a) {
    var c = C.hexToRgb(hex);
    return [c.r, c.g, c.b, a | 0];
  }
  function isEditableTarget(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
  }

  // ---------------------------------------------------------------- 画布 / 视图
  function layoutCanvas() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!cv || !stage) return;
    var w = stage.clientWidth, h = stage.clientHeight;
    cv.width = Math.max(1, Math.round(w * dpr));
    cv.height = Math.max(1, Math.round(h * dpr));
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    buildChecker();
    scheduleRender();
  }

  function buildChecker() {
    var size = 16;
    checker = document.createElement('canvas');
    checker.width = checker.height = size * 2;
    var c = checker.getContext('2d');
    c.fillStyle = '#20242e';
    c.fillRect(0, 0, size * 2, size * 2);
    c.fillStyle = '#262b37';
    c.fillRect(0, 0, size, size);
    c.fillRect(size, size, size, size);
  }

  function fitView() {
    if (!S.img) return;
    var w = stage.clientWidth, h = stage.clientHeight;
    var z = Math.min((w - 32) / S.imgW, (h - 32) / S.imgH);
    S.zoom = clamp(z, 0.02, 8);
    S.tx = (w - S.imgW * S.zoom) / 2;
    S.ty = (h - S.imgH * S.zoom) / 2;
    updateZoomLabel();
    scheduleRender();
  }

  function updateZoomLabel() {
    $('#zoomLabel').textContent = Math.round(S.zoom * 100) + '%';
  }

  function screenToImage(px, py) {
    return { x: (px - S.tx) / S.zoom, y: (py - S.ty) / S.zoom };
  }
  function imageToScreen(ix, iy) {
    return { x: S.tx + ix * S.zoom, y: S.ty + iy * S.zoom };
  }

  function ensureOverlayCanvas() {
    if (!overlayCanvas || overlayCanvas.width !== S.imgW || overlayCanvas.height !== S.imgH) {
      overlayCanvas = document.createElement('canvas');
      overlayCanvas.width = S.imgW;
      overlayCanvas.height = S.imgH;
      overlayCtx = overlayCanvas.getContext('2d');
      S.overlayDirty = true;
    }
    if (!maskCanvas || maskCanvas.width !== S.imgW || maskCanvas.height !== S.imgH) {
      maskCanvas = document.createElement('canvas');
      maskCanvas.width = S.imgW;
      maskCanvas.height = S.imgH;
      maskCtx = maskCanvas.getContext('2d');
    }
  }

  // 把标签图渲染成带色叠加（只在掩码/选中变化时重建）
  function rebuildOverlay() {
    if (!S.img) return;
    ensureOverlayCanvas();
    var map = channelMap();
    var data = overlayCtx.createImageData(S.imgW, S.imgH);
    var buf = data.data;
    var activeIdx = partIndex(S.activeId);
    var colorCache = {};
    for (var i = 0; i < S.parts.length; i++) {
      if (S.parts[i].visible === false) continue;   // 隐藏的部件不上色
      colorCache[i + 1] = hexToRgba(S.parts[i].color, i + 1 === activeIdx ? 190 : 120);
    }
    for (var p = 0; p < map.length; p++) {
      var v = map[p];
      if (!v) continue;
      var col = colorCache[v];
      if (!col) continue;
      var o = p * 4;
      buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2]; buf[o + 3] = col[3];
    }
    overlayCtx.putImageData(data, 0, 0);
    S.overlayDirty = false;
  }

  function rebuildOutline() {
    S.outlineDirty = false;
    S.outlineCanvas = null;
    var idx = partIndex(S.activeId);
    if (!idx || !S.showOutline || !S.showMask) return;
    if (S.parts[idx - 1] && S.parts[idx - 1].visible === false) return;
    var map = channelMap();
    var w = S.imgW, h = S.imgH;
    var out = document.createElement('canvas');
    out.width = w; out.height = h;
    var c = out.getContext('2d');
    var data = c.createImageData(w, h);
    var col = C.hexToRgb(S.parts[idx - 1].color);
    var buf = data.data;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var p = y * w + x;
        if (map[p] !== idx) continue;
        var edge = (x === 0 || map[p - 1] !== idx) || (x === w - 1 || map[p + 1] !== idx) ||
                   (y === 0 || map[p - w] !== idx) || (y === h - 1 || map[p + w] !== idx);
        if (!edge) continue;
        var o = p * 4;
        buf[o] = 255; buf[o + 1] = 255; buf[o + 2] = 255; buf[o + 3] = 235;
      }
    }
    c.putImageData(data, 0, 0);
    S.outlineCanvas = out;
  }

  // 图层可见性：隐藏部件时从底图里抠掉它（但不抠掉盖在它上面的可见件）
  // 一次遍历：label 图里每个像素的归属件如果被隐藏，就把该像素置空（棋盘格露出来）——
  // 像素归属唯一，所以“盖在上面的可见件”天然不会被抠掉。
  function rebuildVisibility() {
    S.visibilityDirty = false;
    S.visibilityCanvas = null;
    if (!S.img || !S.maps.visible) return;
    var anyHidden = false;
    for (var k = 0; k < S.parts.length; k++) {
      if (S.parts[k].visible === false) { anyHidden = true; break; }
    }
    if (!anyHidden || !S.parts.length) return;
    var w = S.imgW, h = S.imgH, map = S.maps.visible;
    var hiddenFlags = new Uint8Array(S.parts.length + 1);   // 下标 = 标签值
    S.parts.forEach(function (p, i) { if (p.visible === false) hiddenFlags[i + 1] = 1; });
    var cvs = document.createElement('canvas');
    cvs.width = w; cvs.height = h;
    var c = cvs.getContext('2d');
    c.drawImage(S.img, 0, 0);
    var img = c.getImageData(0, 0, w, h);
    var buf = img.data;
    for (var i = 0, n = map.length; i < n; i++) {
      var v = map[i];
      if (!v || !hiddenFlags[v]) continue;
      var o = i * 4;
      buf[o] = 0; buf[o + 1] = 0; buf[o + 2] = 0; buf[o + 3] = 0;
    }
    c.putImageData(img, 0, 0);
    S.visibilityCanvas = cvs;
  }

  function render() {
    if (!ctx) return;
    var w = cv.width / dpr, h = cv.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // 棋盘底
    if (checker) {
      var pat = ctx.createPattern(checker, 'repeat');
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = '#20242e';
      ctx.fillRect(0, 0, w, h);
    }
    if (!S.img) return;

    var iw = S.imgW * S.zoom, ih = S.imgH * S.zoom;
    ctx.imageSmoothingEnabled = S.zoom < 2;
    if (S.showBase) {
      if (S.visibilityDirty) rebuildVisibility();
      ctx.drawImage(S.visibilityCanvas || S.img, S.tx, S.ty, iw, ih);
    }
    if (S.showMask) {
      if (S.overlayDirty) rebuildOverlay();
      if (S.outlineDirty) rebuildOutline();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(overlayCanvas, S.tx, S.ty, iw, ih);
      if (S.outlineCanvas) ctx.drawImage(S.outlineCanvas, S.tx, S.ty, iw, ih);
    }
    if (S.showIssues && S.issues.length) {
      if (S.issueOverlayDirty) rebuildIssueOverlay();
      if (issueCanvas) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(issueCanvas, S.tx, S.ty, iw, ih);
      }
    }

    // 选区预览
    if (S.selection) {
      ctx.save();
      ctx.strokeStyle = '#5aa9ff';
      ctx.fillStyle = 'rgba(90,169,255,0.12)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      if (S.selection.type === 'rect') {
        var r = S.selection;
        var a = imageToScreen(r.x0, r.y0), b = imageToScreen(r.x1, r.y1);
        ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      } else if (S.selection.type === 'poly' && S.selection.points.length) {
        ctx.beginPath();
        var p0 = imageToScreen(S.selection.points[0].x, S.selection.points[0].y);
        ctx.moveTo(p0.x, p0.y);
        for (var i = 1; i < S.selection.points.length; i++) {
          var p = imageToScreen(S.selection.points[i].x, S.selection.points[i].y);
          ctx.lineTo(p.x, p.y);
        }
        if (S.hover) {
          var hp = imageToScreen(S.hover.x, S.hover.y);
          ctx.lineTo(hp.x, hp.y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // 画笔光标
    if ((S.tool === 'brush' || S.tool === 'eraser') && S.hover) {
      var c = imageToScreen(S.hover.x, S.hover.y);
      ctx.save();
      ctx.strokeStyle = '#ffffffcc';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(2, S.brushSize * S.zoom / 2), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- 部件
  function partById(id) {
    for (var i = 0; i < S.parts.length; i++) if (S.parts[i].id === id) return S.parts[i];
    return null;
  }
  function sortedParts() {
    return S.parts.slice().sort(function (a, b) { return b.z - a.z; });
  }
  function createPart(name, color) {
    var id = C.normalizeId(name || ('part-' + (S.parts.length + 1)), S.parts.map(function (p) { return p.id; }));
    var part = {
      id: id,
      name: name || id,
      color: color || C.paletteColor(S.parts.length),
      z: S.nextZ++,
      note: '',
      visible: true
    };
    S.parts.push(part);
    S.activeId = part.id;
    S.outlineDirty = true;
    S.overlayDirty = true;
    setDirty(true);
    renderParts();
    scheduleRender();
    return part;
  }
  function deletePart(part) {
    var idx = partIndex(part.id);
    if (!idx) return;
    if (!confirm('删除部件「' + part.name + '」？它的像素会变为未标注（可用撤销恢复）。')) return;
    snapshotAll();
    S.parts.splice(idx - 1, 1);
    remapLabelsAfterDelete(idx);
    if (S.activeId === part.id) S.activeId = S.parts.length ? S.parts[0].id : null;
    S.overlayDirty = true; S.outlineDirty = true;
    setDirty(true);
    renderParts(); scheduleRender();
    msg('已删除部件 ' + part.name);
  }
  function remapLabelsAfterDelete(idx) {
    ['visible', 'hidden'].forEach(function (ch) {
      var map = S.maps[ch];
      if (!map) return;
      for (var i = 0; i < map.length; i++) {
        var v = map[i];
        if (v === idx) map[i] = 0;
        else if (v > idx) map[i] = v - 1;
      }
    });
  }
  function mergePart(source, target) {
    if (!source || !target || source.id === target.id) return;
    var si = partIndex(source.id), ti = partIndex(target.id);
    if (!si || !ti) return;
    snapshotAll();
    ['visible', 'hidden'].forEach(function (ch) {
      var map = S.maps[ch];
      if (!map) return;
      for (var i = 0; i < map.length; i++) if (map[i] === si) map[i] = ti;
    });
    S.parts.splice(si - 1, 1);
    if (si < ti) ti -= 1;
    remapLabelsAfterDelete(si); // 先移除索引，再修正 >si 的编号
    renumberParts();
    S.activeId = target.id;
    S.overlayDirty = true; S.outlineDirty = true;
    setDirty(true);
    renderParts(); scheduleRender();
    msg('已把 ' + source.name + ' 合并到 ' + target.name);
  }
  function renumberParts() {
    // 保证 z 唯一且按数组顺序递增；列表按 z 倒序显示
    S.parts.forEach(function (p, i) { p.z = i + 1; });
    S.nextZ = S.parts.length + 1;
  }
  function moveZ(part, dir) {
    var list = sortedParts();
    var idx = list.indexOf(part);
    var swap = idx + dir;
    if (swap < 0 || swap >= list.length) return;
    var other = list[swap];
    var tmp = part.z; part.z = other.z; other.z = tmp;
    setDirty(true); renderParts(); scheduleRender();
  }

  function renderParts() {
    var list = $('#partList');
    var q = ($('#partSearch').value || '').trim().toLowerCase();
    var rows = sortedParts().filter(function (p) {
      return !q || p.name.toLowerCase().indexOf(q) >= 0 || p.id.indexOf(q) >= 0;
    });
    list.innerHTML = '';
    rows.forEach(function (p) {
      var idx = partIndex(p.id);
      var count = 0;
      ['visible', 'hidden'].forEach(function (ch) {
        var m = S.maps[ch]; if (!m) return;
        for (var i = 0; i < m.length; i++) if (m[i] === idx) count++;
      });
      var li = document.createElement('li');
      li.className = 'part-row' + (p.id === S.activeId ? ' selected' : '');
      li.setAttribute('role', 'option');
      li.dataset.id = p.id;
      li.innerHTML =
        '<span class="chip" style="background:' + p.color + '"></span>' +
        '<span class="pname"></span>' +
        '<span class="ppx mono">' + (count >= 10000 ? (Math.round(count / 1000) + 'k') : count) + '</span>' +
        '<button class="eye' + (p.visible ? '' : ' off') + '" type="button" title="显示/隐藏（不影响导出）">' +
          '<svg class="ic"><use href="#' + (p.visible ? 'i-eye' : 'i-eye-off') + '"></use></svg></button>' +
        '<button class="zbtn" type="button" data-z="1" title="上移一层">▲</button>' +
        '<button class="zbtn" type="button" data-z="-1" title="下移一层">▼</button>';
      li.querySelector('.pname').textContent = p.name;
      li.addEventListener('click', function (ev) {
        if (ev.target.closest('.eye')) {
          p.visible = !p.visible;
          S.overlayDirty = true; S.outlineDirty = true; S.visibilityDirty = true;
          renderParts(); scheduleRender();
          ev.stopPropagation(); return;
        }
        var zb = ev.target.closest('.zbtn');
        if (zb) { moveZ(p, Number(zb.dataset.z)); ev.stopPropagation(); return; }
        selectPart(p.id);
      });
      list.appendChild(li);
    });
    $('#partsCount').textContent = S.parts.length + ' 件';
    if (!S.parts.length) {
      var empty = document.createElement('li');
      empty.className = 'part-row dim';
      empty.textContent = '还没有部件 —— 点「新建」或载入现有拆分件';
      list.appendChild(empty);
    }
    updateInspector();
  }

  function selectPart(id) {
    S.activeId = id;
    S.outlineDirty = true;
    S.overlayDirty = true;
    renderParts();
    scheduleRender();
  }

  function updateInspector() {
    var p = activePart();
    $('#activePartId').textContent = p ? p.id : '—';
    if (!p) return;
    $('#partName').value = p.name;
    $('#partId').value = p.id;
    $('#partColor').value = p.color;
    $('#partNote').value = p.note || '';
    var idx = partIndex(p.id);
    var count = 0;
    ['visible', 'hidden'].forEach(function (ch) {
      var m = S.maps[ch]; if (!m) return;
      for (var i = 0; i < m.length; i++) if (m[i] === idx) count++;
    });
    $('#statPx').textContent = count.toLocaleString();
    $('#statPct').textContent = S.imgW ? (100 * count / (S.imgW * S.imgH)).toFixed(2) + '%' : '—';
    $('#statZ').textContent = p.z;
    $('#statChannel').textContent = S.channel;
  }

  // ---------------------------------------------------------------- 问题标注（issues）
  function issueDefs() { return window.PartAnnotatorBundle || {}; }
  function issueColor(type) {
    var d = issueDefs();
    return (d.ISSUE_COLORS && d.ISSUE_COLORS[type]) || '#adb5bd';
  }
  function issueLabel(type) {
    var d = issueDefs();
    return (d.ISSUE_LABELS && d.ISSUE_LABELS[type]) || type;
  }
  function activeIssue() {
    for (var i = 0; i < S.issues.length; i++) if (S.issues[i].id === S.activeIssueId) return S.issues[i];
    return null;
  }
  function newIssueId() {
    var used = {};
    S.issues.forEach(function (it) { used[it.id] = 1; });
    var n = 1;
    while (used['issue-' + n]) n++;
    return 'issue-' + n;
  }
  function createIssue(opts) {
    if (!S.img) { msg('先载入原立绘/拆件包'); return null; }
    var o = opts || {};
    var pid = o.partId !== undefined ? o.partId : (S.activeId || '');
    var it = {
      id: newIssueId(),
      type: o.type || 'edge-missing',
      severity: o.severity || 2,
      partId: pid,
      beforePartId: o.beforePartId !== undefined ? o.beforePartId : pid,
      note: o.note || '',
      masks: { region: C.createLabelMap(S.imgW, S.imgH), before: null, after: null },
      createdAt: new Date().toISOString()
    };
    S.issues.push(it);
    S.activeIssueId = it.id;
    S.issueOverlayDirty = true;
    setDirty(true);
    setIssueTarget('region');
    // 有部件时，默认把「改动前」指向当前关联件（= 直接用该件可见区，不用画）
    var filled = false;
    if (S.parts.length && it.beforePartId) {
      filled = setIssueBeforeFromPart(it, it.beforePartId, { silent: true });
    }
    renderIssues();
    scheduleRender();
    var bp = filled ? partById(it.beforePartId) : null;
    msg('已新建问题 ' + it.id + '（' + issueLabel(it.type) + '）' +
      (bp ? '；改动前 = ' + bp.name : '；还没有拆分部件，先载入现有拆分件才能指定「改动前件」') +
      '。用矩形 / 多边形 / 魔法棒框选「问题位置」，可多次累加');
    return it;
  }
  function deleteIssue(it) {
    if (!it) return;
    if (!confirm('删除问题「' + it.id + ' · ' + issueLabel(it.type) + '」？')) return;
    var idx = S.issues.indexOf(it);
    if (idx >= 0) S.issues.splice(idx, 1);
    if (S.activeIssueId === it.id) S.activeIssueId = S.issues.length ? S.issues[0].id : null;
    S.issueOverlayDirty = true;
    setDirty(true);
    renderIssues();
    scheduleRender();
    msg('已删除 ' + it.id);
  }
  function ensureIssueMask(it, target) {
    if (!it.masks[target]) it.masks[target] = C.createLabelMap(S.imgW, S.imgH);
    return it.masks[target];
  }
  function issueTargetMap() {
    var it = activeIssue();
    if (!it) return null;
    return ensureIssueMask(it, S.issueTarget);
  }
  function maskCount(map) {
    if (!map) return 0;
    var n = 0;
    for (var i = 0; i < map.length; i++) if (map[i]) n++;
    return n;
  }
  function issueBBox(it) {
    var b = C.bboxOfValue(it.masks.region, S.imgW, S.imgH, 1);
    if (!b) return null;
    return [b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0];
  }
  // 每类目标里的“块”数（一个问题位置可以是多块不相邻的选区）
  function issueBlocks(it) {
    if (!it) return { region: 0, before: 0, after: 0 };
    return {
      region: it.masks.region ? C.countComponents(it.masks.region, S.imgW, S.imgH, 1) : 0,
      before: it.masks.before ? C.countComponents(it.masks.before, S.imgW, S.imgH, 1) : 0,
      after: it.masks.after ? C.countComponents(it.masks.after, S.imgW, S.imgH, 1) : 0
    };
  }
  function fmtPx(n, blocks) {
    var s = (n || 0).toLocaleString();
    return blocks > 1 ? s + ' · ' + blocks + ' 块' : s;
  }
  function unionBox(a, b) {
    if (!a) return b;
    if (!b) return a;
    return {
      x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
      x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1)
    };
  }
  // 画布某点最上层的已拆分部件（visible 优先，其次 hidden 补全通道）
  function pickPartAt(x, y) {
    if (!(x >= 0 && x < S.imgW && y >= 0 && y < S.imgH)) return null;
    var i = y * S.imgW + x;
    var chans = ['visible', 'hidden'];
    for (var c = 0; c < chans.length; c++) {
      var m = S.maps[chans[c]];
      if (!m) continue;
      var v = m[i];
      if (v > 0 && S.parts[v - 1]) return S.parts[v - 1];
    }
    return null;
  }
  // 「改动前」= 直接指定一个已拆分部件：before 掩码由该件的可见区像素生成（可撤销、可清空）
  function setIssueBeforeFromPart(it, partId, opts) {
    if (!it) { msg('先在「问题」页新建或选中一个问题'); return false; }
    var idx = partIndex(partId);
    if (!idx) { msg('「改动前」要指向一个已拆分的部件：先载入现有拆分件，再点画布或下拉选一件'); return false; }
    var p = S.parts[idx - 1];
    var src = S.maps.visible;
    if (!src) { msg('还没有可见区掩码'); return false; }
    var map = ensureIssueMask(it, 'before');
    var newBox = C.bboxOfValue(src, S.imgW, S.imgH, idx);
    var oldBox = C.bboxOfValue(map, S.imgW, S.imgH, 1);
    var box = unionBox(oldBox, newBox);
    if (box) {
      var beforeRegion = C.extractRegion(map, S.imgW, box);
      C.drawRect(map, S.imgW, S.imgH, box.x0, box.y0, box.x1, box.y1, 0);
      if (newBox) {
        for (var y = newBox.y0; y < newBox.y1; y++) {
          for (var x = newBox.x0; x < newBox.x1; x++) {
            var i = y * S.imgW + x;
            if (src[i] === idx) map[i] = 1;
          }
        }
      }
      var afterRegion = C.extractRegion(map, S.imgW, box);
      pushUndo({
        type: 'issueRegion', issueId: it.id, target: 'before',
        diff: { x0: box.x0, y0: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0, before: beforeRegion, after: afterRegion }
      });
    }
    it.beforePartId = partId;
    if (!it.partId) it.partId = partId;
    S.issueOverlayDirty = true;
    setDirty(true);
    renderIssues();
    scheduleRender();
    if (!(opts && opts.silent)) {
      msg('「改动前」= ' + p.name + '（' + p.id + '）：用它的可见区 ' + maskCount(map).toLocaleString() + ' px 作为改动前区域（不用画选区）');
    }
    return true;
  }
  function clearIssueBefore(it) {
    if (!it) { msg('先选中一个问题'); return; }
    var map = it.masks.before;
    var box = map ? C.bboxOfValue(map, S.imgW, S.imgH, 1) : null;
    it.beforePartId = null;
    if (box) {
      var beforeRegion = C.extractRegion(map, S.imgW, box);
      C.drawRect(map, S.imgW, S.imgH, box.x0, box.y0, box.x1, box.y1, 0);
      var afterRegion = C.extractRegion(map, S.imgW, box);
      pushUndo({
        type: 'issueRegion', issueId: it.id, target: 'before',
        diff: { x0: box.x0, y0: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0, before: beforeRegion, after: afterRegion }
      });
    }
    S.issueOverlayDirty = true;
    setDirty(true);
    renderIssues();
    scheduleRender();
    msg('已清除「改动前」');
  }
  function setIssueTarget(t) {
    if (t === 'before' && !S.parts.length) {
      msg('还没有拆分部件：「改动前」要直接选一件（先「载入现有拆分件」或打开拆件包）');
      return;
    }
    if (S.tool !== 'select') S.lastPaintTool = S.tool;
    S.issueTarget = t;
    $$('.segbtn').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.target === t ? 'true' : 'false'); });
    if (t === 'before') {
      if (S.tool !== 'select') setTool('select');
      msg('「改动前」= 直接点画布上的某个拆分部件（或右侧「改动前件」下拉），表示问题发生在哪一件；不用画选区');
    } else {
      if (S.tool === 'select') setTool(S.lastPaintTool || 'rect');
      msg((t === 'region' ? '「问题位置」' : '「改动后」') + '：矩形 / 多边形 / 魔法棒都能用，选多少次都累加（可多块）；切走就停止添加');
    }
    updateIssueInspector();
    scheduleRender();
  }
  function updateIssueInspector() {
    var it = activeIssue();
    $('#activeIssueId').textContent = it ? it.id : '—';
    // 改动前件下拉：先按部件表重建（与有没有选中问题无关）
    var bsel = $('#issueBeforePart');
    bsel.innerHTML = S.parts.length
      ? '<option value="">（未指定）</option>'
      : '<option value="">（先载入拆分件）</option>';
    sortedParts().forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name + ' (' + p.id + ')';
      bsel.appendChild(opt);
    });
    bsel.disabled = !S.parts.length;
    $('#btnBeforePick').disabled = !S.parts.length;
    if (!it) {
      $('#issuePxRegion').textContent = '0';
      $('#issuePxBefore').textContent = '0';
      $('#issuePxAfter').textContent = '0';
      $('#issuePxTotal').textContent = '0';
      $('#beforePartState').textContent = S.parts.length ? '（未指定）' : '（先载入拆分件）';
      bsel.value = '';
      $('#btnBeforeClear').disabled = true;
      return;
    }
    var r = maskCount(it.masks.region), b = maskCount(it.masks.before), a = maskCount(it.masks.after);
    var blocks = issueBlocks(it);
    $('#issuePxRegion').textContent = fmtPx(r, blocks.region);
    $('#issuePxBefore').textContent = b.toLocaleString();
    $('#issuePxAfter').textContent = fmtPx(a, blocks.after);
    $('#issuePxTotal').textContent = (r + b + a).toLocaleString();
    $('#issueType').value = it.type;
    $('#issueSeverity').value = String(it.severity);
    $('#issueNote').value = it.note || '';
    var sel = $('#issuePart');
    sel.innerHTML = '<option value="">（未关联部件）</option>';
    sortedParts().forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name + ' (' + p.id + ')';
      sel.appendChild(opt);
    });
    sel.value = it.partId || '';
    bsel.value = it.beforePartId || '';
    var bp = it.beforePartId ? partById(it.beforePartId) : null;
    $('#beforePartState').textContent = S.parts.length
      ? (bp ? bp.name + ' · 可见区 ' + b.toLocaleString() + ' px' : '（未指定：点画布或选下拉）')
      : '（先载入拆分件）';
    $('#btnBeforeClear').disabled = !it.beforePartId && !b;
  }
  function renderIssues() {
    var list = $('#issueList');
    list.innerHTML = '';
    S.issues.forEach(function (it) {
      var li = document.createElement('li');
      li.className = 'part-row issue-row' + (it.id === S.activeIssueId ? ' selected' : '');
      li.setAttribute('role', 'option');
      li.innerHTML =
        '<span class="chip" style="background:' + issueColor(it.type) + '"></span>' +
        '<span class="pname"></span>' +
        '<span class="itype">' + (it.severity === 3 ? '高' : it.severity === 1 ? '低' : '中') + '</span>' +
        '<span class="ppx mono">' + maskCount(it.masks.region) + '</span>';
      li.querySelector('.pname').textContent = issueLabel(it.type) + (it.partId ? ' · ' + it.partId : '');
      li.addEventListener('click', function () {
        S.activeIssueId = it.id;
        S.issueOverlayDirty = true;
        renderIssues();
        scheduleRender();
      });
      list.appendChild(li);
    });
    if (!S.issues.length) {
      var empty = document.createElement('li');
      empty.className = 'part-row dim';
      empty.textContent = '还没有问题 —— 点「新建问题」，再框选问题区域';
      list.appendChild(empty);
    }
    $('#issuesCount').textContent = S.issues.length + ' 条';
    updateIssueInspector();
  }
  function rebuildIssueOverlay() {
    S.issueOverlayDirty = false;
    if (!S.img) return;
    if (!issueCanvas || issueCanvas.width !== S.imgW || issueCanvas.height !== S.imgH) {
      issueCanvas = document.createElement('canvas');
      issueCanvas.width = S.imgW; issueCanvas.height = S.imgH;
      issueCtx = issueCanvas.getContext('2d');
    }
    var data = issueCtx.createImageData(S.imgW, S.imgH);
    var buf = data.data;
    var active = S.activeIssueId;
    function paint(map, hex, alpha) {
      if (!map) return;
      var c = C.hexToRgb(hex);
      for (var i = 0; i < map.length; i++) {
        if (!map[i]) continue;
        var o = i * 4;
        buf[o] = c.r; buf[o + 1] = c.g; buf[o + 2] = c.b; buf[o + 3] = alpha;
      }
    }
    S.issues.forEach(function (it) {
      paint(it.masks.region, issueColor(it.type), it.id === active ? 165 : 70);
    });
    var it = activeIssue();
    if (it) {
      paint(it.masks.before, '#5aa9ff', 100);
      paint(it.masks.after, '#4ec9a5', 100);
      paint(it.masks.region, issueColor(it.type), 170);
    }
    issueCtx.putImageData(data, 0, 0);
  }
  function setMode(m) {
    S.mode = m;
    $$('.mode').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.mode === m ? 'true' : 'false'); });
    S.selection = null;
    updateSelectionBar();
    switchTab(m === 'issues' ? 'issues' : 'parts');
    if (m === 'issues') {
      msg('问题标注：先新建/选中问题 → 用矩形 / 多边形 / 魔法棒框「问题位置」（可多次累加）；「改动前」直接点选拆分部件，「改动后」同样可多次框选');
    } else {
      msg('部件标注模式：选中部件后框选，把可见区归给该件');
    }
    scheduleRender();
  }
  function eraseIssueSelection() {
    var it = activeIssue();
    if (!it) return;
    if (S.issueTarget === 'before') { msg('「改动前」不画选区：直接点画布上的部件（或下拉「改动前件」）'); return; }
    var bbox = currentSelectionBbox();
    if (!bbox) return;
    var map = issueTargetMap();
    var before = C.extractRegion(map, S.imgW, bbox);
    if (S.selection.type === 'rect') {
      C.drawRect(map, S.imgW, S.imgH, S.selection.x0, S.selection.y0, S.selection.x1, S.selection.y1, 0);
    } else if (S.selection.type === 'poly' && S.selection.points.length >= 3) {
      C.fillPolygon(map, S.imgW, S.imgH, S.selection.points, 0);
    }
    var after = C.extractRegion(map, S.imgW, bbox);
    pushUndo({
      type: 'issueRegion', issueId: it.id, target: S.issueTarget,
      diff: { x0: Math.floor(bbox.x0), y0: Math.floor(bbox.y0), w: Math.ceil(bbox.x1) - Math.floor(bbox.x0), h: Math.ceil(bbox.y1) - Math.floor(bbox.y0), before: before, after: after }
    });
    S.selection = null;
    S.issueOverlayDirty = true;
    setDirty(true);
    updateSelectionBar();
    renderIssues();
    scheduleRender();
    var left = maskCount(map);
    msg('已从「' + (S.issueTarget === 'region' ? '问题位置' : '改动后') + '」擦除选区：剩 ' + left.toLocaleString() + ' px');
  }

  function applyIssueSelection() {
    var it = activeIssue();
    if (!it) { msg('先在「问题」页新建或选中一个问题'); return; }
    if (S.issueTarget === 'before') { msg('「改动前」不画选区：直接点画布上的部件（或下拉「改动前件」）'); return; }
    var bbox = currentSelectionBbox();
    if (!bbox) return;
    var map = issueTargetMap();
    var pxBefore = maskCount(map);
    var before = C.extractRegion(map, S.imgW, bbox);
    if (S.selection.type === 'rect') {
      C.drawRect(map, S.imgW, S.imgH, S.selection.x0, S.selection.y0, S.selection.x1, S.selection.y1, 1);
    } else if (S.selection.type === 'poly' && S.selection.points.length >= 3) {
      C.fillPolygon(map, S.imgW, S.imgH, S.selection.points, 1);
    }
    var after = C.extractRegion(map, S.imgW, bbox);
    pushUndo({
      type: 'issueRegion', issueId: it.id, target: S.issueTarget,
      diff: { x0: Math.floor(bbox.x0), y0: Math.floor(bbox.y0), w: Math.ceil(bbox.x1) - Math.floor(bbox.x0), h: Math.ceil(bbox.y1) - Math.floor(bbox.y0), before: before, after: after }
    });
    S.selection = null;
    S.issueOverlayDirty = true;
    setDirty(true);
    updateSelectionBar();
    renderIssues();
    scheduleRender();
    var pxAfter = maskCount(map);
    var blocks = C.countComponents(map, S.imgW, S.imgH, 1);
    msg('已累加「' + (S.issueTarget === 'region' ? '问题位置' : '改动后') + '」选区：+' +
      (pxAfter - pxBefore).toLocaleString() + ' px，累计 ' + pxAfter.toLocaleString() + ' px' +
      (blocks > 1 ? '（' + blocks + ' 块）' : '') + '；可继续框选，切走即停止添加');
  }

  // ---------------------------------------------------------------- 撤销
  function pushUndo(entry) {
    S.undo.push(entry);
    if (S.undo.length > 40) S.undo.shift();
    S.redo.length = 0;
  }
  function snapshotAll() {
    pushUndo({
      type: 'all',
      maps: { visible: S.maps.visible ? S.maps.visible.slice() : null, hidden: S.maps.hidden ? S.maps.hidden.slice() : null },
      parts: JSON.parse(JSON.stringify(S.parts)),
      activeId: S.activeId,
      nextZ: S.nextZ
    });
    setDirty(true);
  }
  function mutateRegion(channel, bbox, fn) {
    var map = S.maps[channel];
    var w = S.imgW;
    var x0 = clamp(Math.floor(bbox.x0), 0, S.imgW), y0 = clamp(Math.floor(bbox.y0), 0, S.imgH);
    var x1 = clamp(Math.ceil(bbox.x1), 0, S.imgW), y1 = clamp(Math.ceil(bbox.y1), 0, S.imgH);
    if (x1 <= x0 || y1 <= y0) return;
    var before = C.extractRegion(map, w, { x0: x0, y0: y0, x1: x1, y1: y1 });
    fn(map);
    var after = C.extractRegion(map, w, { x0: x0, y0: y0, x1: x1, y1: y1 });
    var diff = { x0: x0, y0: y0, w: x1 - x0, h: y1 - y0, before: before, after: after };
    pushUndo({ type: 'region', channel: channel, diff: diff });
  }
  function issueMapById(id, target) {
    for (var i = 0; i < S.issues.length; i++) {
      if (S.issues[i].id !== id) continue;
      var it = S.issues[i];
      if (target === 'region') return it.masks.region;
      return it.masks[target];
    }
    return null;
  }
  function undo() {
    var e = S.undo.pop();
    if (!e) { msg('没有可撤销的操作'); return; }
    if (e.type === 'all') {
      S.redo.push({ type: 'all', maps: { visible: S.maps.visible.slice(), hidden: S.maps.hidden ? S.maps.hidden.slice() : null }, parts: JSON.parse(JSON.stringify(S.parts)), activeId: S.activeId, nextZ: S.nextZ });
      S.maps.visible = e.maps.visible;
      S.maps.hidden = e.maps.hidden;
      S.parts = e.parts; S.activeId = e.activeId; S.nextZ = e.nextZ;
    } else if (e.type === 'issueRegion') {
      var imap = issueMapById(e.issueId, e.target);
      if (imap) C.applyDiff(imap, S.imgW, e.diff, 'before');
      S.issueOverlayDirty = true;
      S.redo.push(e);
    } else {
      var target = S.maps[e.channel];
      C.applyDiff(target, S.imgW, e.diff, 'before');
      S.redo.push(e);
    }
    afterHistory();
  }
  function redo() {
    var e = S.redo.pop();
    if (!e) { msg('没有可重做的操作'); return; }
    if (e.type === 'all') {
      S.undo.push({ type: 'all', maps: { visible: S.maps.visible.slice(), hidden: S.maps.hidden ? S.maps.hidden.slice() : null }, parts: JSON.parse(JSON.stringify(S.parts)), activeId: S.activeId, nextZ: S.nextZ });
      S.maps.visible = e.maps.visible; S.maps.hidden = e.maps.hidden;
      S.parts = e.parts; S.activeId = e.activeId; S.nextZ = e.nextZ;
    } else if (e.type === 'issueRegion') {
      var imap2 = issueMapById(e.issueId, e.target);
      if (imap2) C.applyDiff(imap2, S.imgW, e.diff, 'after');
      S.issueOverlayDirty = true;
      S.undo.push(e);
    } else {
      C.applyDiff(S.maps[e.channel], S.imgW, e.diff, 'after');
      S.undo.push(e);
    }
    afterHistory();
  }
  function afterHistory() {
    S.overlayDirty = true; S.outlineDirty = true; S.issueOverlayDirty = true; S.selection = null;
    setDirty(true); renderParts(); renderIssues(); updateSelectionBar(); scheduleRender();
  }

  // ---------------------------------------------------------------- 选区
  function currentSelectionBbox() {
    var s = S.selection;
    if (!s) return null;
    if (s.type === 'rect') return { x0: Math.min(s.x0, s.x1), y0: Math.min(s.y0, s.y1), x1: Math.max(s.x0, s.x1), y1: Math.max(s.y0, s.y1) };
    if (s.type === 'poly' && s.points.length >= 3) {
      var xs = s.points.map(function (p) { return p.x; }), ys = s.points.map(function (p) { return p.y; });
      return { x0: Math.min.apply(null, xs), y0: Math.min.apply(null, ys), x1: Math.max.apply(null, xs), y1: Math.max.apply(null, ys) };
    }
    return null;
  }
  function updateSelectionBar() {
    var bar = $('#selectionBar');
    var bbox = currentSelectionBbox();
    if (!S.selection || !bbox) { bar.hidden = true; return; }
    bar.hidden = false;
    var w = Math.round(bbox.x1 - bbox.x0), h = Math.round(bbox.y1 - bbox.y0);
    $('#selectionInfo').textContent = S.selection.type === 'rect'
      ? '矩形 ' + w + '×' + h + ' @' + Math.round(bbox.x0) + ',' + Math.round(bbox.y0)
      : '多边形 ' + S.selection.points.length + ' 顶点 · 包围盒 ' + w + '×' + h;
  }
  function rasterizeSelection(value) {
    var bbox = currentSelectionBbox();
    if (!bbox) return;
    var channel = S.channel;
    mutateRegion(channel, bbox, function (map) {
      if (S.selection.type === 'rect') {
        C.drawRect(map, S.imgW, S.imgH, S.selection.x0, S.selection.y0, S.selection.x1, S.selection.y1, value);
      } else if (S.selection.type === 'poly' && S.selection.points.length >= 3) {
        C.fillPolygon(map, S.imgW, S.imgH, S.selection.points, value);
      }
    });
    S.overlayDirty = true; S.outlineDirty = true;
    setDirty(true);
    renderParts(); scheduleRender();
  }
  function applySelection(mode) {
    if (!S.selection) { msg('先框选一个区域'); return; }
    var idx = partIndex(S.activeId);
    if (mode !== 'new' && !idx) { msg('先在右侧选中一个部件（或用「新建部件」）'); return; }
    if (mode === 'new') {
      var p = createPart(null);
      rasterizeSelection(partIndex(p.id));
      msg('用选区新建了部件 ' + p.name);
    } else if (mode === 'subtract') {
      rasterizeSelection(0);
      msg('已从 ' + activePart().name + ' 减去选区');
    } else {
      rasterizeSelection(idx);
      msg('已把选区赋给 ' + activePart().name);
    }
    S.selection = null;
    updateSelectionBar();
    scheduleRender();
  }
  function clearSelection() {
    S.selection = null;
    updateSelectionBar();
    scheduleRender();
  }

  // ---------------------------------------------------------------- 工具操作
  // 当前编辑目标：部件通道 或 当前问题的某个目标掩码
  function strokeContext() {
    if (S.mode === 'issues') {
      var it = activeIssue();
      if (!it) return null;
      return { kind: 'issue', map: issueTargetMap(), value: S.tool === 'brush' ? 1 : 0, issueId: it.id, target: S.issueTarget };
    }
    var idx = partIndex(S.activeId);
    if (!idx) return null;
    return { kind: 'parts', map: S.maps[S.channel], value: S.tool === 'brush' ? idx : 0, channel: S.channel };
  }

  function beginStroke(ev) {
    if (!S.img) return;
    var rect = cv.getBoundingClientRect();
    var pt = screenToImage(ev.clientX - rect.left, ev.clientY - rect.top);
    S.drag = { start: pt, last: pt, button: ev.button };
    if (ev.button === 1 || ev.button === 2 || ev.shiftKey === false) { /* noop */ }
    if (S.tool === 'select' || ev.button === 1 || spaceDown) {
      S.drag.mode = 'pan';
      S.drag.panStart = { x: S.tx, y: S.ty, sx: ev.clientX, sy: ev.clientY };
      cv.classList.add('panning');
      return;
    }
    if (S.tool === 'rect') {
      S.selection = { type: 'rect', x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
      updateSelectionBar();
    } else if (S.tool === 'poly') {
      if (!S.selection || S.selection.type !== 'poly') S.selection = { type: 'poly', points: [] };
      S.selection.points.push({ x: pt.x, y: pt.y });
      updateSelectionBar();
    } else if (S.tool === 'brush' || S.tool === 'eraser') {
      var cx = strokeContext();
      if (!cx) { msg(S.mode === 'issues' ? '先新建/选中一个问题' : '先选中一个部件'); return; }
      var bbox = C.drawBrush(cx.map, S.imgW, S.imgH, pt.x, pt.y, S.brushSize / 2, cx.value);
      // 记录整笔的 undo：起点区域在 pointerdown 里已截 before，这里只记区域
      S.drag.stroke = { kind: cx.kind, channel: cx.channel, issueId: cx.issueId, target: cx.target, map: cx.map, value: cx.value, points: [pt], start: pt, bbox: { x0: bbox.x0, y0: bbox.y0, x1: bbox.x1, y1: bbox.y1 } };
    }
  }

  function moveStroke(ev) {
    if (!S.img) return;
    var rect = cv.getBoundingClientRect();
    var pt = screenToImage(ev.clientX - rect.left, ev.clientY - rect.top);
    S.hover = pt;
    if (!S.drag) { scheduleRender(); return; }
    if (S.drag.mode === 'pan') {
      S.tx = S.drag.panStart.x + (ev.clientX - S.drag.panStart.sx);
      S.ty = S.drag.panStart.y + (ev.clientY - S.drag.panStart.sy);
      scheduleRender();
      return;
    }
    if (S.tool === 'rect' && S.selection && S.selection.type === 'rect') {
      S.selection.x1 = pt.x; S.selection.y1 = pt.y;
      updateSelectionBar(); scheduleRender();
    } else if (S.tool === 'brush' || S.tool === 'eraser') {
      if (!S.drag.stroke) return;
      var st = S.drag.stroke;
      var value = st.value;
      var last = st.points[st.points.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) < Math.max(0.5, S.brushSize / 4)) return;
      var bbox = C.drawBrushLine(st.map, S.imgW, S.imgH, last.x, last.y, pt.x, pt.y, S.brushSize / 2, st.value);
      st.points.push(pt);
      st.bbox.x0 = Math.min(st.bbox.x0, bbox.x0); st.bbox.y0 = Math.min(st.bbox.y0, bbox.y0);
      st.bbox.x1 = Math.max(st.bbox.x1, bbox.x1); st.bbox.y1 = Math.max(st.bbox.y1, bbox.y1);
      if (st.kind === 'issue') S.issueOverlayDirty = true; else S.overlayDirty = true;
      scheduleRender();
    } else {
      scheduleRender();
    }
  }

  function endStroke(ev) {
    if (!S.img) return;
    cv.classList.remove('panning');
    if (S.drag && S.drag.mode === 'pan') {
      var moved = Math.abs((ev.clientX - S.drag.panStart.sx)) + Math.abs((ev.clientY - S.drag.panStart.sy));
      if (moved < 4 && S.tool === 'select') {
        // 单击选择：取该像素最上层的部件
        var rect = cv.getBoundingClientRect();
        var pt = screenToImage(ev.clientX - rect.left, ev.clientY - rect.top);
        var x = Math.floor(pt.x), y = Math.floor(pt.y);
        if (x >= 0 && x < S.imgW && y >= 0 && y < S.imgH) {
          if (S.mode === 'issues' && S.issueTarget === 'before') {
            // 「改动前」= 直接点选一个已拆分部件，不画选区
            var it0 = activeIssue();
            var pp = pickPartAt(x, y);
            if (pp) setIssueBeforeFromPart(it0, pp.id);
            else msg('这里没有已拆分的部件（点在有部件的像素上，或在右侧「改动前件」下拉里选）');
            S.drag = null;
            return;
          }
          var map = channelMap();
          var v = map[y * S.imgW + x];
          if (v > 0) { selectPart(S.parts[v - 1].id); msg('选中 ' + S.parts[v - 1].name); }
          else { msg('该处未标注（可新建部件后框选）'); }
        }
      }
      S.drag = null; return;
    }
    if (S.tool === 'rect' && S.selection && S.selection.type === 'rect') {
      var bbox = currentSelectionBbox();
      if (bbox && bbox.x1 - bbox.x0 >= 1 && bbox.y1 - bbox.y0 >= 1) {
        if (S.mode === 'issues') applyIssueSelection();
        else if (S.autoAssign) applySelection('assign');
        else updateSelectionBar();
      } else {
        clearSelection();
      }
    } else if (S.tool === 'brush' || S.tool === 'eraser') {
      if (S.drag && S.drag.stroke) {
        var st = S.drag.stroke;
        var map = st.map;
        if (st.before) {
          var after = C.extractRegion(map, S.imgW, st.bbox);
          var diff = { x0: st.bbox.x0, y0: st.bbox.y0, w: st.bbox.x1 - st.bbox.x0, h: st.bbox.y1 - st.bbox.y0, before: st.before, after: after };
          if (st.kind === 'issue') pushUndo({ type: 'issueRegion', issueId: st.issueId, target: st.target, diff: diff });
          else pushUndo({ type: 'region', channel: st.channel, diff: diff });
        }
        if (st.kind === 'issue') { S.issueOverlayDirty = true; renderIssues(); }
        else { setDirty(true); renderParts(); }
      }
    } else if (S.tool === 'poly') {
      updateSelectionBar();
    }
    S.drag = null;
    S.overlayDirty = true; S.outlineDirty = true;
    scheduleRender();
  }

  // ---------------------------------------------------------------- 事件
  var spaceDown = false;
  function bindEvents() {
    cv.addEventListener('pointerdown', function (ev) {
      if (ev.button === 2) return;
      cv.setPointerCapture(ev.pointerId);
      if (S.tool === 'wand') { applyWand(ev); return; }
      if (S.tool === 'brush' || S.tool === 'eraser') {
        var cx = strokeContext();
        if (cx) {
          var rect = cv.getBoundingClientRect();
          var pt = screenToImage(ev.clientX - rect.left, ev.clientY - rect.top);
          var st = { kind: cx.kind, map: cx.map, channel: cx.channel, issueId: cx.issueId, target: cx.target, value: cx.value, points: [pt] };
          // 先算 bbox 与 before，再落第一笔（否则撤销回不到笔前）
          var bx0 = clamp(Math.floor(pt.x - S.brushSize / 2), 0, S.imgW);
          var by0 = clamp(Math.floor(pt.y - S.brushSize / 2), 0, S.imgH);
          var bx1 = clamp(Math.ceil(pt.x + S.brushSize / 2) + 1, 0, S.imgW);
          var by1 = clamp(Math.ceil(pt.y + S.brushSize / 2) + 1, 0, S.imgH);
          st.bbox = { x0: bx0, y0: by0, x1: bx1, y1: by1 };
          st.before = C.extractRegion(cx.map, S.imgW, st.bbox);
          C.drawBrush(cx.map, S.imgW, S.imgH, pt.x, pt.y, S.brushSize / 2, st.value);
          S.drag = { stroke: st, start: pt };
          if (st.kind === 'issue') S.issueOverlayDirty = true; else S.overlayDirty = true;
          setDirty(true);
          scheduleRender();
          return;
        }
      }
      beginStroke(ev);
    });
    cv.addEventListener('pointermove', function (ev) {
      var rect = cv.getBoundingClientRect();
      S.hover = screenToImage(ev.clientX - rect.left, ev.clientY - rect.top);
      if (!S.drag) { if (S.tool === 'poly' || S.tool === 'brush' || S.tool === 'eraser') scheduleRender(); return; }
      moveStroke(ev);
    });
    cv.addEventListener('pointerup', function (ev) { endStroke(ev); });
    cv.addEventListener('pointercancel', function () { S.drag = null; });
    cv.addEventListener('pointerleave', function () { S.hover = null; scheduleRender(); });
    cv.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
    stage.addEventListener('contextmenu', function (ev) {
      ev.preventDefault();
      showContextMenu(ev.clientX, ev.clientY);
    });
    document.addEventListener('pointerdown', function (ev) {
      if (ctxMenuEl && !ev.target.closest('.ctxmenu')) closeContextMenu();
    }, true);
    window.addEventListener('wheel', function () { closeContextMenu(); }, { passive: true });
    cv.addEventListener('dblclick', function (ev) {
      if (S.tool === 'poly' && S.selection && S.selection.type === 'poly') {
        ev.preventDefault();
        if (S.selection.points.length >= 3) {
          if (S.mode === 'issues') applyIssueSelection();
          else if (S.autoAssign) applySelection('assign');
          else updateSelectionBar();
        } else { clearSelection(); }
        scheduleRender();
      }
    });
    cv.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      if (!S.img) return;
      var rect = cv.getBoundingClientRect();
      var before = screenToImage(ev.clientX - rect.left, ev.clientY - rect.top);
      var factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
      S.zoom = clamp(S.zoom * factor, 0.02, 16);
      S.tx = ev.clientX - rect.left - before.x * S.zoom;
      S.ty = ev.clientY - rect.top - before.y * S.zoom;
      updateZoomLabel();
      scheduleRender();
    }, { passive: false });

    window.addEventListener('keydown', function (ev) {
      if (isEditableTarget(ev.target)) return;
      if (ev.code === 'Space') { spaceDown = true; cv.classList.add('pan'); return; }
      var k = ev.key.toLowerCase();
      if ((ev.ctrlKey || ev.metaKey) && k === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && k === 's') { ev.preventDefault(); saveBundle(true); return; }
      if ((ev.ctrlKey || ev.metaKey) && k === 's') { ev.preventDefault(); saveBundle(false); return; }
      if ((ev.ctrlKey || ev.metaKey) && k === 'o') { ev.preventDefault(); openSourceDialog(); return; }
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && k === 'n') { ev.preventDefault(); applySelection('new'); return; }
      if (k === 'enter') {
        if (S.selection && S.selection.type === 'poly') {
          if (S.selection.points.length >= 3) {
            if (S.mode === 'issues') applyIssueSelection();
            else applySelection('assign');
          } else clearSelection();
          scheduleRender();
        } else if (S.selection) {
          if (S.mode === 'issues') applyIssueSelection();
          else applySelection('assign');
        }
        return;
      }
      if (k === 'delete' || k === 'backspace') {
        if (S.selection) {
          ev.preventDefault();
          if (S.mode === 'issues') { eraseIssueSelection(); return; }
          applySelection('subtract');
          return;
        }
        if (S.tool === 'poly' && S.selection && S.selection.points.length) {
          S.selection.points.pop(); updateSelectionBar(); scheduleRender(); return;
        }
      }
      if (k === 'escape') { clearSelection(); closeContextMenu(); closeDialog(); return; }
      if (k === '?') { openHelp(); return; }
      if (k === 'f') { fitView(); return; }
      if (k === '+' || k === '=') { zoomBy(1.15); return; }
      if (k === '-') { zoomBy(1 / 1.15); return; }
      if (k === 'v') return setTool('select');
      if (k === 'r') return setTool('rect');
      if (k === 'p') return setTool('poly');
      if (k === 'b') return setTool('brush');
      if (k === 'e') return setTool('eraser');
      if (k === 'w') return setTool('wand');
      if (k === 'm') { $('#showMask').checked = !$('#showMask').checked; toggleShowMask($('#showMask').checked); return; }
      if (k === '[') { if (activePart()) moveZ(activePart(), -1); return; }
      if (k === ']') { if (activePart()) moveZ(activePart(), 1); return; }
    });
    window.addEventListener('keyup', function (ev) {
      if (ev.code === 'Space') { spaceDown = false; cv.classList.remove('pan'); }
    });
    window.addEventListener('resize', layoutCanvas);

    // 工具切换
    $$('.tool').forEach(function (btn) {
      btn.addEventListener('click', function () { setTool(btn.dataset.tool); });
    });
    $('#partSearch').addEventListener('input', renderParts);
    $('#btnAddPart').addEventListener('click', function () { createPart(); msg('已新建部件'); });
    $('#btnDeletePart').addEventListener('click', function () { var p = activePart(); if (p) deletePart(p); });
    $('#btnMerge').addEventListener('click', function () {
      var p = activePart();
      if (!p) { msg('先选中要保留的目标部件'); return; }
      openDialog('合并部件', '选择要合并进「' + p.name + '」的部件（像素会归到目标件，可用撤销恢复）：',
        S.parts.filter(function (q) { return q.id !== p.id; }).map(function (q) {
          return { label: q.name + ' (' + q.id + ')', meta: 'z=' + q.z, action: function () { mergePart(q, p); closeDialog(); } };
        }));
    });
    $('#partName').addEventListener('change', function () {
      var p = activePart(); if (!p) return;
      p.name = this.value.trim() || p.name;
      setDirty(true); renderParts();
    });
    $('#partColor').addEventListener('input', function () {
      var p = activePart(); if (!p) return;
      p.color = this.value;
      S.overlayDirty = true; S.outlineDirty = true; renderParts(); scheduleRender();
    });
    $('#partNote').addEventListener('change', function () {
      var p = activePart(); if (!p) return;
      p.note = this.value; setDirty(true);
    });
    $('#channel').addEventListener('change', function () {
      setChannel(this.value);
    });
    $('#selAssign').addEventListener('click', function () { applySelection('assign'); });
    $('#selSubtract').addEventListener('click', function () { applySelection('subtract'); });
    $('#selNew').addEventListener('click', function () { applySelection('new'); });
    $('#selClear').addEventListener('click', clearSelection);
    $('#brushSize').addEventListener('input', function () { S.brushSize = Number(this.value); $('#brushSizeV').textContent = this.value; });
    $('#tolerance').addEventListener('input', function () { S.tolerance = Number(this.value); $('#toleranceV').textContent = this.value; });
    $('#autoAssign').addEventListener('change', function () { S.autoAssign = this.checked; });
    $('#showMask').addEventListener('change', function () { toggleShowMask(this.checked); });
    $('#showOutline').addEventListener('change', function () { S.showOutline = this.checked; S.outlineDirty = true; scheduleRender(); });
    $('#showBase').addEventListener('change', function () { S.showBase = this.checked; scheduleRender(); });
    $('#showIssuesChk').addEventListener('change', function () { S.showIssues = this.checked; S.issueOverlayDirty = true; scheduleRender(); });
    $('#modeParts').addEventListener('click', function () { setMode('parts'); });
    $('#modeIssues').addEventListener('click', function () { setMode('issues'); });
    $('#btnAddIssue').addEventListener('click', function () { createIssue(); });
    $('#btnDeleteIssue').addEventListener('click', function () { deleteIssue(activeIssue()); });
    $('#issueType').addEventListener('change', function () {
      var it = activeIssue(); if (!it) return;
      it.type = this.value; S.issueOverlayDirty = true; setDirty(true); renderIssues(); scheduleRender();
    });
    $('#issueSeverity').addEventListener('change', function () {
      var it = activeIssue(); if (!it) return;
      it.severity = Number(this.value); setDirty(true); renderIssues();
    });
    $('#issuePart').addEventListener('change', function () {
      var it = activeIssue(); if (!it) return;
      it.partId = this.value; setDirty(true); renderIssues();
    });
    $('#issueNote').addEventListener('change', function () {
      var it = activeIssue(); if (!it) return;
      it.note = this.value; setDirty(true);
    });
    // 改动前件：下拉直接指定（等值于在画布上点该件）
    $('#issueBeforePart').addEventListener('change', function () {
      var it = activeIssue(); if (!it) return;
      if (this.value) setIssueBeforeFromPart(it, this.value);
      else clearIssueBefore(it);
    });
    $('#btnBeforePick').addEventListener('click', function () {
      var it = activeIssue();
      if (!it) { msg('先新建或选中一个问题'); return; }
      if (!S.parts.length) { msg('先载入现有拆分件，再选「改动前件」'); return; }
      if (S.issueTarget !== 'before') setIssueTarget('before');
      msg('在画布上点一下要指认的部件（当前问题 ' + it.id + '）');
    });
    $('#btnBeforeClear').addEventListener('click', function () { clearIssueBefore(activeIssue()); });
    $$('.segbtn').forEach(function (b) {
      b.addEventListener('click', function () { setIssueTarget(b.dataset.target); });
    });
    $('#btnFit').addEventListener('click', fitView);
    $('#btnZoomIn').addEventListener('click', function () { zoomBy(1.15); });
    $('#btnZoomOut').addEventListener('click', function () { zoomBy(1 / 1.15); });
    $('#btnSave').addEventListener('click', saveBundle);
    $('#btnPanel').addEventListener('click', function () { document.body.classList.toggle('drawer-open'); });
    $('#btnPanelClose').addEventListener('click', function () { document.body.classList.remove('drawer-open'); });
    $('#tabParts').addEventListener('click', function () { switchTab('parts'); });
    $('#tabIssues').addEventListener('click', function () { setMode('issues'); });
    $('#tabHelp').addEventListener('click', function () { switchTab('help'); });
    $('#dialogClose').addEventListener('click', closeDialog);
    $('#dialogCancel').addEventListener('click', closeDialog);

    // 菜单
    $$('.menubtn').forEach(function (btn) {
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var menu = $('#' + btn.getAttribute('aria-controls'));
        var open = btn.getAttribute('aria-expanded') === 'true';
        closeMenus();
        if (!open) { btn.setAttribute('aria-expanded', 'true'); menu.hidden = false; }
      });
    });
    document.addEventListener('click', function (ev) {
      if (!ev.target.closest('.menu-wrap')) closeMenus();
    });
    $$('[data-cmd]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cmd = btn.dataset.cmd;
        closeMenus();
        var map = {
          'load-source': openSourceDialog,
          'load-split': openSplitDialog,
          'open-project': openProjectDialog,
          'save': saveBundle,
          'load-bundle': openBundleDialog,
          'load-bundle-path': openBundleByPath,
          'save': function () { saveBundle(false); },
          'save-as': function () { saveBundle(true); },
          'export-zip': exportZip,
          'undo': undo,
          'redo': redo,
          'assign': function () { applySelection('assign'); },
          'subtract': function () { applySelection('subtract'); },
          'new-from-selection': function () { applySelection('new'); },
          'clear-selection': clearSelection,
          'fit': fitView,
          'zoom-in': function () { zoomBy(1.15); },
          'zoom-out': function () { zoomBy(1 / 1.15); },
          'actual': function () { S.zoom = 1; updateZoomLabel(); scheduleRender(); },
          'toggle-mask': function () { $('#showMask').checked = !$('#showMask').checked; toggleShowMask($('#showMask').checked); },
          'toggle-outline': function () { $('#showOutline').checked = !$('#showOutline').checked; S.showOutline = $('#showOutline').checked; S.outlineDirty = true; scheduleRender(); },
          'toggle-base': function () { $('#showBase').checked = !$('#showBase').checked; S.showBase = $('#showBase').checked; scheduleRender(); },
          'help': openHelp,
          'selftest': function () { window.open('selftest.html', '_blank'); }
        };
        if (map[cmd]) map[cmd]();
      });
    });

    // 空状态按钮
    $('#btnEmptyLoad').addEventListener('click', openSourceDialog);
    $('#btnEmptySplit').addEventListener('click', openSplitDialog);

    // 拖拽载入
    ['dragenter', 'dragover'].forEach(function (t) {
      stage.addEventListener(t, function (ev) { ev.preventDefault(); $('#dropHint').hidden = false; });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      stage.addEventListener(t, function (ev) { ev.preventDefault(); $('#dropHint').hidden = true; });
    });
    stage.addEventListener('drop', function (ev) {
      var f = ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (f) loadImageFile(f);
    });
    $('#dragFiles').addEventListener('change', function () {
      if (this.files[0]) loadImageFile(this.files[0]);
      this.value = '';
    });
  }

  function toggleShowMask(v) {
    S.showMask = v;
    if (v) S.overlayDirty = true;
    scheduleRender();
  }
  function setTool(t) {
    S.tool = t;
    $$('.tool').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.tool === t ? 'true' : 'false'); });
    cv.classList.toggle('pan', t === 'select');
    if (t !== 'poly') { /* 保留多边形选区？切换工具时清掉未闭合多边形 */ }
    if (t !== 'poly' && S.selection && S.selection.type === 'poly') clearSelection();
    // 在「改动前」目标下拿起绘制工具 → 自动切回「问题位置」（改动前只能点选部件）
    if (t !== 'select' && S.mode === 'issues' && S.issueTarget === 'before') {
      S.issueTarget = 'region';
      $$('.segbtn').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.target === 'region' ? 'true' : 'false'); });
      updateIssueInspector();
      msg('已切回「问题位置」：' + ({ rect: '矩形', poly: '多边形', brush: '画笔', eraser: '橡皮', wand: '魔法棒' }[t] || t) + '选区会累加到问题位置');
      scheduleRender();
      return;
    }
    scheduleRender();
    msg('工具：' + ({ select: '选择/平移', rect: '矩形选框', poly: '多边形套索', brush: '画笔', eraser: '橡皮', wand: '颜色魔法棒' })[t]);
  }
  function setChannel(ch) {
    S.channel = ch;
    if (ch === 'hidden' && !S.maps.hidden) {
      S.maps.hidden = C.createLabelMap(S.imgW, S.imgH);
    }
    S.overlayDirty = true; S.outlineDirty = true;
    updateInspector(); scheduleRender();
    msg('当前编辑通道：' + C.CHANNEL_LABEL[ch]);
  }
  function zoomBy(f) {
    if (!S.img) return;
    var w = stage.clientWidth / 2, h = stage.clientHeight / 2;
    var before = screenToImage(w, h);
    S.zoom = clamp(S.zoom * f, 0.02, 16);
    S.tx = w - before.x * S.zoom;
    S.ty = h - before.y * S.zoom;
    updateZoomLabel(); scheduleRender();
  }
  function closeMenus() {
    $$('.menubtn').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
    $$('.menu').forEach(function (m) { m.hidden = true; });
  }
  function switchTab(which) {
    ['parts', 'issues', 'help'].forEach(function (k) {
      var tab = $('#' + 'tab' + k.charAt(0).toUpperCase() + k.slice(1));
      if (!tab) return;
      tab.classList.toggle('active', which === k);
      tab.setAttribute('aria-selected', which === k ? 'true' : 'false');
    });
    $('#paneParts').hidden = which !== 'parts';
    $('#paneIssues').hidden = which !== 'issues';
    $('#paneHelp').hidden = which !== 'help';
  }
  function openHelp() {
    switchTab('help');
    document.body.classList.add('drawer-open');
  }

  // ---------------------------------------------------------------- 右键菜单
  var ctxMenuEl = null;
  function closeContextMenu() {
    if (ctxMenuEl) { ctxMenuEl.remove(); ctxMenuEl = null; }
  }
  function deselectPart() {
    S.activeId = null;
    S.outlineDirty = true; S.overlayDirty = true;
    renderParts(); scheduleRender();
    msg('已取消选中部件');
  }
  function deselectIssue() {
    S.activeIssueId = null;
    S.issueOverlayDirty = true;
    renderIssues(); scheduleRender();
    msg('已取消选中问题');
  }
  function showContextMenu(px, py) {
    closeContextMenu();
    var menu = document.createElement('div');
    menu.className = 'ctxmenu';
    menu.setAttribute('role', 'menu');
    function item(label, kbd, enabled, run) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.disabled = !enabled;
      var s = document.createElement('span');
      s.textContent = label;
      b.appendChild(s);
      if (kbd) { var k = document.createElement('kbd'); k.textContent = kbd; b.appendChild(k); }
      b.addEventListener('click', function () { closeContextMenu(); if (enabled) run(); });
      menu.appendChild(b);
    }
    function sep() { var d = document.createElement('div'); d.className = 'sep'; menu.appendChild(d); }
    var hasSel = !!S.selection;
    var hasPart = !!activePart();
    var hasIssue = !!activeIssue();
    item('取消选区', 'Esc', hasSel, clearSelection);
    if (S.mode === 'issues') item('取消选中问题', '', hasIssue, deselectIssue);
    else item('取消选中部件', '', hasPart, deselectPart);
    sep();
    if (S.mode === 'issues') {
      item('写入当前问题目标', 'Enter', hasSel && hasIssue, applyIssueSelection);
      item('从当前目标擦除', 'Del', hasSel && hasIssue, eraseIssueSelection);
    } else {
      item('赋给当前件', 'Enter', hasSel && hasPart, function () { applySelection('assign'); });
      item('从当前件减去', 'Del', hasSel && hasPart, function () { applySelection('subtract'); });
      item('用选区新建部件', 'Ctrl+Shift+N', hasSel, function () { applySelection('new'); });
    }
    sep();
    item('撤销', 'Ctrl+Z', S.undo.length > 0, undo);
    item('重做', 'Ctrl+Shift+Z', S.redo.length > 0, redo);
    sep();
    item(S.showIssues ? '隐藏问题层' : '显示问题层', 'I', S.issues.length > 0, function () {
      S.showIssues = !S.showIssues;
      $('#showIssuesChk').checked = S.showIssues;
      S.issueOverlayDirty = true; scheduleRender();
    });
    item('适配全部', 'F', !!S.img, fitView);
    item('保存拆件包', 'Ctrl+S', !!S.img, function () { saveBundle(false); });
    document.body.appendChild(menu);
    var rect = menu.getBoundingClientRect();
    var x = Math.min(px, window.innerWidth - rect.width - 8);
    var y = Math.min(py, window.innerHeight - rect.height - 8);
    menu.style.left = Math.max(4, x) + 'px';
    menu.style.top = Math.max(4, y) + 'px';
    ctxMenuEl = menu;
  }

  // ---------------------------------------------------------------- 对话框
  var dialogPick = null;
  function openDialog(title, desc, items, extra) {
    $('#dialogTitle').textContent = title;
    $('#dialogDesc').textContent = desc || '';
    var list = $('#dialogList');
    list.innerHTML = '';
    (items || []).forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'dialog-item';
      var lab = document.createElement('span'); lab.textContent = it.label;
      b.appendChild(lab);
      if (it.meta) { var m = document.createElement('span'); m.className = 'meta'; m.textContent = it.meta; b.appendChild(m); }
      b.addEventListener('click', function () { (it.action || function () {})(); });
      list.appendChild(b);
    });
    var localBtn = $('#dialogLocal');
    localBtn.hidden = !(extra && extra.localFile);
    localBtn.onclick = function () { $('#dialogFile').click(); };
    $('#dialogFile').onchange = function () {
      if (this.files[0] && extra && extra.onFile) extra.onFile(this.files[0]);
      this.value = '';
    };
    $('#dialog').hidden = false;
  }
  function closeDialog() { $('#dialog').hidden = true; }

  // ---------------------------------------------------------------- 载入
  function resetForImage(img, sourcePath) {
    S.img = img;
    S.imgW = img.naturalWidth || img.width;
    S.imgH = img.naturalHeight || img.height;
    S.sourcePath = sourcePath || '';
    S.maps.visible = C.createLabelMap(S.imgW, S.imgH);
    S.maps.hidden = null;
    S.channel = 'visible';
    S.parts = [];
    S.layerSources = {};
    S.visibilityDirty = true;
    S.visibilityCanvas = null;
    S.issues = [];
    S.activeIssueId = null;
    S.issueTarget = 'region';
    S.issueOverlayDirty = true;
    S.activeId = null;
    S.nextZ = 1;
    S.selection = null;
    S.undo = []; S.redo = [];
    S.projectDir = '';
    S.projectName = '';
    S.reportSource = '';
    // 取 base 像素供魔法棒
    var off = document.createElement('canvas');
    off.width = S.imgW; off.height = S.imgH;
    var c = off.getContext('2d');
    c.drawImage(img, 0, 0);
    S.basePixels = c.getImageData(0, 0, S.imgW, S.imgH).data;
    overlayCanvas = null; maskCanvas = null;
    S.overlayDirty = true; S.outlineDirty = true;
    $('#emptyState').hidden = true;
    $('#channel').value = 'visible';
    updateSelectionBar();
    renderParts();
    renderIssues();
    fitView();
    setDirty(false);
    msg('已载入 ' + S.imgW + '×' + S.imgH + '：' + (sourcePath || '本地文件') + '；右侧新建部件后开始框选');
  }

  function loadImageUrl(url, sourcePath) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resetForImage(img, sourcePath); resolve(img); };
      img.onerror = function () { reject(new Error('图片载入失败: ' + url)); };
      img.src = url;
    });
  }
  function loadImageFile(file) {
    var url = URL.createObjectURL(file);
    loadImageUrl(url, file.name).then(function () { URL.revokeObjectURL(url); })
      .catch(function (err) { msg(err.message); });
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
      return r.json();
    });
  }

  function openSourceDialog() {
    fetchJson('/api/sources').then(function (data) {
      var items = (data.sources || []).map(function (s) {
        return {
          label: s.label,
          meta: s.path,
          action: function () {
            loadImageUrl(repoUrl(s.path), s.path).then(function () {
              S.character = s.character || 'deepseek';
              S.view = s.view || 'front';
              closeDialog();
              msg('已载入原立绘 ' + s.path);
            }).catch(function (e) { msg(e.message); });
          }
        };
      });
      if (!items.length) items.push({ label: '没有在 assets/source/*/three-view 找到图片', meta: '可用本地文件选择', action: function () {} });
      openDialog('载入原立绘', '来自 assets/source/<角色>/three-view/ 的图片；也可以直接拖一张 PNG 进画布。', items, { localFile: true, onFile: function (f) { closeDialog(); loadImageFile(f); } });
    }).catch(function (e) {
      openDialog('载入原立绘', 'API 不可用（' + e.message + '），可直接选择本地图片。', [], { localFile: true, onFile: function (f) { closeDialog(); loadImageFile(f); } });
    });
  }

  function openSplitDialog() {
    var character = S.character || 'deepseek';
    fetchJson('/api/splits?character=' + encodeURIComponent(character)).then(function (data) {
      var items = (data.splits || []).map(function (sp) {
        return {
          label: sp.label,
          meta: sp.path,
          action: function () { closeDialog(); loadSplit(sp.path).catch(function (e) { msg(e.message); }); }
        };
      });
      if (!items.length) items.push({ label: '没找到 workspace/characters/' + character + '/output/parts/*/manifest.json', meta: '', action: function () {} });
      openDialog('载入现有拆分件', '按 manifest 的 z 序把每件 alpha 填成候选掩码；之后可以改错、挪像素、合并或拆分。', items);
    }).catch(function (e) { msg('载入拆分件失败：' + e.message); });
  }

  function openProjectDialog() {
    var character = S.character || 'deepseek';
    fetchJson('/api/projects?character=' + encodeURIComponent(character)).then(function (data) {
      var items = (data.projects || []).map(function (p) {
        return { label: p.label, meta: p.updatedAt || p.path, action: function () { closeDialog(); loadProject(p.path).catch(function (e) { msg(e.message); }); } };
      });
      if (!items.length) items.push({ label: '还没有已保存的工程', meta: '先标注并保存', action: function () {} });
      openDialog('打开本地标注工程', '来自 workspace/characters/' + character + '/annotation/*/annotations.json。', items);
    }).catch(function (e) { msg('打开工程失败：' + e.message); });
  }

  function dirname(path) { var i = path.lastIndexOf('/'); return i >= 0 ? path.slice(0, i) : ''; }
  // 仓库相对路径 → 站点根绝对 URL（页面在 /tools/part-annotator/ 下，必须加前导 /）
  function repoUrl(p) {
    if (!p) return p;
    if (/^(https?:|blob:|data:)/i.test(p)) return p;
    return '/' + String(p).replace(/^\/+/, '');
  }
  // 兼容省略 workspace/ 的写法：characters/... → workspace/characters/...
  function normalizeWorkspacePath(p) {
    if (!p) return p;
    var s = String(p).replace(/^\/+/, '');
    if (/^characters\//.test(s)) return 'workspace/' + s;
    return s;
  }

  function loadSplit(manifestPath) {
    manifestPath = normalizeWorkspacePath(manifestPath);
    msg('正在载入拆分件…');
    return fetchJson(repoUrl(manifestPath)).then(function (mf) {
      var view = mf.views ? Object.keys(mf.views)[0] : 'front';
      var views = mf.views || {};
      var v = views[view] || {};
      var parts = v.parts || [];
      var order = (v.composition && v.composition.backToFront) || parts.map(function (p) { return p.name; });
      var byName = {};
      parts.forEach(function (p) { byName[p.name] = p; });
      var baseDir = dirname(manifestPath);
      // 载入原图：manifest.base 指向 parts 目录里的 front/base_norm? 优先 source original
      var baseFile = (v.base && v.base.file) || '';
      var basePath = baseFile ? baseDir + '/' + baseFile : '';
      var character = mf.character || S.character || 'deepseek';
      S.character = character;
      S.view = view;
      var sourceGuess = 'assets/source/' + character + '/three-view/' + view + '.png';
      var imgPromise = basePath
        ? loadImageUrl(repoUrl(basePath), sourceGuess)
        : loadImageUrl(repoUrl(sourceGuess), sourceGuess).catch(function () { return null; });
      return imgPromise.then(function () {
        // 建立部件（z 从后到前递增；列表内 z 大=靠前）
        S.parts = [];
        S.nextZ = 1;
        S.maps.visible = C.createLabelMap(S.imgW, S.imgH);
        S.maps.hidden = null;
        var nameToPart = {};
        order.forEach(function (name) {
          var p = byName[name];
          if (!p) return;
          var idxName = name;
          var id = C.normalizeId(idxName, S.parts.map(function (q) { return q.id; }));
          var part = { id: id, name: name, color: C.paletteColor(S.parts.length), z: S.nextZ++, note: '', visible: true };
          S.parts.push(part);
          nameToPart[name] = part;
          S.layerSources[part.id] = baseDir + '/' + p.file;
        });
        S.activeId = S.parts.length ? S.parts[0].id : null;
        // 逐件把 alpha 填成候选掩码：后 → 前，靠前的覆盖靠后的（与可见归属一致）
        var chain = Promise.resolve();
        order.forEach(function (name) {
          var p = byName[name];
          if (!p) return;
          chain = chain.then(function () {
            var url = baseDir + '/' + p.file;
            return new Promise(function (resolve) {
              var im = new Image();
              im.onload = function () {
                var off = document.createElement('canvas');
                off.width = S.imgW; off.height = S.imgH;
                var c = off.getContext('2d');
                c.drawImage(im, 0, 0);
                var data = c.getImageData(0, 0, S.imgW, S.imgH).data;
                var idx = partIndex(nameToPart[name].id);
                var map = S.maps.visible;
                for (var i = 0, p4 = 0; i < map.length; i++, p4 += 4) {
                  if (data[p4 + 3] > C.MASK_ALPHA_THRESHOLD) map[i] = idx;
                }
                resolve();
              };
              im.onerror = function () { resolve(); };
              im.src = repoUrl(url);
            });
          });
        });
        return chain.then(function () {
          S.overlayDirty = true; S.outlineDirty = true;
          renderParts();
          S.zoom = Math.min((stage.clientWidth - 32) / S.imgW, (stage.clientHeight - 32) / S.imgH);
          fitView();
          setDirty(false);
          msg('已载入 ' + S.parts.length + ' 件候选掩码（来自 ' + manifestPath + '）—— 现在可以改语义');
        });
      });
    });
  }

  function loadProject(annotationsPath) {
    annotationsPath = normalizeWorkspacePath(annotationsPath);
    msg('正在打开标注工程…');
    return fetchJson('/api/project?path=' + encodeURIComponent(annotationsPath)).then(function (res) {
      var proj = res.project || {};
      var dir = res.dir || dirname(annotationsPath);
      var source = proj.source || ('assets/source/' + (proj.character || 'deepseek') + '/three-view/' + (proj.view || 'front') + '.png');
      return loadImageUrl(repoUrl(source), source).then(function () {
        S.character = proj.character || 'deepseek';
        S.view = proj.view || 'front';
        S.parts = (proj.parts || []).map(function (p) {
          return { id: p.id, name: p.name, color: p.color || C.paletteColor(0), z: p.z | 0, note: p.note || '', visible: true };
        });
        S.nextZ = S.parts.reduce(function (m, p) { return Math.max(m, p.z); }, 0) + 1;
        S.maps.visible = C.createLabelMap(S.imgW, S.imgH);
        S.maps.hidden = proj.channels && proj.channels.hidden ? C.createLabelMap(S.imgW, S.imgH) : null;
        S.projectDir = dir;
        S.projectName = dir.split('/').pop();
        S.activeId = S.parts.length ? S.parts[0].id : null;
        var chain = loadLabelPng(dir + '/label.png', S.maps.visible);
        if (S.maps.hidden) chain = chain.then(function () { return loadLabelPng(dir + '/label-hidden.png', S.maps.hidden); });
        return chain.then(function () {
          S.channel = 'visible';
          $('#channel').value = 'visible';
          renderParts();
          fitView();
          setDirty(false);
          msg('已打开工程 ' + annotationsPath + '（' + S.parts.length + ' 件）');
        });
      });
    });
  }

  function loadLabelPng(url, map) {
    return new Promise(function (resolve) {
      var im = new Image();
      im.onload = function () {
        var off = document.createElement('canvas');
        off.width = S.imgW; off.height = S.imgH;
        var c = off.getContext('2d');
        c.drawImage(im, 0, 0);
        var data = c.getImageData(0, 0, S.imgW, S.imgH).data;
        for (var i = 0; i < map.length; i++) {
          var o = i * 4;
          map[i] = data[o + 3] > 127 ? clamp(data[o], 0, 255) : 0; // R = 索引，A>0 表示已标注
        }
        resolve();
      };
      im.onerror = function () { resolve(); };
      im.src = repoUrl(url);
    });
  }

  // ---------------------------------------------------------------- 魔法棒
  function applyWand(ev) {
    if (!S.img || !S.basePixels) return;
    var rect = cv.getBoundingClientRect();
    var pt = screenToImage(ev.clientX - rect.left, ev.clientY - rect.top);
    var x = Math.floor(pt.x), y = Math.floor(pt.y);
    if (!(x >= 0 && x < S.imgW && y >= 0 && y < S.imgH)) {
      clearSelection();
      msg('点在画布外：已取消选区');
      return;
    }
    var alphaAt = S.basePixels[(y * S.imgW + x) * 4 + 3];
    if (alphaAt < C.MASK_ALPHA_THRESHOLD) {
      clearSelection();
      msg('点在透明区域：已取消选区');
      return;
    }
    var isIssue = S.mode === 'issues';
    var it = activeIssue();
    if (isIssue && !it) { msg('先新建/选中一个问题'); return; }
    if (isIssue && S.issueTarget === 'before') { msg('「改动前」不画选区：直接点画布上的部件（或下拉「改动前件」）'); return; }
    var idx = isIssue ? 1 : partIndex(S.activeId);
    if (!isIssue && !idx) { msg('先选中一个部件'); return; }
    var map = isIssue ? issueTargetMap() : S.maps[S.channel];
    // 先复制一份求差异（魔法棒可能大面积扩散）
    var before = map.slice();
    var bbox = C.floodFill(S.basePixels, S.imgW, S.imgH, x, y, S.tolerance, map, idx);
    if (!bbox) { msg('该处颜色区域为空或已经是当前目标'); return; }
    var beforeRegion = C.extractRegion(before, S.imgW, bbox);
    var afterRegion = C.extractRegion(map, S.imgW, bbox);
    var diff = { x0: bbox.x0, y0: bbox.y0, w: bbox.x1 - bbox.x0, h: bbox.y1 - bbox.y0, before: beforeRegion, after: afterRegion };
    if (isIssue) {
      pushUndo({ type: 'issueRegion', issueId: it.id, target: S.issueTarget, diff: diff });
      S.issueOverlayDirty = true;
      renderIssues();
    } else {
      pushUndo({ type: 'region', channel: S.channel, diff: diff });
      S.overlayDirty = true; S.outlineDirty = true;
      renderParts();
    }
    setDirty(true);
    scheduleRender();
    if (isIssue) {
      var blocks = C.countComponents(map, S.imgW, S.imgH, 1);
      msg('魔法棒已把 ' + (bbox.x1 - bbox.x0) + '×' + (bbox.y1 - bbox.y0) + ' 区域累加到问题「' +
        (S.issueTarget === 'region' ? '问题位置' : '改动后') + '」：共 ' + maskCount(map).toLocaleString() + ' px' +
        (blocks > 1 ? '（' + blocks + ' 块）' : '') + '；可继续点/框选');
    } else {
      msg('魔法棒已填充 ' + (bbox.x1 - bbox.x0) + '×' + (bbox.y1 - bbox.y0) + ' 区域到 ' + activePart().name);
    }
  }

  // ---------------------------------------------------------------- 导出 / 保存
  function buildAnnotations() {
    return {
      schemaVersion: 1,
      kind: 'part-annotation',
      character: S.character,
      view: S.view,
      canvas: { width: S.imgW, height: S.imgH },
      source: S.sourcePath,
      seedFrom: S.projectDir ? '' : '',
      parts: S.parts.map(function (p) { return { id: p.id, name: p.name, color: p.color, z: p.z, note: p.note || '' }; }),
      channels: { visible: true, hidden: !!S.maps.hidden },
      updatedAt: nowIso()
    };
  }

  function canvasToPngBytes(canvas) {
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) {
        blob.arrayBuffer().then(function (buf) { resolve(new Uint8Array(buf)); });
      }, 'image/png');
    });
  }
  function bytesToBase64(bytes) {
    var out = '';
    var CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(out);
  }

  // label 图：R=部件索引，G=B=0，A=标注掩码；索引 0 => A=0
  function makeLabelCanvas(map) {
    var cvs = document.createElement('canvas');
    cvs.width = S.imgW; cvs.height = S.imgH;
    var c = cvs.getContext('2d');
    var img = c.createImageData(S.imgW, S.imgH);
    var buf = img.data;
    for (var i = 0; i < map.length; i++) {
      var v = map[i];
      if (!v) continue;
      var o = i * 4;
      buf[o] = v; buf[o + 1] = 0; buf[o + 2] = 0; buf[o + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    return cvs;
  }
  function makeMaskCanvas(map, idx) {
    var cvs = document.createElement('canvas');
    cvs.width = S.imgW; cvs.height = S.imgH;
    var c = cvs.getContext('2d');
    var img = c.createImageData(S.imgW, S.imgH);
    var buf = img.data;
    for (var i = 0; i < map.length; i++) {
      if (map[i] !== idx) continue;
      var o = i * 4;
      buf[o] = 255; buf[o + 1] = 255; buf[o + 2] = 255; buf[o + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    return cvs;
  }
  function makeCutCanvas(map, idx) {
    var cvs = document.createElement('canvas');
    cvs.width = S.imgW; cvs.height = S.imgH;
    var c = cvs.getContext('2d');
    var img = c.createImageData(S.imgW, S.imgH);
    var buf = img.data;
    var base = S.basePixels;
    for (var i = 0; i < map.length; i++) {
      if (map[i] !== idx) continue;
      var o = i * 4;
      buf[o] = base[o]; buf[o + 1] = base[o + 1]; buf[o + 2] = base[o + 2];
      buf[o + 3] = base[o + 3] > 0 ? base[o + 3] : 255;
    }
    c.putImageData(img, 0, 0);
    return cvs;
  }
  function makePreviewCanvas() {
    var cvs = document.createElement('canvas');
    cvs.width = S.imgW; cvs.height = S.imgH;
    var c = cvs.getContext('2d');
    c.fillStyle = '#151821'; c.fillRect(0, 0, S.imgW, S.imgH);
    c.globalAlpha = 0.55; c.drawImage(S.img, 0, 0); c.globalAlpha = 1;
    var map = S.maps.visible;
    var img = c.createImageData(S.imgW, S.imgH);
    var buf = img.data;
    for (var i = 0; i < map.length; i++) {
      var v = map[i];
      if (!v) continue;
      var col = C.hexToRgb(S.parts[v - 1] ? S.parts[v - 1].color : '#888');
      var o = i * 4;
      buf[o] = col.r; buf[o + 1] = col.g; buf[o + 2] = col.b; buf[o + 3] = 150;
    }
    var tmp = document.createElement('canvas');
    tmp.width = S.imgW; tmp.height = S.imgH;
    tmp.getContext('2d').putImageData(img, 0, 0);
    c.drawImage(tmp, 0, 0);
    return cvs;
  }

  async function sha256Bytes(bytes) {
    try {
      if (window.crypto && crypto.subtle) {
        var buf = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(buf)).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      }
    } catch (e) { /* fall back to empty */ }
    return '';
  }

  function makeBaseCanvas() {
    var cvs = document.createElement('canvas');
    cvs.width = S.imgW; cvs.height = S.imgH;
    cvs.getContext('2d').drawImage(S.img, 0, 0);
    return cvs;
  }

  // 构建标准拆件包（parts-bundle v1）：index.json + parts.json + base/masks/cuts/composite/preview
  async function buildPartsBundle() {
    var BUNDLE = window.PartAnnotatorBundle;
    if (!BUNDLE) throw new Error('bundle.js 未加载');
    var project = buildAnnotations();
    var order = S.parts.slice().sort(function (a, b) { return a.z - b.z; }); // 后 → 前
    var files = [];
    var baseBytes = await canvasToPngBytes(makeBaseCanvas());
    files.push({ name: 'base.png', bytes: baseBytes });

    var comp = document.createElement('canvas');
    comp.width = S.imgW; comp.height = S.imgH;
    var compCtx = comp.getContext('2d');
    var partsList = { schemaVersion: 1, kind: 'parts-list', backToFront: [], parts: [] };

    for (var i = 0; i < order.length; i++) {
      var p = order[i], idx = partIndex(p.id);
      var refs = {
        mask: 'masks/' + p.id + '.png',
        cut: 'cuts/' + p.id + '.png'
      };
      var maskCanvas = makeMaskCanvas(S.maps.visible, idx);
      var cutCanvas = makeCutCanvas(S.maps.visible, idx);
      files.push({ name: refs.mask, bytes: await canvasToPngBytes(maskCanvas) });
      files.push({ name: refs.cut, bytes: await canvasToPngBytes(cutCanvas) });
      compCtx.drawImage(cutCanvas, 0, 0);
      if (S.maps.hidden) {
        refs.hiddenMask = 'hidden/' + p.id + '.png';
        refs.hiddenCut = 'cuts-hidden/' + p.id + '.png';
        files.push({ name: refs.hiddenMask, bytes: await canvasToPngBytes(makeMaskCanvas(S.maps.hidden, idx)) });
        files.push({ name: refs.hiddenCut, bytes: await canvasToPngBytes(makeCutCanvas(S.maps.hidden, idx)) });
      }
      partsList.backToFront.push(p.id);
      partsList.parts.push({ id: p.id, name: p.name, z: p.z, color: p.color, note: p.note || '', files: refs });
    }
    files.push({ name: 'composite.png', bytes: await canvasToPngBytes(comp) });
    files.push({ name: 'preview.png', bytes: await canvasToPngBytes(makePreviewCanvas()) });
    files.push({ name: 'annotations.json', bytes: new TextEncoder().encode(JSON.stringify(project, null, 2)) });

    // 保留已有成品层（载入现有拆分件 / 旧拆件包时不要丢 layers/）
    var layerAdded = 0;
    for (var li = 0; li < partsList.parts.length; li++) {
      var lp = partsList.parts[li];
      var src = S.layerSources && S.layerSources[lp.id];
      if (!src) continue;
      try {
        var resp = await fetch(repoUrl(src));
        if (!resp.ok) continue;
        var layerBytes = new Uint8Array(await resp.arrayBuffer());
        files.push({ name: 'layers/' + lp.id + '.png', bytes: layerBytes });
        lp.files.layer = 'layers/' + lp.id + '.png';
        layerAdded++;
      } catch (e) { /* 缺这一层就跳过 */ }
    }

    // 问题标注：issues.json + issues/<id>[-before|-after].png
    var issuesDoc = { schemaVersion: 1, kind: 'issues-list', issues: [] };
    for (var ii = 0; ii < S.issues.length; ii++) {
      var it = S.issues[ii];
      var rPx = maskCount(it.masks.region), bPx = maskCount(it.masks.before), aPx = maskCount(it.masks.after);
      if (!rPx && !bPx && !aPx) continue;   // 空问题不写文件
      var refs = { region: 'issues/' + it.id + '.png' };
      files.push({ name: refs.region, bytes: await canvasToPngBytes(makeMaskCanvas(it.masks.region, 1)) });
      if (bPx) {
        refs.before = 'issues/' + it.id + '-before.png';
        files.push({ name: refs.before, bytes: await canvasToPngBytes(makeMaskCanvas(it.masks.before, 1)) });
      }
      if (aPx) {
        refs.after = 'issues/' + it.id + '-after.png';
        files.push({ name: refs.after, bytes: await canvasToPngBytes(makeMaskCanvas(it.masks.after, 1)) });
      }
      issuesDoc.issues.push({
        id: it.id, type: it.type, severity: it.severity, partId: it.partId || '',
        beforePartId: it.beforePartId || '',
        note: it.note || '',
        files: refs, bbox: issueBBox(it),
        pixels: { region: rPx, before: bPx, after: aPx, blocks: issueBlocks(it) },
        createdAt: it.createdAt
      });
    }

    var index = BUNDLE.emptyIndex({
      label: S.projectName || (S.character + '-' + S.view),
      character: S.character,
      view: S.view,
      width: S.imgW,
      height: S.imgH,
      source: S.sourcePath,
      baseSha256: await sha256Bytes(baseBytes),
      parts: partsList.parts.length
    });
    index.partsFile = 'parts.json';
    index.files.masks = 'masks/';
    index.files.cuts = 'cuts/';
    index.files.hidden = S.maps.hidden ? 'hidden/' : undefined;
    index.files.cutsHidden = S.maps.hidden ? 'cuts-hidden/' : undefined;
    index.provenance = {
      tool: 'tools/part-annotator',
      generator: 'part-annotator v1',
      method: 'manual semantic annotation (rect/polygon/brush/wand)',
      source: S.sourcePath,
      bundle: S.projectName || ''
    };
    if (!S.maps.hidden) { delete index.files.hidden; delete index.files.cutsHidden; }
    // report.md：来自已有拆件包时原样带回
    if (S.reportSource) {
      try {
        var rr = await fetch(repoUrl(S.reportSource));
        if (rr.ok) {
          files.push({ name: 'report.md', bytes: new Uint8Array(await rr.arrayBuffer()) });
          index.files.report = 'report.md';
        }
      } catch (e) { /* 拿不到就不带 */ }
    }
    if (!index.files.report) delete index.files.report;
    if (!layerAdded) delete index.files.layers;
    if (issuesDoc.issues.length) {
      files.push({ name: 'issues.json', bytes: new TextEncoder().encode(JSON.stringify(issuesDoc, null, 2)) });
      index.issuesFile = 'issues.json';
      index.issues = issuesDoc.issues.length;
      index.files.issues = 'issues/';
    }
    var check = BUNDLE.validateBundleWithIssues(index, partsList, issuesDoc.issues.length ? issuesDoc : null);
    if (!check.ok) throw new Error('拆件包校验失败: ' + check.errors.join('; '));
    files.push({ name: 'parts.json', bytes: new TextEncoder().encode(JSON.stringify(partsList, null, 2)) });
    files.push({ name: 'index.json', bytes: new TextEncoder().encode(JSON.stringify(index, null, 2)) });
    return { index: index, parts: partsList, files: files };
  }

  async function saveBundle(saveAs) {
    if (!S.img) { msg('先载入原立绘'); return; }
    var targetName = S.projectName;
    if (saveAs || !targetName) {
      targetName = prompt(
        '拆件包名（写入 workspace/characters/' + S.character + '/parts-bundles/<名字>/）' +
        (S.projectName ? '\n当前：' + S.projectName + '；改名即另存为新包' : '') + '：',
        S.projectName || (S.character + '-' + S.view + '-bundle'));
    }
    if (!targetName) return;
    var name = targetName;
    if (!C.SAFE_ID_RE.test(name)) { msg('拆件包名必须字母数字开头，可含 . _ -（≤64 字符）'); return; }
    if (!S.caps || !S.caps.saveBundle) {
      if (!S.caps || !S.caps.saveProject) { msg('保存接口不可用（只读服务），已改为导出拆件包 ZIP'); await exportZip(); return; }
    }
    msg('正在打包拆件包' + (name === S.projectName ? '（写回 ' + name + '）' : '（另存为 ' + name + '）') + '…');
    try {
      var bundle = await buildPartsBundle();
      var payload = {
        action: 'save-bundle',
        character: S.character,
        bundleId: name,
        index: bundle.index,
        parts: bundle.parts,
        files: bundle.files.map(function (f) { return { name: f.name, base64: bytesToBase64(f.bytes) }; })
      };
      var res = await fetch('/api/save-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var data = await res.json();
      if (!res.ok || !data.ok) throw new Error((data.error && data.error.message) || ('HTTP ' + res.status));
      S.projectName = name;
      S.projectDir = data.dir;
      setDirty(false);
      msg('已保存拆件包到 ' + data.dir + '（' + data.files.length + ' 个文件，' + Math.round(data.bytes / 1024) + ' KB）');
    } catch (e) {
      msg('保存失败：' + e.message + '（可在只读服务下用「导出拆件包 ZIP」）');
    }
  }

  async function exportZip() {
    if (!S.img) { msg('先载入原立绘'); return; }
    var BUNDLE = window.PartAnnotatorBundle;
    msg('正在打包拆件包 ZIP…');
    try {
      var bundle = await buildPartsBundle();
      var fileMap = {};
      bundle.files.forEach(function (f) { fileMap[f.name] = f.bytes; });
      var entries = BUNDLE.toZipEntries({ index: bundle.index, parts: bundle.parts, files: fileMap });
      var zipBytes = C.zipStore(entries);
      var blob = new Blob([zipBytes], { type: 'application/zip' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = (S.projectName || (S.character + '-' + S.view + '-bundle')) + '.zip';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
      msg('已导出拆件包 ZIP（' + entries.length + ' 个文件，' + Math.round(zipBytes.length / 1024) + ' KB，index.json 在根目录）');
    } catch (e) {
      msg('导出失败：' + e.message);
    }
  }

  async function loadBundle(indexPath) {
    var BUNDLE = window.PartAnnotatorBundle;
    var rel = normalizeWorkspacePath(indexPath);
    msg('正在打开拆件包…');
    var res = await fetchJson('/api/bundle?path=' + encodeURIComponent(rel));
    var idx = res.index, pl = res.parts, dir = res.dir;
    var check = BUNDLE.validateBundle(idx, pl);
    if (!check.ok) throw new Error('拆件包校验失败: ' + check.errors.join('; '));
    var baseRel = dir + '/' + idx.base.file;
    var source = idx.source || baseRel;
    return loadImageUrl(repoUrl(baseRel), source).then(function () {
      S.character = idx.character;
      S.view = idx.view;
      S.layerSources = {};
      S.parts = pl.parts.map(function (p) {
        return { id: p.id, name: p.name, color: p.color || C.paletteColor(0), z: p.z | 0, note: p.note || '', visible: true };
      }).sort(function (a, b) { return a.z - b.z; });
      pl.parts.forEach(function (p) {
        if (p.files && p.files.layer) S.layerSources[p.id] = dir + '/' + p.files.layer;
      });
      S.nextZ = S.parts.reduce(function (m, p) { return Math.max(m, p.z); }, 0) + 1;
      S.maps.visible = C.createLabelMap(S.imgW, S.imgH);
      S.maps.hidden = idx.files && idx.files.hidden ? C.createLabelMap(S.imgW, S.imgH) : null;
      S.projectDir = dir;
      S.projectName = dir.split('/').pop();
      S.reportSource = (idx.files && idx.files.report) ? (dir + '/' + idx.files.report) : '';
      S.activeId = S.parts.length ? S.parts[0].id : null;
      S.visibilityDirty = true;
      // 载入顺序：后 → 前。有 mask 用 mask；只有 layer 时按 alpha>10 填
      var chain = Promise.resolve();
      pl.backToFront.forEach(function (id) {
        chain = chain.then(function () {
          var p = null;
          for (var i = 0; i < pl.parts.length; i++) if (pl.parts[i].id === id) p = pl.parts[i];
          if (!p) return Promise.resolve();
          var pi = partIndex(p.id);
          var filesRef = p.files || {};
          var jobs = [];
          if (filesRef.mask) jobs.push(loadMaskPng(dir + '/' + filesRef.mask, pi, 'visible'));
          else if (filesRef.layer) jobs.push(seedFromLayerPng(dir + '/' + filesRef.layer, pi, 'visible'));
          if (filesRef.hiddenMask && S.maps.hidden) jobs.push(loadMaskPng(dir + '/' + filesRef.hiddenMask, pi, 'hidden'));
          return Promise.all(jobs);
        });
      });
      var finish = function () {
        if (!idx.issuesFile) return Promise.resolve();
        return fetchJson(repoUrl(dir + '/' + idx.issuesFile)).then(function (doc) {
          var vv = BUNDLE.validateIssues(doc);
          if (!vv.ok) throw new Error('issues.json 校验失败: ' + vv.errors.join('; '));
          S.issues = doc.issues.map(function (x) {
            return {
              id: x.id, type: x.type, severity: x.severity | 0, partId: x.partId || '',
              beforePartId: x.beforePartId || (x.files && x.files.before ? (x.partId || '') : ''),
              note: x.note || '',
              masks: { region: C.createLabelMap(S.imgW, S.imgH), before: null, after: null },
              createdAt: x.createdAt || ''
            };
          });
          S.activeIssueId = S.issues.length ? S.issues[0].id : null;
          return Promise.all(S.issues.map(function (it, k) {
            var refs = (doc.issues[k] && doc.issues[k].files) || {};
            var jobs = [];
            if (refs.region) jobs.push(loadMaskInto(dir + '/' + refs.region, it.masks.region, 1));
            if (refs.before) {
              it.masks.before = C.createLabelMap(S.imgW, S.imgH);
              jobs.push(loadMaskInto(dir + '/' + refs.before, it.masks.before, 1));
            }
            if (refs.after) {
              it.masks.after = C.createLabelMap(S.imgW, S.imgH);
              jobs.push(loadMaskInto(dir + '/' + refs.after, it.masks.after, 1));
            }
            return Promise.all(jobs);
          }));
        });
      };
      return chain.then(function () { renderParts(); }).then(finish).then(function () {
        S.overlayDirty = true; S.outlineDirty = true; S.visibilityDirty = true;
        S.issueOverlayDirty = true;
        renderIssues();
        fitView();
        setDirty(false);
        msg('已打开拆件包 ' + dir + '（' + S.parts.length + ' 件' +
          (S.issues.length ? ' / ' + S.issues.length + ' 条问题' : '') +
          '，index.json v' + idx.schemaVersion + '）');
      });
    });
  }

  function loadMaskInto(url, map, value) {
    return new Promise(function (resolve) {
      var im = new Image();
      im.onload = function () {
        var off = document.createElement('canvas');
        off.width = S.imgW; off.height = S.imgH;
        var c = off.getContext('2d');
        c.drawImage(im, 0, 0);
        var data = c.getImageData(0, 0, S.imgW, S.imgH).data;
        for (var i = 0; i < map.length; i++) if (data[i * 4 + 3] > 127) map[i] = value;
        resolve();
      };
      im.onerror = function () { resolve(); };
      im.src = repoUrl(url);
    });
  }

  function loadMaskPng(url, idx, channel) {
    return new Promise(function (resolve) {
      var im = new Image();
      im.onload = function () {
        var off = document.createElement('canvas');
        off.width = S.imgW; off.height = S.imgH;
        var c = off.getContext('2d');
        c.drawImage(im, 0, 0);
        var data = c.getImageData(0, 0, S.imgW, S.imgH).data;
        var map = S.maps[channel];
        for (var i = 0; i < map.length; i++) if (data[i * 4 + 3] > 127) map[i] = idx;
        resolve();
      };
      im.onerror = function () { resolve(); };
      im.src = repoUrl(url);
    });
  }

  function seedFromLayerPng(url, idx, channel) {
    return new Promise(function (resolve) {
      var im = new Image();
      im.onload = function () {
        var off = document.createElement('canvas');
        off.width = S.imgW; off.height = S.imgH;
        var c = off.getContext('2d');
        c.drawImage(im, 0, 0);
        var data = c.getImageData(0, 0, S.imgW, S.imgH).data;
        var map = S.maps[channel];
        for (var i = 0; i < map.length; i++) if (data[i * 4 + 3] > C.MASK_ALPHA_THRESHOLD) map[i] = idx;
        resolve();
      };
      im.onerror = function () { resolve(); };
      im.src = repoUrl(url);
    });
  }

  function openBundleByPath() {
    var p = prompt('输入仓库相对路径的 index.json（可放在仓库任意目录，例如 workspace/.../parts-bundles/xxx/index.json）：',
      S.projectDir ? (S.projectDir + '/index.json') : 'workspace/characters/deepseek/parts-bundles/deepseek-front-v1/index.json');
    if (!p) return;
    loadBundle(p).catch(function (e) { msg('打开拆件包失败：' + e.message); });
  }

  function openBundleDialog() {
    var character = S.character || 'deepseek';
    fetchJson('/api/bundles?character=' + encodeURIComponent(character)).then(function (data) {
      var items = (data.bundles || []).map(function (b) {
        return {
          label: b.label,
          meta: b.updatedAt || b.dir,
          action: function () { closeDialog(); loadBundle(b.path).catch(function (e) { msg('打开拆件包失败：' + e.message); }); }
        };
      });
      if (!items.length) items.push({ label: '还没有拆件包', meta: '先标注并「保存拆件包」', action: function () {} });
      openDialog('打开拆件包', '来自 workspace/characters/' + character + '/parts-bundles/*/index.json（自包含，可整体移动）。', items);
    }).catch(function (e) { msg('读取拆件包列表失败：' + e.message); });
  }

  // ---------------------------------------------------------------- 启动
  function boot() {
    cv = $('#cv');
    stage = $('#stage');
    ctx = cv.getContext('2d');
    layoutCanvas();
    bindEvents();
    setTool('rect');
    setChannel('visible');
    updateZoomLabel();
    renderParts();
    renderIssues();
    setMode('parts');

    fetchJson('/api/capabilities').then(function (caps) {
      S.caps = caps;
      msg('服务就绪（' + ((caps.saveBundle || caps.saveProject) ? '可保存拆件包到 workspace' : '只读') + '）：载入一张原立绘开始');
    }).catch(function () {
      S.caps = { saveProject: false, saveBundle: false };
      msg('静态服务可用（无保存 API）：可用 ZIP 导出');
    });

    // 深链：?bundle=<index.json> / ?source=<png> / ?parts=<manifest> / ?project=<annotations.json>
    var q = new URLSearchParams(location.search);
    var src = q.get('source');
    var parts = q.get('parts');
    var project = q.get('project');
    var bundlePath = q.get('bundle');
    if (bundlePath) {
      loadBundle(bundlePath).catch(function (e) { msg('打开拆件包失败：' + e.message); });
    } else if (project) {
      loadProject(project).catch(function (e) { msg(e.message); });
    } else if (src) {
      if (parts) {
        // 先载入原图，再载入拆分件（loadSplit 自己会载入图）
        loadSplit(parts).catch(function (e) { msg(e.message); });
      } else {
        loadImageUrl(repoUrl(src), src).catch(function (e) { msg(e.message); });
      }
    } else if (parts) {
      loadSplit(parts).catch(function (e) { msg(e.message); });
    }
    if (window.__partAnnotatorDebug) window.__partAnnotatorDebug.state = S;
  }

  window.__partAnnotator = {
    state: S,
    core: C,
    loadSource: function (path) { return loadImageUrl(repoUrl(path), path); },
    loadSplit: loadSplit,
    loadProject: loadProject,
    save: saveBundle,
    saveAs: function () { return saveBundle(true); },
    openBundle: openBundleDialog,
    openBundlePath: openBundleByPath,
    loadBundle: loadBundle,
    exportZip: exportZip,
    annotations: buildAnnotations,
    render: render,
    createPart: createPart,
    selectPart: selectPart,
    deletePart: deletePart,
    mergePart: mergePart,
    setTool: setTool,
    setChannel: setChannel,
    setMode: setMode,
    createIssue: createIssue,
    deleteIssue: deleteIssue,
    applyIssueSelection: applyIssueSelection,
    eraseIssueSelection: eraseIssueSelection,
    setIssueTarget: setIssueTarget,
    setIssueBeforeFromPart: setIssueBeforeFromPart,
    clearIssueBefore: clearIssueBefore,
    pickPartAt: pickPartAt,
    issueBlocks: function (id) {
      var target = id ? S.issues.filter(function (x) { return x.id === id; })[0] : activeIssue();
      return issueBlocks(target || null);
    },
    issueSummary: function () { return S.issues.map(function (it) { return { id: it.id, type: it.type, severity: it.severity, partId: it.partId, beforePartId: it.beforePartId || '', note: it.note, region: maskCount(it.masks.region), before: maskCount(it.masks.before), after: maskCount(it.masks.after), blocks: issueBlocks(it) }; }); },
    setPartVisible: function (id, v) {
      var p = partById(id);
      if (!p) return false;
      p.visible = !!v;
      S.overlayDirty = true; S.outlineDirty = true; S.visibilityDirty = true;
      renderParts(); scheduleRender();
      return true;
    },
    wandAt: function (ix, iy) {
      var r = cv.getBoundingClientRect();
      applyWand({ clientX: r.left + S.tx + ix * S.zoom, clientY: r.top + S.ty + iy * S.zoom });
    },
    setSelectionRect: function (x0, y0, x1, y1) {
      S.selection = { type: 'rect', x0: x0, y0: y0, x1: x1, y1: y1 };
      updateSelectionBar(); scheduleRender();
    },
    clearSelection: clearSelection,
    applySelection: applySelection,
    undo: undo,
    redo: redo,
    fit: fitView,
    setProjectName: function (name) { S.projectName = name; },
    summary: function () {
      var out = { parts: S.parts.length, activeId: S.activeId, channel: S.channel, canvas: [S.imgW, S.imgH], counts: {},
                  mode: S.mode, issues: S.issues.length, activeIssueId: S.activeIssueId,
                  issueCounts: S.issues.map(function (it) { return { id: it.id, type: it.type, region: maskCount(it.masks.region), before: maskCount(it.masks.before), after: maskCount(it.masks.after) }; }) };
      S.parts.forEach(function (p) {
        var idx = partIndex(p.id);
        var n = 0;
        ['visible', 'hidden'].forEach(function (ch) {
          var m = S.maps[ch]; if (!m) return;
          for (var i = 0; i < m.length; i++) if (m[i] === idx) n++;
        });
        out.counts[p.id] = n;
      });
      return out;
    },
    tools: { rect: 'rect', poly: 'poly', brush: 'brush', wand: 'wand' }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();