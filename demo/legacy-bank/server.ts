import { createLegacyBankApp } from "./app.js";

const port = Number(process.env.DEMO_PORT ?? 4000);
const app = createLegacyBankApp();

app.listen(port, "127.0.0.1", () => {
  console.log(`LegacyBank Admin Simulator: http://localhost:${port}`);
});
