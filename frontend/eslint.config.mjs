import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // public/mediapipe holds the vendored MediaPipe WASM loader (third-party, generated);
  // src/vendor holds reviewed third-party source kept as published (see its README).
  globalIgnores([".next/**", "test-results/**", "next-env.d.ts", "public/mediapipe/**", "src/vendor/**"]),
]);
