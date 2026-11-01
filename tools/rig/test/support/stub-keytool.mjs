/**
 * Stands in for the JDK's keytool in the rig CLI's tests: `-genkeypair` and
 * `-list -v` on a PKCS12 store, with passwords only through `:env`. The
 * "keystore" is JSON holding a digest of its password, so `-list` can refuse
 * the wrong one as keytool does. Each call's argv is appended to
 * $STUB_KEYTOOL_LOG, so a test can check that no password was on it.
 *
 * STUB_KEYTOOL_FAIL=1 makes `-genkeypair` fail after writing half a file.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
if (process.env.STUB_KEYTOOL_LOG) appendFileSync(process.env.STUB_KEYTOOL_LOG, `${JSON.stringify(argv)}\n`);

const value = (flag) => {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
};
const fail = (message) => {
  console.error(`keytool error: ${message}`);
  process.exit(1);
};
const digest = (text) => createHash("sha256").update(text).digest("hex");

if (argv.some((arg) => arg === "-storepass" || arg === "-keypass")) fail("a password on the command line");
const passwordOf = (flag) => {
  const variable = value(`${flag}:env`);
  const password = variable === undefined ? undefined : process.env[variable];
  if (!password) fail(`${flag}:env names no variable that is set`);
  return password;
};
const keystore = value("-keystore");
if (!keystore) fail("-keystore is required");
if (value("-storetype") !== "PKCS12") fail("only PKCS12 here");
const storePassword = passwordOf("-storepass");

if (argv[0] === "-genkeypair") {
  if (passwordOf("-keypass") !== storePassword) fail("PKCS12 keeps one password");
  if (existsSync(keystore)) fail(`alias <${value("-alias")}> already exists`);
  if (process.env.STUB_KEYTOOL_FAIL === "1") {
    writeFileSync(keystore, "{");
    fail("the stub was told to fail");
  }
  writeFileSync(keystore, JSON.stringify({ alias: value("-alias"), dname: value("-dname"), password: digest(storePassword) }));
} else if (argv[0] === "-list") {
  const store = JSON.parse(readFileSync(keystore, "utf8"));
  if (store.password !== digest(storePassword)) fail("keystore password was incorrect");
  const fingerprint = digest(readFileSync(keystore, "utf8")).toUpperCase().match(/../g).join(":");
  console.log(`Alias name: ${store.alias}\nCertificate fingerprints:\n\t SHA256: ${fingerprint}`);
} else {
  fail(`unknown command ${argv[0]}`);
}
