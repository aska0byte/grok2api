// grok2api pm2 守护配置（仅主服务，单进程）
// 用法（在 dist/grok2api 目录下）：
//   npm install -g pm2        # 如未安装 pm2
//   ./start.sh                # 或: pm2 start ecosystem.config.js
// 常用命令：
//   pm2 status / pm2 logs grok2api / pm2 restart grok2api / pm2 stop grok2api
module.exports = {
  apps: [
    {
      name: "grok2api",
      script: "./grok2api",
      args: "--config ./config.yaml",
      cwd: __dirname,
      interpreter: "none",          // 直接执行二进制，不经 node
      env: {
        GROK2API_QUALITY_GUARD_DIR: __dirname + "/qg",
      },
      max_restarts: 20,
      restart_delay: 5000,          // 崩溃后 5s 自动拉起
      autorestart: true,
      max_memory_restart: "1G",
      out_file: "./logs/grok2api.out.log",
      error_file: "./logs/grok2api.err.log",
      merge_logs: true,
      time: true,
    },
  ],
};
