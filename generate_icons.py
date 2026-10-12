# -*- coding: utf-8 -*-
"""生成 Chrome 扩展图标（纯 Python，无第三方依赖）。
设计：靛蓝圆角底 + 白色书签飘带（底部 V 形缺口）。
输出：icon16.png / icon48.png / icon128.png
"""
import struct
import zlib
import math

BG = (79, 70, 229, 255)      # #4F46E5 靛蓝
WHITE = (255, 255, 255, 255)


def make_icon(size):
    # 像素缓冲，初始为透明
    buf = [[(0, 0, 0, 0) for _ in range(size)] for _ in range(size)]
    cx = size / 2.0
    r = size * 0.22          # 圆角半径
    bw = size * 0.17         # 书签半宽
    y0 = size * 0.20         # 顶部
    y1 = size * 0.80         # 底部
    notch_h = size * 0.18    # V 缺口高度

    for y in range(size):
        for x in range(size):
            # 背景：圆角矩形
            inside = True
            # 圆角判断
            if x < r and y < r:
                if math.hypot(x - r, y - r) > r:
                    inside = False
            elif x > size - r and y < r:
                if math.hypot(x - (size - r), y - r) > r:
                    inside = False
            elif x < r and y > size - r:
                if math.hypot(x - r, y - (size - r)) > r:
                    inside = False
            elif x > size - r and y > size - r:
                if math.hypot(x - (size - r), y - (size - r)) > r:
                    inside = False
            if inside:
                buf[y][x] = BG

            # 书签飘带（白色），叠加在背景之上
            if (cx - bw) <= x <= (cx + bw) and y0 <= y <= y1:
                # 顶部圆角
                top_r = size * 0.06
                if y < y0 + top_r:
                    if x < cx - bw + top_r and y < y0 + top_r:
                        if math.hypot(x - (cx - bw + top_r), y - (y0 + top_r)) > top_r:
                            continue
                    if x > cx + bw - top_r and y < y0 + top_r:
                        if math.hypot(x - (cx + bw - top_r), y - (y0 + top_r)) > top_r:
                            continue
                # 底部 V 形缺口
                if y > y1 - notch_h:
                    dy = (y - (y1 - notch_h)) / notch_h   # 0..1
                    limit = dy * bw
                    if abs(x - cx) < limit:
                        continue
                buf[y][x] = WHITE
    return buf


def write_png(path, buf):
    size = len(buf)
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0
        for x in range(size):
            r, g, b, a = buf[y][x]
            raw.extend((r, g, b, a))
    compressed = zlib.compress(bytes(raw), 9)

    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        crc = zlib.crc32(typ + data) & 0xffffffff
        return c + struct.pack(">I", crc)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", compressed)
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    for s in (16, 48, 128):
        write_png(f"icon{s}.png", make_icon(s))
        print(f"icon{s}.png generated")
