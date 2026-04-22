// Vertical / horizontal alignment guides shown during drag in LayerCanvas.
// Pure presentational — receives an array of % positions and renders dashed
// lines on top of the canvas.
interface Props {
  vertical: number[]; // x percentages (0..100)
  horizontal: number[]; // y percentages (0..100)
}

export default function AlignmentGuides({ vertical, horizontal }: Props) {
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {vertical.map((x, i) => (
        <div
          key={`v-${i}-${x}`}
          className="absolute top-0 bottom-0 border-l border-dashed border-primary"
          style={{ left: `${x}%` }}
        />
      ))}
      {horizontal.map((y, i) => (
        <div
          key={`h-${i}-${y}`}
          className="absolute left-0 right-0 border-t border-dashed border-primary"
          style={{ top: `${y}%` }}
        />
      ))}
    </div>
  );
}
