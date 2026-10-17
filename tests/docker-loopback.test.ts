import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import { withLoopbackDocker } from "../scripts/docker-loopback.mjs";

async function withFakeDocker(check: (received: unknown[]) => Promise<void>) {
  const base = process.platform === "darwin" ? "/private/tmp" : os.tmpdir();
  const directory = await fs.mkdtemp(path.join(base, "afterlight-engine-test-"));
  const socketPath = path.join(directory, "api.sock");
  const received: unknown[] = [];
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8");
    if (body) received.push(JSON.parse(body));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  const originalHost = process.env.DOCKER_HOST;
  const originalContext = process.env.DOCKER_CONTEXT;
  process.env.DOCKER_HOST = `unix://${socketPath}`;
  delete process.env.DOCKER_CONTEXT;
  try {
    await check(received);
  } finally {
    if (originalHost === undefined) delete process.env.DOCKER_HOST;
    else process.env.DOCKER_HOST = originalHost;
    if (originalContext === undefined) delete process.env.DOCKER_CONTEXT;
    else process.env.DOCKER_CONTEXT = originalContext;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function create(
  socketPath: string,
  name: string,
  body: unknown,
): Promise<number> {
  return await new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request(
      {
        socketPath,
        method: "POST",
        path: `/v1.51/containers/create?name=${encodeURIComponent(name)}`,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      },
    );
    request.on("error", reject);
    request.end(payload);
  });
}

const config = (project: string) => ({
  Labels: { "com.supabase.cli.project": project },
  Env: ["UNCHANGED=fixture"],
  HostConfig: {
    NetworkMode: "afterlight-local-loopback",
    Binds: ["fixture-volume:/var/lib/postgresql/data"],
    PortBindings: { "8000/tcp": [{ HostIp: "", HostPort: "55431" }] },
  },
});

test("private Docker proxy binds only its labeled project and preserves volume/environment configuration", async () => {
  await withFakeDocker(async (received) => {
    let proxyPath = "";
    const result = await withLoopbackDocker("afterlight-local", async (env) => {
      proxyPath = env.DOCKER_HOST.slice("unix://".length);
      assert.equal(env.DOCKER_CONTEXT, "");
      assert.equal((await fs.stat(proxyPath)).mode & 0o777, 0o600);
      assert.equal(
        (await fs.stat(path.dirname(proxyPath))).mode & 0o777,
        0o700,
      );
      assert.equal(
        await create(
          proxyPath,
          "supabase_kong_afterlight-local",
          config("afterlight-local"),
        ),
        200,
      );
      assert.equal(
        await create(proxyPath, "supabase_kong_unrelated", config("unrelated")),
        200,
      );
      return "finished";
    });
    assert.equal(result, "finished");
    const expected = config("afterlight-local");
    expected.HostConfig.PortBindings["8000/tcp"][0].HostIp = "127.0.0.1";
    assert.deepEqual(received, [expected, config("unrelated")]);
    await assert.rejects(fs.stat(proxyPath), { code: "ENOENT" });
  });
});

test("Docker proxy fails closed for missing labels/host networking and cleans up when CLI callback fails", async () => {
  await withFakeDocker(async (received) => {
    let proxyPath = "";
    await assert.rejects(
      withLoopbackDocker("afterlight-local", async (env) => {
        proxyPath = env.DOCKER_HOST.slice("unix://".length);
        const missingLabel = { ...config("afterlight-local"), Labels: {} };
        assert.equal(
          await create(
            proxyPath,
            "supabase_kong_afterlight-local",
            missingLabel,
          ),
          502,
        );
        const hostNetwork = config("afterlight-local");
        hostNetwork.HostConfig.NetworkMode = "host";
        assert.equal(
          await create(
            proxyPath,
            "supabase_kong_afterlight-local",
            hostNetwork,
          ),
          502,
        );
        throw new Error("fixture callback failure");
      }),
      /fixture callback failure/,
    );
    assert.deepEqual(received, []);
    await assert.rejects(fs.stat(path.dirname(proxyPath)), { code: "ENOENT" });
  });
});
