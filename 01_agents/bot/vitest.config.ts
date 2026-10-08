// Без своего конфига vitest уходит вверх и подхватывает корневой
// vitest.config.ts (он про 03_automation, и его vitest в корне не установлен) —
// npm test в боте падал на Startup Error вместо прогона тестов.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
