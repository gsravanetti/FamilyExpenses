import { writeFileSync } from "node:fs";

const required = ["GOOGLE_CLIENT_SECRET", "SESSION_SECRET", "ALLOWED_EMAILS"];
const missing = required.filter((name) => !process.env[name]);

if (missing.length) {
  console.error(`Missing required build variables: ${missing.join(", ")}`);
  process.exit(1);
}

const secrets = Object.fromEntries(
  required.map((name) => [name, process.env[name]])
);

writeFileSync(".secrets.json", JSON.stringify(secrets), { mode: 0o600 });
console.log("Prepared encrypted Worker runtime secrets.");
