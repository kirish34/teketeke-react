const { execSync } = require('child_process');

function getGitShaFallback() {
  try {
    const out = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] });
    return out.toString().trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

const commit =
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  process.env.GIT_COMMIT ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  getGitShaFallback();

const deployed_at = new Date().toISOString();

module.exports = {
  commit,
  deployed_at,
  service: 'teketeke-api',
};
