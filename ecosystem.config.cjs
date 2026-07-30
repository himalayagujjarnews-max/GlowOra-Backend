/**
 * PM2 process manager config.
 *
 * `cluster` mode + `instances: 'max'` runs one Node process per CPU core,
 * all sharing port 5000 — instant multi-core scaling on a single server.
 * PM2 also auto-restarts crashed processes and enables zero-downtime reloads.
 *
 * Usage:
 *   npm i -g pm2
 *   pm2 start ecosystem.config.cjs
 *   pm2 reload glowora-api   # zero-downtime deploy
 *   pm2 logs / pm2 monit
 *
 * For BIGGER scale you run this same config on several servers behind a
 * load balancer (see SCALING.md). Redis (queue + socket adapter) makes that
 * multi-server setup work correctly.
 */
module.exports = {
  apps: [
    {
      name: 'glowora-api',
      script: 'server.js',
      instances: 'max',        // one worker per CPU core
      exec_mode: 'cluster',    // load-balance across workers
      max_memory_restart: '600M',
      env: { NODE_ENV: 'production' },
      // keep logs tidy
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
