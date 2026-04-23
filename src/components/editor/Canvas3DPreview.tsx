import { Suspense, useMemo, useRef, useState, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, ContactShadows, Environment } from "@react-three/drei";
import * as THREE from "three";
import { Loader2, AlertCircle } from "lucide-react";
import { getCanvasWeaveNormalMap } from "@/lib/canvas-weave-texture";

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
  /** Background scene around the canvas. Default: livingroom. */
  scene?: "minimal" | "livingroom";
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

function CanvasMesh({
  texture, widthCm, heightCm, depthCm, bleedCm, autoRotate, onUserInteract,
}: {
  texture: THREE.Texture;
  widthCm: number; heightCm: number; depthCm: number; bleedCm: number;
  autoRotate: boolean;
  onUserInteract: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const weaveMap = useMemo(() => getCanvasWeaveNormalMap(256), []);

  // Normalize box size so the largest visible-front dimension = 2 units.
  const maxCm = Math.max(widthCm, heightCm);
  const w = (widthCm / maxCm) * 2;
  const h = (heightCm / maxCm) * 2;
  const d = (depthCm / maxCm) * 2;

  useFrame((_, dt) => {
    if (autoRotate && meshRef.current) {
      meshRef.current.rotation.y += dt * 0.25;
    }
  });

  // BoxGeometry material order: [+X, -X, +Y, -Y, +Z, -Z]
  // = right, left, top, bottom, front, back
  const materials = useMemo(() => {
    const totalW = widthCm + 2 * depthCm + 2 * bleedCm;
    const totalH = heightCm + 2 * depthCm + 2 * bleedCm;
    const fFrontX = widthCm / totalW;
    const fFrontY = heightCm / totalH;
    const fWrapX  = depthCm / totalW;
    const fWrapY  = depthCm / totalH;
    const fBleedX = bleedCm / totalW;
    const fBleedY = bleedCm / totalH;

    // Shared weave normal map clone-helper so each face can have its own
    // repeat (matches the face's physical aspect for consistent thread density).
    const cloneWeave = (repeatU: number, repeatV: number) => {
      const n = weaveMap.clone();
      n.needsUpdate = true;
      n.wrapS = THREE.RepeatWrapping;
      n.wrapT = THREE.RepeatWrapping;
      n.repeat.set(repeatU, repeatV);
      return n;
    };

    const make = (
      offsetX: number, offsetY: number,
      repeatX: number, repeatY: number,
      faceWcm: number, faceHcm: number,
      isWrap: boolean,
      flipX = false, flipY = false,
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

      // ~1 weave repeat per cm visible
      const repU = Math.max(1, Math.round(faceWcm));
      const repV = Math.max(1, Math.round(faceHcm));
      const normalMap = cloneWeave(repU, repV);

      return new THREE.MeshStandardMaterial({
        map: t,
        normalMap,
        normalScale: new THREE.Vector2(0.18, 0.18),
        roughness: isWrap ? 0.92 : 0.86,
        metalness: 0,
      });
    };

    const front  = make(fBleedX + fWrapX,         fBleedY + fWrapY,         fFrontX, fFrontY, widthCm, heightCm, false);
    const right  = make(fBleedX + fWrapX + fFrontX, fBleedY + fWrapY,       fWrapX,  fFrontY, depthCm, heightCm, true);
    const left   = make(fBleedX,                  fBleedY + fWrapY,         fWrapX,  fFrontY, depthCm, heightCm, true,  true,  false);
    const top    = make(fBleedX + fWrapX,         fBleedY,                  fFrontX, fWrapY,  widthCm, depthCm,  true,  false, true);
    const bottom = make(fBleedX + fWrapX,         fBleedY + fWrapY + fFrontY, fFrontX, fWrapY, widthCm, depthCm, true,  false, true);

    const back = new THREE.MeshStandardMaterial({
      color: "#e8e4dc",
      roughness: 0.95,
      normalMap: cloneWeave(Math.round(widthCm), Math.round(heightCm)),
      normalScale: new THREE.Vector2(0.25, 0.25),
    });

    return [right, left, top, bottom, front, back];
  }, [texture, widthCm, heightCm, depthCm, bleedCm, weaveMap]);

  return (
    <mesh
      ref={meshRef}
      castShadow
      receiveShadow
      material={materials}
      position={[0, 0, 0]}
      onPointerDown={onUserInteract}
    >
      <boxGeometry args={[w, h, d]} />
    </mesh>
  );
}

/** Tunn vägg bakom duken så skuggorna landar på något. */
function Wall() {
  return (
    <mesh position={[0, 0, -0.6]} receiveShadow>
      <planeGeometry args={[12, 8]} />
      <meshStandardMaterial color="#ece7df" roughness={1} metalness={0} />
    </mesh>
  );
}

function InteractionTracker({ onInteract }: { onInteract: () => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const handler = () => onInteract();
    el.addEventListener("pointerdown", handler, { passive: true });
    el.addEventListener("touchstart", handler, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", handler);
      el.removeEventListener("touchstart", handler);
    };
  }, [gl, onInteract]);
  return null;
}

function Scene({
  printUrl, widthCm, heightCm, depthCm, bleedCm,
}: {
  printUrl: string;
  widthCm: number; heightCm: number; depthCm: number; bleedCm: number;
}) {
  const tex = useTexture(printUrl);
  const [autoRotate, setAutoRotate] = useState(true);

  // Stoppa auto-rotate efter 4s om användaren inte rört duken.
  useEffect(() => {
    const t = setTimeout(() => setAutoRotate(false), 4000);
    return () => clearTimeout(t);
  }, []);

  const stopAutoRotate = () => setAutoRotate(false);

  return (
    <>
      {/* 3-punkts-belysning */}
      <ambientLight intensity={0.35} />
      {/* Key — varm framifrån-höger */}
      <directionalLight
        position={[3.5, 3, 4]}
        intensity={1.15}
        color="#fff4e6"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0005}
      />
      {/* Fill — sval vänster */}
      <directionalLight position={[-3, 1.5, 3]} intensity={0.45} color="#dde8ff" />
      {/* Rim — bakifrån för kantljus */}
      <directionalLight position={[0, 2, -4]} intensity={0.6} color="#ffffff" />

      <Environment preset="apartment" />
      <Wall />

      <InteractionTracker onInteract={stopAutoRotate} />

      {tex && (
        <CanvasMesh
          texture={tex}
          widthCm={widthCm}
          heightCm={heightCm}
          depthCm={depthCm}
          bleedCm={bleedCm}
          autoRotate={autoRotate}
          onUserInteract={stopAutoRotate}
        />
      )}
      <ContactShadows position={[0, -1.35, 0]} opacity={0.45} scale={6} blur={3.2} far={2.2} />
      <OrbitControls
        enablePan={false}
        enableZoom={false}
        enableDamping
        dampingFactor={0.08}
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
          className="w-full rounded-2xl overflow-hidden border relative"
          style={{
            height: "min(60vh, 520px)",
            background:
              "radial-gradient(ellipse at center, #f7f3ec 0%, #e8e2d6 100%)",
          }}
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
