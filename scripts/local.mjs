import {
  startServices,
  stopServices,
  status,
  requireCli,
  prepareTestProject,
  testRoot,
} from "./local-lib.mjs";
import { seed } from "./seed.mjs";
const command = process.argv[2];
try {
  if (command === "start" || command === "restart") {
    if (command === "restart") await stopServices();
    const values = await startServices();
    await seed(values.API_URL, values.SERVICE_ROLE_KEY);
    console.log(
      "AFTERLIGHT services ready. .env.local updated privately. Run pnpm dev.",
    );
    console.log(
      "Journal: http://127.0.0.1:3300/ru | Editor: http://127.0.0.1:3300/admin",
    );
  } else if (command === "stop") {
    await stopServices();
    console.log("AFTERLIGHT stopped. Database and media volumes preserved.");
  } else if (command === "test-stop") {
    await stopServices(true);
    console.log(
      "Isolated AFTERLIGHT test services stopped; volumes preserved.",
    );
  } else if (command === "status") {
    const values = await status();
    if (!values) {
      console.log("AFTERLIGHT services stopped. Run pnpm local:start.");
      process.exitCode = 1;
    } else
      console.log(
        `AFTERLIGHT services running\nAPI: ${values.API_URL}\nStudio: ${values.STUDIO_URL ?? "http://127.0.0.1:55433"}\nApp starts separately with pnpm dev. Credentials are omitted.`,
      );
  } else if (command === "test-sql") {
    await prepareTestProject();
    await startServices(true);
    const result = await requireCli(["test", "db"], testRoot);
    console.log(result.stdout);
  } else throw new Error("Use start, stop, restart, status or test-sql.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
