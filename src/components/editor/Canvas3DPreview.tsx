import { Suspense, useMemo, useRef, useState, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import { Loader2, AlertCircle } from "lucide-react";

interface Canvas3DPreviewProps {
  printUrl: string | null;
  loading: boolean;
  error?: string;
  /** Aspect ratio of the print: width/height in cm */
  widthCm: number;
  heightCm: number;
  depthCm: number;
}

/** Shared cache so each thumbnail doesn't re-download the same texture. */
function useTexture(url: string | null) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!url) { setTex(null); return; }
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(url, (t) => {
      if (cancelled) return;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      setTex(t);
    });
    return () => { cancelled = true; };
  }, [url]);
  return tex;
}

/**
 * Canvas mesh: BoxGeometry with per-face materials.
 * Front uses the print texture with default UVs.
 * Side/top/bottom faces sample the outermost edge of the print to simulate wrap.
 * Bleed width is proportional to canvas depth so the wrap continues seamlessly
 * from the front edges around the sides/top/bottom.
 */
function CanvasMesh({
  texture, widthCm, heightCm, depthCm, autoRotate,
}: {
  texture: THREE.Texture; widthCm: number; heightCm: number; depthCm: number; autoRotate: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  // Normalize size so the largest dimension = 2 units
  const maxCm = Math.max(widthCm, heightCm);
  const w = (widthCm / maxCm) * 2;
  const h = (heightCm / maxCm) * 2;
  const d = (depthCm / maxCm) * 2;

  // Build edge textures by cropping the print texture via canvas. Bleed width
  // is sized to actual canvas depth so the wrap content fully covers the side
  // (otherwise top/bottom looked empty/stretched).
  const edgeTextures = useMemo(() => {
    if (!texture.image) return null;
    const img = texture.image as HTMLImageElement | HTMLCanvasElement;
    const iw = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width;
    const ih = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height;
    if (!iw || !ih) return null;

    const bleedX = Math.min(0.25, depthCm / widthCm);  // for left/right strips
    const bleedY = Math.min(0.25, depthCm / heightCm); // for top/bottom strips

    const make = (sx: number, sy: number, sw: number, sh: number) => {
      const c = document.createElement("canvas");
      c.width = Math.max(64, Math.round(sw));
      c.height = Math.max(64, Math.round(sh));
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img as CanvasImageSource, sx, sy, sw, sh, 0, 0, c.width, c.height);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.anisotropy = 8;
      return t;
    };

    return {
      right: make(iw * (1 - bleedX), 0, iw * bleedX, ih),
      left: make(0, 0, iw * bleedX, ih),
      top: make(0, 0, iw, ih * bleedY),
      bottom: make(0, ih * (1 - bleedY), iw, ih * bleedY),
    };
  }, [texture, widthCm, heightCm, depthCm]);

  useFrame((_, dt) => {
    if (autoRotate && meshRef.current) {
      meshRef.current.rotation.y += dt * 0.15;
    }
  });

  // BoxGeometry material order: [+X, -X, +Y, -Y, +Z, -Z] = right, left, top, bottom, front, back
  const materials = useMemo(() => {
    const front = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85, metalness: 0 });
    const back = new THREE.MeshStandardMaterial({ color: "#e8e4dc", roughness: 0.95 });
    if (!edgeTextures) {
      const side = new THREE.MeshStandardMaterial({ color: "#d8d4cc", roughness: 0.9 });
      return [side, side, side, side, front, back];
    }

    // Top face (+Y): default UV runs (printWidth → X box-axis, depth → Z box-axis).
    // We want the strip's edge nearest the front to be the bottom row of pixels
    // in our top-strip (which is the row closest to the print's top edge).
    // Default UV V=0 maps to back of box, V=1 to front. Our strip's V=0 is the
    // top-most pixel of the print. Flip V so V=1 (front) corresponds to the
    // pixel row touching the front face.
    const topMap = edgeTextures.top.clone();
    topMap.needsUpdate = true;
    topMap.wrapS = THREE.ClampToEdgeWrapping;
    topMap.wrapT = THREE.ClampToEdgeWrapping;
    topMap.center.set(0.5, 0.5);
    topMap.repeat.set(1, -1);

    // Bottom face (-Y): default UV V=0 maps to front, V=1 to back. Our strip's
    // V=1 is the bottom-most pixel of the print (the row touching the front
    // bottom edge). Flip V so the front-edge pixel is at the front of the box.
    const bottomMap = edgeTextures.bottom.clone();
    bottomMap.needsUpdate = true;
    bottomMap.wrapS = THREE.ClampToEdgeWrapping;
    bottomMap.wrapT = THREE.ClampToEdgeWrapping;
    bottomMap.center.set(0.5, 0.5);
    bottomMap.repeat.set(1, -1);

    return [
      new THREE.MeshStandardMaterial({ map: edgeTextures.right, roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ map: edgeTextures.left, roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ map: topMap, roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ map: bottomMap, roughness: 0.85 }),
      front,
      back,
    ];
  }, [texture, edgeTextures]);

  return (
    <mesh ref={meshRef} castShadow receiveShadow material={materials}>
      <boxGeometry args={[w, h, d]} />
    </mesh>
  );
}

function Scene({
  printUrl, widthCm, heightCm, depthCm,
}: {
  printUrl: string;
  widthCm: number; heightCm: number; depthCm: number;
}) {
  const tex = useTexture(printUrl);
  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight
        position={[3, 4, 5]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-3, 2, 2]} intensity={0.3} />
      {tex && (
        <CanvasMesh
          texture={tex}
          widthCm={widthCm}
          heightCm={heightCm}
          depthCm={depthCm}
          autoRotate={false}
        />
      )}
      <ContactShadows position={[0, -1.4, 0]} opacity={0.35} scale={6} blur={2.4} far={2} />
      <OrbitControls
        enablePan={false}
        enableZoom={false}
        minPolarAngle={Math.PI / 2 - Math.PI / 4}
        maxPolarAngle={Math.PI / 2 + Math.PI / 4}
        minAzimuthAngle={-Math.PI / 4}
        maxAzimuthAngle={Math.PI / 4}
      />
    </>
  );
}

export function Canvas3DPreview({
  printUrl, loading, error, widthCm, heightCm, depthCm,
}: Canvas3DPreviewProps) {
  return (
    <div className="border-t bg-[hsl(var(--paper))]">
      <div className="px-4 py-3">
        <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3">
          3D-förhandsvisning
        </h3>
        <div
          className="w-full rounded-2xl overflow-hidden bg-card border relative"
          style={{ height: "min(60vh, 520px)" }}
        >
          {loading || !printUrl ? (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/40 animate-pulse">
              {error ? (
                <div className="flex flex-col items-center text-destructive text-xs p-4 text-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  <span className="line-clamp-3">{error}</span>
                </div>
              ) : (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              )}
            </div>
          ) : (
            <Canvas
              shadows
              dpr={[1, 2]}
              camera={{ position: [0, 0, 3.6], fov: 35 }}
              gl={{ preserveDrawingBuffer: false, antialias: true }}
            >
              <color attach="background" args={["#f5f2ec"]} />
              <Suspense fallback={null}>
                <Scene
                  printUrl={printUrl}
                  widthCm={widthCm}
                  heightCm={heightCm}
                  depthCm={depthCm}
                />
              </Suspense>
            </Canvas>
          )}
          <div className="absolute bottom-2 right-3 text-[11px] text-muted-foreground bg-background/80 backdrop-blur-sm px-2 py-1 rounded-full pointer-events-none">
            dra för att rotera
          </div>
        </div>
      </div>
    </div>
  );
}
