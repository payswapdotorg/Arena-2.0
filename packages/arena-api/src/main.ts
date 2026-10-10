import { createInMemoryRuntime } from "@arena/application";
import { createArenaServer } from "./contract.js";

/** 本地监听入口：node --experimental-strip-types packages/arena-api/src/main.ts */
const port = Number(process.env.ARENA_API_PORT ?? 3901);
const runtime = createInMemoryRuntime();
const server = createArenaServer({ runtime });
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `arena-api listening on http://127.0.0.1:${port} (DEMO auth, NON-DURABLE runtime)\n`,
  );
});
