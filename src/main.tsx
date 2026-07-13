import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./i18n";

// So we can confirm which build is live from the console (see also the
// <meta name="build-commit"> tag, which is curl-checkable on the deployed URL).
console.info(`Motiv build: ${__BUILD_COMMIT__}`);

createRoot(document.getElementById("root")!).render(<App />);
