import * as THREE from "three";

/**
 * Procedurellt genererad normal-map som efterliknar canvas-väv (kors-tvärs-väv).
 * Ingen extern asset — ren DataTexture.
 *
 * Vi bygger ett höjdfält genom att kombinera två sinusvågor (varp + väft) och
 * räknar centrala differenser för att få normaler. Resultatet är en kaklad
 * RGB-texture (R=X, G=Y, B=Z) som kan användas som `normalMap`.
 */
let cached: THREE.DataTexture | null = null;

export function getCanvasWeaveNormalMap(size = 256): THREE.DataTexture {
  if (cached) return cached;

  const data = new Uint8Array(size * size * 4);
  const freq = 24; // antal trådar per textur-sida
  const TWO_PI = Math.PI * 2;

  // Beräkna höjdfält först
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // Två korsande sinusvågor → väv-mönster
      const warp = Math.sin(u * TWO_PI * freq);
      const weft = Math.sin(v * TWO_PI * freq);
      // Lägg lite brus för att undvika perfekt regelbundenhet
      const noise = (Math.sin(u * 137.7 + v * 91.3) * 0.5 + 0.5) * 0.15;
      heights[y * size + x] = (warp + weft) * 0.5 + noise * 0.3;
    }
  }

  // Räkna normaler från höjdfältet (central differens, kaklat)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size;
      const xr = (x + 1) % size;
      const yu = (y - 1 + size) % size;
      const yd = (y + 1) % size;
      const dx = heights[y * size + xr] - heights[y * size + xl];
      const dy = heights[yd * size + x] - heights[yu * size + x];
      // Strength
      const s = 1.5;
      const nx = -dx * s;
      const ny = -dy * s;
      const nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const i = (y * size + x) * 4;
      data[i] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  cached = tex;
  return tex;
}
