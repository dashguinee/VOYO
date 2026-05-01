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

// 3 lanes — all share chrome-profile-001 (only valid YouTube session as of 2026-05-01).
// Profiles 002/003 had expired Google sessions. cookie_lock in queue-worker.py handles
// concurrent reads safely. Bump LANES + add new profiles when sessions are re-established.
const LANES = 3;

const COMMON_ENV = {
  VOYO_SUPABASE_URL:      'https://anmgyxhnyhbyxzpjhxgx.supabase.co',
  VOYO_SUPABASE_ANON_KEY: process.env.VOYO_SUPABASE_ANON_KEY,
  R2_UPLOAD_BASE:         'https://voyo-edge.dash-webtv.workers.dev',
  R2_UPLOAD_SECRET:       process.env.R2_UPLOAD_SECRET,
  PYTHONUNBUFFERED:       '1',
  VOYO_CHROME_PROFILE:    '/opt/voyo/chrome-profile-001',
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
