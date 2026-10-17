import { spawn, execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv, promisify } from "node:util";
import net from "node:net";
import { withLoopbackDocker } from "./docker-loopback.mjs";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const testRoot = path.join(root, "work/test-services");
export const excludes =
  "realtime,edge-runtime,logflare,vector,supavisor,imgproxy";
export async function cli(args, workdir = root) {
  const run = (environment = {}) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        "pnpm",
        [
          "exec",
          "supabase",
          ...args,
          "--workdir",
          workdir,
          "--network-id",
          workdir === testRoot
            ? "afterlight-test-loopback"
            : "afterlight-local-loopback",
        ],
        {
          cwd: root,
          env: { ...process.env, ...environment },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
  return args[0] === "start"
    ? withLoopbackDocker(
        workdir === testRoot ? "afterlight-test" : "afterlight-local",
        run,
      )
    : run();
}
export function safeDiagnostic(text) {
  return text
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(
      /(password|secret|service.role.key|anon.key|jwt.secret|access.key)\s*[:=].*/gi,
      "$1=[redacted]",
    );
}
export async function requireCli(args, workdir = root) {
  const result = await cli(args, workdir);
  if (result.code !== 0)
    throw new Error(
      `Supabase ${args[0]} failed. ${safeDiagnostic(result.stderr).slice(-2500)}`,
    );
  return result;
}
export async function status(workdir = root) {
  const result = await cli(["status", "-o", "json"], workdir);
  if (result.code !== 0) return null;
  return JSON.parse(result.stdout);
}
export function serviceEnv(values, test = false) {
  if (!values.API_URL || !values.ANON_KEY || !values.SERVICE_ROLE_KEY)
    throw new Error(
      "Local Supabase did not return required server credentials.",
    );
  const port = test ? 3400 : 3300;
  return {
    SITE_ORIGIN: `http://127.0.0.1:${port}`,
    ALLOWED_ORIGINS: `http://127.0.0.1:${port},http://localhost:${port}`,
    SUPABASE_URL: values.API_URL,
    SUPABASE_ANON_KEY: values.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: values.SERVICE_ROLE_KEY,
  };
}
export async function writeEnvironment(values) {
  const filename = path.join(root, ".env.local");
  const updates = serviceEnv(values);
  let original = "";
  try {
    original = await fs.readFile(filename, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const existing = parseEnv(original);
  if (existing.SUPABASE_URL && existing.SUPABASE_URL !== updates.SUPABASE_URL)
    throw new Error(
      ".env.local points at a different Supabase. It was not overwritten.",
    );
  const retained = original
    .split("\n")
    .filter(
      (line) => !Object.keys(updates).some((key) => line.startsWith(`${key}=`)),
    )
    .filter(Boolean);
  const contents =
    [
      ...retained,
      ...Object.entries(updates).map(([key, value]) => `${key}=${value}`),
    ].join("\n") + "\n";
  await fs.writeFile(filename, contents, { mode: 0o600 });
  await fs.chmod(filename, 0o600);
}
export async function assertPortsAvailable(ports) {
  for (const port of ports)
    await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once("error", () =>
        reject(
          new Error(
            `Port ${port} is already occupied. No existing process was stopped.`,
          ),
        ),
      );
      probe.listen(port, "127.0.0.1", () => probe.close(resolve));
    });
}
export async function prepareTestProject() {
  const destination = path.join(testRoot, "supabase");
  await fs.mkdir(destination, { recursive: true });
  const config = (
    await fs.readFile(path.join(root, "supabase/config.toml"), "utf8")
  )
    .replace("afterlight-local", "afterlight-test")
    .replaceAll("5543", "5643")
    .replaceAll(":3300", ":3400");
  await fs.writeFile(path.join(destination, "config.toml"), config);
  await fs.cp(
    path.join(root, "supabase/migrations"),
    path.join(destination, "migrations"),
    { recursive: true },
  );
  await fs.cp(
    path.join(root, "supabase/tests"),
    path.join(destination, "tests"),
    { recursive: true },
  );
}
async function ensureLocalNetwork(test) {
  const name = test ? "afterlight-test-loopback" : "afterlight-local-loopback";
  const run = (args) =>
    new Promise((resolve, reject) => {
      const child = spawn("docker", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout }));
    });
  const inspect = await run([
    "network",
    "inspect",
    name,
    "--format",
    "{{json .Options}}",
  ]);
  if (inspect.code === 0) {
    if (
      JSON.parse(inspect.stdout)[
        "com.docker.network.bridge.host_binding_ipv4"
      ] !== "127.0.0.1"
    )
      throw new Error(
        "Existing AFTERLIGHT network has unexpected binding; it was not modified.",
      );
  } else {
    const created = await run([
      "network",
      "create",
      "--label",
      "afterlight.local=true",
      "-o",
      "com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
      name,
    ]);
    if (created.code !== 0)
      throw new Error("Cannot create isolated localhost-only Docker network.");
  }
  return name;
}
export async function startServices(test = false) {
  if (test) await prepareTestProject();
  const directory = test ? testRoot : root;
  const current = await status(directory);
  if (!current) {
    const base = test ? 56430 : 55430;
    await assertPortsAvailable([
      base,
      base + 1,
      base + 2,
      base + 3,
      base + 4,
      base + 5,
      base + 6,
      base + 9,
    ]);
    console.log(
      `Starting ${test ? "afterlight-test" : "afterlight-local"} Docker services; existing volumes are preserved.`,
    );
    await ensureLocalNetwork(test);
    await requireCli(["start", "-x", excludes], directory);
  }
  await requireCli(["migration", "up", "--local"], directory);
  const values = await status(directory);
  if (!values) throw new Error("Supabase services did not become ready.");
  await assertLoopbackPorts(test);
  if (!test) await writeEnvironment(values);
  return values;
}
async function assertLoopbackPorts(test) {
  const run = promisify(execFile);
  const project = test ? "afterlight-test" : "afterlight-local";
  const { stdout } = await run("docker", [
    "ps",
    "-q",
    "--filter",
    `label=com.supabase.cli.project=${project}`,
  ]);
  const ids = stdout.trim().split(/\s+/).filter(Boolean);
  if (!ids.length)
    throw new Error("AFTERLIGHT Docker containers are not running.");
  const ports = await run("docker", [
    "inspect",
    "--format",
    "{{json .NetworkSettings.Ports}}",
    ...ids,
  ]);
  for (const line of ports.stdout.trim().split("\n")) {
    const bindings = Object.values(JSON.parse(line) ?? {})
      .flat()
      .filter(Boolean);
    if (bindings.some((binding) => binding.HostIp !== "127.0.0.1"))
      throw new Error(
        "AFTERLIGHT ports are not bound only to localhost. Run pnpm local:restart; existing volumes will be preserved.",
      );
  }
}
export async function stopServices(test = false) {
  // No --all, --no-backup or volume removal. Only the named project is stopped.
  await requireCli(["stop"], test ? testRoot : root);
}
export function assertLocal(url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))
    throw new Error("This command is for local Supabase only.");
}
export function loadLocalEnvironment() {
  process.loadEnvFile(path.join(root, ".env.local"));
  assertLocal(process.env.SUPABASE_URL);
}
