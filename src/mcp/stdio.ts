import { loadEnv } from "../config/load-env.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDefaultPmtMcpDependencies, createPmtMcpServer } from "./server.js";

loadEnv();

try {
  const server = createPmtMcpServer({ deps: await createDefaultPmtMcpDependencies() });
  const transport = new StdioServerTransport();
  await server.connect(transport);
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
