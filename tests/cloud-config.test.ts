import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLOUD_URL,
  cloudEnvironment,
  validateCloudConfig,
} from "../scripts/cloud-config.mjs";

const values = {
  SUPABASE_URL: CLOUD_URL,
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_technical_fixture_not_a_real_key",
  SUPABASE_SECRET_KEY: "sb_secret_technical_fixture_not_a_real_key",
  SITE_ORIGIN: "https://afterlight.example",
  ALLOWED_ORIGINS: "https://afterlight.example",
};

test("cloud configuration pins the target project and prevents local env key fallback", () => {
  const config = validateCloudConfig(values, {
    requireSecret: true,
    requireSite: true,
  });
  const env = cloudEnvironment(config);
  assert.equal(config.projectRef, "npadcumzuahkqulhpimi");
  assert.equal(env.SUPABASE_ANON_KEY, "");
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, "");
  assert.equal(env.SUPABASE_SECRET_KEY, values.SUPABASE_SECRET_KEY);
  for (const url of [
    "http://127.0.0.1:55431",
    "https://wrong-project.supabase.co",
    CLOUD_URL + "/evil",
  ]) {
    assert.throws(
      () => validateCloudConfig({ ...values, SUPABASE_URL: url }),
      /должен соответствовать проекту/,
    );
  }
});

test("cloud mutations/build require their missing credentials, with errors that omit secrets", () => {
  const incomplete = {
    ...values,
    SUPABASE_SECRET_KEY: "",
    SITE_ORIGIN: "",
    ALLOWED_ORIGINS: "",
  };
  assert.doesNotThrow(() => validateCloudConfig(incomplete));
  assert.throws(
    () => validateCloudConfig(incomplete, { requireSecret: true }),
    /Нужен серверный Secret key/,
  );
  assert.throws(
    () => validateCloudConfig(incomplete, { requireSite: true }),
    /Адрес Vercel/,
  );
  assert.throws(
    () =>
      validateCloudConfig({
        ...values,
        SUPABASE_PUBLISHABLE_KEY: values.SUPABASE_SECRET_KEY,
      }),
    (error) =>
      error instanceof Error &&
      !error.message.includes(values.SUPABASE_SECRET_KEY),
  );
  assert.throws(
    () =>
      validateCloudConfig({
        ...values,
        ALLOWED_ORIGINS: "https://*.vercel.app",
      }),
    /wildcard/,
  );
  assert.throws(
    () =>
      validateCloudConfig({
        ...values,
        ALLOWED_ORIGINS: "https://unrelated.example",
      }),
    /должен включать SITE_ORIGIN/,
  );
});
