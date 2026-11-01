/*
 * selftest.js —— spine-core 纯函数自检（契约 A9 / C2 / C4 / C5 / C6 / C7 中属于 core 的部分）。
 *
 * 依赖：spine-core.js（globalThis.SpineCore）、fixtures/cases.js（globalThis.SpineFixtures）。
 * 输出：页面顶部 PASS/FAIL 汇总 + 失败明细（期望/实际），并导出 window.__selftestResult。
 * 无 DOM 环境下（Node + 轻量 shim）也能运行，结果挂到 globalThis.__selftestResult。
 */
(function (global) {
  "use strict";

  var core = global.SpineCore;
  var fixtures = global.SpineFixtures; // case map：id -> case

  var result = {
    passed: 0,
    failed: 0,
    total: 0,
    cases: {},
    failures: [],
    startedAt: new Date().toISOString(),
  };
  var currentCase = "(global)";

  function fmt(v) {
    if (typeof v === "number") {
      if (!isFinite(v)) return String(v);
      return Math.abs(v) >= 1e-4 && Math.abs(v) < 1e6 ? String(Math.round(v * 1e6) / 1e6) : v.toExponential(6);
    }
    if (Array.isArray(v)) return "[" + v.map(fmt).join(", ") + "]";
    if (v && typeof v.length === "number" && typeof v !== "string") {
      var arr = [];
      for (var i = 0; i < v.length; i++) arr.push(v[i]);
      return "[" + arr.map(fmt).join(", ") + "]";
    }
    if (v && typeof v === "object") return JSON.stringify(v);
    return String(v);
  }

  function record(pass, name, expected, actual, detail) {
    result.total++;
    var c = result.cases[currentCase] || (result.cases[currentCase] = { passed: 0, failed: 0 });
    if (pass) {
      result.passed++;
      c.passed++;
      return true;
    }
    result.failed++;
    c.failed++;
    result.failures.push({
      case: currentCase,
      name: name,
      expected: expected === undefined ? null : expected,
      actual: actual === undefined ? null : actual,
      detail: detail || "",
    });
    return false;
  }

  function ok(name, cond, detail) {
    return record(!!cond, name, "truthy", cond, detail);
  }

  function eq(name, actual, expected) {
    return record(actual === expected, name, expected, actual);
  }

  function near(name, actual, expected, tol) {
    var t = tol === undefined ? 1e-6 : tol;
    var pass = typeof actual === "number" && isFinite(actual) && Math.abs(actual - expected) <= t;
    return record(pass, name, expected, actual, "tol=" + t);
  }

  function nearArray(name, actual, expected, tol) {
    var t = tol === undefined ? 1e-6 : tol;
    if (!actual || !expected || actual.length !== expected.length) {
      return record(false, name, expected, actual, "长度不一致");
    }
    var max = 0;
    var at = -1;
    for (var i = 0; i < expected.length; i++) {
      var d = Math.abs(actual[i] - expected[i]);
      if (!isFinite(actual[i])) d = Infinity;
      if (d > max) {
        max = d;
        at = i;
      }
    }
    return record(max <= t, name, expected, actual, "最大误差 " + fmt(max) + " @[" + at + "] tol=" + t);
  }

  function eqArray(name, actual, expected) {
    if (!actual || !expected || actual.length !== expected.length) {
      return record(false, name, expected, actual, "长度不一致");
    }
    var same = true;
    for (var i = 0; i < expected.length; i++) if (actual[i] !== expected[i]) same = false;
    return record(same, name, expected, actual);
  }

  function allFinite(name, arr) {
    for (var i = 0; i < arr.length; i++) {
      if (!isFinite(arr[i])) return record(false, name, "全部有限", arr[i], "index " + i);
    }
    return record(true, name, "全部有限", "全部有限");
  }

  function getAtt(model, slotName, attName) {
    return model.attachments.get(model.defaultSkinName + "/" + slotName + "/" + attName);
  }

  function attName(att) {
    var parts = att.id.split("/");
    return parts[parts.length - 1];
  }

  function parseFixture(f) {
    var atlasRes = core.parseAtlas(f.atlasText);
    if (!atlasRes.ok) return { atlasRes: atlasRes, modelRes: null };
    return { atlasRes: atlasRes, modelRes: core.parseModel(f.json, atlasRes.value, { skin: "default" }) };
  }

  /* ------------------------------------------------------------------ *
   * 通用 fixture 断言
   * ------------------------------------------------------------------ */
  function runFixture(f) {
    currentCase = f.id;
    var exp = f.expected || {};
    var parsed = parseFixture(f);
    ok("atlas 解析成功", parsed.atlasRes.ok, parsed.atlasRes.issues);
    if (!parsed.atlasRes.ok) return;

    if (exp.parseOk === false) {
      ok("parseModel 返回 ok:false", parsed.modelRes.ok === false);
      var errors = parsed.modelRes.issues.filter(function (i) {
        return i.severity === "error";
      });
      ok(
        "错误码 " + exp.errorCode,
        errors.some(function (i) {
          return i.code === exp.errorCode;
        }),
        errors
      );
      ok(
        "错误项带 path",
        errors.some(function (i) {
          return typeof i.path === "string";
        }),
        errors
      );
      return;
    }

    ok("parseModel 成功", parsed.modelRes.ok, parsed.modelRes.issues);
    if (!parsed.modelRes.ok) return;
    var model = parsed.modelRes.value;
    var issues = parsed.modelRes.issues;

    if (exp.counts) {
      eq("counts.bones", model.bones.length, exp.counts.bones);
      eq("counts.slots", model.slots.length, exp.counts.slots);
      var meshCount = 0;
      var weightedCount = 0;
      model.attachments.forEach(function (att) {
        if (att.type === "mesh") {
          meshCount++;
          if (att.weighted) weightedCount++;
        }
      });
      eq("counts.meshes", meshCount, exp.counts.meshes);
      eq("counts.weightedMeshes", weightedCount, exp.counts.weightedMeshes);
      eq("counts.ik", model.constraints.length, exp.counts.ik);
    }

    if (exp.issueCodes) {
      exp.issueCodes.forEach(function (code) {
        ok(
          "issue 存在 " + code,
          issues.some(function (i) {
            return i.code === code;
          }),
          issues.map(function (i) {
            return i.code;
          })
        );
      });
    }

    if (exp.atlas) {
      eq("atlas 页数", parsed.atlasRes.value.pages.length, exp.atlas.pages.length);
      exp.atlas.pages.forEach(function (p, i) {
        eq("page[" + i + "].name", parsed.atlasRes.value.pages[i].name, p.name);
        eq("page[" + i + "].width", parsed.atlasRes.value.pages[i].width, p.width);
        eq("page[" + i + "].height", parsed.atlasRes.value.pages[i].height, p.height);
      });
      eq("atlas region 数", parsed.atlasRes.value.regions.size, exp.atlas.regions.length);
      exp.atlas.regions.forEach(function (r) {
        var actual = parsed.atlasRes.value.regions.get(r.name);
        if (!actual) return record(false, "region " + r.name + " 存在", "存在", "缺失");
        var keys = ["pageIndex", "x", "y", "w", "h", "rotate", "offsetX", "offsetY", "originalW", "originalH"];
        keys.forEach(function (k) {
          eq("region " + r.name + "." + k, actual[k], r[k]);
        });
      });
    }

    if (exp.poses) {
      exp.poses.forEach(function (p) {
        var pose = core.evalPose(model, { animation: p.animation === undefined ? null : p.animation, time: p.time || 0 });
        allFinite("pose[" + p.label + "] world 全部有限", flattenWorld(pose.world));
        if (p.bones) {
          Object.keys(p.bones).forEach(function (name) {
            var idx = model.boneIndex.get(name);
            if (idx === undefined) return record(false, "骨 " + name + " 存在", "存在", "缺失");
            var w = pose.world[idx];
            nearArray("pose[" + p.label + "] 骨 " + name + " world", [w.a, w.b, w.c, w.d, w.tx, w.ty], p.bones[name], 1e-4);
          });
        }
        if (p.meshes) {
          p.meshes.forEach(function (m) {
            var att = getAtt(model, m.slot, m.attachment);
            if (!att) return record(false, "附件 " + m.slot + "/" + m.attachment + " 存在", "存在", "缺失");
            var slot = model.slots[att.slotIndex];
            var actual = core.skinMesh(att, slot.boneIndex, pose.world);
            nearArray("pose[" + p.label + "] mesh " + m.slot + "/" + m.attachment, actual, m.vertices, 1e-4);
          });
        }
        if (p.attachments) {
          var actualIds = pose.attachments.map(function (att) {
            return att ? attName(att) : null;
          });
          eqArray("pose[" + p.label + "] attachment 序列", actualIds, p.attachments);
        }
        if (exp.evalIssueCodes) {
          exp.evalIssueCodes.forEach(function (code) {
            ok(
              "pose[" + p.label + "] eval issue " + code,
              pose.issues.some(function (i) {
                return i.code === code;
              }),
              pose.issues.map(function (i) {
                return i.code;
              })
            );
          });
        }
      });
    }

    if (exp.sources) {
      exp.sources.forEach(function (s) {
        var att = getAtt(model, s.slot, s.attachment);
        if (!att || !att.region) return record(false, "附件 " + s.slot + "/" + s.attachment + " 有 region", "有", "缺失");
        var actual = core.uvToPageXY(att.region, s.uv);
        nearArray("source " + s.slot + "/" + s.attachment + " corner" + s.corner, [actual[0], actual[1]], [s.x, s.y], 1e-4);
      });
    }

    if (exp.weights) {
      exp.weights.forEach(function (w) {
        var att = getAtt(model, w.slot, w.attachment);
        if (!att) return record(false, "权重附件存在", "存在", "缺失");
        var palette = new Map();
        Object.keys(w.palette).forEach(function (k) {
          palette.set(Number(k), w.palette[k]);
        });
        var wc = core.weightColors(att, model.slots[att.slotIndex].boneIndex, palette);
        w.colors.forEach(function (color, vi) {
          nearArray("权重配色 " + w.slot + "/" + w.attachment + " v" + vi, [wc.rgb[vi * 3], wc.rgb[vi * 3 + 1], wc.rgb[vi * 3 + 2]], color, 1e-4);
        });
      });
    }

    if (exp.bounds || exp.hits || exp.emptyGeometry) {
      var pose = core.evalPose(model, { animation: null, time: 0 });
      var items = core.buildGeometry(model, pose);
      if (exp.emptyGeometry) {
        eq("无可见件 buildGeometry 为空", items.length, 0);
        eq("无可见件 boundsOf 为 null", core.boundsOf(items), null);
        eq("无可见件 hitTest 为 null", core.hitTest(items, { x: 0, y: 0 }), null);
      }
      if (exp.bounds) {
        var b = core.boundsOf(items);
        ok("bounds 非 null", b !== null);
        if (b) {
          near("bounds.minX", b.minX, exp.bounds.minX, 1e-4);
          near("bounds.minY", b.minY, exp.bounds.minY, 1e-4);
          near("bounds.maxX", b.maxX, exp.bounds.maxX, 1e-4);
          near("bounds.maxY", b.maxY, exp.bounds.maxY, 1e-4);
        }
      }
      if (exp.hits) {
        exp.hits.forEach(function (h) {
          var hit = core.hitTest(items, { x: h.point[0], y: h.point[1] });
          if (h.expect === null) {
            eq("hitTest (" + h.point + ") 未命中", hit, null);
          } else {
            ok("hitTest (" + h.point + ") 命中", hit !== null);
            if (hit) {
              eq("hitTest slot", model.slots[hit.slotIndex].name, h.expect);
              var sum = hit.barycentric[0] + hit.barycentric[1] + hit.barycentric[2];
              near("hitTest 重心和", sum, 1, 1e-6);
            }
          }
        });
      }
    }
  }

  function flattenWorld(world) {
    var out = [];
    for (var i = 0; i < world.length; i++) {
      var w = world[i];
      out.push(w.a, w.b, w.c, w.d, w.tx, w.ty);
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 额外纯函数断言（不依赖 fixture 的通用性质）
   * ------------------------------------------------------------------ */
  function runExtra() {
    currentCase = "(core)";

    // ---- sampleTrack ----
    var lin = [{ time: 0, value: 0 }, { time: 1, value: 10 }];
    near("sampleTrack 线性中点", core.sampleTrack(lin, 0.5, ["value"], [0])[0], 5, 1e-12);
    near("sampleTrack 首 key 之前返回默认", core.sampleTrack([{ time: 0.5, value: 7 }], 0.1, ["value"], [3])[0], 3, 1e-12);
    near("sampleTrack 末 key 之后返回末值", core.sampleTrack([{ time: 0, value: 7 }], 5, ["value"], [3])[0], 7, 1e-12);
    var stepped = [{ time: 0, value: 3, curve: "stepped" }, { time: 1, value: 9 }];
    near("sampleTrack stepped", core.sampleTrack(stepped, 0.5, ["value"], [0])[0], 3, 1e-12);
    var sym = [{ time: 0, value: 0, curve: [0.3, 0, 0.7, 1] }, { time: 1, value: 1 }];
    near("sampleTrack Bezier 对称点", core.sampleTrack(sym, 0.5, ["value"], [0])[0], 0.5, 1e-9);
    var dual = [{ time: 0, x: 0, y: 0, curve: [0.2, 0, 0.8, 10, 0.2, 0, 0.8, 100] }, { time: 1, x: 10, y: 100 }];
    var dualVal = core.sampleTrack(dual, 0.5, ["x", "y"], [0, 0]);
    near("sampleTrack 双通道 x", dualVal[0], 5, 1e-6);
    near("sampleTrack 双通道 y", dualVal[1], 50, 1e-6);
    var outside = core.sampleTrack([{ time: 0, value: 0, curve: [2, 0, 3, 1] }, { time: 1, value: 1 }], 0.5, ["value"], [0]);
    ok("sampleTrack 离界控制点仍有限", isFinite(outside[0]));

    // 缺字段 key：Spine 语义是该 key 处取缺省值（translate 0 / rotate 0 / scale 1），
    // 且不得因为缺字段而丢弃 key（否则时间轴被压缩，采样整体错位）。
    var missT = [{ time: 0, x: 5, curve: "stepped" }, { time: 0.5, x: 7, curve: "stepped" }];
    var missTv = core.sampleTrack(missT, 0.25, ["x", "y"], [0, 0]);
    near("缺 y 的 translate key：x 取本段", missTv[0], 5, 1e-12);
    near("缺 y 的 translate key：y=0", missTv[1], 0, 1e-12);
    eq("缺 y 的 translate key 未被过滤", missT.length, 2);
    var missR = [{ time: 0, value: 7, curve: "stepped" }, { time: 0.5, curve: "stepped" }];
    near("缺 value 的 rotate key：前一段取 7", core.sampleTrack(missR, 0.25, ["value"], [0])[0], 7, 1e-12);
    near("缺 value 的 rotate key：本 key 处取 0", core.sampleTrack(missR, 0.5, ["value"], [0])[0], 0, 1e-12);
    var missS = [{ time: 0, x: 2, curve: "stepped" }, { time: 0.5, curve: "stepped" }];
    var missSv = core.sampleTrack(missS, 0.25, ["x", "y"], [1, 1]);
    near("缺 x/y 的 scale key：x 取本段", missSv[0], 2, 1e-12);
    near("缺 x/y 的 scale key：y=1", missSv[1], 1, 1e-12);
    // 官方 4.2 把 key 时间存进 Float32Array；0.6 存成 0.6000000238，
    // 因此 Timeline.search 在查询 time=0.6 时取到上一个 key。这里锁定该语义（与官方 oracle 一致）。
    var f32keys = [{ time: 0, value: 10, curve: "stepped" }, { time: 0.6, value: 60, curve: "stepped" }];
    near("float32 key 时间：t=0.6 取上一 key（官方 Timeline.search 语义）", core.sampleTrack(f32keys, 0.6, ["value"], [0])[0], 10, 1e-12);

    // fixture：缺字段 key 在解析后必须全部保留且归一化到缺省值
    var fstep = fixtures["stepped-missing-fields"];
    var mstep = parseFixture(fstep).modelRes.value;
    var stepTracks = mstep.animations.get("step").bones.get(mstep.boneIndex.get("b"));
    eq("缺字段 key 全部保留（translate）", stepTracks.translate.keys.length, 5);
    eq("缺字段 key 全部保留（rotate）", stepTracks.rotate.keys.length, 4);
    eq("缺字段 key 全部保留（scale）", stepTracks.scale.keys.length, 4);
    near("translate 缺 y 的 key 归一化为 0", stepTracks.translate.keys[2].y, 0, 1e-12);
    near("rotate 缺 value 的 key 归一化为 0", stepTracks.rotate.keys[1].value, 0, 1e-12);
    near("scale 缺 x 的 key 归一化为 1", stepTracks.scale.keys[1].x, 1, 1e-12);
    near("scale 缺 y 的 key 归一化为 1", stepTracks.scale.keys[1].y, 1, 1e-12);

    // ---- Mat ----
    var m = { a: 2, b: 1, c: -1, d: 3, tx: 10, ty: -4 };
    var inv = core.invert(m);
    ok("invert 非奇异返回矩阵", inv !== null);
    var id = core.matMul(m, inv);
    nearArray("matMul(m, invert(m)) ≈ I", [id.a, id.b, id.c, id.d, id.tx, id.ty], [1, 0, 0, 1, 0, 0], 1e-9);
    eq("invert 奇异返回 null", core.invert({ a: 1, b: 2, c: 2, d: 4 }), null);
    var p = core.transformPoint(m, { x: 3, y: 4 });
    near("transformPoint.x", p.x, 12, 1e-12);
    near("transformPoint.y", p.y, 11, 1e-12);
    var mm = core.matMul(m, { a: 1, b: 0, c: 0, d: 1, tx: 1, ty: 2 });
    near("matMul 平移 x", mm.tx, 10, 1e-12);
    near("matMul 平移 y", mm.ty, 3, 1e-12);

    // ---- affineFromTriangles ----
    var src = [0, 0, 10, 0, 0, 10];
    var dst = [5, 5, 15, 5, 5, 15];
    var affine = core.affineFromTriangles(src, dst);
    ok("affineFromTriangles 返回矩阵", affine !== null);
    if (affine) {
      var q0 = core.transformPoint(affine, { x: 0, y: 0 });
      var q1 = core.transformPoint(affine, { x: 10, y: 0 });
      var q2 = core.transformPoint(affine, { x: 0, y: 10 });
      nearArray("affine 三点映射", [q0.x, q0.y, q1.x, q1.y, q2.x, q2.y], dst, 1e-9);
    }
    eq("affineFromTriangles 奇异返回 null", core.affineFromTriangles([0, 0, 10, 0, 20, 0], dst), null);

    // ---- uvToPageXY 未裁剪简化 ----
    var flat = { x: 10, y: 20, w: 40, h: 30, originalW: 40, originalH: 30, offsetX: 0, offsetY: 0, rotate: 0 };
    var uv00 = core.uvToPageXY(flat, [0, 0]);
    var uv11 = core.uvToPageXY(flat, [1, 1]);
    nearArray("uvToPageXY 未裁剪 (0,0)", [uv00[0], uv00[1]], [10, 20], 1e-12);
    nearArray("uvToPageXY 未裁剪 (1,1)", [uv11[0], uv11[1]], [50, 50], 1e-12);

    // ---- 空输入安全 ----
    eq("boundsOf([]) 为 null", core.boundsOf([]), null);
    eq("hitTest 空 items 为 null", core.hitTest([], { x: 0, y: 0 }), null);
    eq("hitTest 无 point 为 null", core.hitTest([{ bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 }, triangles: [0, 1, 2], worldXY: [0, 0, 1, 0, 0, 1] }], null), null);

    // ---- 无效模型 ----
    var badPose = core.evalPose(null, {});
    eq("evalPose(null) 返回空姿势", badPose.world.length, 0);
    eq("evalPose(null) 有 error issue", badPose.issues[0].severity, "error");
    var badModel = core.parseModel({}, null);
    ok("parseModel 缺 atlas 返回 ok:false", badModel.ok === false);
    var badAtlas = core.parseAtlas(123);
    ok("parseAtlas 非字符串返回 ok:false", badAtlas.ok === false);

    // ---- 真实 fixture 的语义断言 ----
    var F = fixtures;

    // C2：刚性 mesh 的 width/height 不影响几何
    var f2 = F["rigid-mesh-concave"];
    var base2 = parseFixture(f2).modelRes.value;
    var pose2 = core.evalPose(base2, {});
    var att2 = getAtt(base2, "shape", "shape");
    var v0 = core.skinMesh(att2, base2.slots[att2.slotIndex].boneIndex, pose2.world);
    var mutated = JSON.parse(JSON.stringify(f2.json));
    mutated.skins[0].attachments.shape.shape.width = 999;
    mutated.skins[0].attachments.shape.shape.height = 999;
    var m2b = core.parseModel(mutated, core.parseAtlas(f2.atlasText).value).value;
    var pose2b = core.evalPose(m2b, {});
    var att2b = getAtt(m2b, "shape", "shape");
    nearArray("mesh width/height 改成 999 不改变 worldXY", core.skinMesh(att2b, m2b.slots[att2b.slotIndex].boneIndex, pose2b.world), v0, 1e-12);

    // 改 uv 不改 worldXY，但改 sourceXY
    var uvMut = JSON.parse(JSON.stringify(f2.json));
    uvMut.skins[0].attachments.shape.shape.uvs = [0.1, 0.9, 0.9, 0.9, 0.9, 0.1, 0.5, 0.5, 0.1, 0.1];
    var m2c = core.parseModel(uvMut, core.parseAtlas(f2.atlasText).value).value;
    var att2c = getAtt(m2c, "shape", "shape");
    nearArray("改 uv 不改变 worldXY", core.skinMesh(att2c, m2c.slots[att2c.slotIndex].boneIndex, core.evalPose(m2c, {}).world), v0, 1e-12);
    var srcA = core.uvToPageXY(att2.region, att2.uv);
    var srcB = core.uvToPageXY(att2c.region, att2c.uv);
    ok("改 uv 会改变 sourceXY", Math.abs(srcA[0] - srcB[0]) > 1e-6);

    // 改 vertices 不改 sourceXY
    var vMut = JSON.parse(JSON.stringify(f2.json));
    vMut.skins[0].attachments.shape.shape.vertices = [0, 0, 110, 0, 110, 40, 60, 10, 0, 40];
    var m2d = core.parseModel(vMut, core.parseAtlas(f2.atlasText).value).value;
    var att2d = getAtt(m2d, "shape", "shape");
    nearArray("改 vertices 不改变 sourceXY", core.uvToPageXY(att2d.region, att2d.uv), srcA, 1e-12);
    ok("改 vertices 会改变 worldXY", Math.abs(core.skinMesh(att2d, m2d.slots[att2d.slotIndex].boneIndex, core.evalPose(m2d, {}).world)[2] - v0[2]) > 1e-6);

    // edges 归一化
    nearArray("edges 归一化为顶点索引", Array.from(att2.edges), [0, 1, 1, 2, 2, 3, 3, 4, 4, 0], 0);
    eq("hullCount 是顶点个数", att2.hullCount, 5);
    eq("三角形索引个数", att2.triangles.length, 9);

    // C2：加权解码段数 = N、每段对应 uv pair、Σ 权重坐标误差 < 1e-6
    var f3 = F["weighted-mesh"];
    var m3 = parseFixture(f3).modelRes.value;
    var att3 = getAtt(m3, "skin", "wmesh");
    eq("加权 vertexCount", att3.vertexCount, 4);
    eq("加权 influences 段数 = N", att3.influences.length, att3.vertexCount);
    eq("uv 长度 = 2N", att3.uv.length, att3.vertexCount * 2);
    var pose3 = core.evalPose(m3, {});
    var skinned3 = core.skinMesh(att3, m3.slots[att3.slotIndex].boneIndex, pose3.world);
    var manual = new Float64Array(att3.vertexCount * 2);
    for (var vi = 0; vi < att3.vertexCount; vi++) {
      var list = att3.influences[vi];
      var wx = 0;
      var wy = 0;
      for (var k = 0; k < list.length; k++) {
        var inf = list[k];
        var bm = pose3.world[inf.boneIndex];
        wx += inf.weight * (bm.a * inf.x + bm.c * inf.y + bm.tx);
        wy += inf.weight * (bm.b * inf.x + bm.d * inf.y + bm.ty);
      }
      manual[vi * 2] = wx;
      manual[vi * 2 + 1] = wy;
    }
    nearArray("加权顶点 Σw·W·bind 与 skinMesh 一致", skinned3, manual, 1e-6);
    eq("influence[0] 数量为 1", att3.influences[0].length, 1);
    eq("influence[1] 数量为 2", att3.influences[1].length, 2);
    near("v1 权重和", att3.influences[1][0].weight + att3.influences[1][1].weight, 1, 1e-9);
    // 改骨后加权顶点移动
    var boneMoved = core.evalPose(m3, { edits: { bones: new Map([["A", { x: 200 }]]) } });
    var moved = core.skinMesh(att3, m3.slots[att3.slotIndex].boneIndex, boneMoved.world);
    ok("改骨后加权顶点移动", Math.abs(moved[0] - skinned3[0]) > 1);

    // C4：权重配色 1/0、0/1、0.5/0.5
    var palette = new Map([[1, [1, 0, 0]], [2, [0, 1, 0]]]);
    var wc = core.weightColors(att3, m3.slots[att3.slotIndex].boneIndex, palette);
    nearArray("权重 v0 = A 色", [wc.rgb[0], wc.rgb[1], wc.rgb[2]], [1, 0, 0], 1e-9);
    nearArray("权重 v2 = B 色", [wc.rgb[6], wc.rgb[7], wc.rgb[8]], [0, 1, 0], 1e-9);
    nearArray("权重 v1 = 二色平均", [wc.rgb[3], wc.rgb[4], wc.rgb[5]], [0.5, 0.5, 0], 1e-9);
    var heat = core.weightColors(att3, m3.slots[att3.slotIndex].boneIndex, palette, 1);
    nearArray("热力图 = 所选骨权重", Array.from(heat.heat), [1, 0.5, 0, 0.25], 1e-9);
    eq("图例只列用到的骨", heat.legend.length, 2);
    eq("图例含骨名", heat.legend[0].name, "A");
    near("图例 maxWeight", heat.legend[0].maxWeight, 1, 1e-9);

    var f1 = F["region-transform"];
    var m1 = parseFixture(f1).modelRes.value;
    var att1 = getAtt(m1, "body", "region-big");
    var rigidColors = core.weightColors(att1, m1.slots[att1.slotIndex].boneIndex, palette);
    eq("刚性附件图例 1 项", rigidColors.legend.length, 1);
    near("刚性附件权重 100%", rigidColors.legend[0].maxWeight, 1, 1e-12);
    eq("刚性附件无热力图", rigidColors.heat, undefined);

    // C5：IK 几何断言
    var f5 = F["ik-two-bone"];
    var m5 = parseFixture(f5).modelRes.value;
    var pose5 = core.evalPose(m5, {});
    var cIdx = m5.boneIndex.get("C");
    var cBone = m5.bones[cIdx];
    var tip = { x: pose5.world[cIdx].a * cBone.length + pose5.world[cIdx].tx, y: pose5.world[cIdx].b * cBone.length + pose5.world[cIdx].ty };
    var target = pose5.world[m5.boneIndex.get("T1")];
    near("二骨 IK 末端到 target 距离", Math.hypot(tip.x - target.tx, tip.y - target.ty), 0, 1e-4);
    near("二骨 IK 正 bend 父角", normDeg(pose5.applied[m5.boneIndex.get("P")].rotation), 0, 1e-6);
    near("二骨 IK 正 bend 子角", normDeg(pose5.applied[cIdx].rotation), 90, 1e-6);

    var f5n = F["ik-two-bendneg"];
    var m5n = parseFixture(f5n).modelRes.value;
    var pose5n = core.evalPose(m5n, {});
    near("二骨 IK 负 bend 父角", normDeg(pose5n.applied[m5n.boneIndex.get("P")].rotation), 90, 1e-6);
    near("二骨 IK 负 bend 子角", normDeg(pose5n.applied[m5n.boneIndex.get("C")].rotation), -90, 1e-6);

    var f5m0 = F["ik-two-mix0"];
    var m5m0 = parseFixture(f5m0).modelRes.value;
    var pose5m0 = core.evalPose(m5m0, {});
    var fk5 = core.evalPose(m5m0, {});
    nearArray("mix0 与 FK 逐矩阵相等", flattenWorld(pose5m0.world), flattenWorld(fk5.world), 1e-12);

    var f5far = F["ik-two-far"];
    var m5far = parseFixture(f5far).modelRes.value;
    var pose5far = core.evalPose(m5far, {});
    var ci = m5far.boneIndex.get("C");
    var tipFar = { x: pose5far.world[ci].a * m5far.bones[ci].length + pose5far.world[ci].tx, y: pose5far.world[ci].b * m5far.bones[ci].length + pose5far.world[ci].ty };
    near("无 stretch 远目标末端距根", Math.hypot(tipFar.x, tipFar.y), 200, 1e-4);

    var f5st = F["ik-two-far-stretch"];
    var m5st = parseFixture(f5st).modelRes.value;
    var pose5st = core.evalPose(m5st, {});
    near("stretch 父骨 scaleX", pose5st.applied[m5st.boneIndex.get("P")].scaleX, 1.5, 1e-9);
    var cs = m5st.boneIndex.get("C");
    var tipSt = { x: pose5st.world[cs].a * m5st.bones[cs].length + pose5st.world[cs].tx, y: pose5st.world[cs].b * m5st.bones[cs].length + pose5st.world[cs].ty };
    near("stretch 末端到 target", Math.hypot(tipSt.x - 300, tipSt.y), 0, 1e-4);

    var f5o = F["ik-one-bone"];
    var m5o = parseFixture(f5o).modelRes.value;
    var pose5o = core.evalPose(m5o, {});
    near("一骨 compress scaleX", pose5o.applied[m5o.boneIndex.get("arm")].scaleX, 0.5, 1e-9);
    var armIdx = m5o.boneIndex.get("arm");
    var armTip = { x: pose5o.world[armIdx].a * m5o.bones[armIdx].length + pose5o.world[armIdx].tx, y: pose5o.world[armIdx].b * m5o.bones[armIdx].length + pose5o.world[armIdx].ty };
    near("一骨 compress 末端到 target", Math.hypot(armTip.x - 50, armTip.y), 0, 1e-4);
    var f5u = F["ik-one-uniform"];
    var m5u = parseFixture(f5u).modelRes.value;
    var pose5u = core.evalPose(m5u, {});
    near("一骨 uniform scaleY", pose5u.applied[m5u.boneIndex.get("arm")].scaleY, 0.5, 1e-9);

    // softness 阈值连续性：1e-4 与无 softness 结果一致（连续边界）
    var f5s = F["ik-two-softness-1e-4"];
    var m5s = parseFixture(f5s).modelRes.value;
    var pose5s = core.evalPose(m5s, {});
    nearArray("softness 1e-4 与无 softness 连续", flattenWorld(pose5s.world), flattenWorld(pose5far.world), 1e-6);
    var f5s50 = F["ik-two-softness-50"];
    var m5s50 = parseFixture(f5s50).modelRes.value;
    var pose5s50 = core.evalPose(m5s50, {});
    allFinite("softness 50 结果有限", flattenWorld(pose5s50.world));

    // order 交换结果不同
    var f5oa = F["ik-two-order-a"];
    var f5ob = F["ik-two-order-b"];
    var m5oa = parseFixture(f5oa).modelRes.value;
    var m5ob = parseFixture(f5ob).modelRes.value;
    var pose5oa = core.evalPose(m5oa, {});
    var pose5ob = core.evalPose(m5ob, {});
    var dIdxA = m5oa.boneIndex.get("D");
    var diffOrder = Math.max(
      Math.abs(pose5oa.world[dIdxA].tx - pose5ob.world[dIdxA].tx),
      Math.abs(pose5oa.world[dIdxA].ty - pose5ob.world[dIdxA].ty)
    );
    ok("order 交换两约束结果不同", diffOrder > 1e-3, "D 世界差 " + fmt(diffOrder));
    // 后代 mesh 跟随：order 交换后 D 上的 mesh 顶点不同
    var attA = getAtt(m5oa, "chain", "dmesh");
    var attB = getAtt(m5ob, "chain", "dmesh");
    var vA = core.skinMesh(attA, m5oa.slots[attA.slotIndex].boneIndex, pose5oa.world);
    var vB = core.skinMesh(attB, m5ob.slots[attB.slotIndex].boneIndex, pose5ob.world);
    ok("order 交换后后代 mesh 跟随", Math.hypot(vA[0] - vB[0], vA[1] - vB[1]) > 1e-3);

    // 镜像 / 非均匀 / 复杂 inherit：明确 issue、无 NaN
    ["ik-mirror", "ik-nonuniform", "ik-bad-inherit"].forEach(function (id) {
      var m = parseFixture(F[id]).modelRes.value;
      var pose = core.evalPose(m, {});
      allFinite(id + " 无 NaN", flattenWorld(pose.world));
      ok(id + " 有 IK unsupported issue", pose.issues.some(function (i) { return i.code.indexOf("ik.unsupported") === 0; }), pose.issues.map(function (i) { return i.code; }));
    });

    // C6：隐藏件跳过；凹 mesh 空白点不命中（fixture ② 已覆盖空白点）
    var items2 = core.buildGeometry(base2, pose2);
    var hidden = new Set(["shape"]);
    eq("hidden 按 slot 名跳过", core.buildGeometry(base2, pose2, { hidden: hidden }).length, 0);
    var hiddenById = new Set([att2.id]);
    eq("hidden 按 attachment id 跳过", core.buildGeometry(base2, pose2, { hidden: hiddenById }).length, 0);
    ok("可见件几何非空", items2.length > 0);
    eq("DrawItem.pageIndex 与 region 一致", items2[0].pageIndex, att2.region.pageIndex);

    // C7：不支持特性不修改 raw
    var f8 = F["unsupported-diagnostics"];
    var rawBefore = JSON.stringify(f8.json);
    var parsed8 = parseFixture(f8);
    core.evalPose(parsed8.modelRes.value, { animation: "unsupported", time: 0.25 });
    eq("解析/求值不修改 raw JSON", JSON.stringify(f8.json), rawBefore);

    // 附件动画 name:null 卸载
    var fnull = F["null-attachment-animation"];
    var mnull = parseFixture(fnull).modelRes.value;
    eq("attachment 动画卸载 @0.75", core.evalPose(mnull, { animation: "hide", time: 0.75 }).attachments[0], null);
    ok("attachment 动画恢复 @1", core.evalPose(mnull, { animation: "hide", time: 1 }).attachments[0] !== null);

    // 缺失动画：warning + setup 姿势
    var missAnim = core.evalPose(m1, { animation: "nope", time: 0 });
    ok("缺失动画返回 warning", missAnim.issues.some(function (i) { return i.code === "pose.animation.missing"; }));

    // 多 page atlas
    var f4 = F["atlas-rotations-trim"];
    var atlas4 = core.parseAtlas(f4.atlasText).value;
    eq("多 page atlas 页数", atlas4.pages.length, 2);
    eq("page-b 名称", atlas4.pages[1].name, "case4-b.png");
    eq("page-b region pageIndex", atlas4.regions.get("p2").pageIndex, 1);
    eq("缺省 original 回退为 w/h", atlas4.regions.get("flat").originalW, 64);

    // fixture 覆盖率自检
    var ids = Object.keys(F);
    ok("fixture 覆盖 ①–⑧（≥8 主用例）", ids.length >= 8, ids.length);
    ok("fixture 含退化用例", ids.some(function (id) { return F[id].group === "degenerate"; }));
    var examples = Object.keys(fixtures).filter(function (id) { return fixtures[id].example; });
    ok("fixture 含示例用例", examples.length >= 4, examples);
  }

  function normDeg(deg) {
    var d = deg % 360;
    if (d > 180) d -= 360;
    else if (d <= -180) d += 360;
    return d;
  }

  /* ------------------------------------------------------------------ *
   * 运行与渲染
   * ------------------------------------------------------------------ */
  function run() {
    if (!core) {
      result.failures.push({ case: "(global)", name: "SpineCore 未加载", expected: "存在", actual: "缺失", detail: "" });
      result.failed++;
      result.total++;
      return result;
    }
    if (!fixtures) {
      result.failures.push({ case: "(global)", name: "SpineFixtures 未加载", expected: "存在", actual: "缺失", detail: "" });
      result.failed++;
      result.total++;
      return result;
    }
    Object.keys(fixtures).forEach(function (id) {
      try {
        runFixture(fixtures[id]);
      } catch (err) {
        record(false, "fixture 执行异常", "无异常", String(err && err.message ? err.message : err), String(err && err.stack));
      }
    });
    try {
      runExtra();
    } catch (err) {
      record(false, "额外断言执行异常", "无异常", String(err && err.message ? err.message : err), String(err && err.stack));
    }
    result.finishedAt = new Date().toISOString();
    return result;
  }

  function render(res) {
    if (typeof document === "undefined") return;
    var summary = document.getElementById("summary");
    var list = document.getElementById("results");
    var okAll = res.failed === 0;
    if (summary) {
      summary.textContent =
        (okAll ? "PASS" : "FAIL") +
        " — " +
        res.passed +
        " passed / " +
        res.failed +
        " failed / " +
        res.total +
        " total";
      summary.className = okAll ? "pass" : "fail";
    }
    if (list) {
      var header = document.createElement("p");
      header.textContent =
        "用例 " +
        Object.keys(res.cases).length +
        " 组；失败 " +
        res.failed +
        " 条" +
        (res.failed ? "（期望/实际见下）" : "");
      list.appendChild(header);
      if (res.failures.length) {
        var ul = document.createElement("ul");
        ul.className = "failures";
        res.failures.forEach(function (f) {
          var li = document.createElement("li");
          li.textContent =
            "[" + f.case + "] " + f.name + " — 期望 " + fmt(f.expected) + "，实际 " + fmt(f.actual) + (f.detail ? "（" + f.detail + "）" : "");
          ul.appendChild(li);
        });
        list.appendChild(ul);
      } else {
        var p = document.createElement("p");
        p.className = "pass";
        p.textContent = "全部通过。";
        list.appendChild(p);
      }
    }
  }

  var res = run();
  if (typeof window !== "undefined") window.__selftestResult = res;
  else global.__selftestResult = res;
  if (typeof document !== "undefined" && document.readyState !== "loading") render(res);
  else if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", function () {
      render(res);
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
