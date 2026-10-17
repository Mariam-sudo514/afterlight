import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseOwnerArguments,
  validateCloudAuthSettings,
} from "../scripts/create-owner.mjs";

test("cloud owner setup requires explicit mode, disabled signup and confirmed email provider settings", () => {
  assert.deepEqual(parseOwnerArguments([]), { cloud: false, reset: false });
  assert.deepEqual(parseOwnerArguments(["--cloud", "--reset-password"]), {
    cloud: true,
    reset: true,
  });
  assert.throws(() => parseOwnerArguments(["--password=do-not-accept"]));
  assert.throws(() => parseOwnerArguments(["--cloud", "--cloud"]));
  const settings = {
    disable_signup: true,
    external: { email: true, anonymous_users: false },
  };
  assert.doesNotThrow(() => validateCloudAuthSettings(settings));
  assert.throws(
    () => validateCloudAuthSettings({ ...settings, disable_signup: false }),
    /отключите публичную регистрацию/,
  );
  assert.throws(
    () =>
      validateCloudAuthSettings({
        ...settings,
        external: { email: false, anonymous_users: false },
      }),
    /включите Email/,
  );
  assert.throws(
    () =>
      validateCloudAuthSettings({
        ...settings,
        external: { email: true, anonymous_users: true },
      }),
    /Anonymous/,
  );
  assert.throws(() => validateCloudAuthSettings({}), /регистрацию/);
});
