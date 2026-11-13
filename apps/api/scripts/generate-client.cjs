const { spawnSync } = require('node:child_process');

// Generating the client only reads the schema. Database migrations run separately.
const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'generate'], {
  env: {
    ...process.env,
    DATABASE_URL: 'postgresql://localhost/generate',
  },
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
