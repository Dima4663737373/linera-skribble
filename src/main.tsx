
import { createRoot } from "react-dom/client";
  import App from "./App.tsx";
  import "./index.css";
  import { LineraProvider } from "./components/LineraProvider";

// Dev-only: ensure WebAssembly.instantiateStreaming gracefully falls back when
// server does not return `application/wasm` for `.wasm` assets.
if (typeof WebAssembly !== "undefined") {
  const wasmAny = WebAssembly as any;
  const original = wasmAny.instantiateStreaming;
  if (typeof original === "function") {
    wasmAny.instantiateStreaming = async (source: any, importObject?: any) => {
      try {
        const res: Response = source instanceof Response ? source : await source;
        const ct = res.headers?.get("Content-Type") || "";
        if (ct.includes("application/wasm")) {
          return original(Promise.resolve(res), importObject);
        }
        const buf = await res.arrayBuffer();
        return WebAssembly.instantiate(buf, importObject);
      } catch {
        const res: Response = source instanceof Response ? source : await source;
        const buf = await res.arrayBuffer();
        return WebAssembly.instantiate(buf, importObject);
      }
    };
  }
}

  // Use the browser's default fetch; let Linera client talk to validators directly (no local proxy).

  createRoot(document.getElementById("root")!).render(
    <LineraProvider>
      <App />
    </LineraProvider>
  );
  
