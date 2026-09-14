import type { Geometry } from './types';

// Procedural geometry shared by every engine, so triangle counts are identical.
// Winding is CCW for outward faces (right-handed, Y-up). Generators mirror three.js's
// well-tested ones so the output is known-good.

function make(name: string, pos: number[], nrm: number[], uv: number[], idx: number[]): Geometry {
  return {
    name,
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    uvs: new Float32Array(uv),
    indices: pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx),
  };
}

export function box(size = 1): Geometry {
  const h = size / 2;
  // [normal, u axis, v axis] with u × v = normal so corners come out CCW.
  const faces: number[][][] = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [n, u, v] of faces) {
    const base = pos.length / 3;
    for (const [su, sv] of corners) {
      for (let k = 0; k < 3; k++) pos.push(h * (n[k] + su * u[k] + sv * v[k]));
      nrm.push(n[0], n[1], n[2]);
      uv.push((su + 1) / 2, (sv + 1) / 2);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return make('box', pos, nrm, uv, idx);
}

export function sphere(radius = 0.5, widthSegments = 24, heightSegments = 16): Geometry {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  const grid: number[][] = [];
  let index = 0;
  for (let iy = 0; iy <= heightSegments; iy++) {
    const row: number[] = [];
    const v = iy / heightSegments;
    for (let ix = 0; ix <= widthSegments; ix++) {
      const u = ix / widthSegments;
      const x = -radius * Math.cos(u * Math.PI * 2) * Math.sin(v * Math.PI);
      const y = radius * Math.cos(v * Math.PI);
      const z = radius * Math.sin(u * Math.PI * 2) * Math.sin(v * Math.PI);
      pos.push(x, y, z);
      const l = Math.hypot(x, y, z) || 1;
      nrm.push(x / l, y / l, z / l);
      uv.push(u, 1 - v);
      row.push(index++);
    }
    grid.push(row);
  }
  for (let iy = 0; iy < heightSegments; iy++) {
    for (let ix = 0; ix < widthSegments; ix++) {
      const a = grid[iy][ix + 1], b = grid[iy][ix], c = grid[iy + 1][ix], d = grid[iy + 1][ix + 1];
      if (iy !== 0) idx.push(a, b, d);
      if (iy !== heightSegments - 1) idx.push(b, c, d);
    }
  }
  return make(`sphere${widthSegments}x${heightSegments}`, pos, nrm, uv, idx);
}

export function cylinder(radiusTop = 0.5, radiusBottom = 0.5, height = 1, radialSegments = 24, name = 'cylinder'): Geometry {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  const halfH = height / 2;
  const slope = (radiusBottom - radiusTop) / height;
  let index = 0;
  const grid: number[][] = [];
  for (let y = 0; y <= 1; y++) {
    const row: number[] = [];
    const radius = y * (radiusBottom - radiusTop) + radiusTop;
    for (let x = 0; x <= radialSegments; x++) {
      const u = x / radialSegments;
      const theta = u * Math.PI * 2;
      const s = Math.sin(theta), c = Math.cos(theta);
      pos.push(radius * s, -y * height + halfH, radius * c);
      const l = Math.hypot(s, slope, c);
      nrm.push(s / l, slope / l, c / l);
      uv.push(u, 1 - y);
      row.push(index++);
    }
    grid.push(row);
  }
  for (let x = 0; x < radialSegments; x++) {
    const a = grid[0][x], b = grid[1][x], c = grid[1][x + 1], d = grid[0][x + 1];
    if (radiusTop > 0) idx.push(a, b, d);
    if (radiusBottom > 0) idx.push(b, c, d);
  }
  const cap = (top: boolean) => {
    const radius = top ? radiusTop : radiusBottom;
    const sign = top ? 1 : -1;
    const centerStart = index;
    for (let x = 1; x <= radialSegments; x++) {
      pos.push(0, halfH * sign, 0);
      nrm.push(0, sign, 0);
      uv.push(0.5, 0.5);
      index++;
    }
    const centerEnd = index;
    for (let x = 0; x <= radialSegments; x++) {
      const theta = (x / radialSegments) * Math.PI * 2;
      const s = Math.sin(theta), c = Math.cos(theta);
      pos.push(radius * s, halfH * sign, radius * c);
      nrm.push(0, sign, 0);
      uv.push(c * 0.5 + 0.5, s * 0.5 * sign + 0.5);
      index++;
    }
    for (let x = 0; x < radialSegments; x++) {
      const c = centerStart + x, i = centerEnd + x;
      if (top) idx.push(i, i + 1, c);
      else idx.push(i + 1, i, c);
    }
  };
  if (radiusTop > 0) cap(true);
  if (radiusBottom > 0) cap(false);
  return make(name, pos, nrm, uv, idx);
}

export function torus(radius = 0.35, tube = 0.15, radialSegments = 16, tubularSegments = 32): Geometry {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= radialSegments; j++) {
    for (let i = 0; i <= tubularSegments; i++) {
      const u = (i / tubularSegments) * Math.PI * 2;
      const v = (j / radialSegments) * Math.PI * 2;
      const x = (radius + tube * Math.cos(v)) * Math.cos(u);
      const y = (radius + tube * Math.cos(v)) * Math.sin(u);
      const z = tube * Math.sin(v);
      pos.push(x, y, z);
      const cx = radius * Math.cos(u), cy = radius * Math.sin(u);
      const nx = x - cx, ny = y - cy, nz = z;
      const l = Math.hypot(nx, ny, nz) || 1;
      nrm.push(nx / l, ny / l, nz / l);
      uv.push(i / tubularSegments, j / radialSegments);
    }
  }
  for (let j = 1; j <= radialSegments; j++) {
    for (let i = 1; i <= tubularSegments; i++) {
      const a = (tubularSegments + 1) * j + i - 1;
      const b = (tubularSegments + 1) * (j - 1) + i - 1;
      const c = (tubularSegments + 1) * (j - 1) + i;
      const d = (tubularSegments + 1) * j + i;
      idx.push(a, b, d, b, c, d);
    }
  }
  return make('torus', pos, nrm, uv, idx);
}

/** Flat-shaded polyhedron from unit-sphere vertices + CCW face indices, scaled to `radius`. */
function polyhedron(name: string, verts: number[], faces: number[], radius: number): Geometry {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  const v = (i: number) => {
    const x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2];
    const l = Math.hypot(x, y, z);
    return [(x / l) * radius, (y / l) * radius, (z / l) * radius];
  };
  for (let f = 0; f < faces.length; f += 3) {
    const a = v(faces[f]), b = v(faces[f + 1]), c = v(faces[f + 2]);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    const base = pos.length / 3;
    for (const p of [a, b, c]) {
      pos.push(p[0], p[1], p[2]);
      nrm.push(n[0] / l, n[1] / l, n[2] / l);
    }
    uv.push(0, 0, 1, 0, 0.5, 1);
    idx.push(base, base + 1, base + 2);
  }
  return make(name, pos, nrm, uv, idx);
}

export function icosahedron(radius = 0.5): Geometry {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [-1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1];
  const faces = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
  return polyhedron('icosahedron', verts, faces, radius);
}

export function octahedron(radius = 0.5): Geometry {
  const verts = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];
  const faces = [0, 2, 4, 0, 4, 3, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 3, 1, 3, 4, 1, 4, 2];
  return polyhedron('octahedron', verts, faces, radius);
}

export function plane(size: number): Geometry {
  const h = size / 2;
  return make(
    'plane',
    [-h, 0, h, h, 0, h, h, 0, -h, -h, 0, -h],
    [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    [0, 0, 1, 0, 1, 1, 0, 1],
    [0, 1, 2, 0, 2, 3],
  );
}

/** The 8 geometry types used by field scenarios. */
export function fieldGeometries(): Geometry[] {
  return [
    box(),
    sphere(0.5, 24, 16),
    cylinder(0.5, 0.5, 1, 24),
    cylinder(0, 0.5, 1, 24, 'cone'),
    torus(),
    icosahedron(),
    octahedron(),
    sphere(0.5, 8, 6),
  ];
}
