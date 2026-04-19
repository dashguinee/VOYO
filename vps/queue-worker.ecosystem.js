// pm2 ecosystem for the Egyptian lanes — always-on VPS queue workers.
//
// Each lane:
//   • owns a distinct WORKER_ID so claim_upload_queue treats them as separate
//     claimers (SELECT ... FOR UPDATE SKIP LOCKED prevents collisions)
//   • uses a distinct Chrome profile (cookie diversity + viewer-geo diversity)
//   • restarts forever via pm2 (if the script dies, pm2 respawns in ~1s)
//
// Deploy:
//   scp vps/queue-worker.py vps/queue-worker.ecosystem.js vps:/opt/voyo/
//   ssh vps 'sudo PM2_HOME=/root/.pm2 pm2 start /opt/voyo/queue-worker.ecosystem.js'
//   ssh vps 'sudo PM2_HOME=/root/.pm2 pm2 save'   # persist across reboot
//
// Add more lanes: bump LANES and ensure /opt/voyo/chrome-profile-NNN exists.

// Start with 2 — VPS has chrome-profile-001 and 002. To add lane 003, create
// the third profile first (clone 001: sudo cp -r /opt/voyo/chrome-profile-001
// /opt/voyo/chrome-profile-003 && sign in to YT in that profile).
const LANES = 2;

const COMMON_ENV = {
  VOYO_SUPABASE_URL:      'https://anmgyxhnyhbyxzpjhxgx.supabase.co',
  VOYO_SUPABASE_ANON_KEY: process.env.VOYO_SUPABASE_ANON_KEY,
  R2_UPLOAD_BASE:         'https://voyo-edge.dash-webtv.workers.dev',
  PYTHONUNBUFFERED:       '1',
};

module.exports = {
  apps: Array.from({ length: LANES }, (_, i) => {
    const n = String(i + 1).padStart(3, '0');
    return {
      name:          `voyo-lane-${n}`,
      script:        '/opt/voyo/queue-worker.py',
      interpreter:   '/usr/bin/python3',
      cwd:           '/opt/voyo',
      env: {
        ...COMMON_ENV,
        VOYO_LANE_ID:        `vps-lane-${n}`,
        VOYO_CHROME_PROFILE: `/opt/voyo/chrome-profile-${n}`,
      },
      autorestart:   true,
      restart_delay: 2000,
      max_restarts:  50,          // per 15-min rolling window
      max_memory_restart: '512M', // leak safety
      error_file:    `/var/log/voyo/lane-${n}-err.log`,
      out_file:      `/var/log/voyo/lane-${n}-out.log`,
      merge_logs:    true,
      kill_timeout:  30000,       // give current extraction 30s to finish on stop
    };
  }),
};
