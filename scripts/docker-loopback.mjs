import http from "node:http";
import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
// On this Docker Desktop 29.6.2 host, an inspected bridge default of 127.0.0.1
// still yielded wildcard publications when HostIp was empty. Set the documented
// explicit host address per container rather than altering the Docker daemon:
// https://docs.docker.com/engine/network/port-publishing/#publishing-ports
const PROJECTS = new Set(["afterlight-local", "afterlight-test"]);
const MAX_CREATE_BYTES = 8 * 1024 * 1024;
const CREATE_PATH = /^\/(?:v\d+\.\d+\/)?containers\/create$/;

async function currentDockerSocket() {
  let endpoint;
  if (process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT) {
    endpoint = process.env.DOCKER_HOST;
  } else {
    const args = ["context", "inspect"];
    if (process.env.DOCKER_CONTEXT) args.push(process.env.DOCKER_CONTEXT);
    args.push("--format", "{{json .Endpoints.docker.Host}}");
    const { stdout } = await runFile("docker", args, {
      maxBuffer: 64 * 1024,
      timeout: 10_000,
    });
    endpoint = JSON.parse(stdout);
  }
  // This adapter never forwards to a remote daemon or opens a TCP Docker socket.
  if (typeof endpoint !== "string" || !endpoint.startsWith("unix:///")) {
    throw new Error(
      "AFTERLIGHT requires a local Unix Docker socket. No Docker configuration was changed.",
    );
  }
  const socketPath = endpoint.slice("unix://".length);
  if (!(await fs.stat(socketPath)).isSocket()) {
    throw new Error(
      "The configured local Docker endpoint is not a Unix socket.",
    );
  }
  return socketPath;
}

function requestPath(request) {
  return new URL(request.url, "http://docker.local").pathname;
}

async function createBody(request, projectId) {
  if (
    request.headers["content-encoding"] &&
    request.headers["content-encoding"] !== "identity"
  ) {
    throw new Error("Encoded Docker create requests are unsupported.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_CREATE_BYTES)
      throw new Error("Docker create request exceeds the local limit.");
    chunks.push(chunk);
  }
  const original = Buffer.concat(chunks);
  const config = JSON.parse(original.toString("utf8"));
  const name =
    new URL(request.url, "http://docker.local").searchParams.get("name") ?? "";
  const matchesProject =
    config?.Labels?.["com.supabase.cli.project"] === projectId;
  if (!matchesProject) {
    // The current CLI was verified to label its containers. If that contract
    // changes, fail closed for names belonging to this project rather than
    // starting that project's services with an unrestricted port publication.
    if (name.endsWith(`_${projectId}`))
      throw new Error("AFTERLIGHT container has no matching project label.");
    return original;
  }
  const host = config.HostConfig ?? {};
  if (host.PublishAllPorts || host.NetworkMode === "host") {
    throw new Error(
      "AFTERLIGHT requires explicit, isolated Docker port bindings.",
    );
  }
  for (const bindings of Object.values(host.PortBindings ?? {})) {
    if (!Array.isArray(bindings))
      throw new Error("Unexpected Docker port configuration.");
    for (const binding of bindings) {
      if (!binding || typeof binding !== "object")
        throw new Error("Unexpected Docker port binding.");
      binding.HostIp = "127.0.0.1";
    }
  }
  config.HostConfig = host;
  return Buffer.from(JSON.stringify(config));
}

function failResponse(response) {
  if (response.headersSent) response.destroy();
  else {
    response.writeHead(502, {
      "Content-Type": "application/json",
      Connection: "close",
    });
    response.end(
      JSON.stringify({
        message:
          "AFTERLIGHT local Docker proxy could not forward this request.",
      }),
    );
  }
}

/**
 * Run one CLI operation through a private Unix socket, scoped to one project.
 * Only labeled container-create bodies are modified; images, commands, mounts,
 * volumes, credentials and other projects pass through without modification.
 * @template T
 * @param {'afterlight-local' | 'afterlight-test'} projectId
 * @param {(env: Record<string, string>) => Promise<T>} callback
 * @returns {Promise<T>}
 */
export async function withLoopbackDocker(projectId, callback) {
  if (!PROJECTS.has(projectId))
    throw new Error("Unknown AFTERLIGHT Docker project.");
  const dockerSocket = await currentDockerSocket();
  // macOS Unix socket names have a small path limit; use a short private directory.
  const base = process.platform === "darwin" ? "/private/tmp" : os.tmpdir();
  const directory = await fs.mkdtemp(path.join(base, "afterlight-docker-"));
  await fs.chmod(directory, 0o700);
  const proxySocket = path.join(directory, "api.sock");
  const sockets = new Set();
  const upstreamRequests = new Set();
  let runtimeError;
  const trackSocket = (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
  };
  const server = http.createServer(async (request, response) => {
    try {
      const body =
        request.method === "POST" && CREATE_PATH.test(requestPath(request))
          ? await createBody(request, projectId)
          : null;
      const headers = { ...request.headers };
      if (body) {
        delete headers["transfer-encoding"];
        headers["content-length"] = String(body.length);
      }
      const upstream = http.request(
        {
          socketPath: dockerSocket,
          path: request.url,
          method: request.method,
          headers,
          agent: false,
        },
        (result) => {
          response.writeHead(result.statusCode ?? 502, result.headers);
          result.on("error", () => response.destroy());
          result.pipe(response);
        },
      );
      upstreamRequests.add(upstream);
      upstream.once("close", () => upstreamRequests.delete(upstream));
      upstream.on("socket", trackSocket);
      upstream.on("error", () => failResponse(response));
      request.on("aborted", () => upstream.destroy());
      response.on("close", () => {
        if (!response.writableFinished) upstream.destroy();
      });
      if (body) upstream.end(body);
      else request.pipe(upstream);
    } catch {
      // Container configurations contain service credentials. Never log payloads,
      // raw parse errors or upstream error bodies here.
      failResponse(response);
    }
  });
  server.on("connection", trackSocket);
  // Docker exec/attach upgrades are raw bidirectional streams, not JSON bodies.
  server.on("upgrade", (request, socket, head) => {
    if (CREATE_PATH.test(requestPath(request))) {
      socket.end(
        "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
      return;
    }
    const upstream = net.createConnection({ path: dockerSocket });
    trackSocket(upstream);
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    socket.on("close", () => upstream.destroy());
    upstream.on("close", () => socket.destroy());
    upstream.on("connect", () => {
      const headers = [];
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        headers.push(
          `${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}`,
        );
      }
      upstream.write(
        `${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers.join("\r\n")}\r\n\r\n`,
      );
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(proxySocket, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    await fs.chmod(proxySocket, 0o600);
    server.on("error", () => {
      runtimeError = new Error("The private AFTERLIGHT Docker proxy failed.");
      for (const socket of sockets) socket.destroy();
    });
    const result = await callback({
      DOCKER_HOST: `unix://${proxySocket}`,
      // DOCKER_CONTEXT takes precedence over DOCKER_HOST if inherited as nonempty.
      DOCKER_CONTEXT: "",
      DOCKER_TLS_VERIFY: "",
      DOCKER_CERT_PATH: "",
    });
    if (runtimeError) throw runtimeError;
    return result;
  } finally {
    for (const request of upstreamRequests) request.destroy();
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
}
