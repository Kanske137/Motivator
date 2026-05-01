// Visar de fyra silverskruvarna som finns IRL i hörnen på Gelatos akrylglas-print.
// Skruvarna sitter ~1.4 cm in från varje hörn (centrum) och har ~1.5 cm
// silverdisk diameter. Vi renderar dem som % av posterstorleken så proportioner
// stämmer i alla format. Använd ENDAST i preview/cart-bild, ALDRIG i tryckfil.
//
// Försök matcha utseendet IRL: borstad silver med liten skugga och en mörkare
// inre cirkel som antyder skruvhuvudet.
interface Props {
  /** Front-storlek (cm) för respektive sida — används för att räkna ut % */
  frontWcm: number;
  frontHcm: number;
  /** Avstånd från kant till diskens CENTRUM (cm). Default 1.4 cm. */
  insetCm?: number;
  /** Diskens diameter (cm). Default 1.5 cm. */
  diameterCm?: number;
  /** Z-index (default 50 — över allt utom guides). */
  zIndex?: number;
}

export function AcrylicCornerOverlay({
  frontWcm,
  frontHcm,
  insetCm = 1.4,
  diameterCm = 1.5,
  zIndex = 50,
}: Props) {
  const dxPct = (insetCm / frontWcm) * 100;
  const dyPct = (insetCm / frontHcm) * 100;
  const dwPct = (diameterCm / frontWcm) * 100;
  const dhPct = (diameterCm / frontHcm) * 100;

  const corners: { top?: string; bottom?: string; left?: string; right?: string }[] = [
    { top: `calc(${dyPct}% - ${dhPct / 2}%)`, left: `calc(${dxPct}% - ${dwPct / 2}%)` },
    { top: `calc(${dyPct}% - ${dhPct / 2}%)`, right: `calc(${dxPct}% - ${dwPct / 2}%)` },
    { bottom: `calc(${dyPct}% - ${dhPct / 2}%)`, left: `calc(${dxPct}% - ${dwPct / 2}%)` },
    { bottom: `calc(${dyPct}% - ${dhPct / 2}%)`, right: `calc(${dxPct}% - ${dwPct / 2}%)` },
  ];

  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ zIndex }}
      aria-hidden
    >
      {corners.map((pos, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: `${dwPct}%`,
            height: `${dhPct}%`,
            ...pos,
            // Borstad silver-radial gradient + subtil rim & skugga
            background:
              "radial-gradient(circle at 35% 30%, #f5f5f5 0%, #d8d8d8 35%, #b8b8b8 60%, #9a9a9a 85%, #7a7a7a 100%)",
            borderRadius: "50%",
            boxShadow:
              "0 1px 2px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.35), inset 0 -1px 2px rgba(0,0,0,0.25)",
          }}
        >
          {/* Inre skruvhuvud-skiva för att antyda metallisk djup */}
          <div
            style={{
              position: "absolute",
              inset: "22%",
              borderRadius: "50%",
              background:
                "radial-gradient(circle at 40% 35%, #c8c8c8 0%, #a8a8a8 50%, #888 100%)",
              boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.2)",
            }}
          />
        </div>
      ))}
    </div>
  );
}
