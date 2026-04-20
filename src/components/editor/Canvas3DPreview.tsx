import { Suspense, useMemo, useRef, useState, useEffect } from "react";
import { Canvas, useLoader, useFrame } from "@react-three/fiber";
import { OrbitControls, ContactShadows, Environment } from "@react-three/drei";
import * as THREE from "three";
import { Loader2, ChevronLeft, ChevronRight, Maximize2, AlertCircle } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Canvas3DPreviewProps {
  printUrl: string | null;
  loading: boolean;
  error?: string;
  /** Aspect ratio of the print: width/height in cm */
  widthCm: number;
  heightCm: number;
  depthCm: number;
}

interface CameraPreset {
  id: string;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
}

const PRESETS: CameraPreset[] = [
  { id: "front", label: "Framifrån", position: [0, 0, 3.2], target: [0, 0, 0] },
  { id: "left", label: "Vänster", position: [-1.6, 0.3, 2.8], target: [0, 0, 0] },
  { id: "right", label: "Höger", position: [1.6, 0.3, 2.8], target: [0, 0, 0] },
  { id: "closeup", label: "Närbild", position: [0.9, -0.3, 2.0], target: [0, 0, 0] },
];

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
 * Side/top/bottom faces sample the outermost ~3% of the print to simulate wrap.
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

  // Build edge textures by cropping the print texture via canvas
  const edgeTextures = useMemo(() => {
    if (!texture.image) return null;
    const img = texture.image as HTMLImageElement | HTMLCanvasElement;
    const iw = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width;
    const ih = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height;
    if (!iw || !ih) return null;
    const bleed = 0.03;
    const make = (sx: number, sy: number, sw: number, sh: number, rotate = 0) => {
      const c = document.createElement("canvas");
      const targetW = Math.max(64, Math.round(sw));
      const targetH = Math.max(64, Math.round(sh));
      c.width = rotate % 180 === 0 ? targetW : targetH;
      c.height = rotate % 180 === 0 ? targetH : targetW;
      const ctx = c.getContext("2d")!;
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((rotate * Math.PI) / 180);
      ctx.drawImage(img as CanvasImageSource, sx, sy, sw, sh, -targetW / 2, -targetH / 2, targetW, targetH);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    return {
      right: make(iw * (1 - bleed), 0, iw * bleed, ih),
      left: make(0, 0, iw * bleed, ih),
      top: make(0, 0, iw, ih * bleed),
      bottom: make(0, ih * (1 - bleed), iw, ih * bleed),
    };
  }, [texture]);

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
    return [
      new THREE.MeshStandardMaterial({ map: edgeTextures.right, roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ map: edgeTextures.left, roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ map: edgeTextures.top, roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ map: edgeTextures.bottom, roughness: 0.85 }),
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
  printUrl, widthCm, heightCm, depthCm, preset, allowControls, autoRotate,
}: {
  printUrl: string;
  widthCm: number; heightCm: number; depthCm: number;
  preset: CameraPreset;
  allowControls: boolean;
  autoRotate: boolean;
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
          autoRotate={autoRotate && !allowControls}
        />
      )}
      <ContactShadows position={[0, -1.4, 0]} opacity={0.35} scale={6} blur={2.4} far={2} />
      {allowControls && (
        <OrbitControls
          enablePan={false}
          enableZoom={true}
          minDistance={1.8}
          maxDistance={5}
          minPolarAngle={Math.PI / 2 - 0.4}
          maxPolarAngle={Math.PI / 2 + 0.3}
          target={preset.target}
        />
      )}
    </>
  );
}

function ThumbCanvas({
  printUrl, widthCm, heightCm, depthCm, preset,
}: {
  printUrl: string; widthCm: number; heightCm: number; depthCm: number; preset: CameraPreset;
}) {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: preset.position, fov: 35 }}
      gl={{ preserveDrawingBuffer: false, antialias: true }}
    >
      <color attach="background" args={["#f5f2ec"]} />
      <Suspense fallback={null}>
        <Scene
          printUrl={printUrl}
          widthCm={widthCm}
          heightCm={heightCm}
          depthCm={depthCm}
          preset={preset}
          allowControls={false}
          autoRotate={false}
        />
      </Suspense>
    </Canvas>
  );
}

export function Canvas3DPreview({
  printUrl, loading, error, widthCm, heightCm, depthCm,
}: Canvas3DPreviewProps) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const lightboxPreset = lightboxIdx !== null ? PRESETS[lightboxIdx] : null;

  const goPrev = () =>
    setLightboxIdx((i) => (i === null ? null : (i - 1 + PRESETS.length) % PRESETS.length));
  const goNext = () =>
    setLightboxIdx((i) => (i === null ? null : (i + 1) % PRESETS.length));

  return (
    <>
      <div className="border-t bg-[hsl(var(--paper))]">
        <div className="px-4 py-3">
          <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3">
            3D-förhandsgranska canvas
          </h3>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x">
            {PRESETS.map((preset, i) => (
              <button
                type="button"
                key={preset.id}
                disabled={!printUrl}
                onClick={() => printUrl && setLightboxIdx(i)}
                className="group flex-shrink-0 w-32 h-32 md:w-40 md:h-40 rounded-2xl overflow-hidden bg-card border snap-start relative disabled:cursor-default cursor-zoom-in"
                aria-label={`Förstora ${preset.label}`}
              >
                {loading || !printUrl ? (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/40 animate-pulse">
                    {error ? (
                      <div className="flex flex-col items-center text-destructive text-[10px] p-2 text-center gap-1">
                        <AlertCircle className="h-4 w-4" />
                        <span className="line-clamp-3">{error}</span>
                      </div>
                    ) : (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    )}
                  </div>
                ) : (
                  <>
                    <ThumbCanvas
                      printUrl={printUrl}
                      widthCm={widthCm}
                      heightCm={heightCm}
                      depthCm={depthCm}
                      preset={preset}
                    />
                    <span className="absolute top-1.5 right-1.5 inline-flex items-center justify-center h-6 w-6 rounded-full bg-background/85 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition">
                      <Maximize2 className="h-3.5 w-3.5" />
                    </span>
                  </>
                )}
                <div className="absolute bottom-0 inset-x-0 bg-background/85 backdrop-blur-sm text-[11px] py-1 text-center font-medium pointer-events-none">
                  {preset.label}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <Dialog open={lightboxIdx !== null} onOpenChange={(o) => !o && setLightboxIdx(null)}>
        <DialogContent className="max-w-[95vw] md:max-w-4xl p-0 bg-background border-0 overflow-hidden">
          <DialogTitle className="sr-only">{lightboxPreset?.label ?? "Canvas 3D"}</DialogTitle>
          {lightboxPreset && printUrl && (
            <div className="relative bg-[#f5f2ec]" style={{ height: "min(85vh, 700px)" }}>
              <Canvas
                shadows
                dpr={[1, 2]}
                camera={{ position: lightboxPreset.position, fov: 35 }}
              >
                <color attach="background" args={["#f5f2ec"]} />
                <Suspense fallback={null}>
                  <Scene
                    printUrl={printUrl}
                    widthCm={widthCm}
                    heightCm={heightCm}
                    depthCm={depthCm}
                    preset={lightboxPreset}
                    allowControls={true}
                    autoRotate={false}
                  />
                </Suspense>
              </Canvas>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={goPrev}
                className="absolute left-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full shadow-lg bg-background/90 hover:bg-background"
                aria-label="Föregående"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={goNext}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full shadow-lg bg-background/90 hover:bg-background"
                aria-label="Nästa"
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent text-background px-4 py-3 text-sm font-medium pointer-events-none">
                {lightboxPreset.label}
                <span className="ml-2 opacity-70">
                  {(lightboxIdx ?? 0) + 1} / {PRESETS.length} · dra för att rotera
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
