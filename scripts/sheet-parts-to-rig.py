#!/usr/bin/env python3
"""绿幕拆件 sheet → Spine 4.2 骨架（通用版，项目内可复用）。

输入：一张纯绿背景的拆件图（各部件互不接触），例如由生图 API 生成的
      "character parts sheet"。也接受白底：--key white。
输出：<out>/images/part_XX.png + <out>/<name>.json（Spine 4.2 骨架），
      随后用 spine-pack.py 打包、spine-verify.mjs 校验。

层序约定：默认按「面积从大到小」排前后（大衣身在后，小配件在前），
可用 --names 显式指定 back→front 的层名来固定顺序与命名。

限制：每个部件一根骨骼、绕自身中心旋转，不做网格与权重；
真正的二段式肢体（上臂/前臂）需要拆得更细或手工调骨。
"""
import argparse
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage

MIN_AREA_RATIO = 0.0008  # 小于整图的 0.08% 视为噪点


def key_green(rgb):
    r, g, b = [rgb[..., i].astype(np.int16) for i in range(3)]
    spill = g - np.maximum(r, b)
    alpha = np.clip((80 - spill) / 60.0, 0, 1)
    out = rgb.copy()
    g2 = np.minimum(g, np.maximum(r, b) + 4)
    out[..., 1] = np.where(spill > 4, g2, g).astype(np.uint8)
    return out, (alpha * 255).astype(np.uint8)


def key_white(rgb):
    mn = rgb.min(axis=2).astype(np.int16)
    mx = rgb.max(axis=2).astype(np.int16)
    near = (mn >= 238) & ((mx - mn) <= 12)
    lab, n = ndimage.label(near)
    if n:
        border = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
        border.discard(0)
        bg = np.isin(lab, list(border))
    else:
        bg = near
    return rgb, np.where(bg, 0, 255).astype(np.uint8)


def cut_parts(rgb, alpha, min_area):
    subj = alpha > 128
    lab, n = ndimage.label(subj)
    parts = []
    for i in range(1, n + 1):
        m = lab == i
        area = int(m.sum())
        if area < min_area:
            continue
        ys, xs = np.where(m)
        parts.append({
            "mask": m,
            "area": area,
            "box": (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1),
        })
    # 前后顺序：面积大的在后
    parts.sort(key=lambda p: -p["area"])
    return parts


def build_skeleton(name, placements, canvas_w, canvas_h):
    """placements: [{name,w,h,cx,cy}]，cx/cy 为画布坐标（y 向下），脚底为 y=下边界。"""
    feet_y = max(p["cy"] + p["h"] / 2 for p in placements)
    bones = [{"name": "root"}]
    slots, att_by_slot = [], {}
    for p in placements:
        bone = f"b_{p['name']}"
        bones.append({
            "name": bone, "parent": "root",
            "x": round(p["cx"] - canvas_w / 2, 2),
            "y": round(feet_y - p["cy"], 2),
        })
        slots.append({"name": f"s_{p['name']}", "bone": bone, "attachment": p["name"]})
        att_by_slot[f"s_{p['name']}"] = {
            p["name"]: {"x": 0, "y": 0, "width": p["w"], "height": p["h"]}
        }

    def k(t, **kw):
        d = {"time": round(t, 3)}
        d.update(kw)
        return d

    # 整身动画挂在 root 上；有 head 部件时额外给头部一点偏移
    anims = {
        "idle": {"bones": {"root": {
            "scaleY": [k(0, value=1), k(1.0, value=1.015), k(2.0, value=1)],
            "rotate": [k(0, value=0), k(1.0, value=0.6), k(2.0, value=0)]}}},
        "working": {"bones": {"root": {
            "translate": [k(0, y=0), k(0.25, y=8), k(0.5, y=0), k(0.75, y=8), k(1.0, y=0)],
            "rotate": [k(0, value=1.5), k(0.5, value=-1.5), k(1.0, value=1.5)]}}},
        "attention": {"bones": {"root": {
            "scaleX": [k(0, value=1), k(0.12, value=1.04), k(0.24, value=1), k(0.36, value=1.04), k(0.5, value=1)],
            "rotate": [k(0, value=0), k(0.08, value=3), k(0.16, value=-3), k(0.24, value=2), k(0.5, value=0)]}}},
        "done": {"bones": {"root": {
            "translate": [k(0, y=0), k(0.15, y=-10), k(0.35, y=60), k(0.6, y=0), k(1.0, y=0)],
            "scaleY": [k(0, value=1), k(0.15, value=0.92), k(0.35, value=1.06), k(1.0, value=1)]}}},
        "failed": {"bones": {"root": {
            "rotate": [k(0, value=0), k(0.4, value=-3), k(3.0, value=-3)],
            "translate": [k(0, y=0), k(0.4, y=-10), k(3.0, y=-10)]}}},
    }
    return {
        "skeleton": {"spine": "4.2.00", "x": -canvas_w / 2, "y": -20,
                     "width": canvas_w, "height": canvas_h + 40},
        "bones": bones,
        "slots": slots,
        "skins": [{"name": "default", "attachments": att_by_slot}],
        "animations": anims,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("out")
    ap.add_argument("--name", default="model")
    ap.add_argument("--key", choices=("green", "white"), default="green")
    ap.add_argument("--names", default=None, help="逗号分隔，back→front 的层名（数量需与切出的件一致）")
    ap.add_argument("--min-area-ratio", type=float, default=MIN_AREA_RATIO)
    ap.add_argument("--layout", choices=("inplace", "center"), default="inplace",
                    help="inplace=部件保持 sheet 上的原始位置（要求拆件图原位分离）；"
                         "center=全部居中堆叠（格子排布的 sheet 只能这样凑合）")
    ap.add_argument("--draw-order", default=None,
                    help="逗号分隔的层名，指定 back→front 的绘制顺序（未列出的按原顺序追加）")
    a = ap.parse_args()

    src = Image.open(a.sheet).convert("RGB")
    rgb = np.array(src)
    canvas_w, canvas_h = src.size
    rgb2, alpha = (key_green if a.key == "green" else key_white)(rgb)
    parts = cut_parts(rgb2, alpha, int(canvas_w * canvas_h * a.min_area_ratio))
    print(f"输入 {canvas_w}x{canvas_h}，切出 {len(parts)} 个部件")
    if not parts:
        raise SystemExit("没有切出任何部件：检查背景色与 --key")

    names = a.names.split(",") if a.names else None
    if names and len(names) != len(parts):
        raise SystemExit(f"--names 给了 {len(names)} 个名字，但切出 {len(parts)} 个部件")

    os.makedirs(os.path.join(a.out, "images"), exist_ok=True)
    placements = []
    for i, p in enumerate(parts):
        x0, y0, x1, y1 = p["box"]
        w, h = x1 - x0, y1 - y0
        layer = np.zeros((h, w, 4), np.uint8)
        layer[..., :3] = rgb2[y0:y1, x0:x1]
        layer[..., 3] = alpha[y0:y1, x0:x1] * p["mask"][y0:y1, x0:x1]
        part_name = names[i] if names else f"part_{i:02d}"
        Image.fromarray(layer, "RGBA").save(os.path.join(a.out, "images", f"{part_name}.png"))
        placements.append({"name": part_name, "w": w, "h": h,
                           "cx": (x0 + x1) / 2, "cy": (y0 + y1) / 2})
        print(f"  {part_name}: {w}x{h}  面积 {p['area']}")

    if a.layout == "center":
        ccx, ccy = canvas_w / 2, canvas_h / 2
        for pl in placements:
            pl["cx"], pl["cy"] = ccx, ccy
        print("布局：center（所有部件居中堆叠）")
    else:
        print("布局：inplace（使用 sheet 原始坐标，要求原位分离）")

    if a.draw_order:
        want = [n.strip() for n in a.draw_order.split(",") if n.strip()]
        by_name = {p["name"]: p for p in placements}
        unknown = [n for n in want if n not in by_name]
        if unknown:
            raise SystemExit(f"--draw-order 里有未知层名: {unknown}")
        placements = [by_name[n] for n in want] + [p for p in placements if p["name"] not in want]
        print("绘制顺序：" + " → ".join(p["name"] for p in placements))

    skel = build_skeleton(a.name, placements, canvas_w, canvas_h)
    path = os.path.join(a.out, f"{a.name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(skel, f, ensure_ascii=False, indent=1)
    print(f"骨架已写出：{path}（{len(skel['bones'])} 骨 / {len(skel['slots'])} 槽）")


if __name__ == "__main__":
    main()
