import { Suspense, useMemo, useRef, useState, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import { Loader2, AlertCircle } from "lucide-react";

interface Canvas3DPreviewProps {
  printUrl: string | null;
  loading: boolean;
  error?: string;
  /** Visible front dimensions in cm (what customer ordered). */
  widthCm: number;
  heightCm: number;
  /** Canvas depth in cm (wrap zone width per side). */
  depthCm: number;
  /** Bleed in cm per side outside the wrap zone (Gelato canvas = 0.3). */
  bleedCm?: number;
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
 * Canvas mesh with Gelato-accurate wrap.
 *
 * The input texture is the FULL print file produced by `renderArtworkSnapshot`
 * with `wrapCm` + `bleedCm`, laid out as:
 *
 *   [ bleed | wrap | FRONT (visible motif) | wrap | bleed ]   (per axis)
 *
 * Each face of the box samples its own UV-rect of that single texture so the
 * front shows only the motif, sides show the wrap continuation, and corners
 * are seamless because they share pixel boundaries with the front.
 */
function CanvasMesh({
  texture, widthCm, heightCm, depthCm, bleedCm, autoRotate,
}: {
  texture: THREE.Texture;
  widthCm: number; heightCm: number; depthCm: number; bleedCm: number;
  autoRotate: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  // Normalize box size so the largest visible-front dimension = 2 units.
  // Depth is independent so 2cm vs 4cm look visually different.
  const maxCm = Math.max(widthCm, heightCm);
  const w = (widthCm / maxCm) * 2;
  const h = (heightCm / maxCm) * 2;
  const d = (depthCm / maxCm) * 2;

  useFrame((_, dt) => {
    if (autoRotate && meshRef.current) {
      meshRef.current.rotation.y += dt * 0.15;
    }
  });

  // BoxGeometry material order: [+X, -X, +Y, -Y, +Z, -Z]
  // = right, left, top, bottom, front, back
  const materials = useMemo(() => {
    // Texture-fraction layout (Gelato print file)
    const totalW = widthCm + 2 * depthCm + 2 * bleedCm;
    const totalH = heightCm + 2 * depthCm + 2 * bleedCm;
    const fFrontX = widthCm / totalW;
    const fFrontY = heightCm / totalH;
    const fWrapX  = depthCm / totalW;
    const fWrapY  = depthCm / totalH;
    const fBleedX = bleedCm / totalW;
    const fBleedY = bleedCm / totalH;

    // Helper: clone texture and apply UV offset/repeat (and optional flip).
    // Three.js UV origin: (0,0) = bottom-left of texture, (1,1) = top-right.
    // Our snapshot is drawn with canvas 2D origin top-left → in UV space the
    // top of the print is V=1, bottom is V=0.
    const make = (
      offsetX: number, offsetY: number,
      repeatX: number, repeatY: number,
      flipX = false, flipY = false,
    ) => {
      const t = texture.clone();
      t.needsUpdate = true;
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      // Convert top-left-origin coordinates to UV (flip Y for the offset).
      const uvOffsetX = offsetX;
      const uvOffsetY = 1 - (offsetY + repeatY);
      // For flips, compensate offset so the SAME UV window is sampled, just
      // mirrored. Using texture.center would pivot around the whole texture
      // and shift the strip onto the wrong region (front face bleed).
      t.offset.set(
        flipX ? uvOffsetX + repeatX : uvOffsetX,
        flipY ? uvOffsetY + repeatY : uvOffsetY,
      );
      t.repeat.set(flipX ? -repeatX : repeatX, flipY ? -repeatY : repeatY);
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, metalness: 0 });
    };

    // FRONT (+Z): inner motif zone, no wrap, no bleed.
    // Three.js BoxGeometry +Z UVs: U=0 at -X (left), V=0 at -Y (bottom).
    const front = make(
      fBleedX + fWrapX, fBleedY + fWrapY,
      fFrontX, fFrontY,
    );

    // RIGHT (+X): wrap strip immediately to the right of the front in the
    // print file. Three.js BoxGeometry +X UVs: U=0 at +Z (FRONT edge),
    // U=1 at -Z (back edge); V=0 at bottom. The strip's leftmost pixel
    // column (in print-file space) is closest to the front and must land at
    // U=0 (the face-edge that meets the front). Default mapping puts the
    // strip's leftmost pixel at U=0 → flip X to align it with the front edge.
    const right = make(
      fBleedX + fWrapX + fFrontX, fBleedY + fWrapY,
      fWrapX, fFrontY,
      true, false,
    );

    // LEFT (-X): wrap strip immediately to the left of the front.
    // Three.js BoxGeometry -X UVs: U=0 at -Z (back), U=1 at +Z (FRONT edge).
    // The strip's rightmost pixel column (in print-file space) is closest to
    // the front and must land at U=1. Default mapping already puts the
    // rightmost pixel at U=1 → no flip.
    const left = make(
      fBleedX, fBleedY + fWrapY,
      fWrapX, fFrontY,
    );

    // TOP (+Y): wrap strip immediately above the front in the print file.
    // Three.js BoxGeometry +Y UVs: U=0 at -X (left); V=0 at +Z (FRONT edge),
    // V=1 at -Z (back edge). The strip's bottom row (in print-file space) is
    // closest to the front and must land at V=0. Default mapping puts the
    // strip's bottom row at V=0 → no flip.
    const top = make(
      fBleedX + fWrapX, fBleedY,
      fFrontX, fWrapY,
    );

    // BOTTOM (-Y): wrap strip immediately below the front.
    // Three.js BoxGeometry -Y UVs: U=0 at -X; V=0 at -Z (back), V=1 at +Z
    // (FRONT edge). The strip's top row (in print-file space) is closest to
    // the front and must land at V=1. Default mapping puts the strip's top
    // row at V=1 → no flip.
    const bottom = make(
      fBleedX + fWrapX, fBleedY + fWrapY + fFrontY,
      fFrontX, fWrapY,
    );

    // BACK (-Z): canvas back is plain stretched fabric. Solid neutral.
    const back = new THREE.MeshStandardMaterial({ color: "#e8e4dc", roughness: 0.95 });

    return [right, left, top, bottom, front, back];
  }, [texture, widthCm, heightCm, depthCm, bleedCm]);

  return (
    <mesh ref={meshRef} castShadow receiveShadow material={materials}>
      <boxGeometry args={[w, h, d]} />
    </mesh>
  );
}

function Scene({
  printUrl, widthCm, heightCm, depthCm, bleedCm,
}: {
  printUrl: string;
  widthCm: number; heightCm: number; depthCm: number; bleedCm: number;
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
          bleedCm={bleedCm}
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
  printUrl, loading, error, widthCm, heightCm, depthCm, bleedCm = 0.3,
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
                  bleedCm={bleedCm}
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
