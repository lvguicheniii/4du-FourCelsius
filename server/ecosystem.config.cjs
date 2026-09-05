module.exports = {
  apps: [{
    name: 'sidu',
    script: 'src/index.js',
    cwd: '/opt/sidu',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '1G',
    kill_timeout: 10000,
    listen_timeout: 10000,
    restart_delay: 1000,
    exp_backoff_restart_delay: 100,
    merge_logs: true,
    time: true,
    env: {
      NODE_ENV: 'production',
    },
  }],
};
