import { useEditorStore } from "@/stores/editorStore";
import { StepHeader } from "./StepHeader";
import { StepProduct } from "./StepProduct";
import { StepImage } from "./StepImage";
import { StepMap } from "./StepMap";
import { StepText } from "./StepText";
import { StepStyle } from "./StepStyle";
import { StepSize } from "./StepSize";
import { StepMockup } from "./StepMockup";

export function Editor() {
  const step = useEditorStore((s) => s.step);

  return (
    <div className="min-h-screen bg-background">
      <StepHeader />
      {step === "product" && <StepProduct />}
      {step === "image" && <StepImage />}
      {step === "map" && <StepMap />}
      {step === "text" && <StepText />}
      {step === "style" && <StepStyle />}
      {step === "size" && <StepSize />}
      {step === "mockup" && <StepMockup />}
    </div>
  );
}
