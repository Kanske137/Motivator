import * as THREE from "three";

/**
 * Off-screen Three.js-rendering av canvas-mesh i fyra fasta kameravinklar.
 *
 * Återanvänder samma UV-mappning som `Canvas3DPreview` använder för den
 * interaktiva 3D-vyn: tryckfilen är layoutad som
 *   [ bleed | wrap | FRONT | wrap | bleed ]   (per axel)
 * och varje sida av boxen samplar sin region av filen så att fronten visar
 * motivet och sidorna visar wrap-fortsättningen sömlöst.
 *
 * Bakgrunden renderas TRANSPARENT så vi kan composita in canvasen i en
 * fotograferad rumsmiljö efteråt — då stämmer perspektivet eftersom rummet
 * är fotograferat från samma vinkel som kameran står i här.
 */

export type CanvasViewKey = "front" | "right" | "left" | "bottom";

export interface CanvasViewSet {
  front: string;
  right: string;
  left: string;
  bottom: string;
}

interface RenderArgs {
  printUrl: string;
  widthCm: number;
  heightCm: number;
  depthCm: number;
  bleedCm: number;
  /** Output-storlek per vy (px). Default 900. */
  size?: number;
}

function loadTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      url,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        resolve(t);
      },
      undefined,
      (err) => reject(err instanceof Error ? err : new Error("Texture load failed")),
    );
  });
}

/**
 * Bygg de sex materialen för box-meshen, identiskt med `Canvas3DPreview`.
 * BoxGeometry-ordning: [+X, -X, +Y, -Y, +Z, -Z] = right, left, top, bottom, front, back.
 */
function buildMaterials(
  texture: THREE.Texture,
  widthCm: number,
  heightCm: number,
  depthCm: number,
  bleedCm: number,
): THREE.Material[] {
  const totalW = widthCm + 2 * depthCm + 2 * bleedCm;
  const totalH = heightCm + 2 * depthCm + 2 * bleedCm;
  const fFrontX = widthCm / totalW;
  const fFrontY = heightCm / totalH;
  const fWrapX = depthCm / totalW;
  const fWrapY = depthCm / totalH;
  const fBleedX = bleedCm / totalW;
  const fBleedY = bleedCm / totalH;

  const make = (
    offsetX: number,
    offsetY: number,
    repeatX: number,
    repeatY: number,
    flipX = false,
    flipY = false,
  ) => {
    const t = texture.clone();
    t.needsUpdate = true;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    const uvOffsetX = offsetX;
    const uvOffsetY = 1 - (offsetY + repeatY);
    t.offset.set(
      flipX ? uvOffsetX + repeatX : uvOffsetX,
      flipY ? uvOffsetY + repeatY : uvOffsetY,
    );
    t.repeat.set(flipX ? -repeatX : repeatX, flipY ? -repeatY : repeatY);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, metalness: 0 });
  };

  const front = make(fBleedX + fWrapX, fBleedY + fWrapY, fFrontX, fFrontY);
  const right = make(fBleedX + fWrapX + fFrontX, fBleedY + fWrapY, fWrapX, fFrontY, true, false);
  const left = make(fBleedX, fBleedY + fWrapY, fWrapX, fFrontY);
  const top = make(fBleedX + fWrapX, fBleedY, fFrontX, fWrapY);
  const bottom = make(fBleedX + fWrapX, fBleedY + fWrapY + fFrontY, fFrontX, fWrapY);
  const back = new THREE.MeshStandardMaterial({ color: "#e8e4dc", roughness: 0.95 });

  return [right, left, top, bottom, front, back];
}

/**
 * Kameraposition + fov för varje fast vy. Alla riktas mot origo (canvasens centrum).
 *
 * Vinklarna matchar de fyra fotograferade rumsmiljöerna i `mockup-scenes.ts`.
 */
const VIEW_CAMERAS: Record<CanvasViewKey, { pos: [number, number, number]; fov: number }> = {
  front: { pos: [0, 0, 3.6], fov: 32 },
  // Höger: kameran står till höger om canvasen, tittar in mot vänster.
  // → höger sida av canvasen blir synlig
  right: { pos: [1.55, 0, 3.0], fov: 32 },
  // Vänster: spegelvänd
  left: { pos: [-1.55, 0, 3.0], fov: 32 },
  // Underifrån: kameran sänkt under canvasens centrum, tittar uppåt
  // → ovansidan av canvasen blir synlig
  bottom: { pos: [0, -1.5, 3.0], fov: 34 },
};

export async function renderCanvas3DViews({
  printUrl,
  widthCm,
  heightCm,
  depthCm,
  bleedCm,
  size = 900,
}: RenderArgs): Promise<CanvasViewSet> {
  const texture = await loadTexture(printUrl);

  // Normalisera box-storlek så största front-sidan = 2 enheter.
  const maxCm = Math.max(widthCm, heightCm);
  const w = (widthCm / maxCm) * 2;
  const h = (heightCm / maxCm) * 2;
  const d = (depthCm / maxCm) * 2;

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0); // transparent

  const scene = new THREE.Scene();

  // Belysning — samma riktning för alla vyer så ljuset känns konsekvent
  // när bilderna ses bredvid varandra. Lite uppifrån-vänster (fönsterljus).
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 1.05);
  key.position.set(-3, 4, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.25);
  fill.position.set(3, 2, 2);
  scene.add(fill);

  const materials = buildMaterials(texture, widthCm, heightCm, depthCm, bleedCm);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials);
  scene.add(mesh);

  const result: Partial<CanvasViewSet> = {};
  const keys: CanvasViewKey[] = ["front", "right", "left", "bottom"];

  try {
    for (const key of keys) {
      const cfg = VIEW_CAMERAS[key];
      const cam = new THREE.PerspectiveCamera(cfg.fov, 1, 0.1, 100);
      cam.position.set(...cfg.pos);
      cam.lookAt(0, 0, 0);
      renderer.render(scene, cam);
      result[key] = renderer.domElement.toDataURL("image/png");
    }
  } finally {
    // Cleanup för att inte läcka GPU-minne mellan re-renders i editorn.
    mesh.geometry.dispose();
    materials.forEach((m) => {
      const mat = m as THREE.MeshStandardMaterial;
      mat.map?.dispose();
      mat.dispose();
    });
    texture.dispose();
    renderer.dispose();
  }

  return result as CanvasViewSet;
}
