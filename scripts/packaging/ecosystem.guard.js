// optional quality-guard sidecar (started by start.sh only when python3 exists)
// manage manually: pm2 start ecosystem.guard.js / pm2 stop grok2api-quality-guard
module.exports = {
  apps: [
    {
      name: "grok2api-quality-guard",
      script: "./egress-quality-guard/quality_guard.py",
      cwd: __dirname,
      interpreter: "./qg-python3",
      env: {
        GROK2API_QUALITY_GUARD_DIR: __dirname + "/qg",
        GROK2API_BASE_URL: "http://127.0.0.1:8000",
      },
      max_restarts: 20,
      restart_delay: 10000,
      autorestart: true,
      out_file: "./logs/guard.out.log",
      error_file: "./logs/guard.err.log",
      merge_logs: true,
      time: true,
    },
  ],
};
