import { Editor } from "@/components/editor/Editor";
import { CartDrawer } from "@/components/CartDrawer";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b">
        <div className="flex items-center justify-between px-4 py-3 max-w-2xl mx-auto">
          <h1 className="font-semibold">Personlig Karta</h1>
          <CartDrawer />
        </div>
      </header>
      <main className="max-w-2xl mx-auto">
        <Editor />
      </main>
    </div>
  );
};

export default Index;
