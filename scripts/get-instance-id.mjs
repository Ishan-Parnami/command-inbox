// One-off helper: print your Corsair instance id(s) for CORSAIR_INSTANCE_ID.
// override: `node --env-file=.env.local scripts/get-instance-id.mjs my-name`

import { createClient } from "@corsair-dev/app";

const apiKey = process.env.CORSAIR_DEV_KEY;
if (!apiKey) {
  console.error("✗ CORSAIR_DEV_KEY not set — add your ch_... key to .env.local first.");
  process.exit(1);
}

const corsair = createClient({ apiKey });
const { instances } = await corsair.instances.list();

if (instances.length > 0) {
  console.log(`Found ${instances.length} instance(s):\n`);
  for (const i of instances) {
    console.log(`  name:  ${i.name}  (status: ${i.status})`);
    console.log(`  id:    ${i.id}\n`);
  }
  console.log("→ Copy the id into .env.local as CORSAIR_INSTANCE_ID");
} else {
  const name = process.argv[2] ?? "command-inbox";
  const created = await corsair.instances.create({ name });
  console.log(`Created instance "${created.name}".`);
  console.log(`→ CORSAIR_INSTANCE_ID=${created.id}`);
}
