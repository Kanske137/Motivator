// Pure-presentational layer renderers (no state, no side-effects).
// Image, Line, Margin. Text is handled inline in MapPreview because it shares
// the customer's live `text`/`textFont` state.
import type { TemplateLayer } from "@/lib/template-schema";

export function ImageLayerView({
  layer,
}: {
  layer: Extract<TemplateLayer, { type: "image" }>;
}) {
  const d = layer.defaults;
  const clip =
    d.shape === "circle"
      ? "circle(50% at 50% 50%)"
      : d.shape === "square"
      ? undefined
      : undefined;
  return (
    <div className="absolute inset-0 overflow-hidden bg-muted/30" style={{ clipPath: clip }}>
      {d.url ? (
        <img
          src={d.url}
          alt=""
          className="w-full h-full"
          style={{ objectFit: d.fit }}
          draggable={false}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground">
          Bild
        </div>
      )}
    </div>
  );
}

export function LineLayerView({
  layer,
}: {
  layer: Extract<TemplateLayer, { type: "line" }>;
}) {
  const d = layer.defaults;
  // thicknessMm rendered as % of layer's short side — close enough for preview
  const style: React.CSSProperties =
    d.orientation === "horizontal"
      ? { width: "100%", height: "100%", borderTop: `${Math.max(1, d.thicknessMm)}px solid ${d.color}` }
      : { width: "100%", height: "100%", borderLeft: `${Math.max(1, d.thicknessMm)}px solid ${d.color}` };
  return <div className="absolute inset-0" style={style} />;
}

export function MarginLayerView({
  layer,
}: {
  layer: Extract<TemplateLayer, { type: "margin" }>;
}) {
  const d = layer.defaults;
  // Thickness as % of the SHORT side of this layer's box (which equals the
  // canvas short side, since margin layers always span 0..100%). We use a
  // container query unit so the same number works regardless of orientation.
  const thick = `min(${d.thicknessPct}cqw, ${d.thicknessPct}cqh)`;
  const common: React.CSSProperties = {
    position: "absolute",
    background: d.color,
    pointerEvents: "auto",
  };
  return (
    // Container is pointer-events:none so the transparent middle never steals
    // clicks/drags from layers underneath (e.g. map). Only the four filled
    // edge strips opt back in via pointer-events:auto.
    <div
      className="absolute inset-0"
      style={{ containerType: "size", pointerEvents: "none" }}
    >
      <div style={{ ...common, top: 0, left: 0, right: 0, height: thick }} />
      <div style={{ ...common, bottom: 0, left: 0, right: 0, height: thick }} />
      <div style={{ ...common, top: 0, bottom: 0, left: 0, width: thick }} />
      <div style={{ ...common, top: 0, bottom: 0, right: 0, width: thick }} />
    </div>
  );
}
